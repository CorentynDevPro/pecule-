<script setup lang="ts">
/** Entrées au-dessus de zéro, sorties en dessous, mois par mois. */
import { computed } from 'vue';
import VChart from 'vue-echarts';
import type { MonthlyFlow } from '@/domain/portfolio';
import { axisCommon, baseTooltip, useChartTheme } from '@/charts/setup';
import { formatEuros, formatMonth } from '@/domain/format';

const props = defineProps<{ months: MonthlyFlow[] }>();
const theme = useChartTheme();

const option = computed(() => {
  const t = theme.value;
  const rows = props.months.slice(-12);
  return {
    animation: false,
    grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 12, textStyle: { color: t.ink2, fontSize: 12 } },
    tooltip: {
      ...baseTooltip(t),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: t.line, opacity: 0.4 } },
      formatter: (items: { seriesName: string; value: number; axisValue: string; marker: string }[]) => {
        const month = items[0] ? formatMonth(items[0].axisValue) : '';
        const lines = items.map((i) => `${i.marker}${i.seriesName} <b style="float:right;margin-left:16px">${formatEuros(Math.abs(i.value) * 100)}</b>`);
        return `<div style="font-weight:600;margin-bottom:4px">${month}</div>${lines.join('<br/>')}`;
      },
    },
    xAxis: {
      type: 'category',
      data: rows.map((r) => r.month),
      ...axisCommon(t),
      splitLine: { show: false },
      axisLabel: { ...axisCommon(t).axisLabel, formatter: formatMonth },
    },
    yAxis: {
      type: 'value',
      ...axisCommon(t),
      axisLine: { show: false },
      axisLabel: { ...axisCommon(t).axisLabel, formatter: (v: number) => formatEuros(Math.abs(v) * 100, { round: true }) },
    },
    series: [
      {
        name: 'Entrées',
        type: 'bar',
        stack: 'flux',
        barMaxWidth: 28,
        data: rows.map((r) => r.inCents / 100),
        itemStyle: { color: t.flowIn, borderRadius: [4, 4, 0, 0] },
      },
      {
        name: 'Sorties',
        type: 'bar',
        stack: 'flux',
        barMaxWidth: 28,
        data: rows.map((r) => -r.outCents / 100),
        itemStyle: { color: t.flowOut, borderRadius: [0, 0, 4, 4] },
      },
    ],
  };
});
</script>

<template>
  <div class="h-60 w-full">
    <!-- La hauteur est portée par ce conteneur : le style injecté par vue-echarts passe devant les classes Tailwind -->
    <VChart :option="option" autoresize aria-label="Entrées et sorties d'argent par mois" />
  </div>
</template>
