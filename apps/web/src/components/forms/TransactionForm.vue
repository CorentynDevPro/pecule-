<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Transaction } from '@pecule/shared';
import { useAppStore } from '@/stores/app';
import { formatEuros, formatPrice, formatQuantity, KIND_LABELS, parseEuros, parseQuantity, todayIso } from '@/domain/format';
import { priceInEur } from '@/domain/portfolio';
import { ValidationError } from '@/db/repo';

const props = defineProps<{ transaction?: Transaction; assetId?: string }>();
const emit = defineEmits<{ done: []; addAccount: []; addAsset: [] }>();
const app = useAppStore();

const t = props.transaction;
const kind = ref<Transaction['kind']>(t?.kind ?? 'buy');
const accountId = ref(t?.accountId ?? app.accounts[0]?.id ?? '');
const assetId = ref(t?.assetId ?? props.assetId ?? app.assets[0]?.id ?? '');
const tradeDate = ref(t?.tradeDate ?? todayIso());
const quantity = ref(t ? String(t.quantity).replace('.', ',') : '');
const amount = ref(t ? (t.amountCents / 100).toFixed(2).replace('.', ',') : '');
const fee = ref(t ? (t.feeCents / 100).toFixed(2).replace('.', ',') : '0');
const note = ref(t?.note ?? '');
const error = ref('');

const asset = computed(() => app.assets.find((a) => a.id === assetId.value));
const needsQuantity = computed(() => kind.value === 'buy' || kind.value === 'sell');
const held = computed(() => app.positions.find((p) => p.asset.id === assetId.value)?.quantity ?? 0);
const current = computed(() => (asset.value ? priceInEur(asset.value, app.prices) : null));

// Suggestion de montant à partir du cours actuel, tant que l'utilisateur n'a rien saisi
const amountTouched = ref(Boolean(t));
watch([quantity, current], () => {
  if (amountTouched.value || !current.value) return;
  const q = parseQuantity(quantity.value);
  if (q) amount.value = (q * current.value.price).toFixed(2).replace('.', ',');
});

const amountHint = computed(() => {
  switch (kind.value) {
    case 'buy': return 'Montant total débité, frais inclus';
    case 'sell': return 'Montant total crédité, frais déduits';
    case 'dividend': return 'Montant net reçu';
    default: return 'Montant des frais (droits de garde, etc.)';
  }
});

async function submit(): Promise<void> {
  error.value = '';
  const amountCents = parseEuros(amount.value);
  const feeCents = parseEuros(fee.value || '0');
  const q = needsQuantity.value ? parseQuantity(quantity.value) : 0;
  if (!accountId.value || !assetId.value) return void (error.value = 'Choisis un compte et un actif.');
  if (amountCents === null || amountCents < 0) return void (error.value = 'Montant invalide.');
  if (feeCents === null || feeCents < 0) return void (error.value = 'Frais invalides.');
  if (needsQuantity.value && !q) return void (error.value = 'Quantité invalide (jusqu’à 8 décimales).');
  if (kind.value === 'sell' && q! > held.value + 1e-9 && !t) {
    return void (error.value = `Tu ne détiens que ${formatQuantity(held.value)} de cet actif.`);
  }
  try {
    await app.save('transaction', {
      id: t?.id,
      kind: kind.value,
      accountId: accountId.value,
      assetId: assetId.value,
      tradeDate: tradeDate.value,
      quantity: q ?? 0,
      amountCents,
      feeCents: needsQuantity.value ? feeCents : 0,
      note: note.value.trim(),
    });
    emit('done');
  } catch (e) {
    error.value = e instanceof ValidationError ? e.message : 'Enregistrement impossible';
  }
}

async function remove(): Promise<void> {
  if (!t) return;
  await app.remove('transaction', t.id);
  emit('done');
}
</script>

<template>
  <div v-if="app.accounts.length === 0 || app.assets.length === 0" class="space-y-3 text-[14px]">
    <p class="text-ink-2">Pour enregistrer une opération, il faut d’abord un compte et un actif.</p>
    <button v-if="app.accounts.length === 0" class="btn-primary w-full" @click="emit('addAccount')">Ajouter un compte</button>
    <button v-else class="btn-primary w-full" @click="emit('addAsset')">Ajouter un actif</button>
  </div>
  <form v-else class="space-y-4" @submit.prevent="submit">
    <div class="grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1">
      <button
        v-for="(label, key) in KIND_LABELS"
        :key="key"
        type="button"
        class="rounded-lg py-1.5 text-[13px] font-semibold"
        :class="kind === key ? 'bg-surface shadow' : 'text-ink-2'"
        @click="kind = key"
      >
        {{ label }}
      </button>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <label class="block">
        <span class="label">Actif</span>
        <select v-model="assetId" class="field">
          <option v-for="a in app.assets" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </label>
      <label class="block">
        <span class="label">Compte</span>
        <select v-model="accountId" class="field">
          <option v-for="a in app.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </label>
    </div>
    <p v-if="current" class="-mt-2 text-[12px] text-muted">
      Cours actuel : {{ formatPrice(current.price) }}<template v-if="held > 0"> · tu en détiens {{ formatQuantity(held) }}</template>
    </p>
    <div class="grid grid-cols-2 gap-3">
      <label class="block"><span class="label">Date</span><input v-model="tradeDate" type="date" class="field" required /></label>
      <label v-if="needsQuantity" class="block">
        <span class="label">Quantité</span>
        <input v-model="quantity" class="field num" inputmode="decimal" placeholder="0,0015" required />
      </label>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <label class="block">
        <span class="label">Montant (€)</span>
        <input v-model="amount" class="field num" inputmode="decimal" placeholder="25,00" required @input="amountTouched = true" />
      </label>
      <label v-if="needsQuantity" class="block">
        <span class="label">dont frais (€)</span>
        <input v-model="fee" class="field num" inputmode="decimal" placeholder="0,00" />
      </label>
    </div>
    <p class="-mt-2 text-[12px] text-muted">{{ amountHint }}</p>
    <label class="block"><span class="label">Note (facultatif)</span><input v-model="note" class="field" maxlength="500" /></label>
    <p v-if="error" class="text-[13px] text-down">{{ error }}</p>
    <div class="flex gap-2">
      <button type="submit" class="btn-primary flex-1">Enregistrer</button>
      <button v-if="t" type="button" class="btn-danger" @click="remove">Supprimer</button>
    </div>
    <p v-if="t" class="text-center text-[12px] text-muted">Enregistrée le {{ new Date(t.updatedAt).toLocaleString('fr-FR') }} · {{ formatEuros(t.amountCents) }}</p>
  </form>
</template>
