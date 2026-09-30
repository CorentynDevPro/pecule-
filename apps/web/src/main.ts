import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import './style.css';
import App from './App.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/DashboardView.vue') },
    { path: '/portefeuille', component: () => import('./views/PortfolioView.vue') },
    { path: '/marches', component: () => import('./views/MarketsView.vue') },
    { path: '/flux', component: () => import('./views/FlowsView.vue') },
    { path: '/profil', component: () => import('./views/ProfileView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

// Demande au navigateur de ne pas effacer les données locales en cas de manque de place
// (Safari peut sinon vider IndexedDB après plusieurs semaines sans ouverture).
void navigator.storage?.persist?.();

createApp(App).use(createPinia()).use(router).mount('#app');
