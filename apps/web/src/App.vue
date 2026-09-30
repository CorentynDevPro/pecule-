<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useAppStore } from '@/stores/app';
import ConnectionBadge from '@/components/ConnectionBadge.vue';
import UpdatePrompt from '@/components/UpdatePrompt.vue';

const app = useAppStore();
const route = useRoute();
const baseUrl = import.meta.env.BASE_URL;
onMounted(() => void app.init());

const icons = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  wallet: 'M3 7h18v13H3zM3 7l2-3h14l2 3M8 12h8',
  markets: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  analysis: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  agent: 'M12 3v3M7 9h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM9 14h.01M15 14h.01',
  flows: 'M7 4v16M7 20l-4-4M7 20l4-4M17 20V4M17 4l-4 4M17 4l4 4',
  report: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
/** Barre latérale (Mac, tour) : tous les écrans */
const nav = [
  { to: '/', label: 'Accueil', icon: icons.home },
  { to: '/portefeuille', label: 'Portefeuille', icon: icons.wallet },
  { to: '/marches', label: 'Marchés', icon: icons.markets },
  { to: '/analyse', label: 'Analyse', icon: icons.analysis },
  { to: '/agent', label: 'Agent', icon: icons.agent },
  { to: '/flux', label: 'Flux', icon: icons.flows },
  { to: '/bilan', label: 'Bilan', icon: icons.report },
  { to: '/profil', label: 'Profil', icon: icons.profile },
];
/** Barre d'onglets (iPhone) : cinq entrées, le reste dans « Plus » */
const tabs = [
  { to: '/', label: 'Accueil', icon: icons.home },
  { to: '/portefeuille', label: 'Portefeuille', icon: icons.wallet },
  { to: '/marches', label: 'Marchés', icon: icons.markets },
  { to: '/agent', label: 'Agent', icon: icons.agent },
  { to: '/plus', label: 'Plus', icon: icons.more },
];
const inMore = ['/analyse', '/flux', '/bilan', '/profil', '/plus'];
</script>

<template>
  <div class="min-h-dvh md:flex">
    <!-- Barre latérale : Mac et tour Windows -->
    <aside class="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-line p-4 md:flex">
      <div class="mb-6 flex items-center gap-2 px-2 pt-2">
        <img :src="`${baseUrl}favicon.svg`" alt="" class="size-8 rounded-lg" />
        <span class="text-[18px] font-bold">Pécule</span>
      </div>
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-ink-2 hover:bg-surface-2"
        active-class="!bg-surface !text-ink shadow-[0_0_0_1px_var(--ring)]"
        :exact-active-class="item.to === '/' ? '!bg-surface !text-ink shadow-[0_0_0_1px_var(--ring)]' : undefined"
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="item.icon" /></svg>
        {{ item.label }}
      </RouterLink>
    </aside>

    <div class="min-w-0 flex-1">
      <header class="safe-top sticky top-0 z-30 bg-page/85 backdrop-blur-md">
        <div class="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <h1 class="text-[22px] font-bold">{{ nav.find((n) => n.to === route.path)?.label ?? (route.path === '/plus' ? 'Plus' : 'Pécule') }}</h1>
          <ConnectionBadge />
        </div>
      </header>
      <main class="mx-auto max-w-5xl px-4 pb-28 md:pb-10">
        <RouterView v-if="app.ready" />
        <p v-else class="py-20 text-center text-ink-2">Chargement…</p>
      </main>
    </div>

    <!-- Barre d'onglets : iPhone -->
    <nav class="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-page/90 backdrop-blur-md md:hidden" aria-label="Navigation principale">
      <div class="grid grid-cols-5">
        <RouterLink
          v-for="item in tabs"
          :key="item.to"
          :to="item.to"
          class="flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10.5px] font-medium text-muted"
          :class="{ '!text-accent': route.path === item.to || (item.to === '/plus' && inMore.includes(route.path)) }"
        >
          <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="item.icon" /></svg>
          {{ item.label }}
        </RouterLink>
      </div>
    </nav>

    <UpdatePrompt />
  </div>
</template>
