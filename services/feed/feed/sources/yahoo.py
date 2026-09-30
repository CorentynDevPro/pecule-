"""Actions et ETF européens via Yahoo Finance (gratuit, non officiel, environ 15 min de décalage).

yfinance est bloquant : chaque appel s'exécute dans un thread pour ne pas figer le flux crypto.
Cette source peut casser si Yahoo change son site ; l'erreur est alors visible dans l'état du flux
et les autres sources continuent de fonctionner.
"""

from __future__ import annotations

import asyncio
import logging
import math
from collections.abc import Callable
from datetime import date, datetime, timezone

from ..markets import eu_day_window
from ..ticks import Tick
from . import OnTick, SourceStatus

log = logging.getLogger("feed.yahoo")


def yahoo_symbol_for_fx(pair: str) -> str:
    """« EUR/USD » → « EURUSD=X »"""
    return pair.replace("/", "") + "=X"


def _last_prices(symbols: list[str]) -> dict[str, tuple[float, float | None]]:
    import yfinance as yf

    out: dict[str, tuple[float, float | None]] = {}
    for symbol in symbols:
        try:
            info = yf.Ticker(symbol).fast_info
            last = float(info["last_price"])
            prev = info.get("previous_close")
            if math.isfinite(last):
                chg = (last / float(prev) - 1) * 100 if prev else None
                out[symbol] = (last, chg)
        except Exception as exc:
            log.warning("Yahoo %s : %s", symbol, exc)
    return out


def _daily(symbol: str, period: str = "2y") -> list[tuple[date, float]]:
    import yfinance as yf

    hist = yf.Ticker(symbol).history(period=period, interval="1d", auto_adjust=True)
    return [(idx.date(), float(row["Close"])) for idx, row in hist.iterrows() if math.isfinite(row["Close"])]


async def daily(symbol: str) -> list[tuple[date, float]]:
    return await asyncio.to_thread(_daily, symbol)


async def run(
    get_symbols: Callable[[], dict[str, tuple[str, str]]],
    on_tick: OnTick,
    status: SourceStatus,
    interval_s: int,
) -> None:
    """get_symbols renvoie {symbole Yahoo: (clé de cotation, devise)}."""
    first = True
    while True:
        wanted = get_symbols()
        # Au démarrage on récupère toujours un cours, même marché fermé, pour ne pas afficher de vide.
        if wanted and (first or eu_day_window(datetime.now(timezone.utc))):
            try:
                prices = await asyncio.to_thread(_last_prices, list(wanted))
                now = int(datetime.now(timezone.utc).timestamp() * 1000)
                for symbol, (price, chg) in prices.items():
                    key, currency = wanted[symbol]
                    await on_tick(Tick(k=key, p=price, c=currency, chg=chg, t=now))
                    status.last_tick_at = now
                status.ok = len(prices) > 0 or not wanted
                status.error = None if status.ok else "aucun cours reçu"
                first = False
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                status.ok, status.error = False, str(exc)
                log.warning("Yahoo : %s", exc)
        elif not wanted:
            status.ok = True
        await asyncio.sleep(interval_s)
