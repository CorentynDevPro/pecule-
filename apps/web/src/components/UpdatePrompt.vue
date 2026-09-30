<script setup lang="ts">
/** Nouvelle version déployée sur la tour : on propose de recharger plutôt que de le faire en plein usage. */
import { useRegisterSW } from 'virtual:pwa-register/vue';

const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    // Vérifie les mises à jour toutes les heures, pour les appareils qui restent ouverts longtemps.
    if (registration) setInterval(() => void registration.update(), 3600_000);
  },
});
</script>

<template>
  <div v-if="needRefresh || offlineReady" class="fixed inset-x-3 bottom-24 z-40 mx-auto max-w-md md:bottom-6">
    <div class="card flex items-center gap-3 p-3 shadow-lg">
      <p class="flex-1 text-[14px]">
        {{ needRefresh ? 'Une nouvelle version de Pécule est prête.' : 'Pécule fonctionne maintenant hors connexion.' }}
      </p>
      <button v-if="needRefresh" class="btn-primary py-2" @click="updateServiceWorker(true)">Mettre à jour</button>
      <button class="btn-ghost py-2" @click="needRefresh = false; offlineReady = false">OK</button>
    </div>
  </div>
</template>
