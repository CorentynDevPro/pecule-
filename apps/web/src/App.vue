<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useAppStore } from '@/stores/app';
import ConnectionBadge from '@/components/ConnectionBadge.vue';
import UpdatePrompt from '@/components/UpdatePrompt.vue';

const app = useAppStore();
const route = useRoute();
onMounted(() => void app.init());

const nav = [
  { to: '/', label: 'Accueil', icon: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/portefeuille', label: 'Portefeuille', icon: 'M3 7h18v13H3zM3 7l2-3h14l2 3M8 12h8' },
  { to: '/marches', label: 'Marchés', icon: 'M3 17l6-6 4 4 8-8M15 7h6v6' },
  { to: '/flux', label: 'Flux', icon: 'M7 4v16M7 20l-4-4M7 20l4-4M17 20V4M17 4l-4 4M17 4l4 4' },
  { to: '/profil', label: 'Profil', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0' },
];
</script>

<template>
  <div class="min-h-dvh md:flex">
    <!-- Barre latérale : Mac et tour Windows -->
    <aside class="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-line p-4 md:flex">
      <div class="mb-6 flex items-center gap-2 px-2 pt-2">
        <img src="/favicon.svg" alt="" class="size-8 rounded-lg" />
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
          <h1 class="text-[22px] font-bold">{{ nav.find((n) => n.to === route.path)?.label ?? 'Pécule' }}</h1>
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
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10.5px] font-medium text-muted"
          :class="{ '!text-accent': route.path === item.to }"
        >
          <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="item.icon" /></svg>
          {{ item.label }}
        </RouterLink>
      </div>
    </nav>

    <UpdatePrompt />
  </div>
</template>
