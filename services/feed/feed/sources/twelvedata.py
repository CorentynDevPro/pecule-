"""Actions US et taux de change via Twelve Data (offre gratuite : 800 crédits par jour, 8 par minute)."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import date, datetime, timezone

import httpx

from ..markets import forex_open, twelvedata_interval_s, us_market_open
from ..ticks import Tick
from . import OnTick, SourceStatus

log = logging.getLogger("feed.twelvedata")

BASE = "https://api.twelvedata.com"


def parse_quotes(payload: dict, symbols: list[str], key_of: Callable[[str], str], currency_of: Callable[[str], str]) -> list[Tick]:
    """/quote renvoie un objet par symbole, ou directement l'objet quand il n'y en a qu'un."""
    if len(symbols) == 1 and "symbol" in payload:
        payload = {symbols[0]: payload}
    ticks: list[Tick] = []
    for symbol in symbols:
        q = payload.get(symbol)
        if not isinstance(q, dict) or q.get("status") == "error" or q.get("close") is None:
            continue
        ts = q.get("last_quote_at") or q.get("timestamp")
        t_ms = int(ts) * 1000 if ts else int(datetime.now(timezone.utc).timestamp() * 1000)
        change = q.get("percent_change")
        ticks.append(
            Tick(
                k=key_of(symbol),
                p=float(q["close"]),
                c=currency_of(symbol),
                chg=float(change) if change not in (None, "") else None,
                t=t_ms,
            )
        )
    return ticks


def parse_time_series(payload: dict) -> list[tuple[date, float]]:
    if payload.get("status") == "error":
        raise ValueError(payload.get("message", "erreur Twelve Data"))
    return [
        (date.fromisoformat(v["datetime"][:10]), float(v["close"]))
        for v in payload.get("values") or []
    ]


class TwelveData:
    def __init__(self, api_key: str, daily_credits: int) -> None:
        self.api_key = api_key
        self.daily_credits = daily_credits
        self._used_today = 0
        self._day = datetime.now(timezone.utc).date()

    def _spend(self, credits: int) -> bool:
        today = datetime.now(timezone.utc).date()
        if today != self._day:
            self._day, self._used_today = today, 0
        if self._used_today + credits > self.daily_credits:
            return False
        self._used_today += credits
        return True

    async def quotes(self, client: httpx.AsyncClient, symbols: list[str]) -> dict:
        if not self._spend(len(symbols)):
            raise RuntimeError("budget quotidien Twelve Data atteint")
        resp = await client.get(f"{BASE}/quote", params={"symbol": ",".join(symbols), "apikey": self.api_key}, timeout=20)
        resp.raise_for_status()
        return resp.json()

    async def daily(self, client: httpx.AsyncClient, symbol: str, days: int = 400) -> list[tuple[date, float]]:
        if not self._spend(1):
            raise RuntimeError("budget quotidien Twelve Data atteint")
        resp = await client.get(
            f"{BASE}/time_series",
            params={"symbol": symbol, "interval": "1day", "outputsize": days, "apikey": self.api_key},
            timeout=30,
        )
        resp.raise_for_status()
        return parse_time_series(resp.json())

    async def run(
        self,
        get_symbols: Callable[[], dict[str, tuple[str, str]]],
        on_tick: OnTick,
        status: SourceStatus,
    ) -> None:
        """get_symbols renvoie {symbole Twelve Data: (clé de cotation, devise)}.

        Les actions ne sont interrogées que pendant la séance américaine, le change
        pendant l'ouverture du forex : aucun crédit n'est dépensé marché fermé.
        """
        async with httpx.AsyncClient() as client:
            while True:
                wanted = get_symbols()
                now = datetime.now(timezone.utc)
                active = [
                    s for s in wanted
                    if ("/" in s and forex_open(now)) or ("/" not in s and us_market_open(now))
                ]
                interval = twelvedata_interval_s(len(active) or 1, self.daily_credits)
                if active:
                    try:
                        for start in range(0, len(active), 8):
                            batch = active[start:start + 8]
                            payload = await self.quotes(client, batch)
                            ticks = parse_quotes(payload, batch, lambda s: wanted[s][0], lambda s: wanted[s][1])
                            for tick in ticks:
                                status.last_tick_at = tick.t
                                await on_tick(tick)
                        status.ok, status.error = True, None
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        status.ok, status.error = False, str(exc)
                        log.warning("Twelve Data : %s", exc)
                else:
                    status.ok = True
                await asyncio.sleep(interval)
