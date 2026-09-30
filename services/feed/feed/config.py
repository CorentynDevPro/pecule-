"""Configuration lue dans les variables d'environnement."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    database_url: str
    twelvedata_api_key: str
    twelvedata_daily_credits: int
    # Intervalle de rafraîchissement des cours Yahoo (Europe), en secondes
    yahoo_interval_s: int = 300
    # Fréquence maximale de publication d'un même cours, en secondes
    min_publish_interval_s: float = 1.0
    # Fréquence d'écriture des bougies en cours de formation, en secondes
    candle_flush_s: float = 5.0

    @staticmethod
    def from_env() -> "Config":
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise SystemExit("DATABASE_URL manquant")
        return Config(
            database_url=url,
            twelvedata_api_key=os.environ.get("TWELVEDATA_API_KEY", "").strip(),
            twelvedata_daily_credits=int(os.environ.get("TWELVEDATA_DAILY_CREDITS", "760")),
        )
