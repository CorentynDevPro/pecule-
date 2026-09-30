"""Crypto en temps réel via le WebSocket public v2 de Kraken (gratuit, sans clé)."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import date, datetime, timezone

import httpx
import websockets

from ..ticks import Tick
from . import OnTick, SourceStatus

log = logging.getLogger("feed.kraken")

WS_URL = "wss://ws.kraken.com/v2"
OHLC_URL = "https://api.kraken.com/0/public/OHLC"


def parse_ticker_message(message: dict, received_ms: int) -> list[Tick]:
    """Extrait les cours d'un message « ticker » Kraken v2 (snapshot ou mise à jour)."""
    if message.get("channel") != "ticker" or message.get("type") not in ("snapshot", "update"):
        return []
    ticks: list[Tick] = []
    for item in message.get("data") or []:
        symbol = item.get("symbol")
        last = item.get("last")
        if not symbol or last is None:
            continue
        quote = symbol.split("/")[-1]
        change = item.get("change_pct")
        ts = item.get("timestamp")
        try:
            t_ms = int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000) if ts else received_ms
        except ValueError:
            t_ms = received_ms
        ticks.append(
            Tick(
                k=f"kraken:{symbol}",
                p=float(last),
                c=quote,
                chg=float(change) if change is not None else None,
                t=t_ms,
            )
        )
    return ticks


def rest_pair(symbol: str) -> str:
    """« BTC/EUR » → « XBTEUR » : nom de paire attendu par l'API REST historique."""
    base, quote = symbol.split("/")
    return ("XBT" if base == "BTC" else base) + quote


def parse_ohlc(payload: dict) -> list[tuple[date, float]]:
    if payload.get("error"):
        raise ValueError(", ".join(payload["error"]))
    result = payload.get("result") or {}
    rows = next((v for k, v in result.items() if k != "last"), [])
    return [
        (datetime.fromtimestamp(int(r[0]), tz=timezone.utc).date(), float(r[4]))
        for r in rows
    ]


async def fetch_daily(client: httpx.AsyncClient, symbol: str) -> list[tuple[date, float]]:
    """Jusqu'à 720 clôtures quotidiennes (environ deux ans)."""
    resp = await client.get(OHLC_URL, params={"pair": rest_pair(symbol), "interval": 1440}, timeout=20)
    resp.raise_for_status()
    return parse_ohlc(resp.json())


async def run(get_symbols: Callable[[], set[str]], on_tick: OnTick, status: SourceStatus) -> None:
    """Reste connecté en permanence ; se réabonne quand la liste d'actifs change."""
    delay = 1.0
    while True:
        symbols = get_symbols()
        if not symbols:
            status.ok = True
            await asyncio.sleep(10)
            continue
        try:
            async with websockets.connect(WS_URL, ping_interval=20, ping_timeout=20) as ws:
                await ws.send(json.dumps({"method": "subscribe", "params": {"channel": "ticker", "symbol": sorted(symbols)}}))
                subscribed = set(symbols)
                status.ok, status.error, delay = True, None, 1.0
                log.info("Kraken connecté : %s", ", ".join(sorted(subscribed)))
                while True:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=10)
                    except asyncio.TimeoutError:
                        raw = None
                    if raw is not None:
                        now = int(datetime.now(timezone.utc).timestamp() * 1000)
                        for tick in parse_ticker_message(json.loads(raw), now):
                            status.last_tick_at = now
                            await on_tick(tick)
                    wanted = get_symbols()
                    if wanted != subscribed:
                        added, removed = wanted - subscribed, subscribed - wanted
                        if added:
                            await ws.send(json.dumps({"method": "subscribe", "params": {"channel": "ticker", "symbol": sorted(added)}}))
                        if removed:
                            await ws.send(json.dumps({"method": "unsubscribe", "params": {"channel": "ticker", "symbol": sorted(removed)}}))
                        subscribed = set(wanted)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # coupure réseau, redémarrage côté Kraken…
            status.ok, status.error = False, str(exc)
            log.warning("Kraken déconnecté (%s), reconnexion dans %.0f s", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)
