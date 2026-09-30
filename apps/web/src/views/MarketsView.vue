<script setup lang="ts">
import { computed, ref } from 'vue';
import type { WatchlistItem } from '@pecule/shared';
import { useAppStore } from '@/stores/app';
import Sheet from '@/components/Sheet.vue';
import PriceAge from '@/components/PriceAge.vue';
import PriceChart from '@/components/PriceChart.vue';
import { formatPct, formatPrice } from '@/domain/format';
import { ASSET_PRESETS } from '@/domain/presets';

const app = useAppStore();
const selected = ref<WatchlistItem | null>(null);
const adding = ref(false);
const custom = ref({ label: '', quoteKey: '', currency: 'EUR' });
const error = ref('');

const items = computed(() => [...app.watchlist].sort((a, b) => a.sortOrder - b.sortOrder));
const suggestions = computed(() => {
  const have = new Set(app.watchlist.map((w) => w.quoteKey));
  const fromAssets = app.assets.filter((a) => a.quoteKey && !have.has(a.quoteKey)).map((a) => ({ label: a.name, quoteKey: a.quoteKey!, currency: a.currency }));
  const fromPresets = ASSET_PRESETS.filter((p) => p.quoteKey && !have.has(p.quoteKey) && !fromAssets.some((a) => a.quoteKey === p.quoteKey))
    .map((p) => ({ label: p.name, quoteKey: p.quoteKey!, currency: p.currency }));
  return [...fromAssets, ...fromPresets];
});

async function add(item: { label: string; quoteKey: string; currency: string }): Promise<void> {
  error.value = '';
  try {
    await app.save('watchlistItem', { ...item, currency: item.currency.toUpperCase(), sortOrder: items.value.length });
    adding.value = false;
    custom.value = { label: '', quoteKey: '', currency: 'EUR' };
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function remove(item: WatchlistItem): Promise<void> {
  await app.remove('watchlistItem', item.id);
  selected.value = null;
}

const tick = (k: string) => app.liveState.prices[k];
const changeClass = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? 'text-ink-2' : v > 0 ? 'text-up' : 'text-down');
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <p class="min-w-0 text-[13px] text-ink-2">Crypto en direct, bourse selon l’ouverture des marchés.</p>
      <button class="btn-ghost shrink-0 whitespace-nowrap py-2" @click="adding = true">+ Favori</button>
    </div>

    <ul class="grid gap-3 md:grid-cols-2">
      <li v-for="w in items" :key="w.id">
        <button class="card flex w-full items-center gap-3 p-4 text-left" @click="selected = w">
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[15px] font-semibold">{{ w.label }}</span>
            <PriceAge :tick="tick(w.quoteKey)" />
          </span>
          <span class="shrink-0 text-right">
            <span class="num block text-[17px] font-semibold">{{ formatPrice(tick(w.quoteKey)?.p, w.currency) }}</span>
            <span class="num block text-[13px] font-medium" :class="changeClass(tick(w.quoteKey)?.chg)">
              {{ formatPct(tick(w.quoteKey)?.chg ?? null) }}
            </span>
          </span>
        </button>
      </li>
    </ul>
    <p v-if="!items.length" class="card p-6 text-center text-[14px] text-ink-2">Aucun favori. Ajoute des actifs à surveiller.</p>

    <Sheet v-if="selected" :title="selected.label" @close="selected = null">
      <div class="mb-3 flex items-baseline justify-between">
        <span class="num text-[28px] font-semibold">{{ formatPrice(tick(selected.quoteKey)?.p, selected.currency) }}</span>
        <span class="num text-[15px] font-medium" :class="changeClass(tick(selected.quoteKey)?.chg)">{{ formatPct(tick(selected.quoteKey)?.chg ?? null) }} sur 24 h</span>
      </div>
      <PriceChart :quote-key="selected.quoteKey" :currency="selected.currency" />
      <p class="mt-3 font-mono text-[12px] text-muted">{{ selected.quoteKey }}</p>
      <button class="btn-danger mt-4 w-full" @click="remove(selected)">Retirer des favoris</button>
    </Sheet>

    <Sheet v-if="adding" title="Ajouter un favori" @close="adding = false">
      <ul v-if="suggestions.length" class="mb-5 space-y-2">
        <li v-for="s in suggestions" :key="s.quoteKey">
          <button class="card flex w-full justify-between p-3 text-left text-[14px]" @click="add(s)">
            <span class="font-medium">{{ s.label }}</span>
            <span class="font-mono text-[12px] text-muted">{{ s.quoteKey }}</span>
          </button>
        </li>
      </ul>
      <form class="space-y-3" @submit.prevent="add(custom)">
        <h3 class="text-[14px] font-semibold">Autre actif</h3>
        <label class="block"><span class="label">Nom</span><input v-model="custom.label" class="field" required maxlength="80" /></label>
        <div class="grid grid-cols-3 gap-3">
          <label class="col-span-2 block"><span class="label">Source</span><input v-model="custom.quoteKey" class="field font-mono text-[14px]" required placeholder="yf:AIR.PA" /></label>
          <label class="block"><span class="label">Devise</span><input v-model="custom.currency" class="field" required maxlength="3" /></label>
        </div>
        <p v-if="error" class="text-[13px] text-down">{{ error }}</p>
        <button class="btn-primary w-full" type="submit">Ajouter</button>
      </form>
    </Sheet>
  </div>
</template>
