<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CashFlow } from '@pecule/shared';
import { useAppStore } from '@/stores/app';
import Sheet from '@/components/Sheet.vue';
import StatTile from '@/components/StatTile.vue';
import FlowsChart from '@/components/FlowsChart.vue';
import CashFlowForm from '@/components/forms/CashFlowForm.vue';
import AccountForm from '@/components/forms/AccountForm.vue';
import { formatDate, formatEuros } from '@/domain/format';

const app = useAppStore();
const panel = ref<{ kind: 'flow'; flow?: CashFlow } | { kind: 'account' } | null>(null);

const totals = computed(() => {
  let deposits = 0;
  let withdrawals = 0;
  for (const f of app.cashFlows) f.amountCents > 0 ? (deposits += f.amountCents) : (withdrawals -= f.amountCents);
  const dividends = app.transactions.filter((t) => t.kind === 'dividend').reduce((s, t) => s + t.amountCents, 0);
  const fees = app.transactions.reduce((s, t) => s + (t.kind === 'fee' ? t.amountCents : t.feeCents), 0);
  return { deposits, withdrawals, dividends, fees };
});

const list = computed(() => [...app.cashFlows].sort((a, b) => (a.flowDate < b.flowDate ? 1 : -1)));
const accountName = (id: string) => app.accounts.find((a) => a.id === id)?.name ?? '—';
</script>

<template>
  <div class="space-y-4">
    <button class="btn-primary" @click="panel = { kind: 'flow' }">+ Versement ou retrait</button>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label="Versé" :value="formatEuros(totals.deposits, { round: true })" />
      <StatTile label="Retiré" :value="formatEuros(totals.withdrawals, { round: true })" />
      <StatTile label="Dividendes reçus" :value="formatEuros(totals.dividends)" />
      <StatTile label="Frais payés" :value="formatEuros(totals.fees)" hint="courtage et droits de garde" />
    </div>

    <section v-if="app.flows.length" class="card p-4">
      <h2 class="mb-2 text-[16px] font-semibold">Entrées et sorties par mois</h2>
      <FlowsChart :months="app.flows" />
    </section>

    <section class="card p-4">
      <h2 class="mb-2 text-[16px] font-semibold">Mouvements</h2>
      <p v-if="!list.length" class="text-[14px] text-ink-2">
        Enregistre ici chaque versement sur tes comptes : c’est ce qui permet de calculer ton vrai gain.
      </p>
      <ul class="divide-y divide-line">
        <li v-for="f in list" :key="f.id">
          <button class="flex w-full items-center gap-3 py-2.5 text-left" @click="panel = { kind: 'flow', flow: f }">
            <span class="w-24 shrink-0 text-[12px] text-ink-2">{{ formatDate(f.flowDate) }}</span>
            <span class="min-w-0 flex-1 truncate text-[14px]">{{ f.label || (f.amountCents > 0 ? 'Versement' : 'Retrait') }} · <span class="text-ink-2">{{ accountName(f.accountId) }}</span></span>
            <span class="num shrink-0 text-[14px] font-medium" :class="f.amountCents > 0 ? 'text-up' : 'text-down'">{{ formatEuros(f.amountCents, { signed: true }) }}</span>
          </button>
        </li>
      </ul>
    </section>

    <Sheet v-if="panel?.kind === 'flow'" :title="panel.flow ? 'Modifier le mouvement' : 'Nouveau mouvement'" @close="panel = null">
      <CashFlowForm :flow="panel.flow" @done="panel = null" @add-account="panel = { kind: 'account' }" />
    </Sheet>
    <Sheet v-if="panel?.kind === 'account'" title="Nouveau compte" @close="panel = null">
      <AccountForm @done="panel = { kind: 'flow' }" />
    </Sheet>
  </div>
</template>
