<script setup lang="ts">
/** Écran « Plus » de l'iPhone : les écrans qui ne tiennent pas dans la barre d'onglets. */
import { RouterLink } from 'vue-router';

const links = [
  { to: '/analyse', label: 'Analyse', hint: 'Simulation de ton plan, statistiques, meilleure répartition, test de stratégie' },
  { to: '/flux', label: 'Flux', hint: 'Versements, retraits, entrées et sorties par mois' },
  { to: '/bilan', label: 'Bilan', hint: 'Scénarios de crise et récapitulatif fiscal' },
  { to: '/profil', label: 'Profil et appareil', hint: 'Répartition cible, tour, clé Twelve Data, sauvegarde' },
];
</script>

<template>
  <ul class="space-y-2">
    <li v-for="l in links" :key="l.to">
      <RouterLink :to="l.to" class="card flex items-center gap-3 p-4">
        <span class="min-w-0 flex-1">
          <span class="block text-[16px] font-semibold">{{ l.label }}</span>
          <span class="block text-[13px] text-ink-2">{{ l.hint }}</span>
        </span>
        <span class="text-[20px] text-muted" aria-hidden="true">›</span>
      </RouterLink>
    </li>
  </ul>
</template>
