#!/usr/bin/env python3
"""Behaviour tests for the coordinate fingerprint.

    python3 -m unittest scripts/test_fingerprint.py -v
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import fingerprint  # noqa: E402

KEY = 'test-key-not-the-real-one'
FOUR_DECIMALS = 0.0001   # ~11 m of latitude: the most a marked pin may move


class MarkingOneClub(unittest.TestCase):
    def test_marked_pin_stays_within_eleven_metres_and_keeps_its_four_decimals(self):
        la, lo = fingerprint.mark('atlanta-united', 33.7553, -84.4008, KEY)

        self.assertTrue(str(la).startswith('33.7553'), la)
        self.assertTrue(str(lo).startswith('-84.4008'), lo)
        self.assertLess(abs(la - 33.7553), FOUR_DECIMALS)
        self.assertLess(abs(lo - -84.4008), FOUR_DECIMALS)
        self.assertNotEqual((la, lo), (33.7553, -84.4008))

    def test_same_club_and_key_always_get_the_same_mark(self):
        self.assertEqual(fingerprint.mark('austin-fc', 30.3882, -97.7198, KEY),
                         fingerprint.mark('austin-fc', 30.3882, -97.7198, KEY))

    def test_marking_an_already_marked_pin_changes_nothing(self):
        once = fingerprint.mark('cf-montreal', 45.5631, -73.5525, KEY)

        self.assertEqual(fingerprint.mark('cf-montreal', *once, KEY), once)

    def test_a_different_key_leaves_a_different_mark(self):
        self.assertNotEqual(fingerprint.mark('cf-montreal', 45.5631, -73.5525, KEY),
                            fingerprint.mark('cf-montreal', 45.5631, -73.5525, 'another-key'))


DATA_JS = ('// header comment\n'
           'export const CLUBS=[{"n":"Atlanta United","g":"mls","la":33.7553,"lo":-84.4008,'
           '"r":1846,"id":"atlanta-united"},'
           '{"n":"No Pin FC","g":"upsl","r":1200,"id":"no-pin-fc"},'
           '{"n":"Austin FC","g":"mls","la":30.388,"lo":-97.72,"r":1861,"id":"austin-fc"}];\n'
           'export const LEAGUES=[{"id":"mls","la":1}];\n')


class MarkingTheStagedDataFile(unittest.TestCase):
    def test_only_club_coordinates_change(self):
        import _datajs
        before = _datajs.load_clubs(DATA_JS)

        marked_src = fingerprint.mark_datajs(DATA_JS, KEY)

        after = _datajs.load_clubs(marked_src)
        strip = lambda clubs: [{k: v for k, v in c.items() if k not in ('la', 'lo')}  # noqa: E731
                               for c in clubs]
        self.assertEqual(strip(after), strip(before))
        self.assertNotIn('la', after[1])
        self.assertEqual((after[0]['la'], after[0]['lo']),
                         fingerprint.mark('atlanta-united', 33.7553, -84.4008, KEY))
        self.assertLess(abs(after[2]['lo'] - -97.72), FOUR_DECIMALS)
        # everything outside the CLUBS array ships byte-for-byte
        self.assertTrue(marked_src.startswith('// header comment\nexport const CLUBS=['))
        self.assertTrue(marked_src.endswith('export const LEAGUES=[{"id":"mls","la":1}];\n'))


class CheckingASuspectCopy(unittest.TestCase):
    def setUp(self):
        import _datajs
        self.clubs = _datajs.load_clubs(DATA_JS)
        self.published = fingerprint.mark_datajs(DATA_JS, KEY)

    def test_a_copy_of_the_published_file_carries_every_pinned_clubs_mark(self):
        report = fingerprint.check(self.published, self.clubs, KEY)

        self.assertEqual((report['matched'], report['pinned']), (2, 2))

    def test_the_mark_survives_being_reformatted_as_csv(self):
        import _datajs
        rows = [f'{c["n"]},{c["la"]:.6f},{c["lo"]:.6f}'
                for c in _datajs.load_clubs(self.published) if 'la' in c]
        csv = 'name,lat,lng\n' + '\n'.join(rows)

        self.assertEqual(fingerprint.check(csv, self.clubs, KEY)['matched'], 2)

    def test_our_own_unmarked_source_does_not_match(self):
        self.assertEqual(fingerprint.check(DATA_JS, self.clubs, KEY)['matched'], 0)

    def test_a_file_marked_with_someone_elses_key_does_not_match(self):
        other = fingerprint.mark_datajs(DATA_JS, 'another-key')

        self.assertEqual(fingerprint.check(other, self.clubs, KEY)['matched'], 0)


class MarkingTheDeployStage(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.staged = pathlib.Path(self.tmp.name) / 'js' / 'data.js'
        self.staged.parent.mkdir()
        self.staged.write_text(DATA_JS)

    def test_staged_data_file_ships_marked_when_a_key_is_present(self):
        import _datajs

        self.assertTrue(fingerprint.mark_stage(self.tmp.name, KEY))

        report = fingerprint.check(self.staged.read_text(), _datajs.load_clubs(DATA_JS), KEY)
        self.assertEqual(report['matched'], 2)

    def test_no_key_ships_the_file_untouched_instead_of_blocking_the_deploy(self):
        self.assertFalse(fingerprint.mark_stage(self.tmp.name, None))

        self.assertEqual(self.staged.read_text(), DATA_JS)


if __name__ == '__main__':
    unittest.main()
