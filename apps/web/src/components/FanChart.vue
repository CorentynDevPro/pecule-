<script setup lang="ts">
/** Éventail Monte-Carlo : 8 futurs sur 10 dans la zone claire, la moitié dans la zone foncée. */
import { computed } from 'vue';
import VChart from 'vue-echarts';
import type { MonteCarloResult } from '@pecule/shared';
import { axisCommon, baseTooltip, useChartTheme } from '@/charts/setup';
import { formatEuros } from '@/domain/format';

const props = defineProps<{ result: MonteCarloResult }>();
const theme = useChartTheme();

const option = computed(() => {
  const t = theme.value;
  const r = props.result;
  const labels = r.bands.p50.map((_, m) => (m % 12 === 0 ? `${m / 12} an${m >= 24 ? 's' : ''}` : `mois ${m}`));
  const euros = (xs: number[]) => xs.map((v) => Math.round(v) / 100);
  const diff = (hi: number[], lo: number[]) => hi.map((v, i) => Math.round(v - lo[i]!) / 100);
  const band = (name: string, stack: string, lo: number[], hi: number[], opacity: number) => [
    { name: `${name}-bas`, type: 'line', stack, data: euros(lo), lineStyle: { opacity: 0 }, symbol: 'none', silent: true, tooltip: { show: false } },
    { name, type: 'line', stack, data: diff(hi, lo), lineStyle: { opacity: 0 }, symbol: 'none', itemStyle: { color: t.accent, opacity: opacity * 2.5 }, areaStyle: { color: t.accent, opacity }, silent: true },
  ];
  return {
    animation: false,
    grid: { left: 8, right: 24, top: 64, bottom: 8, containLabel: true },
    legend: {
      top: 0,
      left: 0,
      itemGap: 12,
      itemWidth: 14,
      itemHeight: 8,
      textStyle: { color: t.ink2, fontSize: 12 },
      data: ['Médiane', 'Argent versé', '8 cas sur 10', '1 cas sur 2'],
    },
    tooltip: {
      ...baseTooltip(t),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: t.axis } },
      formatter: (items: { dataIndex: number }[]) => {
        const i = items[0]?.dataIndex ?? 0;
        const year = i / 12;
        return `<div style="font-weight:600;margin-bottom:4px">${year >= 1 ? `Après ${year.toFixed(year % 1 ? 1 : 0).replace('.', ',')} an${year >= 2 ? 's' : ''}` : `Mois ${i}`}</div>
          8 cas sur 10 entre <b>${formatEuros(r.bands.p10[i]!, { round: true })}</b> et <b>${formatEuros(r.bands.p90[i]!, { round: true })}</b><br/>
          Médiane <b>${formatEuros(r.bands.p50[i]!, { round: true })}</b> · versé ${formatEuros(r.invested[i]!, { round: true })}`;
      },
    },
    xAxis: { type: 'category', data: labels, boundaryGap: false, ...axisCommon(t), splitLine: { show: false }, axisLabel: { ...axisCommon(t).axisLabel, interval: (i: number) => i % 12 === 0 } },
    yAxis: { type: 'value', ...axisCommon(t), axisLine: { show: false }, axisLabel: { ...axisCommon(t).axisLabel, formatter: (v: number) => formatEuros(v * 100, { round: true }) } },
    series: [
      ...band('8 cas sur 10', 'large', r.bands.p10, r.bands.p90, 0.12),
      ...band('1 cas sur 2', 'etroit', r.bands.p25, r.bands.p75, 0.18),
      { name: 'Médiane', type: 'line', data: euros(r.bands.p50), symbol: 'none', lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent } },
      { name: 'Argent versé', type: 'line', data: euros(r.invested), symbol: 'none', lineStyle: { width: 1.5, type: 'dashed', color: t.muted }, itemStyle: { color: t.muted } },
    ],
  };
});
</script>

<template>
  <div class="h-72 w-full">
    <VChart :option="option" autoresize aria-label="Éventail des valeurs possibles du portefeuille dans le temps" />
  </div>
</template>
