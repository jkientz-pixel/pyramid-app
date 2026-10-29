"""Stdlib unittest, no network: playoff fixtures on a league scoreboard are not
counted as regular-season games still to play."""
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from fetch_race import is_postseason


class PostseasonTest(unittest.TestCase):
    def test_flags_playoff_quarterfinal(self):
        self.assertTrue(is_postseason({'season': {'slug': 'playoffs---quarterfinals'}}))

    def test_flags_conference_playoff_round(self):
        self.assertTrue(is_postseason({'season': {'slug': 'western-conference-playoffs---quarterfinals'}}))

    def test_keeps_regular_season_game(self):
        self.assertFalse(is_postseason({'season': {'slug': 'regular-season'}}))

    def test_keeps_event_with_no_season_block(self):
        self.assertFalse(is_postseason({}))


if __name__ == '__main__':
    unittest.main()
