<script setup lang="ts">
/** Ajout d'un actif : depuis le catalogue (déjà relié à sa source de cours) ou à la main. */
import { computed, ref } from 'vue';
import type { Asset, Pocket } from '@pecule/shared';
import { useAppStore } from '@/stores/app';
import { ASSET_PRESETS, type AssetPreset } from '@/domain/presets';
import { formatPrice, POCKET_LABELS } from '@/domain/format';
import { priceKeyOf } from '@/domain/portfolio';
import PriceAge from '@/components/PriceAge.vue';
import { ValidationError } from '@/db/repo';

const props = defineProps<{ asset?: Asset }>();
const emit = defineEmits<{ done: [id: string] }>();
const app = useAppStore();

const mode = ref<'catalog' | 'manual'>(props.asset ? 'manual' : 'catalog');
const name = ref(props.asset?.name ?? '');
const symbol = ref(props.asset?.symbol ?? '');
const isin = ref(props.asset?.isin ?? '');
const assetClass = ref<Asset['assetClass']>(props.asset?.assetClass ?? 'stock');
const pocket = ref<Pocket>(props.asset?.pocket ?? 'themes');
const currency = ref(props.asset?.currency ?? 'EUR');
const quoteKey = ref(props.asset?.quoteKey ?? '');
const error = ref('');

const existingKeys = computed(() => new Set(app.assets.map((a) => a.quoteKey)));
const presets = computed(() => ASSET_PRESETS.filter((p) => !existingKeys.value.has(p.quoteKey)));

async function addPreset(p: AssetPreset): Promise<void> {
  const { hint: _hint, ...fields } = p;
  const saved = await app.save('asset', fields);
  emit('done', saved.id);
}

async function submit(): Promise<void> {
  error.value = '';
  try {
    const saved = await app.save('asset', {
      id: props.asset?.id,
      name: name.value.trim(),
      symbol: symbol.value.trim().toUpperCase(),
      isin: isin.value.trim().toUpperCase() || null,
      assetClass: assetClass.value,
      pocket: pocket.value,
      currency: currency.value.trim().toUpperCase(),
      quoteKey: quoteKey.value.trim() || null,
    });
    emit('done', saved.id);
  } catch (e) {
    error.value = e instanceof ValidationError ? e.message : 'Enregistrement impossible';
  }
}

// --- Cours saisi à la main -----------------------------------------------------------
const manualPrice = ref('');
const manualMessage = ref('');
const currentTick = computed(() => (props.asset ? app.liveState.prices[priceKeyOf(props.asset)] : undefined));

function saveManualPrice(): void {
  if (!props.asset) return;
  const value = Number(manualPrice.value.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) {
    manualMessage.value = 'Cours invalide.';
    return;
  }
  app.setManualPrice(priceKeyOf(props.asset), value, props.asset.currency);
  manualMessage.value = 'Cours enregistré. Un cours automatique plus récent le remplacera.';
  manualPrice.value = '';
}

async function remove(): Promise<void> {
  if (!props.asset) return;
  await app.remove('asset', props.asset.id);
  emit('done', props.asset.id);
}
</script>

<template>
  <div>
    <div v-if="!asset" class="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
      <button class="rounded-lg py-1.5 text-[14px] font-semibold" :class="mode === 'catalog' ? 'bg-surface shadow' : 'text-ink-2'" @click="mode = 'catalog'">Catalogue</button>
      <button class="rounded-lg py-1.5 text-[14px] font-semibold" :class="mode === 'manual' ? 'bg-surface shadow' : 'text-ink-2'" @click="mode = 'manual'">À la main</button>
    </div>

    <ul v-if="mode === 'catalog'" class="space-y-2">
      <li v-for="p in presets" :key="p.quoteKey ?? p.symbol">
        <button class="card flex w-full items-center gap-3 p-3 text-left" @click="addPreset(p)">
          <span class="min-w-0 flex-1">
            <span class="block text-[15px] font-semibold">{{ p.name }}</span>
            <span class="block text-[12px] text-ink-2">{{ p.hint }}</span>
          </span>
          <span class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">{{ POCKET_LABELS[p.pocket] }}</span>
        </button>
      </li>
      <li v-if="presets.length === 0" class="py-6 text-center text-[14px] text-ink-2">Tout le catalogue est déjà dans ton portefeuille.</li>
    </ul>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <label class="block"><span class="label">Nom</span><input v-model="name" class="field" required maxlength="120" placeholder="Ex. Amundi MSCI World" /></label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block"><span class="label">Symbole</span><input v-model="symbol" class="field" required maxlength="40" placeholder="CW8" /></label>
        <label class="block"><span class="label">Devise</span><input v-model="currency" class="field" required maxlength="3" placeholder="EUR" /></label>
      </div>
      <label class="block"><span class="label">ISIN (facultatif)</span><input v-model="isin" class="field" maxlength="12" placeholder="LU1681043599" /></label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="label">Type</span>
          <select v-model="assetClass" class="field">
            <option value="etf">ETF</option>
            <option value="stock">Action</option>
            <option value="crypto">Crypto</option>
            <option value="commodity">Matière première</option>
            <option value="leveraged">Produit à levier</option>
            <option value="bond">Obligation</option>
          </select>
        </label>
        <label class="block">
          <span class="label">Poche</span>
          <select v-model="pocket" class="field">
            <option v-for="(label, key) in POCKET_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
      </div>
      <label class="block">
        <span class="label">Source de cours (facultatif)</span>
        <input v-model="quoteKey" class="field font-mono text-[14px]" maxlength="80" placeholder="yf:CW8.PA · td:TTWO · kraken:BTC/EUR" />
        <span class="mt-1 block text-[12px] text-muted">
          yf: Yahoo Finance (Europe, symbole Yahoo) · td: Twelve Data (actions US) · kraken: crypto (paire Kraken). Sans source, l’actif est valorisé à son prix d’achat.
        </span>
      </label>
      <p v-if="error" class="text-[13px] text-down">{{ error }}</p>
      <div class="flex gap-2">
        <button type="submit" class="btn-primary flex-1">Enregistrer</button>
        <button v-if="asset" type="button" class="btn-danger" @click="remove">Supprimer</button>
      </div>
    </form>

    <section v-if="asset" class="mt-6 space-y-2 border-t border-line pt-4">
      <h3 class="text-[15px] font-semibold">Cours actuel</h3>
      <p class="text-[14px]">
        <b class="num">{{ formatPrice(currentTick?.p, currentTick?.c ?? asset.currency) }}</b>
        · <PriceAge :tick="currentTick" />
      </p>
      <p class="text-[12px] text-muted">Sans source automatique (un ETF européen sans la tour, par exemple), saisis le cours affiché par ton courtier.</p>
      <div class="flex gap-2">
        <input id="manual-price" v-model="manualPrice" class="field num min-w-0 flex-1" inputmode="decimal" :placeholder="`Cours en ${asset.currency}`" />
        <button type="button" class="btn-ghost shrink-0" @click="saveManualPrice">Enregistrer</button>
      </div>
      <p v-if="manualMessage" class="text-[13px] text-ink-2">{{ manualMessage }}</p>
    </section>
  </div>
</template>
