/** Mise en forme française des montants, pourcentages et dates. */

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euroRound = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function formatEuros(cents: number | null | undefined, opts: { round?: boolean; signed?: boolean } = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  const text = (opts.round ? euroRound : euro).format(cents / 100);
  if (opts.signed && cents > 0) return `+${text}`;
  return text;
}

export function formatPct(value: number | null | undefined, signed = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const text = `${pct.format(value)} %`;
  return signed && value > 0 ? `+${text}` : text;
}

export function formatPrice(value: number | null | undefined, currency = 'EUR'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const digits = value >= 1000 ? 2 : value >= 1 ? 2 : 6;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: digits }).format(value);
}

export function formatQuantity(q: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 8 }).format(q);
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** « à l'instant », « il y a 3 min », « il y a 2 h », « il y a 4 j » */
export function formatAge(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return 'jamais';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return 'à l’instant';
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

/** Convertit une saisie « 12,50 » ou « 12.5 » en centimes ; null si invalide. */
export function parseEuros(input: string): number | null {
  const clean = input.replace(/\s|€/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

export function parseQuantity(input: string): number | null {
  const clean = input.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,8})?$/.test(clean)) return null;
  const n = Number(clean);
  return n > 0 ? n : null;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const POCKET_LABELS = {
  core: 'Socle',
  crypto: 'Crypto',
  themes: 'Thèmes et actions',
  leverage: 'Levier',
} as const;

export const ACCOUNT_LABELS = {
  pea: 'PEA',
  cto: 'Compte-titres',
  crypto: 'Plateforme crypto',
  savings: 'Livret',
  life_insurance: 'Assurance-vie',
} as const;

export const KIND_LABELS = {
  buy: 'Achat',
  sell: 'Vente',
  dividend: 'Dividende',
  fee: 'Frais',
} as const;
