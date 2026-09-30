<script setup lang="ts">
/** Valeur du portefeuille jour après jour, comparée à l'argent versé. */
import { computed } from 'vue';
import VChart from 'vue-echarts';
import type { ValuePoint } from '@/domain/portfolio';
import { axisCommon, baseTooltip, useChartTheme } from '@/charts/setup';
import { formatDate, formatEuros } from '@/domain/format';

const props = defineProps<{ points: ValuePoint[] }>();
const theme = useChartTheme();

const option = computed(() => {
  const t = theme.value;
  const days = props.points.map((p) => p.day);
  return {
    animation: false,
    grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
    legend: {
      top: 0,
      left: 0,
      itemWidth: 16,
      itemHeight: 2,
      textStyle: { color: t.ink2, fontSize: 12 },
      data: ['Valeur', 'Argent versé'],
    },
    tooltip: {
      ...baseTooltip(t),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: t.axis } },
      formatter: (items: { seriesName: string; value: number; axisValue: string; marker: string }[]) => {
        const day = items[0] ? formatDate(items[0].axisValue) : '';
        const rows = items.map((i) => `${i.marker}${i.seriesName} <b style="float:right;margin-left:16px">${formatEuros(i.value * 100)}</b>`);
        return `<div style="font-weight:600;margin-bottom:4px">${day}</div>${rows.join('<br/>')}`;
      },
    },
    xAxis: {
      type: 'category',
      data: days,
      boundaryGap: false,
      ...axisCommon(t),
      splitLine: { show: false },
      axisLabel: { ...axisCommon(t).axisLabel, formatter: (d: string) => formatDate(d).replace(/ \d{4}$/, ''), hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      scale: true,
      ...axisCommon(t),
      axisLine: { show: false },
      axisLabel: { ...axisCommon(t).axisLabel, formatter: (v: number) => formatEuros(v * 100, { round: true }) },
    },
    series: [
      {
        name: 'Valeur',
        type: 'line',
        data: props.points.map((p) => p.valueCents / 100),
        showSymbol: false,
        lineStyle: { width: 2, color: t.accent },
        itemStyle: { color: t.accent },
        areaStyle: { color: t.accent, opacity: 0.08 },
      },
      {
        name: 'Argent versé',
        type: 'line',
        step: 'end',
        data: props.points.map((p) => p.contributedCents / 100),
        showSymbol: false,
        lineStyle: { width: 1.5, type: 'dashed', color: t.muted },
        itemStyle: { color: t.muted },
      },
    ],
  };
});
</script>

<template>
  <div class="h-64 w-full">
    <!-- La hauteur est portée par ce conteneur : le style injecté par vue-echarts passe devant les classes Tailwind -->
    <VChart :option="option" autoresize aria-label="Évolution de la valeur du portefeuille" />
  </div>
</template>
