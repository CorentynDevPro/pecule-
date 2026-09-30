<script setup lang="ts">
/** Phase 3 : l'agent, en mode entraînement (argent fictif). */
import { computed } from 'vue';
import { AGENT_LIMITS, type AgentTrade } from '@pecule/shared';
import { useAppStore } from '@/stores/app';
import { formatAge, formatEuros, formatPct, formatPrice } from '@/domain/format';

const app = useAppStore();

const byDate = (a: AgentTrade, b: AgentTrade) => (a.proposedAt < b.proposedAt ? 1 : -1);
const proposals = computed(() => app.agentTrades.filter((t) => t.status === 'proposed').sort(byDate));
const open = computed(() => app.agentTrades.filter((t) => t.status === 'open').sort(byDate));
const journal = computed(() => app.agentTrades.filter((t) => ['closed', 'rejected', 'expired'].includes(t.status)).sort(byDate).slice(0, 40));

const ruleName = { trend: 'Cassure de tendance', reversion: 'Retour à la moyenne' } as const;
const exitName = { target: 'objectif atteint', stop: 'stop touché', manual: 'fermée à la main', time: 'durée maximale' } as const;
const statusName = { rejected: 'refusée par toi', expired: 'expirée sans réponse' } as const;

const livePrice = (t: AgentTrade) => app.liveState.prices[t.quoteKey]?.p;
const pctFrom = (from: number, to: number) => formatPct((to / from - 1) * 100);
const livePnl = (t: AgentTrade) => {
  const p = livePrice(t);
  if (!p) return null;
  return Math.round(Math.max(-t.stakeCents, t.stakeCents * t.leverage * (p / t.entryPrice - 1 - 2 * AGENT_LIMITS.feeRate)));
};
/** Position du cours entre le stop (0 %) et l'objectif (100 %) */
const progress = (t: AgentTrade) => {
  const p = livePrice(t);
  if (!p) return 50;
  return Math.min(100, Math.max(0, ((p - t.stopPrice) / (t.targetPrice - t.stopPrice)) * 100));
};
const riskOf = (t: AgentTrade) => Math.round(t.stakeCents * t.leverage * (1 - t.stopPrice / t.entryPrice));
const rewardOf = (t: AgentTrade) => Math.round(t.stakeCents * t.leverage * (t.targetPrice / t.entryPrice - 1));
const tone = (v: number | null) => (v === null || v === 0 ? 'text-ink-2' : v > 0 ? 'text-up' : 'text-down');
</script>

<template>
  <div class="space-y-4">
    <section class="card p-5">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-[16px] font-semibold">Entraînement</h2>
        <span class="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold text-ink-2">argent fictif</span>
      </div>
      <p class="mt-1 text-[13px] text-ink-2">
        L’agent s’entraîne avec {{ formatEuros(app.trainingCapitalCents, { round: true }) }} fictifs. Aucun ordre ne part chez un courtier.
        Il passera à l’argent réel seulement après avoir prouvé qu’il fait mieux que l’ETF monde.
      </p>
      <div class="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">Résultat fictif</div><div class="num text-[18px] font-semibold" :class="tone(app.training.pnlCents)">{{ formatEuros(app.training.pnlCents, { signed: true }) }}</div></div>
        <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">ETF monde, même période</div><div class="num text-[18px] font-semibold">{{ app.benchmark ? formatEuros(app.benchmark.pnlCents, { signed: true }) : '—' }}</div></div>
        <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">Opérations fermées</div><div class="num text-[18px] font-semibold">{{ app.training.closedTrades }} <span class="text-[13px] font-normal text-ink-2">· {{ Math.round(app.training.winRate * 100) }} % gagnantes</span></div></div>
        <div class="rounded-xl bg-surface-2 p-3"><div class="text-[12px] text-ink-2">Jours d’entraînement</div><div class="num text-[18px] font-semibold">{{ app.training.daysTrained }} / {{ AGENT_LIMITS.trainingDays }}</div></div>
      </div>
      <div class="mt-3 h-2 rounded-full bg-surface-2" role="img" :aria-label="`${app.training.daysTrained} jours sur ${AGENT_LIMITS.trainingDays}`">
        <div class="h-full rounded-full bg-accent" :style="{ width: `${Math.min(100, (app.training.daysTrained / AGENT_LIMITS.trainingDays) * 100)}%` }" />
      </div>
      <p v-if="app.training.ready" class="mt-3 text-[14px] font-medium text-up">Entraînement réussi : l’agent peut passer à l’argent réel, dans la poche levier, une fois la tour en place.</p>
      <p v-else class="mt-3 text-[13px] text-ink-2">Avant l’argent réel : {{ app.training.missing.join(' · ') }}.</p>
      <div class="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted">
        <span>Dernière analyse {{ formatAge(app.agentLastScan, app.now) }}. Sur le téléphone, l’agent veille quand l’application est ouverte ; sur la tour, il veillera en continu.</span>
        <button class="btn-ghost shrink-0 py-1.5 text-[13px]" @click="app.agentTick()">Analyser</button>
      </div>
    </section>

    <section>
      <h2 class="mb-2 px-1 text-[16px] font-semibold">Propositions</h2>
      <p v-if="!proposals.length" class="card p-5 text-[14px] text-ink-2">
        Aucune opportunité ne passe le contrôle de risque pour l’instant. C’est normal : l’agent ne propose que des règles qui ont gagné par le passé, sur chaque moitié de l’historique, avec une perte limitée à 2 % du capital.
      </p>
      <ul class="space-y-3">
        <li v-for="t in proposals" :key="t.id" class="card space-y-3 p-4">
          <div class="flex items-baseline justify-between gap-3">
            <div>
              <div class="text-[16px] font-semibold">{{ t.assetName }}</div>
              <div class="text-[12px] text-ink-2">{{ ruleName[t.signal] }} · proposée {{ formatAge(Date.parse(t.proposedAt), app.now) }}</div>
            </div>
            <div class="num text-right text-[15px] font-semibold">{{ formatPrice(livePrice(t) ?? t.entryPrice, t.currency) }}</div>
          </div>
          <p class="text-[14px]">{{ t.reason }}</p>
          <dl class="num grid grid-cols-3 gap-2 text-[13px]">
            <div class="rounded-lg bg-surface-2 p-2"><dt class="text-ink-2">Stop</dt><dd class="font-semibold">{{ formatPrice(t.stopPrice, t.currency) }}</dd><dd class="text-down">{{ pctFrom(t.entryPrice, t.stopPrice) }}</dd></div>
            <div class="rounded-lg bg-surface-2 p-2"><dt class="text-ink-2">Objectif</dt><dd class="font-semibold">{{ formatPrice(t.targetPrice, t.currency) }}</dd><dd class="text-up">{{ pctFrom(t.entryPrice, t.targetPrice) }}</dd></div>
            <div class="rounded-lg bg-surface-2 p-2"><dt class="text-ink-2">Mise</dt><dd class="font-semibold">{{ formatEuros(t.stakeCents) }}</dd><dd class="text-ink-2">levier {{ t.leverage.toFixed(1).replace('.', ',') }}</dd></div>
          </dl>
          <p class="text-[13px]">
            Perte possible <b class="num text-down">{{ formatEuros(-riskOf(t)) }}</b> · gain visé <b class="num text-up">{{ formatEuros(rewardOf(t), { signed: true }) }}</b>
          </p>
          <p class="text-[12px] text-muted">
            Sur l’historique : {{ t.backtestSamples }} cas, {{ Math.round(t.backtestWinRate * 100) }} % gagnants, {{ formatPct(t.backtestExpectancyPct) }} en moyenne par opération, frais déduits.
          </p>
          <div class="flex gap-2">
            <button class="btn-primary flex-1" @click="app.acceptTrade(t)">Valider (fictif)</button>
            <button class="btn-ghost" @click="app.rejectTrade(t)">Refuser</button>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="open.length">
      <h2 class="mb-2 px-1 text-[16px] font-semibold">Positions fictives ouvertes</h2>
      <ul class="space-y-3">
        <li v-for="t in open" :key="t.id" class="card space-y-2 p-4">
          <div class="flex items-baseline justify-between gap-3">
            <div>
              <div class="text-[15px] font-semibold">{{ t.assetName }}</div>
              <div class="text-[12px] text-ink-2">{{ ruleName[t.signal] }} · ouverte {{ formatAge(Date.parse(t.openedAt!), app.now) }}</div>
            </div>
            <div class="num text-right text-[15px] font-semibold" :class="tone(livePnl(t))">{{ formatEuros(livePnl(t), { signed: true }) }}</div>
          </div>
          <div class="relative h-2 rounded-full bg-surface-2" role="img" :aria-label="`Cours entre le stop et l’objectif : ${Math.round(progress(t))} %`">
            <div class="absolute -top-1 h-4 w-1 rounded bg-ink" :style="{ left: `calc(${progress(t)}% - 2px)` }" />
          </div>
          <div class="num flex justify-between text-[11px] text-muted">
            <span>stop {{ formatPrice(t.stopPrice, t.currency) }}</span>
            <span>entrée {{ formatPrice(t.entryPrice, t.currency) }}</span>
            <span>objectif {{ formatPrice(t.targetPrice, t.currency) }}</span>
          </div>
          <button class="btn-ghost w-full py-2 text-[14px]" @click="app.closeTrade(t)">Fermer maintenant</button>
        </li>
      </ul>
    </section>

    <section class="card p-4">
      <h2 class="mb-2 text-[16px] font-semibold">Journal</h2>
      <p v-if="!journal.length" class="text-[14px] text-ink-2">Chaque décision de l’agent sera consignée ici, avec son résultat.</p>
      <ul class="divide-y divide-line">
        <li v-for="t in journal" :key="t.id" class="flex items-center gap-3 py-2.5 text-[14px]">
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ t.assetName }} · {{ ruleName[t.signal] }}</span>
            <span class="block text-[12px] text-ink-2">
              {{ t.status === 'closed' ? exitName[t.exitReason ?? 'manual'] : statusName[t.status as 'rejected' | 'expired'] }}
              · {{ new Date(t.closedAt ?? t.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) }}
            </span>
          </span>
          <span v-if="t.status === 'closed'" class="num shrink-0 font-semibold" :class="tone(t.pnlCents)">{{ formatEuros(t.pnlCents, { signed: true }) }}</span>
        </li>
      </ul>
    </section>

    <section v-if="app.rejections.length" class="card p-4">
      <h2 class="mb-1 text-[16px] font-semibold">Écartées par le contrôle de risque</h2>
      <p class="mb-2 text-[12px] text-muted">Signaux repérés aujourd’hui mais bloqués avant de t’être proposés.</p>
      <ul class="divide-y divide-line">
        <li v-for="r in app.rejections" :key="`${r.name}-${r.kind}`" class="py-2 text-[13px]">
          <b class="font-medium">{{ r.name }}</b> · {{ ruleName[r.kind] }}
          <ul class="mt-0.5 list-disc pl-5 text-ink-2"><li v-for="f in r.failed" :key="f">{{ f }}</li></ul>
        </li>
      </ul>
    </section>

    <section class="card space-y-1.5 p-4 text-[13px]">
      <h2 class="mb-1 text-[16px] font-semibold">Règles que l’agent ne peut pas modifier</h2>
      <p>Un stop est posé à chaque position ; la perte au stop ne dépasse jamais 2 % du capital.</p>
      <p>Au plus {{ AGENT_LIMITS.maxOpenPositions }} positions ouvertes, jamais deux sur le même actif.</p>
      <p>Levier au plus {{ AGENT_LIMITS.maxLeverage }}, et {{ AGENT_LIMITS.maxLeverageCrypto }} sur la crypto (plafonds européens pour les particuliers).</p>
      <p>Coupe-circuit : l’agent s’arrête si ses pertes du mois dépassent {{ AGENT_LIMITS.monthlyLossLimit * 100 }} % du capital.</p>
      <p>Une position dure au plus {{ AGENT_LIMITS.maxHoldDays }} jours ; une proposition expire après 2 heures.</p>
    </section>
  </div>
</template>
