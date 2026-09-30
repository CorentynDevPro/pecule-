<script setup lang="ts">
/** Chiffre clé : libellé, valeur, et variation signée (le signe porte le sens, pas seulement la couleur). */
defineProps<{ label: string; value: string; delta?: string; deltaTone?: 'up' | 'down' | 'flat'; hint?: string }>();
</script>

<template>
  <div class="card p-4">
    <div class="text-[13px] text-ink-2">{{ label }}</div>
    <div class="mt-1 text-[22px] font-semibold leading-tight">{{ value }}</div>
    <div
      v-if="delta"
      class="num mt-1 text-[13px] font-medium"
      :class="{ 'text-up': deltaTone === 'up', 'text-down': deltaTone === 'down', 'text-ink-2': !deltaTone || deltaTone === 'flat' }"
    >
      <span aria-hidden="true">{{ deltaTone === 'up' ? '▲ ' : deltaTone === 'down' ? '▼ ' : '' }}</span>{{ delta }}
    </div>
    <div v-if="hint" class="mt-1 text-[12px] text-muted">{{ hint }}</div>
  </div>
</template>
