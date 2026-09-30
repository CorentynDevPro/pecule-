<script setup lang="ts">
/** Âge et provenance d'un cours : « en direct », « il y a 15 min », « Kraken direct »… */
import { computed } from 'vue';
import type { StoredPrice } from '@/db/local';
import { formatAge } from '@/domain/format';
import { useAppStore } from '@/stores/app';

const props = defineProps<{ tick: StoredPrice | null | undefined }>();
const app = useAppStore();

const text = computed(() => {
  const t = props.tick;
  if (!t) return 'pas de cours';
  const age = app.now - t.t;
  const when = age < 90_000 ? 'en direct' : formatAge(t.t, app.now);
  return t.via === 'direct' ? `${when} · Kraken direct` : when;
});
const stale = computed(() => !props.tick || app.now - props.tick.t > 3 * 86_400_000);
</script>

<template>
  <span class="text-[11px]" :class="stale ? 'text-warn' : 'text-muted'">{{ text }}</span>
</template>
