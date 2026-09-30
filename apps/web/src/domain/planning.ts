/**
 * Préparation des analyses : hypothèses par poche (historique réel mélangé aux défauts prudents),
 * statistiques par actif, données de la frontière efficiente.
 */
import {
  assetStats,
  blendEstimate,
  DEFAULT_CORRELATION,
  DEFAULT_HYPOTHESES,
  POCKETS,
  type Asset,
  type AssetStats,
  type Bucket,
  type DailyClose,
  type Pocket,
  type Profile,
} from '@pecule/shared';
import { POCKET_LABELS } from './format';
import { targetFor } from './portfolio';

export interface PocketHypothesis {
  pocket: Pocket;
  label: string;
  weight: number;
  mu: number;
  sigma: number;
  /** « défaut prudent » ou « historique mêlé au défaut (n ans) » */
  source: string;
}

export function statsByAsset(assets: Asset[], daily: Record<string, DailyClose[]>, riskFree: number): { asset: Asset; stats: AssetStats }[] {
  const out: { asset: Asset; stats: AssetStats }[] = [];
  const seen = new Set<string>();
  for (const asset of assets) {
    // Un même cours ne compte qu'une fois, même si l'actif a été saisi en double
    if (!asset.quoteKey || seen.has(asset.quoteKey)) continue;
    seen.add(asset.quoteKey);
    const stats = assetStats(daily[asset.quoteKey] ?? [], riskFree);
    if (stats) out.push({ asset, stats });
  }
  return out;
}

/**
 * Hypothèses de rendement et de risque par poche.
 * Quand tes actifs ont un historique, il est mélangé au défaut, avec un poids qui croît
 * avec sa longueur (10 ans = confiance totale) : deux ans de bourse ne disent presque rien du futur.
 */
export function pocketHypotheses(
  profile: Profile | undefined,
  assetStatsList: { asset: Asset; stats: AssetStats }[],
  opts: { includeLeverage: boolean },
): PocketHypothesis[] {
  const pockets = POCKETS.filter((p) => opts.includeLeverage || p !== 'leverage');
  const rawWeights = pockets.map((p) => (profile ? targetFor(profile, p) : { core: 50, crypto: 25, themes: 15, leverage: 10 }[p]));
  const total = rawWeights.reduce((a, b) => a + b, 0) || 1;
  return pockets.map((pocket, i) => {
    const def = DEFAULT_HYPOTHESES[pocket];
    const own = assetStatsList.filter((s) => s.asset.pocket === pocket && s.stats.years >= 0.5);
    if (pocket === 'leverage' || own.length === 0) {
      return { pocket, label: POCKET_LABELS[pocket], weight: rawWeights[i]! / total, mu: def.mu, sigma: def.sigma, source: 'hypothèse par défaut' };
    }
    const years = Math.min(...own.map((s) => s.stats.years));
    const histSigma = own.reduce((s, x) => s + x.stats.volatility, 0) / own.length;
    const histMu = own.reduce((s, x) => s + x.stats.cagr + x.stats.volatility ** 2 / 2, 0) / own.length;
    return {
      pocket,
      label: POCKET_LABELS[pocket],
      weight: rawWeights[i]! / total,
      mu: blendEstimate(histMu, def.mu, years),
      sigma: blendEstimate(histSigma, def.sigma, years),
      source: `défaut mêlé à ${years.toFixed(1).replace('.', ',')} an${years >= 2 ? 's' : ''} d’historique`,
    };
  });
}

export function toBuckets(h: PocketHypothesis[]): { buckets: Bucket[]; correlation: number[][] } {
  const idx = h.map((x) => POCKETS.indexOf(x.pocket));
  return {
    buckets: h.map((x) => ({ name: x.label, weight: x.weight, mu: x.mu, sigma: x.sigma, canBeWipedOut: x.pocket === 'leverage' })),
    correlation: idx.map((i) => idx.map((j) => DEFAULT_CORRELATION[i]![j]!)),
  };
}
