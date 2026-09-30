-- Schéma initial de Pécule (phase 1 : suivi).
-- Montants en centimes (bigint), quantités en numeric(20,8), horodatages en UTC.
-- Chaque table synchronisée porte :
--   updated_at : date de modification côté appareil (règle « la dernière écriture gagne »)
--   deleted    : suppression logique, propagée aux autres appareils
--   server_seq : numéro d'ordre attribué par le serveur, sert de curseur de synchronisation

CREATE SEQUENCE IF NOT EXISTS sync_seq;

-- Profil investisseur (une seule ligne en pratique)
CREATE TABLE IF NOT EXISTS investor_profile (
  id uuid PRIMARY KEY,
  horizon_years integer NOT NULL CHECK (horizon_years BETWEEN 1 AND 50),
  max_drawdown_pct integer NOT NULL CHECK (max_drawdown_pct BETWEEN 1 AND 100),
  monthly_contribution_cents bigint NOT NULL CHECK (monthly_contribution_cents >= 0),
  target_core_pct integer NOT NULL,
  target_crypto_pct integer NOT NULL,
  target_themes_pct integer NOT NULL,
  target_leverage_pct integer NOT NULL,
  emergency_fund_ok boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  server_seq bigint NOT NULL DEFAULT nextval('sync_seq'),
  CHECK (target_core_pct + target_crypto_pct + target_themes_pct + target_leverage_pct = 100)
);

-- Enveloppes et plateformes : PEA, compte-titres, plateforme crypto, livret
CREATE TABLE IF NOT EXISTS account (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('pea', 'cto', 'crypto', 'savings', 'life_insurance')),
  broker text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  server_seq bigint NOT NULL DEFAULT nextval('sync_seq')
);

-- Actifs suivis. quote_key identifie la source de cours : « kraken:BTC/EUR », « td:TTWO », « yf:CW8.PA »
CREATE TABLE IF NOT EXISTS asset (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  symbol text NOT NULL,
  isin text,
  asset_class text NOT NULL CHECK (asset_class IN ('etf', 'stock', 'crypto', 'commodity', 'leveraged', 'bond')),
  pocket text NOT NULL CHECK (pocket IN ('core', 'crypto', 'themes', 'leverage')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  quote_key text,
  updated_at timestamptz NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  server_seq bigint NOT NULL DEFAULT nextval('sync_seq')
);

-- Opérations sur actifs : achat, vente, dividende, frais
CREATE TABLE IF NOT EXISTS transaction (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('buy', 'sell', 'dividend', 'fee')),
  trade_date date NOT NULL,
  quantity numeric(20, 8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  -- montant total en euros, frais inclus pour un achat, frais déduits pour une vente
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  fee_cents bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  server_seq bigint NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS transaction_account_idx ON transaction (account_id, trade_date);

-- Entrées et sorties d'argent (versements, retraits), positives ou négatives
CREATE TABLE IF NOT EXISTS cash_flow (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  flow_date date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  label text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  server_seq bigint NOT NULL DEFAULT nextval('sync_seq')
);

-- Liste de favoris de l'écran Marchés
CREATE TABLE IF NOT EXISTS watchlist_item (
  id uuid PRIMARY KEY,
  quote_key text NOT NULL,
  label text NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  server_seq bigint NOT NULL DEFAULT nextval('sync_seq')
);

-- Dernier cours connu de chaque source
CREATE TABLE IF NOT EXISTS price_latest (
  quote_key text PRIMARY KEY,
  price numeric(24, 10) NOT NULL,
  currency text NOT NULL,
  -- variation depuis la clôture précédente, en %, quand la source la fournit
  change_pct numeric(12, 6),
  source_ts timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Bougies d'une minute issues du flux temps réel
CREATE TABLE IF NOT EXISTS price_candle_1m (
  quote_key text NOT NULL,
  ts timestamptz NOT NULL,
  open numeric(24, 10) NOT NULL,
  high numeric(24, 10) NOT NULL,
  low numeric(24, 10) NOT NULL,
  close numeric(24, 10) NOT NULL,
  volume numeric(28, 10) NOT NULL DEFAULT 0,
  PRIMARY KEY (quote_key, ts)
);

-- Clôtures quotidiennes (courbe de valeur, futurs backtests)
CREATE TABLE IF NOT EXISTS price_daily (
  quote_key text NOT NULL,
  day date NOT NULL,
  close numeric(24, 10) NOT NULL,
  PRIMARY KEY (quote_key, day)
);

-- TimescaleDB est présent dans l'image Docker ; en développement sur un PostgreSQL simple,
-- les tables restent des tables classiques.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable('price_candle_1m', 'ts', if_not_exists => true, migrate_data => true);
    PERFORM create_hypertable('price_daily', 'day', if_not_exists => true, migrate_data => true,
                              chunk_time_interval => interval '1 year');
    -- Les bougies de plus de 7 jours sont compressées (gain de place d'environ 90 %)
    ALTER TABLE price_candle_1m SET (timescaledb.compress, timescaledb.compress_segmentby = 'quote_key');
    PERFORM add_compression_policy('price_candle_1m', interval '7 days', if_not_exists => true);
  END IF;
END $$;
