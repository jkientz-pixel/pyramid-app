"""Parser tests for fetch_opencup_qual.py — stdlib unittest, no network."""
import datetime, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_opencup_qual as q


class Teams(unittest.TestCase):
    def test_scheduled(self):
        self.assertEqual(q.parse_teams('<td>Fall River FC vs. KO Elites FC</td>'),
                         {'t1': 'Fall River FC', 't2': 'KO Elites FC'})

    def test_winner_bold_away(self):
        r = q.parse_teams('South Coast Union 2 - <strong>8 Fall River FC</strong>')
        self.assertEqual((r['score'], r['winner'], r['t2']), ([2, 8], 2, 'Fall River FC'))

    def test_team_name_with_digit(self):
        r = q.parse_teams('<strong>Arkansas Wolves 2 3</strong> - 1 Oklahoma United FC')
        self.assertEqual((r['t1'], r['score'], r['winner']), ('Arkansas Wolves 2', [3, 1], 1))

    def test_penalties_and_aet(self):
        r = q.parse_teams('<strong>St. Louis CITY SC 2 (4)</strong> - 2 (2) Houston Dynamo FC (AET & PKs)')
        self.assertEqual((r['pens'], r['aet'], r['winner']), ([4, 2], True, 1))

    def test_bare_aet_and_forfeit(self):
        r = q.parse_teams('CV United FC 1 - <strong>2 SF Vikings SC</strong> AET')
        self.assertEqual((r['t2'], r['aet']), ('SF Vikings SC', True))
        f = q.parse_teams('<strong>Columbus Astray 1</strong> - 0 West Virginia United (Forfeit)')
        self.assertTrue(f['forfeit'])

    def test_unbolded_falls_back_to_score(self):
        self.assertEqual(q.parse_teams('A 0 - 3 B')['winner'], 2)


class WhenAndWhere(unittest.TestCase):
    def test_autumn_belongs_to_year_before_edition(self):
        self.assertEqual(q.parse_day('Oct. 31', 2027), datetime.date(2026, 10, 31))
        self.assertEqual(q.parse_day('April 2', 2027), datetime.date(2027, 4, 2))

    def test_kickoff_respects_dst_end(self):
        # 31 Oct is EDT (UTC-4); 1 Nov 2026 is EST (UTC-5)
        d1, d2 = datetime.date(2026, 10, 31), datetime.date(2026, 11, 1)
        t = q.parse_time('3:30 p.m. ET')
        self.assertEqual(q.kickoff(d1, t), '2026-10-31T19:30:00.000Z')
        self.assertEqual(q.kickoff(d2, t), '2026-11-01T20:30:00.000Z')
        self.assertEqual(q.kickoff(d2, q.parse_time('6 p.m. PT')), '2026-11-02T02:00:00.000Z')
        self.assertIsNone(q.parse_time('TBD'))

    def test_venue_as_stated(self):
        self.assertEqual(q.split_venue('Britland Park; Fall River, Mass.'),
                         ('Britland Park', 'Fall River, Mass.', 'MA'))
        self.assertEqual(q.split_venue('-'), (None, None, None))


class Tabs(unittest.TestCase):
    def test_label_count_mismatch_refuses_to_guess(self):
        page = ('<script>self.__next_f.push([1,"{\\"labels\\":[\\"A\\",\\"B\\"]}<table></table>"])</script>')
        with self.assertRaises(ValueError):
            q.tabs(page)

    def test_round_label(self):
        self.assertEqual(q.round_name('THIRD QUALIFYING ROUND (2027)'), ('Third Qualifying Round', 2027))
        self.assertIsNone(q.round_name('ROUND OF 32'))


if __name__ == '__main__':
    unittest.main()
