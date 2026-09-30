/**
 * État global de l'application : données locales (réactives), synchronisation, cours en direct,
 * et tous les calculs dérivés (positions, synthèse, répartition).
 */
import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import { liveQuery } from 'dexie';
import { fxKeyFor, trainingStatus, type Account, type AgentTrade, type Asset, type CashFlow, type DailyClose, type EntityName, type Profile, type Transaction, type WatchlistItem } from '@pecule/shared';
import { AgentRunner, candidatesFrom, TRAINING_CAPITAL_CENTS, type Rejection } from '@/agent/runner';
import { db } from '@/db/local';
import { Repo } from '@/db/repo';
import { SyncEngine, type SyncState } from '@/sync/engine';
import { loadDaily } from '@/sync/history';
import { LivePrices, type LiveState } from '@/live/prices';
import { apiBase, getSettings, liveUrl, loadSettings, saveSettings, type DeviceSettings } from '@/device/settings';
import {
  allocationByPocket,
  computePositions,
  monthlyFlows,
  nextContributionSplit,
  summarize,
  valueHistory,
  valuePositions,
  type PriceMap,
} from '@/domain/portfolio';
import { todayIso } from '@/domain/format';
import { PROFILE_ID, WATCHLIST_DEFAULTS } from '@/domain/presets';

const repo = new Repo(db);
const sync = new SyncEngine(db, () => apiBase());
const live = new LivePrices(db, { towerWs: () => liveUrl(), twelveDataKey: () => getSettings().twelveDataKey });
repo.onWrite(() => sync.schedule());
const agent = new AgentRunner(repo);

function useTable<T extends { deleted: boolean }>(query: () => Promise<T[]>) {
  const data = shallowRef<T[]>([]);
  liveQuery(query).subscribe({ next: (rows) => (data.value = rows.filter((r) => !r.deleted)) });
  return data;
}

export const useAppStore = defineStore('app', () => {
  const ready = ref(false);
  const profiles = useTable<Profile>(() => db.profile.toArray());
  const accounts = useTable<Account>(() => db.account.toArray());
  const assets = useTable<Asset>(() => db.asset.toArray());
  const transactions = useTable<Transaction>(() => db.trades.toArray());
  const cashFlows = useTable<CashFlow>(() => db.cashFlow.toArray());
  const watchlist = useTable<WatchlistItem>(() => db.watchlistItem.toArray());
  const agentTrades = useTable<AgentTrade>(() => db.agentTrade.toArray());

  const syncState = shallowRef<SyncState>(sync.state);
  const liveState = shallowRef<LiveState>(live.state);
  const daily = shallowRef<Record<string, DailyClose[]>>({});
  const now = ref(Date.now());
  const settings = shallowRef<DeviceSettings>(getSettings());

  const profile = computed(() => profiles.value.find((p) => p.id === PROFILE_ID) ?? profiles.value[0]);
  const prices = computed<PriceMap>(() => liveState.value.prices);
  const positions = computed(() => computePositions(transactions.value, assets.value));
  const valued = computed(() => valuePositions(positions.value, prices.value));
  const summary = computed(() => summarize(valued.value, transactions.value, cashFlows.value));
  const allocation = computed(() => allocationByPocket(valued.value, profile.value));
  const nextSplit = computed(() =>
    // Phase 1 : l'agent n'existe pas encore, la poche levier ne reçoit rien.
    nextContributionSplit(allocation.value, profile.value?.monthlyContributionCents ?? 10_000, ['leverage']),
  );
  const flows = computed(() => monthlyFlows(cashFlows.value, transactions.value));

  /** Clés de cotation utiles : actifs, favoris, et taux de change pour les convertir. */
  /** Devise de chaque clé suivie (utile aux sources directes) */
  const trackedCurrencies = computed(() => {
    const map: Record<string, string> = {};
    for (const a of assets.value) if (a.quoteKey) map[a.quoteKey] = a.currency;
    for (const w of watchlist.value) map[w.quoteKey] = w.currency;
    return map;
  });

  const trackedKeys = computed(() => {
    const keys = new Set<string>();
    for (const a of assets.value) if (a.quoteKey) keys.add(a.quoteKey);
    for (const w of watchlist.value) keys.add(w.quoteKey);
    for (const c of new Set([...assets.value.map((a) => a.currency), ...watchlist.value.map((w) => w.currency)])) {
      const fx = fxKeyFor(c);
      if (fx) keys.add(fx);
    }
    return [...keys];
  });

  // --- Historique de marché (analyse et agent) -------------------------------------------
  const marketDaily = shallowRef<Record<string, DailyClose[]>>({});
  async function refreshMarketDaily(): Promise<void> {
    if (trackedKeys.value.length === 0) return;
    const from = new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 10);
    marketDaily.value = await loadDaily(db, trackedKeys.value, from);
  }

  // --- Agent (entraînement) --------------------------------------------------------------
  const rejections = shallowRef<Rejection[]>([]);
  const agentLastScan = ref<number | null>(null);
  const toEur = (price: number, currency: string): number | null => {
    const fx = fxKeyFor(currency);
    if (!fx) return price;
    const rate = liveState.value.prices[fx]?.p;
    return rate ? price / rate : null;
  };
  async function agentTick(): Promise<void> {
    await agent.tick({
      candidates: candidatesFrom(assets.value, watchlist.value),
      daily: marketDaily.value,
      prices: liveState.value.prices,
      trades: agentTrades.value,
      toEur,
    });
    rejections.value = [...agent.rejections];
    agentLastScan.value = agent.lastScanAt;
  }

  /** Référence : ce qu'aurait fait le capital d'entraînement placé sur l'ETF monde depuis le début. */
  const benchmark = computed(() => {
    const opened = agentTrades.value.filter((t) => t.openedAt).map((t) => t.openedAt!.slice(0, 10)).sort();
    const start = opened[0];
    const core = assets.value.find((a) => a.pocket === 'core' && a.quoteKey && (marketDaily.value[a.quoteKey]?.length ?? 0) > 0);
    if (!start || !core?.quoteKey) return null;
    const series = marketDaily.value[core.quoteKey]!;
    const atStart = [...series].reverse().find((d) => d.day <= start)?.close ?? series[0]?.close;
    const nowPrice = liveState.value.prices[core.quoteKey]?.p ?? series[series.length - 1]?.close;
    if (!atStart || !nowPrice) return null;
    return { name: core.name, pnlCents: Math.round(TRAINING_CAPITAL_CENTS * (nowPrice / atStart - 1)) };
  });
  const training = computed(() => trainingStatus(agentTrades.value, now.value, benchmark.value?.pnlCents ?? null));

  const history = computed(() => valueHistory(transactions.value, cashFlows.value, assets.value, daily.value, todayIso()));

  async function refreshHistory(): Promise<void> {
    const first = [...transactions.value.map((t) => t.tradeDate), ...cashFlows.value.map((f) => f.flowDate)].sort()[0];
    if (!first || trackedKeys.value.length === 0) return;
    daily.value = await loadDaily(db, trackedKeys.value, first);
  }

  async function init(): Promise<void> {
    if (ready.value) return;
    settings.value = await loadSettings(db);
    sync.subscribe((s) => (syncState.value = s));
    live.subscribe((s) => (liveState.value = s));
    watch(trackedKeys, (keys) => live.setTracked(keys, trackedCurrencies.value), { immediate: true });
    await live.start();
    sync.start();
    setInterval(() => (now.value = Date.now()), 5000);
    await sync.syncNow();
    // Favoris par défaut au premier lancement. Leurs identifiants sont fixes : s'ils sont créés
    // sur deux appareils avant la première synchro, ils fusionnent au lieu de se dédoubler.
    if ((await db.watchlistItem.count()) === 0) {
      for (const [i, w] of WATCHLIST_DEFAULTS.entries()) await repo.save('watchlistItem', { ...w, sortOrder: i });
    }
    ready.value = true;
    void refreshHistory();
    setInterval(() => void refreshHistory(), 30 * 60_000);
    // L'agent veille tant que l'application est ouverte
    void refreshMarketDaily().then(() => agentTick());
    setInterval(() => void refreshMarketDaily(), 6 * 3600_000);
    setInterval(() => void agentTick(), 30_000);
  }

  const save: Repo['save'] = (entity, draft) => repo.save(entity, draft);

  async function updateSettings(patch: Partial<DeviceSettings>): Promise<void> {
    settings.value = await saveSettings(db, patch);
    live.reconnect();
    await db.daily.clear(); // l'historique sera rechargé depuis la nouvelle source
    void sync.syncNow();
    void refreshHistory();
  }

  /** Vérifie qu'une adresse répond bien comme une tour Pécule. */
  async function testTower(url: string): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
      const body = (await res.json()) as { ok?: boolean };
      return body.ok ? { ok: true, message: 'La tour répond.' } : { ok: false, message: 'La tour répond, mais sa base est indisponible.' };
    } catch {
      return { ok: false, message: 'Aucune réponse. Vérifie que Tailscale est actif sur ce téléphone et que la tour est allumée.' };
    }
  }

  function setManualPrice(quoteKey: string, price: number, currency: string): void {
    live.setManual(quoteKey, price, currency);
  }

  function remove(entity: EntityName, id: string) {
    return repo.remove(entity, id);
  }

  return {
    ready,
    profile,
    accounts,
    assets,
    transactions,
    cashFlows,
    watchlist,
    syncState,
    liveState,
    prices,
    positions,
    valued,
    summary,
    allocation,
    nextSplit,
    flows,
    history,
    daily,
    trackedKeys,
    now,
    agentTrades,
    marketDaily,
    rejections,
    agentLastScan,
    benchmark,
    training,
    trainingCapitalCents: TRAINING_CAPITAL_CENTS,
    agentTick,
    acceptTrade: (t: AgentTrade) => agent.accept(t, liveState.value.prices[t.quoteKey]?.p),
    rejectTrade: (t: AgentTrade) => agent.reject(t),
    closeTrade: (t: AgentTrade) => {
      const price = liveState.value.prices[t.quoteKey]?.p;
      return price ? agent.closeNow(t, price) : Promise.resolve();
    },
    settings,
    updateSettings,
    testTower,
    setManualPrice,
    init,
    save,
    remove,
    refreshHistory,
    syncNow: () => sync.syncNow(),
  };
});

export { db, repo };
