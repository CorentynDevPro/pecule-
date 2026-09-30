import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router';
import { STANDALONE_BUILD } from './device/settings';
import './style.css';
import App from './App.vue';

const router = createRouter({
  // Sur GitHub Pages, les adresses en « #/ » évitent les erreurs 404 au rechargement d'un écran.
  history: STANDALONE_BUILD ? createWebHashHistory() : createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: () => import('./views/DashboardView.vue') },
    { path: '/portefeuille', component: () => import('./views/PortfolioView.vue') },
    { path: '/marches', component: () => import('./views/MarketsView.vue') },
    { path: '/flux', component: () => import('./views/FlowsView.vue') },
    { path: '/profil', component: () => import('./views/ProfileView.vue') },
    { path: '/analyse', component: () => import('./views/AnalysisView.vue') },
    { path: '/agent', component: () => import('./views/AgentView.vue') },
    { path: '/bilan', component: () => import('./views/ReportView.vue') },
    { path: '/plus', component: () => import('./views/MoreView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

// Demande au navigateur de ne pas effacer les données locales en cas de manque de place
// (Safari peut sinon vider IndexedDB après plusieurs semaines sans ouverture).
void navigator.storage?.persist?.();

createApp(App).use(createPinia()).use(router).mount('#app');
