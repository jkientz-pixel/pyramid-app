"""Stdlib unittest, no network: the public prediction ledger never rewrites a
frozen prediction, scores and voids honestly, and logs pro fixtures only."""
import pathlib, sys, unittest
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from prediction_ledger import freeze, score, summarize, odds

NOW = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)
CLUBS = [{'id': 'h', 'n': 'Home FC', 'r': 1900}, {'id': 'a', 'n': 'Away FC', 'r': 1850},
         {'id': 'u1', 'n': 'Amateur One', 'r': 1400}, {'id': 'u2', 'n': 'Amateur Two', 'r': 1380}]


def fx(start, lg='mls', id1='h', id2='a'):
    return {'lg': lg, 'start': start, 'id1': id1, 'id2': id2}


class Freeze(unittest.TestCase):
    def test_freezes_pro_fixture_inside_window_with_app_odds(self):
        ledger, n = freeze([], [fx('2026-09-30T00:00:00.000Z')], CLUBS, NOW)
        self.assertEqual(n, 1)
        self.assertEqual(ledger[0]['p'], [round(x, 4) for x in odds(1900, 1850)])
        self.assertEqual((ledger[0]['r1'], ledger[0]['r2']), (1900, 1850))

    def test_skips_fixtures_outside_window_or_already_started(self):
        _, n = freeze([], [fx('2026-10-05T00:00:00.000Z'), fx('2026-09-29T11:00:00.000Z')], CLUBS, NOW)
        self.assertEqual(n, 0)

    def test_never_logs_amateur_fixtures(self):
        _, n = freeze([], [fx('2026-09-30T00:00:00.000Z', 'upsl', 'u1', 'u2')], CLUBS, NOW)
        self.assertEqual(n, 0)

    def test_a_frozen_prediction_is_never_rewritten_when_ratings_move(self):
        first, _ = freeze([], [fx('2026-09-30T00:00:00.000Z')], CLUBS, NOW)
        moved = [{**c, 'r': c['r'] + 200} for c in CLUBS]
        again, n = freeze(first, [fx('2026-09-30T00:00:00.000Z')], moved, NOW)
        self.assertEqual(n, 0)
        self.assertEqual(again, first)


class Score(unittest.TestCase):
    def frozen(self):
        return freeze([], [fx('2026-09-30T00:00:00.000Z')], CLUBS, NOW)[0]

    def test_result_attached_from_wire_within_a_day(self):
        wire = [{'lg': 'mls', 't1': 'Home FC', 't2': 'Away FC', 'd': '2026-09-29', 's1': 2, 's2': 1}]
        out, n = score(self.frozen(), wire, datetime(2026, 10, 1, tzinfo=timezone.utc))
        self.assertEqual((n, out[0]['res']), (1, [2, 1]))
        self.assertEqual(out[0]['p'], self.frozen()[0]['p'])

    def test_unplayed_game_is_voided_not_deleted(self):
        out, _ = score(self.frozen(), [], datetime(2026, 10, 9, tzinfo=timezone.utc))
        self.assertEqual(len(out), 1)
        self.assertTrue(out[0]['void'])

    def test_recent_unplayed_game_stays_pending(self):
        out, _ = score(self.frozen(), [], datetime(2026, 10, 1, tzinfo=timezone.utc))
        self.assertNotIn('void', out[0])
        self.assertNotIn('res', out[0])


class Summary(unittest.TestCase):
    def test_hit_rate_and_brier(self):
        s = summarize([([0.6, 0.3, 0.1], 0), ([0.6, 0.3, 0.1], 2)])
        self.assertEqual(s['n'], 2)
        self.assertEqual(s['hit'], 0.5)
        self.assertAlmostEqual(s['brier'], round(((0.16 + 0.09 + 0.01) + (0.36 + 0.09 + 0.81)) / 2, 3))


if __name__ == '__main__':
    unittest.main()
