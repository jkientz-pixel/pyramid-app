"""Stdlib unittest, no network: the freshness gate flags each failure mode the
2026-09-23 audit found, and stays quiet in the offseason."""
import pathlib, sys, unittest
from datetime import date

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from check_freshness import check, spearman

TODAY = date(2026, 9, 28)


def table(order):
    """An MLS table whose strength follows `order` (first = best)."""
    n = len(order)
    return {'updated': '2026-09-28T08:45Z', 'leagues': {'mls': {'groups': [{'rows': [
        {'id': cid, 'gp': 20, 'pts': 3 * (n - i), 'gd': n - i, 'ded': 0} for i, cid in enumerate(order)]}]}}}


def fresh_inputs(**over):
    ids = ['a', 'b', 'c', 'd', 'e']
    base = dict(
        wire=[{'lg': lg, 'd': '2026-09-26'} for lg in ('uslc', 'usl1', 'mnp', 'nwsl', 'uslw')],
        standings=table(ids),
        upsl=[{'division': d, 'fetched': '2026-09-28'} for d in ('Premier', 'Division 1')],
        apsl={'fetched': '2026-09-28'},
        mls_clubs=[{'id': cid, 'r': 2000 - 10 * i} for i, cid in enumerate(ids)],
        massey={k: {'season': '2026', 'fetched': '2026-09-28'} for k in ('d1', 'd2', 'd3', 'naia', 'd1w', 'd2w')},
    )
    base.update(over)
    return base


class FreshnessGate(unittest.TestCase):
    def stale(self, today=TODAY, **over):
        res = check(today, **fresh_inputs(**over))
        return {lg for lg, v in res.items() if v['stale']}

    def test_everything_fresh_passes(self):
        self.assertEqual(self.stale(), set())

    def test_frozen_mls_ratings_are_flagged_even_with_a_fresh_table(self):
        frozen = [{'id': cid, 'r': 2000 - 10 * i} for i, cid in enumerate(['e', 'd', 'c', 'b', 'a'])]
        self.assertEqual(self.stale(mls_clubs=frozen), {'mls'})

    def test_results_league_walking_last_season_is_flagged(self):
        wire = [{'lg': lg, 'd': '2026-09-26'} for lg in ('uslc', 'usl1', 'mnp', 'nwsl')]
        wire.append({'lg': 'uslw', 'd': '2026-05-17'})
        self.assertEqual(self.stale(wire=wire), {'uslw'})

    def test_one_upsl_division_behind_is_flagged(self):
        upsl = [{'division': 'Premier', 'fetched': '2026-09-28'},
                {'division': 'Division 1', 'fetched': '2026-08-23'}]
        self.assertEqual(self.stale(upsl=upsl), {'upsl'})

    def test_apsl_never_fetched_is_flagged(self):
        self.assertEqual(self.stale(apsl={}), {'apsl'})

    def test_college_pinned_to_last_season_is_flagged(self):
        massey = {k: {'season': '2026', 'fetched': '2026-09-28'} for k in ('d1', 'd2', 'd3', 'naia', 'd1w')}
        massey['d2w'] = {'season': '2025', 'fetched': '2026-09-28'}
        self.assertEqual(self.stale(massey=massey), {'ncaa2w'})

    def test_offseason_quiet_is_not_flagged(self):
        wire = [{'lg': lg, 'd': '2026-05-17'} for lg in ('uslc', 'usl1', 'mnp', 'nwsl', 'uslw')]
        self.assertNotIn('uslw', self.stale(today=date(2026, 7, 15), wire=wire))

    def test_spearman_orders(self):
        self.assertAlmostEqual(spearman([1, 2, 3], [10, 20, 30]), 1.0)
        self.assertAlmostEqual(spearman([1, 2, 3], [30, 20, 10]), -1.0)


if __name__ == '__main__':
    unittest.main()
