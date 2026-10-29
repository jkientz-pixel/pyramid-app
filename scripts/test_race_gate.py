"""Stdlib unittest, no network: the season race fallback restores only the
league that fails and keeps every other league's fresh table (the
2026-10-29 USL1 over-count that froze the MLS table for three days)."""
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from race_gate import league_failures, salvage

TODAY = '2026-10-29'
CLUBS = {'m1', 'm2', 'u1', 'u2'}


def trio(stamp, mls_gp, usl_gp, fixtures):
    sea = {'mls': {'games': 34}, 'usl1': {'games': 32}}
    std = {'updated': stamp, 'leagues': {
        'mls': {'groups': [{'rows': [{'id': 'm1', 'gp': mls_gp}, {'id': 'm2', 'gp': mls_gp}]}]},
        'usl1': {'groups': [{'rows': [{'id': 'u1', 'gp': usl_gp}, {'id': 'u2', 'gp': usl_gp}]}]}}}
    sch = {'updated': stamp, 'fixtures': fixtures}
    return sea, std, sch


FRESH = trio('2026-10-29T08:34Z', 33, 32, [
    {'lg': 'mls', 'd': '2026-11-01', 'h': 'm1', 'a': 'm2'},
    {'lg': 'usl1', 'd': '2026-11-02', 'h': 'u1', 'a': 'u2'}])
LAST = trio('2026-10-26T20:01Z', 32, 31, [
    {'lg': 'mls', 'd': '2026-10-28', 'h': 'm1', 'a': 'm2'},
    {'lg': 'usl1', 'd': '2026-10-27', 'h': 'u1', 'a': 'u2'},
    {'lg': 'usl1', 'd': '2026-10-31', 'h': 'u2', 'a': 'u1'}])


class RaceGateFallback(unittest.TestCase):
    def test_over_count_is_blamed_on_its_own_league(self):
        bad = {lg for lg, _ in league_failures(FRESH[0], FRESH[1]['leagues'], FRESH[2]['fixtures'], CLUBS, TODAY)}
        self.assertEqual(bad, {'usl1'})

    def test_salvage_keeps_fresh_mls_and_restores_usl1(self):
        sea, std, sch = salvage(FRESH, LAST, {'usl1'}, TODAY)
        self.assertEqual(std['leagues']['mls']['groups'][0]['rows'][0]['gp'], 33)
        self.assertEqual(std['leagues']['usl1']['groups'][0]['rows'][0]['gp'], 31)
        self.assertEqual(std['leagues']['mls']['updated'], '2026-10-29T08:34Z')
        self.assertEqual(std['leagues']['usl1']['updated'], '2026-10-26T20:01Z')
        self.assertEqual([(f['lg'], f['d']) for f in sch['fixtures']],
                         [('usl1', '2026-10-31'), ('mls', '2026-11-01')])

    def test_salvaged_set_passes_the_gate(self):
        sea, std, sch = salvage(FRESH, LAST, {'usl1'}, TODAY)
        self.assertEqual(league_failures(sea, std['leagues'], sch['fixtures'], CLUBS, TODAY), [])

    def test_unknown_fixture_club_is_blamed_on_its_league(self):
        fx = FRESH[2]['fixtures'] + [{'lg': 'mls', 'd': '2026-11-03', 'h': 'm1', 'a': 'ghost'}]
        bad = {lg for lg, _ in league_failures(FRESH[0], FRESH[1]['leagues'], fx, CLUBS, TODAY)}
        self.assertIn('mls', bad)


if __name__ == '__main__':
    unittest.main()
