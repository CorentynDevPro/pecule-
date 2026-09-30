<script setup lang="ts">
import { ref } from 'vue';
import type { Account } from '@pecule/shared';
import { useAppStore } from '@/stores/app';
import { ACCOUNT_LABELS } from '@/domain/format';
import { ValidationError } from '@/db/repo';

const props = defineProps<{ account?: Account }>();
const emit = defineEmits<{ done: [] }>();
const app = useAppStore();

const name = ref(props.account?.name ?? '');
const type = ref<Account['type']>(props.account?.type ?? 'pea');
const broker = ref(props.account?.broker ?? '');
const error = ref('');

async function submit(): Promise<void> {
  error.value = '';
  try {
    await app.save('account', {
      id: props.account?.id,
      name: name.value.trim() || ACCOUNT_LABELS[type.value],
      type: type.value,
      broker: broker.value.trim(),
    });
    emit('done');
  } catch (e) {
    error.value = e instanceof ValidationError ? e.message : 'Enregistrement impossible';
  }
}

async function remove(): Promise<void> {
  if (!props.account) return;
  await app.remove('account', props.account.id);
  emit('done');
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div>
      <span class="label">Type d’enveloppe</span>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="(label, key) in ACCOUNT_LABELS"
          :key="key"
          type="button"
          class="rounded-xl px-3 py-2 text-[14px] font-medium"
          :class="type === key ? 'bg-accent text-white' : 'bg-surface-2 text-ink'"
          @click="type = key"
        >
          {{ label }}
        </button>
      </div>
    </div>
    <label class="block">
      <span class="label">Nom</span>
      <input v-model="name" class="field" :placeholder="`Ex. ${ACCOUNT_LABELS[type]} principal`" maxlength="80" />
    </label>
    <label class="block">
      <span class="label">Banque ou plateforme</span>
      <input v-model="broker" class="field" placeholder="Ex. Boursorama, Trade Republic, Kraken…" maxlength="80" />
    </label>
    <p v-if="error" class="text-[13px] text-down">{{ error }}</p>
    <div class="flex gap-2">
      <button type="submit" class="btn-primary flex-1">Enregistrer</button>
      <button v-if="account" type="button" class="btn-danger" @click="remove">Supprimer</button>
    </div>
  </form>
</template>
