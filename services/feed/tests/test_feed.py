"""Tests du service de flux : logique pure, puis écriture en base si TEST_DATABASE_URL est défini."""

from __future__ import annotations

import os
from datetime import date, datetime, timezone

import pytest

from feed.candles import CandleBuilder
from feed.markets import forex_open, twelvedata_interval_s, us_market_open
from feed.sources.kraken import parse_ohlc, parse_ticker_message, rest_pair
from feed.sources.twelvedata import parse_quotes, parse_time_series
from feed.sources.yahoo import yahoo_symbol_for_fx
from feed.store import fx_keys_for
from feed.ticks import Throttle, Tick

T0 = 1_790_000_040_000  # un instant au milieu d'une minute


class TestCandles:
    def test_minute_complete(self):
        b = CandleBuilder()
        assert b.add("k", 100, T0) is None
        b.add("k", 105, T0 + 1_000)
        b.add("k", 98, T0 + 2_000)
        b.add("k", 101, T0 + 3_000, volume=2)
        (c,) = b.take_dirty()
        assert (c.open, c.high, c.low, c.close, c.volume) == (100, 105, 98, 101, 2)

    def test_nouvelle_minute_renvoie_la_bougie_close(self):
        b = CandleBuilder()
        b.add("k", 100, T0)
        closed = b.add("k", 110, T0 + 60_000)
        assert closed is not None and closed.close == 100
        assert b.take_dirty()[0].open == 110

    def test_cours_en_retard_ignore(self):
        b = CandleBuilder()
        b.add("k", 100, T0 + 60_000)
        assert b.add("k", 1, T0) is None
        assert b.take_dirty()[0].low == 100


class TestMarkets:
    def test_seance_us(self):
        # Mercredi 30 septembre 2026, 16 h à Paris = 10 h à New York
        assert us_market_open(datetime(2026, 9, 30, 14, 0, tzinfo=timezone.utc))
        # 23 h à Paris : fermé
        assert not us_market_open(datetime(2026, 9, 30, 21, 0, tzinfo=timezone.utc))
        # Samedi
        assert not us_market_open(datetime(2026, 10, 3, 15, 0, tzinfo=timezone.utc))

    def test_forex_ferme_le_samedi(self):
        assert not forex_open(datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc))
        assert forex_open(datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc))

    def test_budget_twelvedata(self):
        # 2 actions + 1 change, 760 crédits : ~253 rafraîchissements sur 390 min → toutes les ~93 s
        interval = twelvedata_interval_s(3, 760)
        assert interval >= 60
        assert 390 * 60 / interval * 3 <= 760
        # Beaucoup de symboles : la limite par minute s'applique aussi
        assert twelvedata_interval_s(16, 10_000) >= 120


class TestParsers:
    def test_kraken_ticker(self):
        msg = {
            "channel": "ticker",
            "type": "update",
            "data": [{"symbol": "BTC/EUR", "last": 54321.5, "change_pct": -1.25, "volume": 10}],
        }
        (tick,) = parse_ticker_message(msg, T0)
        assert tick == Tick(k="kraken:BTC/EUR", p=54321.5, c="EUR", chg=-1.25, t=T0)

    def test_kraken_horodatage_source(self):
        msg = {"channel": "ticker", "type": "update",
               "data": [{"symbol": "ETH/EUR", "last": 2000, "timestamp": "2026-09-30T07:00:00.500000Z"}]}
        (tick,) = parse_ticker_message(msg, T0)
        assert tick.t == 1790751600500

    def test_kraken_ignore_les_autres_canaux(self):
        assert parse_ticker_message({"channel": "heartbeat"}, T0) == []
        assert parse_ticker_message({"method": "subscribe", "success": True}, T0) == []

    def test_kraken_rest(self):
        assert rest_pair("BTC/EUR") == "XBTEUR"
        assert rest_pair("ETH/EUR") == "ETHEUR"
        payload = {"error": [], "result": {"XXBTZEUR": [[1790035200, "1", "2", "0.5", "54000.1", "0", "3", 9]], "last": 1}}
        assert parse_ohlc(payload) == [(date(2026, 9, 22), 54000.1)]

    def test_twelvedata_plusieurs_symboles(self):
        payload = {
            "TTWO": {"symbol": "TTWO", "close": "231.40", "percent_change": "0.85", "timestamp": 1790000000},
            "EA": {"status": "error", "message": "invalid"},
        }
        ticks = parse_quotes(payload, ["TTWO", "EA"], lambda s: f"td:{s}", lambda s: "USD")
        assert ticks == [Tick(k="td:TTWO", p=231.4, c="USD", chg=0.85, t=1_790_000_000_000)]

    def test_twelvedata_un_seul_symbole(self):
        payload = {"symbol": "EUR/USD", "close": "1.1702", "percent_change": "", "timestamp": 1790000000}
        (tick,) = parse_quotes(payload, ["EUR/USD"], lambda s: f"fx:{s}", lambda s: "USD")
        assert tick.k == "fx:EUR/USD" and tick.chg is None

    def test_twelvedata_historique(self):
        payload = {"values": [{"datetime": "2026-09-29", "close": "230.1"}], "status": "ok"}
        assert parse_time_series(payload) == [(date(2026, 9, 29), 230.1)]
        with pytest.raises(ValueError):
            parse_time_series({"status": "error", "message": "quota"})

    def test_change(self):
        assert yahoo_symbol_for_fx("EUR/USD") == "EURUSD=X"
        assert fx_keys_for({"EUR", "USD", "JPY"}) == {"fx:EUR/JPY": "JPY", "fx:EUR/USD": "USD"}


def test_throttle():
    t = Throttle(1.0)
    assert t.allow("k", 0)
    assert not t.allow("k", 500)
    assert t.allow("k", 1000)
    assert t.allow("autre", 500)


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL non défini")
@pytest.mark.asyncio
async def test_store_publie_et_ecrit(tmp_path):
    import psycopg

    from feed.candles import Candle
    from feed.store import Store

    url = os.environ["TEST_DATABASE_URL"]
    store = Store(url)
    await store.connect()
    listener = await psycopg.AsyncConnection.connect(url, autocommit=True)
    await listener.execute("LISTEN price_tick")

    await store.conn.execute(
        """INSERT INTO asset (id, name, symbol, asset_class, pocket, currency, quote_key, updated_at)
           VALUES ('55555555-5555-4555-8555-555555555555', 'Take-Two', 'TTWO', 'stock', 'themes', 'USD', 'td:TTWO', now())
           ON CONFLICT (id) DO NOTHING"""
    )
    tracked = await store.tracked()
    assert tracked.keys["td:TTWO"] == "USD"
    assert tracked.keys["fx:EUR/USD"] == "USD"

    await store.publish(Tick(k="td:TTWO", p=231.4, c="USD", chg=0.5, t=T0))
    gen = listener.notifies(timeout=2)
    note = await anext(gen)
    assert '"td:TTWO"' in note.payload

    # Un cours plus ancien n'écrase pas le plus récent
    await store.publish(Tick(k="td:TTWO", p=1.0, c="USD", chg=None, t=T0 - 60_000))
    async with store.conn.cursor() as cur:
        await cur.execute("SELECT price, change_pct FROM price_latest WHERE quote_key = 'td:TTWO'")
        assert tuple(float(v) for v in await cur.fetchone()) == (231.4, 0.5)

    await store.write_candles([Candle("td:TTWO", T0 - T0 % 60_000, 1, 3, 0.5, 2, 1)])
    await store.write_candles([Candle("td:TTWO", T0 - T0 % 60_000, 1, 2, 0.8, 2.5, 1)])
    async with store.conn.cursor() as cur:
        await cur.execute("SELECT high, low, close FROM price_candle_1m WHERE quote_key = 'td:TTWO'")
        assert tuple(float(v) for v in await cur.fetchone()) == (3, 0.5, 2.5)

    await store.write_daily("td:TTWO", [(date(2026, 9, 29), 230.1)])
    assert await store.daily_last_day("td:TTWO") == date(2026, 9, 29)
    await listener.close()
    await store.close()
