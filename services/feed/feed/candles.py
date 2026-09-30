"""Construction des bougies d'une minute à partir des cours reçus."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Candle:
    quote_key: str
    minute_ms: int  # début de la minute, en millisecondes UTC
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


def minute_of(ts_ms: int) -> int:
    return ts_ms - ts_ms % 60_000


class CandleBuilder:
    """Garde la bougie de la minute en cours pour chaque actif.

    `add` renvoie la bougie précédente quand une nouvelle minute commence ;
    `pending` donne les bougies en cours, écrites régulièrement en base pour
    que les graphiques restent à jour même au milieu d'une minute.
    """

    def __init__(self) -> None:
        self._current: dict[str, Candle] = {}
        self._dirty: set[str] = set()

    def add(self, quote_key: str, price: float, ts_ms: int, volume: float = 0.0) -> Candle | None:
        minute = minute_of(ts_ms)
        current = self._current.get(quote_key)
        closed: Candle | None = None
        if current is not None and minute < current.minute_ms:
            # Cours en retard (réseau) : ignoré pour ne pas réécrire une minute close.
            return None
        if current is None or minute > current.minute_ms:
            closed = current
            current = Candle(quote_key, minute, price, price, price, price, volume)
            self._current[quote_key] = current
        else:
            current.high = max(current.high, price)
            current.low = min(current.low, price)
            current.close = price
            current.volume += volume
        self._dirty.add(quote_key)
        return closed

    def take_dirty(self) -> list[Candle]:
        """Bougies modifiées depuis le dernier appel."""
        candles = [self._current[k] for k in self._dirty if k in self._current]
        self._dirty.clear()
        return candles
