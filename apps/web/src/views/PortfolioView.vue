<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Account, Asset, Transaction } from '@pecule/shared';
import { POCKETS } from '@pecule/shared';
import { useAppStore } from '@/stores/app';
import Sheet from '@/components/Sheet.vue';
import PriceAge from '@/components/PriceAge.vue';
import AccountForm from '@/components/forms/AccountForm.vue';
import AssetForm from '@/components/forms/AssetForm.vue';
import TransactionForm from '@/components/forms/TransactionForm.vue';
import { ACCOUNT_LABELS, formatDate, formatEuros, formatPct, formatPrice, formatQuantity, KIND_LABELS, POCKET_LABELS } from '@/domain/format';

const app = useAppStore();

type Panel =
  | { kind: 'account'; account?: Account }
  | { kind: 'asset'; asset?: Asset }
  | { kind: 'tx'; transaction?: Transaction; assetId?: string };
const panel = ref<Panel | null>(null);

const groups = computed(() =>
  POCKETS.map((pocket) => ({
    pocket,
    rows: app.valued.filter((p) => p.asset.pocket === pocket && p.quantity > 0),
    total: app.valued.filter((p) => p.asset.pocket === pocket).reduce((s, p) => s + (p.valueCents ?? p.costCents), 0),
  })).filter((g) => g.rows.length > 0),
);

const unheldAssets = computed(() => {
  const held = new Set(app.valued.filter((p) => p.quantity > 0).map((p) => p.asset.id));
  return app.assets.filter((a) => !held.has(a.id));
});

const recent = computed(() =>
  [...app.transactions].sort((a, b) => (a.tradeDate === b.tradeDate ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.tradeDate < b.tradeDate ? 1 : -1)).slice(0, 50),
);
const assetName = (id: string) => app.assets.find((a) => a.id === id)?.name ?? 'Actif supprimé';
const tickOf = (a: Asset) => (a.quoteKey ? app.liveState.prices[a.quoteKey] : undefined);
const pnlClass = (v: number | null) => (v === null || v === 0 ? 'text-ink-2' : v > 0 ? 'text-up' : 'text-down');
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap gap-2">
      <button class="btn-primary" @click="panel = { kind: 'tx' }">+ Opération</button>
      <button class="btn-ghost" @click="panel = { kind: 'asset' }">+ Actif</button>
      <button class="btn-ghost" @click="panel = { kind: 'account' }">+ Compte</button>
    </div>

    <section v-for="g in groups" :key="g.pocket" class="card overflow-hidden">
      <header class="flex items-baseline justify-between px-4 pt-4 pb-2">
        <h2 class="text-[16px] font-semibold">{{ POCKET_LABELS[g.pocket] }}</h2>
        <span class="num text-[14px] text-ink-2">{{ formatEuros(g.total, { round: true }) }}</span>
      </header>
      <ul class="divide-y divide-line">
        <li v-for="p in g.rows" :key="p.asset.id">
          <button class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2" @click="panel = { kind: 'tx', assetId: p.asset.id }">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[15px] font-medium">{{ p.asset.name }}</span>
              <span class="block text-[12px] text-ink-2">
                {{ formatQuantity(p.quantity) }} × {{ formatPrice(p.priceEur) }} · PRU {{ formatPrice(p.averageCost) }}
              </span>
              <PriceAge :tick="tickOf(p.asset)" />
            </span>
            <span class="shrink-0 text-right">
              <span class="num block text-[15px] font-semibold">{{ formatEuros(p.valueCents ?? p.costCents) }}</span>
              <span class="num block text-[12px]" :class="pnlClass(p.unrealizedCents)">
                {{ formatEuros(p.unrealizedCents, { signed: true }) }}
                <template v-if="p.unrealizedCents !== null && p.costCents > 0">({{ formatPct((p.unrealizedCents / p.costCents) * 100) }})</template>
              </span>
            </span>
          </button>
        </li>
      </ul>
    </section>

    <section v-if="unheldAssets.length" class="card p-4">
      <h2 class="mb-2 text-[16px] font-semibold">Actifs suivis sans position</h2>
      <div class="flex flex-wrap gap-2">
        <button v-for="a in unheldAssets" :key="a.id" class="rounded-full bg-surface-2 px-3 py-1.5 text-[13px]" @click="panel = { kind: 'asset', asset: a }">
          {{ a.name }}
        </button>
      </div>
    </section>

    <section class="card p-4">
      <h2 class="mb-2 text-[16px] font-semibold">Comptes</h2>
      <p v-if="!app.accounts.length" class="text-[14px] text-ink-2">Aucun compte pour l’instant.</p>
      <ul class="divide-y divide-line">
        <li v-for="a in app.accounts" :key="a.id">
          <button class="flex w-full justify-between py-2.5 text-left text-[14px]" @click="panel = { kind: 'account', account: a }">
            <span class="font-medium">{{ a.name }}</span>
            <span class="text-ink-2">{{ ACCOUNT_LABELS[a.type] }}<template v-if="a.broker"> · {{ a.broker }}</template></span>
          </button>
        </li>
      </ul>
    </section>

    <section class="card p-4">
      <h2 class="mb-2 text-[16px] font-semibold">Historique des opérations</h2>
      <p v-if="!recent.length" class="text-[14px] text-ink-2">Aucune opération enregistrée.</p>
      <ul class="divide-y divide-line">
        <li v-for="t in recent" :key="t.id">
          <button class="flex w-full items-center gap-3 py-2.5 text-left" @click="panel = { kind: 'tx', transaction: t }">
            <span class="w-20 shrink-0 text-[12px] text-ink-2">{{ formatDate(t.tradeDate) }}</span>
            <span class="min-w-0 flex-1 truncate text-[14px]">
              <b class="font-medium">{{ KIND_LABELS[t.kind] }}</b> · {{ assetName(t.assetId) }}
              <template v-if="t.quantity"> · {{ formatQuantity(t.quantity) }}</template>
            </span>
            <span class="num shrink-0 text-[14px]" :class="t.kind === 'buy' || t.kind === 'fee' ? '' : 'text-up'">
              {{ t.kind === 'buy' || t.kind === 'fee' ? '−' : '+' }}{{ formatEuros(t.amountCents) }}
            </span>
          </button>
        </li>
      </ul>
    </section>

    <Sheet v-if="panel?.kind === 'account'" :title="panel.account ? 'Modifier le compte' : 'Nouveau compte'" @close="panel = null">
      <AccountForm :account="panel.account" @done="panel = null" />
    </Sheet>
    <Sheet v-if="panel?.kind === 'asset'" :title="panel.asset ? 'Modifier l’actif' : 'Ajouter un actif'" @close="panel = null">
      <AssetForm :asset="panel.asset" @done="panel = null" />
    </Sheet>
    <Sheet v-if="panel?.kind === 'tx'" :title="panel.transaction ? 'Modifier l’opération' : 'Nouvelle opération'" @close="panel = null">
      <TransactionForm
        :transaction="panel.transaction"
        :asset-id="panel.assetId"
        @done="panel = null"
        @add-account="panel = { kind: 'account' }"
        @add-asset="panel = { kind: 'asset' }"
      />
    </Sheet>
  </div>
</template>
