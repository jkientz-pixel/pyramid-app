"""Stdlib unittest, no network: the shared pro Elo engine."""
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import _elo_pro as E


class Engine(unittest.TestCase):
    def test_xg_share_is_half_for_identical_chances(self):
        self.assertAlmostEqual(E.xg_share(1.3, 1.3), 0.5, places=6)

    def test_xg_share_favours_the_side_that_made_more_chances(self):
        self.assertGreater(E.xg_share(2.0, 0.5), 0.75)

    def test_home_edge_makes_level_teams_home_favourites(self):
        self.assertGreater(E.expected(1500, 1500), 0.5)

    def test_lucky_win_moves_less_than_a_deserved_win(self):
        lucky, _ = E.update(1500, 1500, 1, 0, 0.4, 2.1)
        deserved, _ = E.update(1500, 1500, 1, 0, 2.1, 0.4)
        self.assertLess(lucky, deserved)

    def test_dominated_draw_still_rewards_the_better_side(self):
        d, _ = E.update(1500, 1500, 1, 1, 2.5, 0.5)
        self.assertGreater(d, 0)

    def test_missing_xg_falls_back_to_the_score(self):
        win, _ = E.update(1500, 1500, 2, 0)
        loss, _ = E.update(1500, 1500, 0, 2)
        self.assertGreater(win, 0)
        self.assertLess(loss, 0)

    def test_regress_halves_distance_from_1500_without_mutating(self):
        elo = {'a': 1600, 'b': 1400}
        out = E.regress(elo)
        self.assertEqual(out, {'a': 1550, 'b': 1450})
        self.assertEqual(elo, {'a': 1600, 'b': 1400})


if __name__ == '__main__':
    unittest.main()
