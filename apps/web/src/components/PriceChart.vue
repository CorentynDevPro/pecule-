<script setup lang="ts">
/** Courbe de cours d'un actif : intraday depuis la tour, sinon historique quotidien en cache. */
import { computed, ref, watch } from 'vue';
import VChart from 'vue-echarts';
import type { Candle } from '@pecule/shared';
import { axisCommon, baseTooltip, useChartTheme } from '@/charts/setup';
import { formatPrice } from '@/domain/format';
import { db } from '@/db/local';
import { loadDaily } from '@/sync/history';
import { apiBase } from '@/device/settings';
import { fetchKrakenCandles, krakenSymbolFor } from '@/live/kraken';

const props = defineProps<{ quoteKey: string; currency: string }>();
const theme = useChartTheme();

type Range = '1j' | '7j' | '1a';
const range = ref<Range>('1j');
const points = ref<{ ts: number; close: number }[]>([]);
const note = ref('');

async function load(): Promise<void> {
  note.value = '';
  points.value = [];
  if (range.value === '1a') {
    const from = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10);
    const closes = (await loadDaily(db, [props.quoteKey], from))[props.quoteKey] ?? [];
    points.value = closes.slice(-365).map((c) => ({ ts: Date.parse(`${c.day}T12:00:00Z`), close: c.close }));
    if (points.value.length === 0) note.value = apiBase() === null ? 'Pas d’historique sans tour pour cet actif (crypto : Kraken ; actions US : clé Twelve Data dans Profil).' : 'Historique pas encore disponible : la tour le télécharge au prochain passage.';
    return;
  }
  const intraday = range.value === '1j' ? { interval: '5m', hours: 24, minutes: 5 as const } : { interval: '1h', hours: 24 * 7, minutes: 60 as const };
  const base = apiBase();
  if (base !== null) {
    try {
      const params = new URLSearchParams({ key: props.quoteKey, interval: intraday.interval, hours: String(intraday.hours) });
      const res = await fetch(`${base}/api/prices/candles?${params}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(String(res.status));
      const candles = (await res.json()) as Candle[];
      points.value = candles.map((c) => ({ ts: c.ts, close: c.close }));
      if (points.value.length) return;
    } catch {
      // Tour injoignable : on tente Kraken directement
    }
  }
  const kraken = krakenSymbolFor(props.quoteKey);
  if (kraken) {
    try {
      const since = Date.now() - intraday.hours * 3600_000;
      const candles = await fetchKrakenCandles(kraken, intraday.minutes);
      points.value = candles.filter((c) => c.ts >= since).map((c) => ({ ts: c.ts, close: c.close }));
      if (points.value.length) return;
    } catch {
      // Kraken indisponible
    }
  }
  note.value = base === null
    ? 'Historique intraday disponible en direct pour la crypto uniquement sans tour. Essaie la vue 1 an.'
    : 'Pas d’historique intraday pour l’instant. Essaie la vue 1 an, gardée sur l’appareil.';
}

watch(() => [props.quoteKey, range.value], load, { immediate: true });

const option = computed(() => {
  const t = theme.value;
  const withTime = range.value !== '1a';
  const fmtAxis = (ts: number) =>
    new Date(ts).toLocaleString('fr-FR', withTime ? { hour: '2-digit', minute: '2-digit', day: range.value === '7j' ? 'numeric' : undefined } : { day: 'numeric', month: 'short' });
  return {
    animation: false,
    grid: { left: 8, right: 12, top: 12, bottom: 8, containLabel: true },
    tooltip: {
      ...baseTooltip(t),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: t.axis } },
      formatter: (items: { value: [number, number] }[]) => {
        const i = items[0];
        if (!i) return '';
        const when = new Date(i.value[0]).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: withTime ? 'short' : undefined });
        return `<div style="color:${t.ink2}">${when}</div><b>${formatPrice(i.value[1], props.currency)}</b>`;
      },
    },
    xAxis: { type: 'time', ...axisCommon(t), splitLine: { show: false }, axisLabel: { ...axisCommon(t).axisLabel, formatter: fmtAxis, hideOverlap: true } },
    yAxis: { type: 'value', scale: true, ...axisCommon(t), axisLine: { show: false }, axisLabel: { ...axisCommon(t).axisLabel, formatter: (v: number) => formatPrice(v, props.currency) } },
    series: [
      {
        type: 'line',
        data: points.value.map((p) => [p.ts, p.close]),
        showSymbol: false,
        lineStyle: { width: 2, color: t.accent },
        areaStyle: { color: t.accent, opacity: 0.08 },
      },
    ],
  };
});
</script>

<template>
  <div>
    <div class="mb-2 flex gap-1" role="tablist" aria-label="Période">
      <button
        v-for="r in (['1j', '7j', '1a'] as const)"
        :key="r"
        role="tab"
        :aria-selected="range === r"
        class="rounded-lg px-3 py-1 text-[13px] font-semibold"
        :class="range === r ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2'"
        @click="range = r"
      >
        {{ r === '1j' ? '24 h' : r === '7j' ? '7 jours' : '1 an' }}
      </button>
    </div>
    <p v-if="note" class="py-10 text-center text-[13px] text-muted">{{ note }}</p>
    <div v-else class="h-56 w-full">
    <!-- La hauteur est portée par ce conteneur : le style injecté par vue-echarts passe devant les classes Tailwind -->
    <VChart :option="option" autoresize aria-label="Évolution du cours" />
  </div>
  </div>
</template>
