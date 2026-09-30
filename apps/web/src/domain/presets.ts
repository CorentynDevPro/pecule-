/**
 * Catalogue de départ : actifs courants, déjà configurés avec leur source de cours.
 * Tu peux toujours ajouter un actif à la main depuis l'écran Portefeuille.
 */
import type { Asset, Pocket } from '@pecule/shared';

export type AssetPreset = Pick<Asset, 'name' | 'symbol' | 'isin' | 'assetClass' | 'pocket' | 'currency' | 'quoteKey'> & {
  hint: string;
};

export const ASSET_PRESETS: AssetPreset[] = [
  { name: 'Amundi PEA Monde (MSCI World)', symbol: 'DCAM', isin: 'FR001400U5Q4', assetClass: 'etf', pocket: 'core', currency: 'EUR', quoteKey: 'yf:DCAM.PA', hint: 'Socle recommandé : ETF monde éligible PEA, environ 6 € la part, frais 0,20 %/an' },
  { name: 'Amundi MSCI World (PEA)', symbol: 'CW8', isin: 'LU1681043599', assetClass: 'etf', pocket: 'core', currency: 'EUR', quoteKey: 'yf:CW8.PA', hint: 'Même indice, mais environ 500 € la part : peu adapté à 50 €/mois' },
  { name: 'BNP Paribas Easy S&P 500 (PEA)', symbol: 'ESE', isin: 'FR0011550185', assetClass: 'etf', pocket: 'core', currency: 'EUR', quoteKey: 'yf:ESE.PA', hint: '500 grandes entreprises américaines, éligible PEA' },
  { name: 'Bitcoin', symbol: 'BTC', isin: null, assetClass: 'crypto', pocket: 'crypto', currency: 'EUR', quoteKey: 'kraken:BTC/EUR', hint: 'Cours en direct 24 h/24' },
  { name: 'Ethereum', symbol: 'ETH', isin: null, assetClass: 'crypto', pocket: 'crypto', currency: 'EUR', quoteKey: 'kraken:ETH/EUR', hint: 'Cours en direct 24 h/24' },
  { name: 'Solana', symbol: 'SOL', isin: null, assetClass: 'crypto', pocket: 'crypto', currency: 'EUR', quoteKey: 'kraken:SOL/EUR', hint: 'Plus volatile que Bitcoin et Ethereum' },
  { name: 'Take-Two Interactive (GTA)', symbol: 'TTWO', isin: 'US8740541094', assetClass: 'stock', pocket: 'themes', currency: 'USD', quoteKey: 'td:TTWO', hint: 'Maison mère de Rockstar Games, cotée au Nasdaq' },
  { name: 'Electronic Arts', symbol: 'EA', isin: 'US2855121099', assetClass: 'stock', pocket: 'themes', currency: 'USD', quoteKey: 'td:EA', hint: 'Éditeur de jeux, coté au Nasdaq' },
  { name: 'Ubisoft', symbol: 'UBI', isin: 'FR0000054470', assetClass: 'stock', pocket: 'themes', currency: 'EUR', quoteKey: 'yf:UBI.PA', hint: 'Éditeur français, éligible PEA' },
  { name: 'Nintendo', symbol: '7974', isin: 'JP3756600007', assetClass: 'stock', pocket: 'themes', currency: 'JPY', quoteKey: 'yf:7974.T', hint: 'Coté à Tokyo, en yens' },
  { name: 'TotalEnergies', symbol: 'TTE', isin: 'FR0000120271', assetClass: 'stock', pocket: 'themes', currency: 'EUR', quoteKey: 'yf:TTE.PA', hint: 'Énergie et pétrole, éligible PEA' },
];

export const WATCHLIST_DEFAULTS = [
  { quoteKey: 'kraken:BTC/EUR', label: 'Bitcoin', currency: 'EUR' },
  { quoteKey: 'kraken:ETH/EUR', label: 'Ethereum', currency: 'EUR' },
  { quoteKey: 'yf:DCAM.PA', label: 'PEA Monde (DCAM)', currency: 'EUR' },
  { quoteKey: 'td:TTWO', label: 'Take-Two', currency: 'USD' },
  { quoteKey: 'yf:UBI.PA', label: 'Ubisoft', currency: 'EUR' },
];

export const DEFAULT_TARGETS: Record<Pocket, number> = { core: 50, crypto: 25, themes: 15, leverage: 10 };

/** Identifiant fixe : tous les appareils partagent le même profil. */
export const PROFILE_ID = '00000000-0000-4000-8000-000000000001';
