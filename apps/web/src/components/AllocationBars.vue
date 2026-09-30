<script setup lang="ts">
/** Répartition réelle par poche, avec un repère sur la cible et l'écart écrit en toutes lettres. */
import type { PocketAllocation } from '@/domain/portfolio';
import { formatEuros, POCKET_LABELS } from '@/domain/format';

defineProps<{ allocations: PocketAllocation[] }>();

const colors: Record<string, string> = {
  core: 'var(--pocket-core)',
  crypto: 'var(--pocket-crypto)',
  themes: 'var(--pocket-themes)',
  leverage: 'var(--pocket-leverage)',
};

function driftText(a: PocketAllocation): string {
  const d = Math.round(a.driftPts);
  if (Math.abs(d) < 2) return 'dans la cible';
  return d > 0 ? `${d} pts au-dessus` : `${-d} pts en dessous`;
}
</script>

<template>
  <ul class="space-y-4">
    <li v-for="a in allocations" :key="a.pocket">
      <div class="mb-1.5 flex items-baseline justify-between gap-3 text-[14px]">
        <span class="flex items-center gap-2 font-medium">
          <span class="inline-block size-2.5 rounded-sm" :style="{ background: colors[a.pocket] }" aria-hidden="true" />
          {{ POCKET_LABELS[a.pocket] }}
        </span>
        <span class="num text-ink-2">
          <b class="text-ink">{{ Math.round(a.actualPct) }} %</b> / cible {{ a.targetPct }} %
        </span>
      </div>
      <div class="relative h-2.5 rounded-full bg-surface-2" role="img" :aria-label="`${POCKET_LABELS[a.pocket]} : ${Math.round(a.actualPct)} % pour une cible de ${a.targetPct} %`">
        <div class="h-full rounded-full" :style="{ width: `${Math.min(100, a.actualPct)}%`, background: colors[a.pocket] }" />
        <div class="absolute -top-1 h-4.5 w-0.5 rounded bg-ink" :style="{ left: `calc(${a.targetPct}% - 1px)` }" title="Cible" />
      </div>
      <div class="mt-1 flex justify-between text-[12px] text-muted">
        <span class="num">{{ formatEuros(a.valueCents, { round: true }) }}</span>
        <span :class="Math.abs(a.driftPts) >= 5 ? 'font-medium text-ink-2' : ''">{{ driftText(a) }}</span>
      </div>
    </li>
  </ul>
</template>
