/**
 * État global de l'application : données locales (réactives), synchronisation, cours en direct,
 * et tous les calculs dérivés (positions, synthèse, répartition).
 */
import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import { liveQuery } from 'dexie';
import { fxKeyFor, type Account, type Asset, type CashFlow, type DailyClose, type EntityName, type Profile, type Transaction, type WatchlistItem } from '@pecule/shared';
import { db } from '@/db/local';
import { Repo } from '@/db/repo';
import { SyncEngine, type SyncState } from '@/sync/engine';
import { loadDaily } from '@/sync/history';
import { LivePrices, type LiveState } from '@/live/prices';
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
const sync = new SyncEngine(db);
const live = new LivePrices(db, `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
repo.onWrite(() => sync.schedule());

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

  const syncState = shallowRef<SyncState>(sync.state);
  const liveState = shallowRef<LiveState>(live.state);
  const daily = shallowRef<Record<string, DailyClose[]>>({});
  const now = ref(Date.now());

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

  const history = computed(() => valueHistory(transactions.value, cashFlows.value, assets.value, daily.value, todayIso()));

  async function refreshHistory(): Promise<void> {
    const first = [...transactions.value.map((t) => t.tradeDate), ...cashFlows.value.map((f) => f.flowDate)].sort()[0];
    if (!first || trackedKeys.value.length === 0) return;
    daily.value = await loadDaily(db, trackedKeys.value, first);
  }

  async function init(): Promise<void> {
    if (ready.value) return;
    sync.subscribe((s) => (syncState.value = s));
    live.subscribe((s) => (liveState.value = s));
    watch(trackedKeys, (keys) => live.setTracked(keys), { immediate: true });
    await live.start();
    sync.start();
    setInterval(() => (now.value = Date.now()), 5000);
    // Premier lancement sur cet appareil : on attend la première synchro pour ne pas créer
    // de doublons (favoris par défaut) si un autre appareil a déjà tout configuré.
    await sync.syncNow();
    if ((await db.watchlistItem.count()) === 0 && sync.state.towerReachable === true) {
      for (const [i, w] of WATCHLIST_DEFAULTS.entries()) await repo.save('watchlistItem', { ...w, sortOrder: i });
    }
    ready.value = true;
    void refreshHistory();
    setInterval(() => void refreshHistory(), 30 * 60_000);
  }

  const save: Repo['save'] = (entity, draft) => repo.save(entity, draft);

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
    init,
    save,
    remove,
    refreshHistory,
    syncNow: () => sync.syncNow(),
    setTracked: (keys: string[]) => live.setTracked(keys),
  };
});

export { db, repo };
