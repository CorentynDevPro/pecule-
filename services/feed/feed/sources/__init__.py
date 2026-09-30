"""Sources de cours : Kraken (crypto), Twelve Data (US, change), Yahoo Finance (Europe)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from ..ticks import Tick

OnTick = Callable[[Tick], Awaitable[None]]


@dataclass
class SourceStatus:
    ok: bool = False
    last_tick_at: int | None = None
    error: str | None = None
    extra: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"ok": self.ok, "lastTickAt": self.last_tick_at}
