"""Heures d'ouverture des marchés et budget de requêtes."""

from __future__ import annotations

import math
from datetime import datetime, time
from zoneinfo import ZoneInfo

NEW_YORK = ZoneInfo("America/New_York")
PARIS = ZoneInfo("Europe/Paris")

# Séance régulière américaine : 9 h 30 – 16 h à New York (15 h 30 – 22 h à Paris)
US_OPEN, US_CLOSE = time(9, 30), time(16, 0)
US_SESSION_MINUTES = 390


def us_market_open(now: datetime) -> bool:
    local = now.astimezone(NEW_YORK)
    return local.weekday() < 5 and US_OPEN <= local.time() < US_CLOSE


def forex_open(now: datetime) -> bool:
    """Le marché des changes tourne du dimanche 23 h au vendredi 23 h, heure de Paris."""
    local = now.astimezone(PARIS)
    wd, t = local.weekday(), local.time()
    if wd == 5:
        return False
    if wd == 6:
        return t >= time(23, 0)
    if wd == 4:
        return t < time(23, 0)
    return True


def eu_day_window(now: datetime) -> bool:
    """Plage de rafraîchissement des cours Yahoo : jours ouvrés, 8 h 45 – 22 h 15 à Paris,
    pour couvrir Euronext (9 h – 17 h 30) et les actions US suivies via Yahoo."""
    local = now.astimezone(PARIS)
    return local.weekday() < 5 and time(8, 45) <= local.time() <= time(22, 15)


def twelvedata_interval_s(symbol_count: int, daily_credits: int, per_minute_limit: int = 8) -> int:
    """Intervalle entre deux interrogations de Twelve Data pour tenir dans le budget gratuit.

    Chaque symbole coûte 1 crédit par requête. On répartit le budget quotidien sur la
    séance américaine et on respecte la limite de crédits par minute.
    """
    if symbol_count <= 0:
        return 60
    per_session = daily_credits / symbol_count  # nombre de rafraîchissements possibles
    by_day = math.ceil(US_SESSION_MINUTES * 60 / max(per_session, 1))
    by_minute = math.ceil(60 * symbol_count / per_minute_limit)
    return max(60, by_day, by_minute)
