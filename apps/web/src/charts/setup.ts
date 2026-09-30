/**
 * ECharts, réduit aux modules utilisés (poids du bundle), et couleurs lues dans les jetons CSS
 * pour suivre le thème clair ou sombre de l'appareil.
 */
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { onBeforeUnmount, ref } from 'vue';

use([CanvasRenderer, LineChart, BarChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent]);

export interface ChartTheme {
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  axis: string;
  surface: string;
  accent: string;
  flowIn: string;
  flowOut: string;
}

function read(): ChartTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--muted'),
    line: v('--line'),
    axis: v('--axis'),
    surface: v('--surface'),
    accent: v('--accent'),
    flowIn: v('--flow-in'),
    flowOut: v('--flow-out'),
  };
}

/** Thème réactif : se met à jour quand l'appareil passe en mode sombre ou clair. */
export function useChartTheme() {
  const theme = ref<ChartTheme>(read());
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => (theme.value = read());
  mq.addEventListener('change', update);
  onBeforeUnmount(() => mq.removeEventListener('change', update));
  return theme;
}

export function baseTooltip(t: ChartTheme) {
  return {
    backgroundColor: t.surface,
    borderColor: t.line,
    borderWidth: 1,
    textStyle: { color: t.ink, fontSize: 13 },
    extraCssText: 'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);',
  };
}

export function axisCommon(t: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.line } },
  };
}
