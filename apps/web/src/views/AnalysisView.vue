<script setup lang="ts">
/**
 * Phase 2 : analyse.
 * Simulation Monte-Carlo du plan, statistiques des actifs, frontière efficiente,
 * et test d'une stratégie sur des périodes jamais vues (walk-forward).
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { efficientFrontier, jointEstimates, monteCarlo, walkForward, type DailyClose, type MonteCarloResult } from '@pecule/shared';
import { useAppStore, db } from '@/stores/app';
import { loadDaily } from '@/sync/history';
import { formatEuros, formatPct, parseEuros } from '@/domain/format';
import { pocketHypotheses, statsByAsset, toBuckets } from '@/domain/planning';
import FanChart from '@/components/FanChart.vue';
import FrontierChart from '@/components/FrontierChart.vue';

const RISK_FREE = 0.02;
const app = useAppStore();

// --- Historique ------------------------------------------------------------------------
const daily = shallowRef<Record<string, DailyClose[]>>({});
const loadingHistory = ref(true);
onMounted(async () => {
  const from = new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 10);
  daily.value = await loadDaily(db, app.trackedKeys, from);
  loadingHistory.value = false;
});

const stats = computed(() => statsByAsset(app.assets, daily.value, RISK_FREE));

// --- Simulation -----------------------------------------------------------------------
const monthly = ref(String((app.profile?.monthlyContributionCents ?? 10_000) / 100));
const years = ref(app.profile?.horizonYears ?? 5);
const includeLeverage = ref(false);
const startFromToday = ref(true);
const running = ref(false);
const result = shallowRef<MonteCarloResult | null>(null);

const hypotheses = computed(() => pocketHypotheses(app.profile, stats.value, { includeLeverage: includeLeverage.value }));
const drawdownLimit = computed(() => (app.profile?.maxDrawdownPct ?? 30) / 100);

async function run(): Promise<void> {
  const cents = parseEuros(monthly.value) ?? 10_000;
  running.value = true;
  // Laisse le temps d'afficher « Calcul… » avant le calcul (quelques centaines de millisecondes)
  await new Promise((r) => setTimeout(r, 30));
  const { buckets, correlation } = toBuckets(hypotheses.value);
  result.value = monteCarlo({
    buckets,
    correlation,
    initialCents: startFromToday.value ? Math.max(0, app.summary.totalCents) : 0,
    monthlyCents: cents,
    months: years.value * 12,
    paths: 5000,
    seed: 2026,
    drawdownLimit: drawdownLimit.value,
  });
  running.value = false;
}
onMounted(() => void run());
watch([includeLeverage, startFromToday], () => void run());

// --- Frontière efficiente ------------------------------------------------------------------
const frontier = computed(() => {
  const usable = stats.value.filter((s) => s.stats.days >= 120).slice(0, 8);
  if (usable.length < 2) return null;
  const est = jointEstimates(usable.map((s) => daily.value[s.asset.quoteKey!]!));
  if (!est) return null;
  const f = efficientFrontier(est.mu, est.cov, { samples: 4000, riskFree: RISK_FREE, maxWeight: 0.6 });
  return {
    ...f,
    days: est.days,
    names: usable.map((s) => s.asset.name),
    assets: usable.map((s, i) => ({ name: s.asset.symbol, ret: est.mu[i]!, vol: Math.sqrt(est.cov[i]![i]!) })),
  };
});

// --- Test de stratégie --------------------------------------------------------------
const testable = computed(() => stats.value.filter((s) => s.stats.days >= 400));
const strategyAsset = ref<string>('');
watch(testable, (list) => {
  if (!strategyAsset.value && list[0]) strategyAsset.value = list[0].asset.id;
}, { immediate: true });
const strategy = computed(() => {
  const s = testable.value.find((x) => x.asset.id === strategyAsset.value);
  if (!s) return null;
  return walkForward(daily.value[s.asset.quoteKey!]!, { monthlyCents: 10_000, feeRate: 0.002 });
});

const verdictText = {
  better: 'Le filtre de tendance a fait mieux que l’achat simple sur la plupart des périodes qu’il n’avait jamais vues.',
  worse: 'Le filtre de tendance a fait moins bien que l’achat simple : acheter chaque mois sans rien faire reste le meilleur choix ici.',
  inconclusive: 'Résultat trop partagé pour conclure : dans le doute, l’achat simple reste le choix par défaut.',
} as const;
const pct0 = (v: number) => `${Math.round(v * 100)} %`;
</script>

<template>
  <div class="space-y-4">
    <section class="card space-y-4 p-5">
      <div>
        <h2 class="text-[16px] font-semibold">Où peut aller ton plan ?</h2>
        <p class="mt-1 text-[13px] text-ink-2">5 000 futurs simulés, avec des krachs plus fréquents qu’une loi normale ne le prévoit. Ce ne sont pas des prévisions : c’est la fourchette de ce qui peut raisonnablement arriver.</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block"><span class="label">Versement mensuel (€)</span><input id="mc-monthly" v-model="monthly" class="field num" inputmode="decimal" @change="run" /></label>
        <label class="block"><span class="label">Horizon : {{ years }} an{{ years > 1 ? 's' : '' }}</span><input id="mc-years" v-model.number="years" type="range" min="1" max="30" class="mt-3 w-full accent-[var(--accent)]" @change="run" /></label>
      </div>
      <div class="flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
        <label class="flex items-center gap-2"><input id="mc-start" v-model="startFromToday" type="checkbox" class="size-4 accent-[var(--accent)]" /> Partir de mon portefeuille actuel</label>
        <label class="flex items-center gap-2"><input id="mc-lev" v-model="includeLeverage" type="checkbox" class="size-4 accent-[var(--accent)]" /> Inclure la poche levier</label>
      </div>

      <p v-if="running" class="py-16 text-center text-[14px] text-ink-2">Calcul…</p>
      <template v-else-if="result">
        <FanChart :result="result" />
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">Cas défavorable (1 sur 10)</div><div class="num text-[18px] font-semibold">{{ formatEuros(result.final.p10, { round: true }) }}</div></div>
          <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">Cas médian</div><div class="num text-[18px] font-semibold">{{ formatEuros(result.final.p50, { round: true }) }}</div></div>
          <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">Cas favorable (1 sur 10)</div><div class="num text-[18px] font-semibold">{{ formatEuros(result.final.p90, { round: true }) }}</div></div>
          <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">Argent versé</div><div class="num text-[18px] font-semibold">{{ formatEuros(result.totalInvestedCents, { round: true }) }}</div></div>
        </div>
        <ul class="space-y-1 text-[14px]">
          <li>Probabilité de finir avec <b>moins que l’argent versé</b> : <b class="num">{{ pct0(result.probLoss) }}</b></li>
          <li v-if="result.probDrawdownBreach !== null">
            Probabilité de voir, en chemin, une <b>baisse de plus de {{ Math.round(drawdownLimit * 100) }} %</b> (ta limite) : <b class="num">{{ pct0(result.probDrawdownBreach) }}</b>
          </li>
          <li>Pire baisse en chemin dans le cas médian : <b class="num">{{ formatPct(result.medianMaxDrawdown * 100, false) }}</b></li>
        </ul>
        <details class="text-[13px]">
          <summary class="cursor-pointer font-semibold text-ink-2">Hypothèses utilisées</summary>
          <div class="mt-2 overflow-x-auto">
            <table class="num w-full text-left">
              <thead class="text-ink-2"><tr><th class="py-1 pr-3 font-medium">Poche</th><th class="pr-3 font-medium">Part</th><th class="pr-3 font-medium">Rendement/an</th><th class="pr-3 font-medium">Volatilité</th><th class="font-medium">Source</th></tr></thead>
              <tbody>
                <tr v-for="h in hypotheses" :key="h.pocket" class="border-t border-line">
                  <td class="py-1 pr-3">{{ h.label }}</td><td class="pr-3">{{ pct0(h.weight) }}</td><td class="pr-3">{{ (h.mu * 100).toFixed(1).replace('.', ',') }} %</td><td class="pr-3">{{ pct0(h.sigma) }}</td><td class="text-ink-2">{{ h.source }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mt-2 text-muted">Rééquilibrage chaque mois vers ta cible, loi de Student à 4 degrés de liberté, corrélations par défaut entre poches. Le levier est modélisé avec perte totale possible.</p>
        </details>
      </template>
    </section>

    <section class="card p-5">
      <h2 class="text-[16px] font-semibold">Tes actifs à la loupe</h2>
      <p class="mt-1 text-[13px] text-ink-2">Ce qui s’est passé sur l’historique disponible. Taux sans risque retenu : 2 %.</p>
      <p v-if="loadingHistory" class="py-6 text-center text-[14px] text-ink-2">Chargement de l’historique…</p>
      <p v-else-if="!stats.length" class="py-6 text-center text-[14px] text-ink-2">Pas encore assez d’historique (30 jours minimum par actif).</p>
      <div v-else class="mt-3 overflow-x-auto">
        <table class="num w-full min-w-[520px] text-left text-[14px]">
          <thead class="text-[12px] text-ink-2">
            <tr><th class="py-1.5 pr-3 font-medium">Actif</th><th class="pr-3 font-medium">Rendement/an</th><th class="pr-3 font-medium">Volatilité</th><th class="pr-3 font-medium">Sharpe</th><th class="pr-3 font-medium">Pire baisse</th><th class="font-medium">Période</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in stats" :key="s.asset.id" class="border-t border-line">
              <td class="py-2 pr-3 font-medium">{{ s.asset.name }}</td>
              <td class="pr-3" :class="s.stats.cagr >= 0 ? 'text-up' : 'text-down'">{{ formatPct(s.stats.cagr * 100) }}</td>
              <td class="pr-3">{{ pct0(s.stats.volatility) }}</td>
              <td class="pr-3">{{ s.stats.sharpe === null ? '—' : s.stats.sharpe.toFixed(2).replace('.', ',') }}</td>
              <td class="pr-3 text-down">{{ formatPct(s.stats.maxDrawdown * 100, false) }}</td>
              <td class="text-ink-2">{{ s.stats.years.toFixed(1).replace('.', ',') }} an{{ s.stats.years >= 2 ? 's' : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-[12px] text-muted">Sharpe : rendement gagné au-delà du taux sans risque, par unité de risque. Au-dessus de 1, c’est très bon ; sous 0, le risque n’a pas payé.</p>
    </section>

    <section class="card p-5">
      <h2 class="text-[16px] font-semibold">Meilleure répartition sur le passé</h2>
      <p class="mt-1 text-[13px] text-ink-2">Méthode de Markowitz : 4 000 mélanges de tes actifs, sans dépasser 60 % sur un seul.</p>
      <p v-if="!frontier" class="py-6 text-center text-[14px] text-ink-2">Il faut au moins deux actifs avec 120 jours d’historique commun.</p>
      <template v-else>
        <FrontierChart :points="frontier.points" :best="frontier.maxSharpe" :assets="frontier.assets" />
        <h3 class="mt-3 text-[14px] font-semibold">Meilleur rapport rendement/risque constaté</h3>
        <ul class="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 text-[14px] sm:grid-cols-2 md:grid-cols-3">
          <li v-for="(name, i) in frontier.names" :key="name" class="flex justify-between gap-3"><span class="truncate">{{ name }}</span><b class="num">{{ pct0(frontier.maxSharpe.weights[i]!) }}</b></li>
        </ul>
        <p class="mt-2 text-[12px] text-muted">
          Calculé sur {{ frontier.days }} jours communs. Le passé récent favorise ce qui vient de monter : garde ta répartition cible comme référence et utilise ceci comme un éclairage, pas comme une consigne.
        </p>
      </template>
    </section>

    <section class="card p-5">
      <h2 class="text-[16px] font-semibold">Tester une stratégie</h2>
      <p class="mt-1 text-[13px] text-ink-2">
        Achat chaque mois, avec ou sans filtre de tendance (rester en liquidités quand le cours passe sous sa moyenne mobile).
        Le réglage est choisi sur une année, puis jugé sur les trois mois suivants, jamais vus. Frais de 0,2 % par ordre.
      </p>
      <p v-if="!testable.length" class="py-6 text-center text-[14px] text-ink-2">Il faut au moins 400 jours d’historique sur un actif.</p>
      <template v-else>
        <label class="mt-3 block max-w-sm">
          <span class="label">Actif</span>
          <select id="wf-asset" v-model="strategyAsset" class="field">
            <option v-for="s in testable" :key="s.asset.id" :value="s.asset.id">{{ s.asset.name }}</option>
          </select>
        </label>
        <template v-if="strategy">
          <p class="mt-3 text-[15px] font-medium">{{ verdictText[strategy.verdict] }}</p>
          <div class="mt-3 grid grid-cols-3 gap-3 text-[14px]">
            <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">Périodes testées</div><div class="num text-[18px] font-semibold">{{ strategy.folds.length }}</div></div>
            <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">Gagnées par le filtre</div><div class="num text-[18px] font-semibold">{{ pct0(strategy.winRate) }}</div></div>
            <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">Gain moyen filtre / simple</div><div class="num text-[18px] font-semibold">{{ formatPct(strategy.strategyGainAvg * 100) }} / {{ formatPct(strategy.baselineGainAvg * 100) }}</div></div>
          </div>
        </template>
      </template>
    </section>
  </div>
</template>
