<script setup lang="ts">
/** Phase 4 : ce que ton portefeuille encaisserait dans une crise, et ce que tu devras déclarer. */
import { computed } from 'vue';
import { useAppStore } from '@/stores/app';
import { formatEuros, formatPct } from '@/domain/format';
import { applyScenario, FLAT_TAX_2026, SCENARIOS, yearlyTaxRecap } from '@/domain/tax';

const app = useAppStore();
const limit = computed(() => (app.profile?.maxDrawdownPct ?? 30) / 100);
const scenarios = computed(() => SCENARIOS.map((s) => ({ ...s, ...applyScenario(app.allocation, s) })));
const recap = computed(() => yearlyTaxRecap(app.transactions, app.assets, app.accounts));
const bucketName = { cto: 'Compte-titres', crypto: 'Crypto', sheltered: 'PEA, assurance-vie, livrets' } as const;
</script>

<template>
  <div class="space-y-4">
    <section class="card p-5">
      <h2 class="text-[16px] font-semibold">Et si une crise arrivait demain ?</h2>
      <p class="mt-1 text-[13px] text-ink-2">
        Chocs appliqués à ta répartition actuelle, poche par poche. Ordres de grandeur inspirés de crises passées, pas des prévisions.
        Ta limite : une baisse de {{ Math.round(limit * 100) }} %.
      </p>
      <p v-if="app.summary.investedValueCents <= 0" class="py-6 text-center text-[14px] text-ink-2">Enregistre d’abord tes placements pour voir leur résistance.</p>
      <ul v-else class="mt-3 divide-y divide-line">
        <li v-for="s in scenarios" :key="s.name" class="flex items-center gap-3 py-3">
          <span class="min-w-0 flex-1">
            <span class="block text-[15px] font-medium">{{ s.name }}</span>
            <span class="block text-[12px] text-ink-2">{{ s.description }}</span>
          </span>
          <span class="shrink-0 text-right">
            <span class="num block text-[15px] font-semibold">{{ formatEuros(s.afterCents, { round: true }) }}</span>
            <span class="num block text-[12px]" :class="-s.lossPct > limit ? 'font-semibold text-down' : 'text-ink-2'">{{ formatPct(s.lossPct * 100) }}</span>
            <span v-if="-s.lossPct > limit" class="block text-[11px] font-semibold text-down">au-delà de ta limite</span>
          </span>
        </li>
      </ul>
      <p class="mt-2 text-[12px] text-muted">Si un scénario dépasse ta limite, deux leviers : réduire la part crypto ou levier, ou accepter une limite plus large dans ton profil, en connaissance de cause.</p>
    </section>

    <section class="card p-5">
      <h2 class="text-[16px] font-semibold">Récapitulatif fiscal</h2>
      <p class="mt-1 text-[13px] text-ink-2">
        Estimation pour t’aider à déclarer, calculée sur tes ventes et dividendes. Flat tax de {{ (FLAT_TAX_2026 * 100).toFixed(1).replace('.', ',') }} % en 2026.
      </p>
      <p v-if="!recap.length" class="py-6 text-center text-[14px] text-ink-2">Aucune vente ni dividende enregistré pour l’instant : rien à déclarer.</p>
      <div v-else class="mt-3 overflow-x-auto">
        <table class="num w-full min-w-[520px] text-left text-[14px]">
          <thead class="text-[12px] text-ink-2">
            <tr><th class="py-1.5 pr-3 font-medium">Année</th><th class="pr-3 font-medium">Enveloppe</th><th class="pr-3 font-medium">Plus-values</th><th class="pr-3 font-medium">Dividendes</th><th class="pr-3 font-medium">Impôt estimé</th></tr>
          </thead>
          <tbody>
            <template v-for="r in recap" :key="`${r.year}-${r.bucket}`">
              <tr class="border-t border-line">
                <td class="py-2 pr-3">{{ r.year }}</td>
                <td class="pr-3 font-medium">{{ bucketName[r.bucket] }}</td>
                <td class="pr-3" :class="r.realizedCents >= 0 ? '' : 'text-down'">{{ formatEuros(r.realizedCents, { signed: true }) }}</td>
                <td class="pr-3">{{ formatEuros(r.dividendsCents) }}</td>
                <td class="pr-3 font-semibold">{{ formatEuros(r.taxCents) }}</td>
              </tr>
              <tr><td colspan="5" class="pb-2 text-[12px] text-muted">{{ r.note }}</td></tr>
            </template>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-[12px] text-muted">
        Pour la crypto, l’administration applique une formule globale sur l’ensemble de ton portefeuille : le montant réel peut différer un peu.
        Je ne suis pas conseiller fiscal ; en cas de doute, le service des impôts ou un professionnel tranchera.
      </p>
    </section>
  </div>
</template>
