<script setup lang="ts">
/** Nuage des répartitions possibles : risque en abscisse, rendement en ordonnée. */
import { computed } from 'vue';
import VChart from 'vue-echarts';
import type { PortfolioPoint } from '@pecule/shared';
import { axisCommon, baseTooltip, useChartTheme } from '@/charts/setup';

const props = defineProps<{ points: PortfolioPoint[]; best: PortfolioPoint; assets: { name: string; ret: number; vol: number }[] }>();
const theme = useChartTheme();
const pct = (v: number) => `${(v * 100).toFixed(0)} %`;

const option = computed(() => {
  const t = theme.value;
  const cloud = props.points.filter((_, i) => i % 3 === 0).map((p) => [p.vol * 100, p.ret * 100]);
  return {
    animation: false,
    grid: { left: 8, right: 16, top: 30, bottom: 28, containLabel: true },
    legend: { top: 0, left: 0, textStyle: { color: t.ink2, fontSize: 12 }, data: ['Répartitions possibles', 'Meilleur rapport', 'Actifs seuls'] },
    tooltip: {
      ...baseTooltip(t),
      trigger: 'item',
      formatter: (p: { seriesName: string; value: [number, number]; name?: string }) =>
        `${p.name ? `<b>${p.name}</b><br/>` : `${p.seriesName}<br/>`}Risque ${p.value[0].toFixed(0)} % · rendement ${p.value[1].toFixed(0)} %/an`,
    },
    xAxis: { type: 'value', name: 'Risque (volatilité annuelle)', nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: t.muted, fontSize: 11 }, ...axisCommon(t), axisLabel: { ...axisCommon(t).axisLabel, formatter: '{value} %' } },
    yAxis: { type: 'value', ...axisCommon(t), axisLine: { show: false }, axisLabel: { ...axisCommon(t).axisLabel, formatter: '{value} %' } },
    series: [
      { name: 'Répartitions possibles', type: 'scatter', data: cloud, symbolSize: 4, itemStyle: { color: t.muted, opacity: 0.35 } },
      {
        name: 'Actifs seuls',
        type: 'scatter',
        data: props.assets.map((a) => ({ name: a.name, value: [a.vol * 100, a.ret * 100] })),
        symbolSize: 9,
        itemStyle: { color: t.surface, borderColor: t.ink2, borderWidth: 1.5 },
        label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: { name: string }) => p.name },
      },
      {
        name: 'Meilleur rapport',
        type: 'scatter',
        data: [{ name: `Meilleur rapport : ${pct(props.best.ret)} pour ${pct(props.best.vol)} de risque`, value: [props.best.vol * 100, props.best.ret * 100] }],
        symbolSize: 14,
        itemStyle: { color: t.accent, borderColor: t.surface, borderWidth: 2 },
      },
    ],
  };
});
</script>

<template>
  <div class="h-72 w-full">
    <VChart :option="option" autoresize aria-label="Frontière efficiente des répartitions possibles" />
  </div>
</template>
