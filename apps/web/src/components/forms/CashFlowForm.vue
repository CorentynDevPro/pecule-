<script setup lang="ts">
import { ref } from 'vue';
import type { CashFlow } from '@pecule/shared';
import { useAppStore } from '@/stores/app';
import { parseEuros, todayIso } from '@/domain/format';
import { ValidationError } from '@/db/repo';

const props = defineProps<{ flow?: CashFlow }>();
const emit = defineEmits<{ done: []; addAccount: [] }>();
const app = useAppStore();

const f = props.flow;
const direction = ref<'in' | 'out'>(f && f.amountCents < 0 ? 'out' : 'in');
const accountId = ref(f?.accountId ?? app.accounts[0]?.id ?? '');
const flowDate = ref(f?.flowDate ?? todayIso());
const amount = ref(f ? (Math.abs(f.amountCents) / 100).toFixed(2).replace('.', ',') : ((app.profile?.monthlyContributionCents ?? 10000) / 100).toFixed(2).replace('.', ','));
const label = ref(f?.label ?? 'Versement mensuel');
const error = ref('');

async function submit(): Promise<void> {
  error.value = '';
  const cents = parseEuros(amount.value);
  if (!cents || cents <= 0) return void (error.value = 'Montant invalide.');
  try {
    await app.save('cashFlow', {
      id: f?.id,
      accountId: accountId.value,
      flowDate: flowDate.value,
      amountCents: direction.value === 'in' ? cents : -cents,
      label: label.value.trim(),
    });
    emit('done');
  } catch (e) {
    error.value = e instanceof ValidationError ? e.message : 'Enregistrement impossible';
  }
}

async function remove(): Promise<void> {
  if (!f) return;
  await app.remove('cashFlow', f.id);
  emit('done');
}
</script>

<template>
  <div v-if="app.accounts.length === 0" class="space-y-3 text-[14px]">
    <p class="text-ink-2">Ajoute d’abord le compte sur lequel tu verses de l’argent.</p>
    <button class="btn-primary w-full" @click="emit('addAccount')">Ajouter un compte</button>
  </div>
  <form v-else class="space-y-4" @submit.prevent="submit">
    <div class="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
      <button type="button" class="rounded-lg py-1.5 text-[14px] font-semibold" :class="direction === 'in' ? 'bg-surface shadow' : 'text-ink-2'" @click="direction = 'in'; label = label || 'Versement'">Versement</button>
      <button type="button" class="rounded-lg py-1.5 text-[14px] font-semibold" :class="direction === 'out' ? 'bg-surface shadow' : 'text-ink-2'" @click="direction = 'out'; label = label === 'Versement mensuel' ? 'Retrait' : label">Retrait</button>
    </div>
    <label class="block">
      <span class="label">Compte</span>
      <select v-model="accountId" class="field">
        <option v-for="a in app.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </label>
    <div class="grid grid-cols-2 gap-3">
      <label class="block"><span class="label">Date</span><input v-model="flowDate" type="date" class="field" required /></label>
      <label class="block"><span class="label">Montant (€)</span><input v-model="amount" class="field num" inputmode="decimal" required /></label>
    </div>
    <label class="block"><span class="label">Libellé</span><input v-model="label" class="field" maxlength="200" /></label>
    <p v-if="error" class="text-[13px] text-down">{{ error }}</p>
    <div class="flex gap-2">
      <button type="submit" class="btn-primary flex-1">Enregistrer</button>
      <button v-if="f" type="button" class="btn-danger" @click="remove">Supprimer</button>
    </div>
  </form>
</template>
