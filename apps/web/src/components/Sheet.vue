<script setup lang="ts">
/** Panneau modal : feuille qui monte du bas sur téléphone, fenêtre centrée sur ordinateur. */
import { onBeforeUnmount, onMounted } from 'vue';

defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close');
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" @click.self="emit('close')">
      <div
        class="safe-bottom max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-page p-5 md:max-w-lg md:rounded-3xl"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-[18px] font-semibold">{{ title }}</h2>
          <button class="rounded-full bg-surface-2 px-3 py-1 text-[13px] font-semibold text-ink-2" @click="emit('close')">Fermer</button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
