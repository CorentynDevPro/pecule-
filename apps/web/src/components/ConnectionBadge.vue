<script setup lang="ts">
/** État de connexion, en mots : on sait toujours d'où viennent les chiffres affichés. */
import { computed } from 'vue';
import { useAppStore } from '@/stores/app';
import { formatAge } from '@/domain/format';

const app = useAppStore();

const status = computed(() => {
  const mode = app.liveState.mode;
  const pending = app.syncState.pending;
  const pendingText = pending > 0 ? ` · ${pending} modification${pending > 1 ? 's' : ''} en attente` : '';
  if (mode === 'tower') {
    return { tone: 'ok', title: 'Tour connectée', detail: `Synchro ${formatAge(app.syncState.lastSyncAt, app.now)}${pendingText}` };
  }
  if (mode === 'direct') {
    return { tone: 'warn', title: 'Mode autonome', detail: `Crypto en direct via Kraken, le reste figé${pendingText}` };
  }
  if (mode === 'offline') {
    return { tone: 'bad', title: 'Hors ligne', detail: `Dernières valeurs connues${pendingText}` };
  }
  if (app.syncState.towerReachable === false) {
    return { tone: 'bad', title: 'Tour injoignable', detail: `Tes données restent disponibles, cours figés${pendingText}` };
  }
  return { tone: 'warn', title: 'Connexion…', detail: `Recherche de la tour${pendingText}` };
});
</script>

<template>
  <button
    class="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-left shadow-[0_0_0_1px_var(--ring)]"
    :title="status.detail"
    @click="app.syncNow()"
  >
    <span
      class="inline-block size-2 shrink-0 rounded-full"
      :class="{ 'bg-up': status.tone === 'ok', 'bg-warn': status.tone === 'warn', 'bg-down': status.tone === 'bad' }"
      aria-hidden="true"
    />
    <span class="min-w-0">
      <span class="block text-[12px] font-semibold leading-tight">{{ status.title }}</span>
      <span class="block truncate text-[11px] leading-tight text-ink-2">{{ status.detail }}</span>
    </span>
  </button>
</template>
