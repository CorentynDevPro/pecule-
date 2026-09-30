<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { POCKETS } from '@pecule/shared';
import { useAppStore } from '@/stores/app';
import StatTile from '@/components/StatTile.vue';
import AllocationBars from '@/components/AllocationBars.vue';
import ValueChart from '@/components/ValueChart.vue';
import { formatEuros, formatPct, POCKET_LABELS } from '@/domain/format';

const app = useAppStore();
const s = computed(() => app.summary);
const hasData = computed(() => app.transactions.length > 0 || app.cashFlows.length > 0);
const tone = (v: number | null) => (v === null || Math.abs(v) < 1 ? 'flat' : v > 0 ? 'up' : 'down') as 'up' | 'down' | 'flat';

const steps = computed(() => [
  { done: Boolean(app.profile), label: 'Régler ton profil et tes poches', to: '/profil' },
  { done: app.accounts.length > 0, label: 'Ajouter ton premier compte (PEA, plateforme crypto…)', to: '/portefeuille' },
  { done: app.assets.length > 0, label: 'Ajouter un actif depuis le catalogue', to: '/portefeuille' },
  { done: app.transactions.length > 0, label: 'Enregistrer ton premier achat', to: '/portefeuille' },
]);
</script>

<template>
  <div class="space-y-4">
    <section class="card p-5">
      <div class="text-[13px] text-ink-2">Patrimoine investi</div>
      <div class="mt-1 text-[44px] font-semibold leading-none tracking-tight md:text-[52px]">
        {{ formatEuros(s.totalCents) }}
      </div>
      <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
        <span :class="{ 'text-up': tone(s.gainCents) === 'up', 'text-down': tone(s.gainCents) === 'down' }" class="num font-medium">
          {{ formatEuros(s.gainCents, { signed: true }) }} ({{ formatPct(s.gainPct) }}) depuis le début
        </span>
        <span :class="{ 'text-up': tone(s.dayChangeCents) === 'up', 'text-down': tone(s.dayChangeCents) === 'down' }" class="num text-ink-2">
          {{ formatEuros(s.dayChangeCents, { signed: true }) }} aujourd’hui
        </span>
      </div>
    </section>

    <section v-if="!hasData || !app.profile" class="card p-5">
      <h2 class="text-[16px] font-semibold">Pour démarrer</h2>
      <ol class="mt-3 space-y-2">
        <li v-for="(step, i) in steps" :key="step.label">
          <RouterLink :to="step.to" class="flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2">
            <span
              class="grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold"
              :class="step.done ? 'bg-up text-white' : 'bg-surface-2 text-ink-2'"
            >{{ step.done ? '✓' : i + 1 }}</span>
            <span class="text-[14px]" :class="step.done ? 'text-muted line-through' : ''">{{ step.label }}</span>
          </RouterLink>
        </li>
      </ol>
    </section>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label="Argent versé" :value="formatEuros(s.netContributionsCents, { round: true })" :hint="s.contributionsEstimated && hasData ? 'estimé depuis tes achats' : undefined" />
      <StatTile label="Plus-value" :value="formatEuros(s.gainCents, { round: true, signed: true })" :delta="formatPct(s.gainPct)" :delta-tone="tone(s.gainCents)" />
      <StatTile label="Positions" :value="formatEuros(s.investedValueCents, { round: true })" :hint="`${app.valued.filter((p) => p.quantity > 0).length} actifs`" />
      <StatTile label="Liquidités" :value="formatEuros(s.cashCents, { round: true })" hint="sur tes comptes, non investies" />
    </div>

    <section v-if="app.history.length > 1" class="card p-4">
      <h2 class="mb-2 text-[16px] font-semibold">Évolution</h2>
      <ValueChart :points="app.history" />
    </section>

    <div class="grid gap-4 md:grid-cols-2">
      <section class="card p-5">
        <h2 class="mb-4 text-[16px] font-semibold">Répartition par poche</h2>
        <AllocationBars :allocations="app.allocation" />
      </section>

      <section class="card p-5">
        <h2 class="text-[16px] font-semibold">Ton prochain versement</h2>
        <p class="mt-1 text-[13px] text-ink-2">
          Pour revenir vers ta cible sans rien vendre (donc sans impôt), répartis tes
          {{ formatEuros(app.profile?.monthlyContributionCents ?? 10000, { round: true }) }} ainsi :
        </p>
        <ul class="mt-3 divide-y divide-line">
          <li v-for="p in POCKETS" :key="p" class="flex justify-between py-2 text-[15px]">
            <span>{{ POCKET_LABELS[p] }}</span>
            <b class="num">{{ formatEuros(app.nextSplit[p]) }}</b>
          </li>
        </ul>
        <p v-if="(app.profile?.targetLeveragePct ?? 0) > 0" class="mt-2 text-[12px] text-muted">
          La poche levier s’ouvrira avec l’agent, après ses trois mois d’entraînement (phase 3). D’ici là, sa part est répartie sur les autres poches.
        </p>
      </section>
    </div>

    <section v-if="s.missingPrices.length || (app.profile && !app.profile.emergencyFundOk)" class="card space-y-2 p-4 text-[13px]">
      <p v-if="app.profile && !app.profile.emergencyFundOk">
        <b>Épargne de précaution</b> — avant d’investir, garde 3 à 6 mois de dépenses sur un livret. Coche la case dans ton profil quand c’est fait.
      </p>
      <p v-if="s.missingPrices.length">
        <b>Cours manquant</b> — {{ s.missingPrices.join(', ') }} : valorisé au prix d’achat en attendant un cours.
      </p>
    </section>
  </div>
</template>
