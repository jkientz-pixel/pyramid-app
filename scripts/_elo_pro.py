"""Pro-league Elo engine, shared by fetch_asa_games.py (the live ratings) and
prediction_ledger.py (the published backtest) so the two can never drift.

Settings chosen 2026-10-01 by fitting on the 2025 season only and scoring the
2026 season once (~/Documents/crypto-api-trading/rankedxi-eval/v4). Against the
old engine (K 32, home +65, results only, every club reset to 1500 each season)
on 1,635 2026 games: Brier 0.6252 -> 0.6197, top pick 48.2% -> 49.1%, and the
probability bands now land where they say (70-80% calls had been winning 65%).
Most of the gain is xG: a results-only engine retuned the same way only fixed
the calibration, not the accuracy.
"""
import math

K = 48            # Elo step
HOME_ADV = 45     # home edge in Elo points (js/app.js oddsFor, pro tier)
XG_WEIGHT = 0.7   # share of each update driven by the chances (xG) rather than the score
CARRY = 0.5       # share of last season's distance from 1500 kept at the season break
MIN_MULT = 0.5    # floor on the margin multiplier so a level xG draw still moves ratings


def xg_share(hx, ax, top=11):
    """Home 'points share' the chances deserved: P(win) + P(draw)/2, Poisson on each side's xG."""
    ph = [math.exp(-hx) * hx ** i / math.factorial(i) for i in range(top)]
    pa = [math.exp(-ax) * ax ** j / math.factorial(j) for j in range(top)]
    win = sum(ph[i] * pa[j] for i in range(top) for j in range(i))
    draw = sum(ph[i] * pa[i] for i in range(top))
    return win + draw / 2


def expected(rh, ra):
    """Home expected score with the home edge applied."""
    return 1 / (1 + 10 ** ((ra - (rh + HOME_ADV)) / 400))


def update(rh, ra, hg, ag, hx=None, ax=None):
    """(delta, home expectation) for one game. delta is added to home, taken from away.
    Without xG the update falls back to the score alone."""
    eh = expected(rh, ra)
    actual = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
    if hx is None or ax is None:
        share, xgd = actual, hg - ag
    else:
        share, xgd = xg_share(hx, ax), hx - ax
    sh = (1 - XG_WEIGHT) * actual + XG_WEIGHT * share
    margin = abs((1 - XG_WEIGHT) * (hg - ag) + XG_WEIGHT * xgd)
    return K * max(math.log(margin + 1), MIN_MULT) * (sh - eh), eh


def regress(elo):
    """Season break: pull every rating CARRY of the way back toward 1500 (new dict)."""
    return {t: 1500 + CARRY * (r - 1500) for t, r in elo.items()}
