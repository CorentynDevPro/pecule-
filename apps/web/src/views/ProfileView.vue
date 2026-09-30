<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ENTITY_NAMES, POCKETS, type Pocket } from '@pecule/shared';
import { useAppStore, db } from '@/stores/app';
import { DEFAULT_TARGETS, PROFILE_ID } from '@/domain/presets';
import { formatAge, formatEuros, parseEuros, POCKET_LABELS } from '@/domain/format';
import { ValidationError } from '@/db/repo';
import { normalizeTowerUrl } from '@/device/settings';

const app = useAppStore();

const horizon = ref(5);
const maxDrawdown = ref(30);
const monthly = ref('100');
const targets = ref<Record<Pocket, number>>({ ...DEFAULT_TARGETS });
const emergency = ref(false);
const message = ref('');
const error = ref('');

watch(
  () => app.profile,
  (p) => {
    if (!p) return;
    horizon.value = p.horizonYears;
    maxDrawdown.value = p.maxDrawdownPct;
    monthly.value = String(p.monthlyContributionCents / 100).replace('.', ',');
    targets.value = { core: p.targetCorePct, crypto: p.targetCryptoPct, themes: p.targetThemesPct, leverage: p.targetLeveragePct };
    emergency.value = p.emergencyFundOk;
  },
  { immediate: true },
);

const total = computed(() => POCKETS.reduce((s, p) => s + targets.value[p], 0));

async function save(): Promise<void> {
  message.value = '';
  error.value = '';
  const cents = parseEuros(monthly.value);
  if (cents === null || cents < 0) return void (error.value = 'Versement mensuel invalide.');
  if (total.value !== 100) return void (error.value = `Les poches totalisent ${total.value} % : il faut exactement 100 %.`);
  try {
    await app.save('profile', {
      id: PROFILE_ID,
      horizonYears: horizon.value,
      maxDrawdownPct: maxDrawdown.value,
      monthlyContributionCents: cents,
      targetCorePct: targets.value.core,
      targetCryptoPct: targets.value.crypto,
      targetThemesPct: targets.value.themes,
      targetLeveragePct: targets.value.leverage,
      emergencyFundOk: emergency.value,
    });
    message.value = 'Profil enregistré, il sera partagé avec tes autres appareils.';
  } catch (e) {
    error.value = e instanceof ValidationError ? e.message : 'Enregistrement impossible';
  }
}

// --- Sauvegarde manuelle : un fichier JSON avec toutes tes données ---------------------------
async function exportData(): Promise<void> {
  const data: Record<string, unknown[]> = {};
  for (const name of ENTITY_NAMES) data[name] = await db.entityTable(name).toArray();
  const blob = new Blob([JSON.stringify({ app: 'pecule', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pecule-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(ev: Event): Promise<void> {
  message.value = '';
  error.value = '';
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as { app?: string; data?: Record<string, { id: string }[]> };
    if (parsed.app !== 'pecule' || !parsed.data) throw new Error('Ce fichier n’est pas une sauvegarde Pécule.');
    let count = 0;
    for (const name of ENTITY_NAMES) {
      for (const record of parsed.data[name] ?? []) {
        const { updatedAt: _u, deleted, ...rest } = record as { updatedAt?: string; deleted?: boolean; id: string };
        if (deleted) continue;
        await app.save(name, rest as never);
        count++;
      }
    }
    message.value = `${count} éléments restaurés et envoyés à la tour.`;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const sourceNames: Record<string, string> = { kraken: 'Crypto (Kraken)', td: 'Actions US (Twelve Data)', yf: 'Europe (Yahoo Finance)' };

// --- Réglages de l'appareil -------------------------------------------------------------
const towerInput = ref(app.settings.towerUrl ?? '');
const tdKey = ref(app.settings.twelveDataKey);
const checking = ref(false);
const towerMessage = ref('');
const towerOk = ref(false);

async function applyTower(): Promise<void> {
  towerMessage.value = '';
  const url = normalizeTowerUrl(towerInput.value);
  if (!url) {
    towerOk.value = false;
    towerMessage.value = 'Adresse invalide. Exemple : tour.tail1234.ts.net';
    return;
  }
  checking.value = true;
  const result = await app.testTower(url);
  checking.value = false;
  towerOk.value = result.ok;
  towerMessage.value = result.ok ? 'Tour reliée : tes données vont s’y synchroniser.' : result.message;
  if (result.ok) {
    towerInput.value = url;
    await app.updateSettings({ towerUrl: url });
  }
}

async function useWithoutTower(): Promise<void> {
  towerInput.value = '';
  towerMessage.value = '';
  await app.updateSettings({ towerUrl: null });
}

async function saveKey(): Promise<void> {
  await app.updateSettings({ twelveDataKey: tdKey.value.trim() });
  message.value = tdKey.value.trim() ? 'Clé Twelve Data enregistrée sur cet appareil.' : 'Clé Twelve Data retirée.';
}

const platform = computed(() => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
});
const installed = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
</script>

<template>
  <div class="space-y-4">
    <form class="card space-y-5 p-5" @submit.prevent="save">
      <h2 class="text-[16px] font-semibold">Mon profil investisseur</h2>

      <label class="block">
        <span class="label">Horizon : {{ horizon }} an{{ horizon > 1 ? 's' : '' }}</span>
        <input v-model.number="horizon" type="range" min="1" max="30" class="w-full accent-[var(--accent)]" />
        <span class="text-[12px] text-muted">Dans combien de temps pourrais-tu avoir besoin de cet argent ?</span>
      </label>

      <label class="block">
        <span class="label">Baisse maximale supportable : −{{ maxDrawdown }} %</span>
        <input v-model.number="maxDrawdown" type="range" min="5" max="80" step="5" class="w-full accent-[var(--accent)]" />
        <span class="text-[12px] text-muted">
          Sur 1 000 €, tu verrais ton portefeuille descendre à {{ formatEuros((1000 - maxDrawdown * 10) * 100, { round: true }) }} sans tout vendre.
        </span>
      </label>

      <label class="block">
        <span class="label">Versement mensuel (€)</span>
        <input v-model="monthly" class="field num" inputmode="decimal" />
      </label>

      <fieldset>
        <legend class="label">Répartition cible des poches</legend>
        <div class="space-y-3">
          <label v-for="p in POCKETS" :key="p" class="flex items-center gap-3">
            <span class="w-36 shrink-0 text-[14px]">{{ POCKET_LABELS[p] }}</span>
            <input v-model.number="targets[p]" type="range" min="0" max="100" step="5" class="flex-1 accent-[var(--accent)]" />
            <span class="num w-12 text-right text-[14px] font-semibold">{{ targets[p] }} %</span>
          </label>
        </div>
        <p class="mt-2 text-[13px]" :class="total === 100 ? 'text-ink-2' : 'font-semibold text-down'">Total : {{ total }} % {{ total === 100 ? '✓' : '(doit faire 100 %)' }}</p>
      </fieldset>

      <label class="flex items-start gap-3 text-[14px]">
        <input v-model="emergency" type="checkbox" class="mt-1 size-4 accent-[var(--accent)]" />
        <span>J’ai déjà une épargne de précaution (3 à 6 mois de dépenses) sur un livret.</span>
      </label>

      <p v-if="error" class="text-[13px] text-down">{{ error }}</p>
      <p v-if="message" class="text-[13px] text-up">{{ message }}</p>
      <button type="submit" class="btn-primary w-full">Enregistrer le profil</button>
    </form>

    <section class="card space-y-4 p-5">
      <h2 class="text-[16px] font-semibold">Cet appareil</h2>

      <div>
        <label class="label" for="tower-url">Adresse de la tour</label>
        <div class="flex gap-2">
          <input id="tower-url" v-model="towerInput" class="field min-w-0 flex-1" placeholder="tour.tail1234.ts.net" autocomplete="off" autocapitalize="off" spellcheck="false" />
          <button class="btn-ghost shrink-0" :disabled="checking" @click="applyTower">{{ checking ? '…' : 'Relier' }}</button>
        </div>
        <p class="mt-1 text-[12px] text-muted">
          {{ app.settings.towerUrl === null ? 'Aucune tour : tout fonctionne sur cet appareil. Tu pourras relier ta tour plus tard, tes données y seront envoyées.' : app.settings.towerUrl === '' ? 'Tour : même adresse que l’application.' : `Tour : ${app.settings.towerUrl}` }}
        </p>
        <button v-if="app.settings.towerUrl !== null" class="mt-1 text-[12px] font-semibold text-accent" @click="useWithoutTower">Utiliser sans tour</button>
        <p v-if="towerMessage" class="mt-1 text-[13px]" :class="towerOk ? 'text-up' : 'text-down'">{{ towerMessage }}</p>
      </div>

      <div>
        <label class="label" for="td-key">Clé Twelve Data (facultatif)</label>
        <div class="flex gap-2">
          <input id="td-key" v-model="tdKey" type="password" class="field min-w-0 flex-1" placeholder="gratuite sur twelvedata.com" autocomplete="off" />
          <button class="btn-ghost shrink-0" @click="saveKey">Enregistrer</button>
        </div>
        <p class="mt-1 text-[12px] text-muted">Sert aux actions américaines (Take-Two, EA…) quand la tour est absente. Elle reste sur cet appareil.</p>
      </div>

      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[14px]">
        <template v-if="app.settings.towerUrl !== null">
          <dt class="text-ink-2">Dernière synchro</dt>
          <dd>{{ formatAge(app.syncState.lastSyncAt, app.now) }}</dd>
        </template>
        <dt class="text-ink-2">En attente d’envoi</dt>
        <dd>{{ app.syncState.pending }} modification{{ app.syncState.pending > 1 ? 's' : '' }}</dd>
        <template v-for="(s, name) in app.liveState.feed" :key="name">
          <dt class="text-ink-2">{{ sourceNames[name] ?? name }}</dt>
          <dd :class="s.ok ? '' : 'text-down'">{{ s.ok ? 'OK' : 'indisponible' }}<template v-if="s.lastTickAt"> · dernier cours {{ formatAge(s.lastTickAt, app.now) }}</template><template v-if="!s.ok && s.error"> · {{ s.error }}</template></dd>
        </template>
      </dl>
      <button v-if="app.settings.towerUrl !== null" class="btn-ghost w-full" @click="app.syncNow()">Synchroniser maintenant</button>
    </section>

    <section class="card space-y-2 p-5 text-[14px]">
      <h2 class="text-[16px] font-semibold">Installer Pécule sur cet appareil</h2>
      <p v-if="installed" class="text-up">Pécule est installée sur cet appareil ✓</p>
      <template v-else>
        <p v-if="platform === 'ios'">Dans Safari : bouton <b>Partager</b>, puis <b>Sur l’écran d’accueil</b>.</p>
        <p v-else-if="platform === 'mac'">Dans Safari : menu <b>Fichier</b> → <b>Ajouter au Dock</b>. Dans Chrome : icône d’installation dans la barre d’adresse.</p>
        <p v-else-if="platform === 'windows'">Dans Edge ou Chrome : icône <b>Installer</b> dans la barre d’adresse, puis épingle Pécule à la barre des tâches.</p>
        <p v-else>Utilise l’option « Installer l’application » de ton navigateur.</p>
      </template>
      <p class="text-[12px] text-muted">Une fois installée, Pécule s’ouvre même hors connexion, avec tes données et les derniers cours connus.</p>
    </section>

    <section class="card space-y-3 p-5">
      <h2 class="text-[16px] font-semibold">Sauvegarde manuelle</h2>
      <p class="text-[13px] text-ink-2">La tour sauvegarde déjà sa base chaque nuit. Ce fichier est une copie de plus, que tu peux garder où tu veux.</p>
      <div class="flex gap-2">
        <button class="btn-ghost flex-1" @click="exportData">Exporter</button>
        <label class="btn-ghost flex-1 cursor-pointer">Importer<input type="file" accept="application/json" class="hidden" @change="importData" /></label>
      </div>
    </section>
  </div>
</template>
