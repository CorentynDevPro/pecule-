"""Point d'entrée du service de flux.

Boucles parallèles :
- Kraken (crypto, temps réel, 24 h/24)
- Twelve Data (actions US et change, dans la limite du budget gratuit)
- Yahoo Finance (Europe, toutes les 5 minutes)
- écriture des bougies d'une minute, état des sources, historiques quotidiens
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

from .candles import CandleBuilder
from .config import Config
from .sources import SourceStatus, kraken, yahoo
from .sources.twelvedata import TwelveData
from .store import Store, Tracked, now_ms
from .ticks import Throttle, Tick

log = logging.getLogger("feed")


class Feed:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.store = Store(config.database_url)
        self.tracked = Tracked({})
        self.builder = CandleBuilder()
        self.throttle = Throttle(config.min_publish_interval_s)
        self.td = TwelveData(config.twelvedata_api_key, config.twelvedata_daily_credits) if config.twelvedata_api_key else None
        self.status = {"kraken": SourceStatus(), "yf": SourceStatus()}
        if self.td:
            self.status["td"] = SourceStatus()

    # --- listes d'actifs par source -------------------------------------------------

    def kraken_symbols(self) -> set[str]:
        return set(self.tracked.by_source("kraken"))

    def td_symbols(self) -> dict[str, tuple[str, str]]:
        out = {s: (f"td:{s}", c) for s, c in self.tracked.by_source("td").items()}
        for pair, cur in self.tracked.by_source("fx").items():
            out[pair] = (f"fx:{pair}", cur)
        return out

    def yahoo_symbols(self) -> dict[str, tuple[str, str]]:
        out = {s: (f"yf:{s}", c) for s, c in self.tracked.by_source("yf").items()}
        if not self.td:
            for pair, cur in self.tracked.by_source("fx").items():
                out[yahoo.yahoo_symbol_for_fx(pair)] = (f"fx:{pair}", cur)
        return out

    # --- publication -------------------------------------------------------------

    async def on_tick(self, tick: Tick) -> None:
        self.builder.add(tick.k, tick.p, tick.t, tick.volume)
        if not self.throttle.allow(tick.k, now_ms()):
            return
        await self._with_db(self.store.publish(tick))

    async def _with_db(self, coro) -> None:
        try:
            await coro
        except (psycopg.OperationalError, RuntimeError) as exc:
            log.warning("Base indisponible (%s), reconnexion", exc)
            await self._reconnect()

    async def _reconnect(self) -> None:
        await self.store.close()
        delay = 1
        while True:
            try:
                await self.store.connect()
                log.info("Base connectée")
                return
            except psycopg.OperationalError as exc:
                log.warning("Connexion à la base impossible (%s), nouvel essai dans %d s", exc, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)

    # --- boucles -----------------------------------------------------------------

    async def refresh_tracked_loop(self) -> None:
        while True:
            try:
                tracked = await self.store.tracked()
                if tracked.keys != self.tracked.keys:
                    log.info("Actifs suivis : %s", ", ".join(sorted(tracked.keys)) or "aucun")
                self.tracked = tracked
            except Exception as exc:
                log.warning("Lecture des actifs suivis impossible : %s", exc)
                await self._reconnect()
            await asyncio.sleep(60)

    async def candle_loop(self) -> None:
        while True:
            await asyncio.sleep(self.config.candle_flush_s)
            candles = self.builder.take_dirty()
            if candles:
                await self._with_db(self.store.write_candles(candles))

    async def status_loop(self) -> None:
        while True:
            await asyncio.sleep(30)
            payload = {name: s.as_dict() for name, s in self.status.items()}
            await self._with_db(self.store.notify_status(payload))

    async def daily_loop(self) -> None:
        """Complète les clôtures quotidiennes au démarrage puis toutes les 6 heures."""
        async with httpx.AsyncClient() as client:
            while True:
                await asyncio.sleep(5)  # laisse le temps de lire les actifs suivis
                yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()
                for key in list(self.tracked.keys):
                    try:
                        last = await self.store.daily_last_day(key)
                        if last is not None and last >= yesterday:
                            continue
                        closes = await self._fetch_daily(client, key)
                        await self.store.write_daily(key, closes)
                        log.info("Historique %s : %d clôtures", key, len(closes))
                    except Exception as exc:
                        log.warning("Historique %s indisponible : %s", key, exc)
                await asyncio.sleep(6 * 3600)

    async def _fetch_daily(self, client: httpx.AsyncClient, key: str):
        source, _, symbol = key.partition(":")
        if source == "kraken":
            return await kraken.fetch_daily(client, symbol)
        if source == "yf":
            return await yahoo.daily(symbol)
        if source in ("td", "fx") and self.td:
            return await self.td.daily(client, symbol)
        if source == "fx":
            return await yahoo.daily(yahoo.yahoo_symbol_for_fx(symbol))
        return []

    async def run(self) -> None:
        await self._reconnect()
        self.tracked = await self.store.tracked()
        tasks = [
            self.refresh_tracked_loop(),
            self.candle_loop(),
            self.status_loop(),
            self.daily_loop(),
            kraken.run(self.kraken_symbols, self.on_tick, self.status["kraken"]),
            yahoo.run(self.yahoo_symbols, self.on_tick, self.status["yf"], self.config.yahoo_interval_s),
        ]
        if self.td:
            tasks.append(self.td.run(self.td_symbols, self.on_tick, self.status["td"]))
        else:
            log.info("Pas de clé Twelve Data : actions US et change via Yahoo uniquement")
        await asyncio.gather(*tasks)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s : %(message)s")
    asyncio.run(Feed(Config.from_env()).run())


if __name__ == "__main__":
    main()
