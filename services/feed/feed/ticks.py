"""Format commun des cours, identique au type PriceTick côté application."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Tick:
    k: str  # clé de cotation, ex. « kraken:BTC/EUR »
    p: float  # dernier prix
    c: str  # devise
    chg: float | None  # variation depuis la veille, en %
    t: int  # horodatage de la source, en millisecondes
    volume: float = 0.0

    def payload(self) -> dict:
        data = asdict(self)
        data.pop("volume")
        return data


class Throttle:
    """Limite la fréquence de publication d'un même cours."""

    def __init__(self, min_interval_s: float) -> None:
        self._min_ms = int(min_interval_s * 1000)
        self._last: dict[str, int] = {}

    def allow(self, key: str, now_ms: int) -> bool:
        last = self._last.get(key)
        if last is not None and now_ms - last < self._min_ms:
            return False
        self._last[key] = now_ms
        return True
