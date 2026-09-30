"""Accès à la base : actifs suivis, derniers cours, bougies, clôtures, notifications."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timezone

import psycopg

from .candles import Candle
from .ticks import Tick

TRACKED_SQL = """
SELECT quote_key, currency FROM asset
 WHERE NOT deleted AND quote_key IS NOT NULL AND quote_key <> ''
UNION
SELECT quote_key, currency FROM watchlist_item WHERE NOT deleted
"""


@dataclass(frozen=True)
class Tracked:
    """Clés de cotation à suivre, avec leur devise."""

    keys: dict[str, str]

    def by_source(self, source: str) -> dict[str, str]:
        prefix = f"{source}:"
        return {k[len(prefix):]: cur for k, cur in self.keys.items() if k.startswith(prefix)}


def fx_keys_for(currencies: set[str]) -> dict[str, str]:
    """Taux de change nécessaires pour convertir chaque devise en euros."""
    return {f"fx:EUR/{c}": c for c in sorted(currencies) if c != "EUR"}


class Store:
    def __init__(self, url: str) -> None:
        self._url = url
        self._conn: psycopg.AsyncConnection | None = None

    async def connect(self) -> None:
        self._conn = await psycopg.AsyncConnection.connect(self._url, autocommit=True)

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()

    @property
    def conn(self) -> psycopg.AsyncConnection:
        if self._conn is None or self._conn.closed:
            raise RuntimeError("Base non connectée")
        return self._conn

    async def tracked(self) -> Tracked:
        async with self.conn.cursor() as cur:
            await cur.execute(TRACKED_SQL)
            rows = await cur.fetchall()
        keys = {k: c for k, c in rows}
        keys.update(fx_keys_for(set(keys.values())))
        return Tracked(keys)

    async def publish(self, tick: Tick) -> None:
        """Enregistre le dernier cours et le diffuse aux appareils connectés."""
        async with self.conn.transaction():
            await self.conn.execute(
                """INSERT INTO price_latest (quote_key, price, currency, change_pct, source_ts, received_at)
                   VALUES (%s, %s, %s, %s, to_timestamp(%s / 1000.0), now())
                   ON CONFLICT (quote_key) DO UPDATE SET
                     price = EXCLUDED.price, currency = EXCLUDED.currency,
                     change_pct = COALESCE(EXCLUDED.change_pct, price_latest.change_pct),
                     source_ts = EXCLUDED.source_ts, received_at = now()
                   WHERE price_latest.source_ts <= EXCLUDED.source_ts""",
                (tick.k, tick.p, tick.c, tick.chg, tick.t),
            )
            await self.conn.execute("SELECT pg_notify('price_tick', %s)", (json.dumps(tick.payload()),))

    async def write_candles(self, candles: list[Candle]) -> None:
        if not candles:
            return
        async with self.conn.cursor() as cur:
            await cur.executemany(
                """INSERT INTO price_candle_1m (quote_key, ts, open, high, low, close, volume)
                   VALUES (%s, to_timestamp(%s / 1000.0), %s, %s, %s, %s, %s)
                   ON CONFLICT (quote_key, ts) DO UPDATE SET
                     high = GREATEST(price_candle_1m.high, EXCLUDED.high),
                     low = LEAST(price_candle_1m.low, EXCLUDED.low),
                     close = EXCLUDED.close,
                     volume = GREATEST(price_candle_1m.volume, EXCLUDED.volume)""",
                [(c.quote_key, c.minute_ms, c.open, c.high, c.low, c.close, c.volume) for c in candles],
            )

    async def write_daily(self, quote_key: str, closes: list[tuple[date, float]]) -> None:
        if not closes:
            return
        async with self.conn.cursor() as cur:
            await cur.executemany(
                """INSERT INTO price_daily (quote_key, day, close) VALUES (%s, %s, %s)
                   ON CONFLICT (quote_key, day) DO UPDATE SET close = EXCLUDED.close""",
                [(quote_key, d, c) for d, c in closes],
            )

    async def daily_last_day(self, quote_key: str) -> date | None:
        async with self.conn.cursor() as cur:
            await cur.execute("SELECT max(day) FROM price_daily WHERE quote_key = %s", (quote_key,))
            row = await cur.fetchone()
        return row[0] if row else None

    async def notify_status(self, status: dict) -> None:
        await self.conn.execute("SELECT pg_notify('feed_status', %s)", (json.dumps(status),))


def now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)
