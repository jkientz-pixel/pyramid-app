#!/usr/bin/env python3
"""Behaviour tests for the first-paint slice of the club data.

    python3 -m unittest scripts/test_gen_slim.py -v
"""
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _datajs  # noqa: E402
import fingerprint  # noqa: E402
import gen_slim  # noqa: E402

KEY = 'test-key-not-the-real-one'


def data_js(clubs):
    return ('export const CLUBS=' + json.dumps(clubs, separators=(',', ':')) + ';\n'
            'export const REGIONS={"region1": ["CT"]};\n'
            'export const LEAGUES={"mls":{"label":"MLS"}};\n')


CLUBS = [
    {'n': 'Atlanta United', 'id': 'atlanta-united', 'g': 'mls', 'x': 'm', 'la': 33.7553, 'lo': -84.4008,
     'st': 'GA', 'r': 1853, 'rr': 2, 'acc': 'v', 'img': 'crests/atlanta-united.png', 'url': 'https://atlutd.com'},
    {'n': "Lexington SC", 'id': 'lexington-sc-usl-super-league', 'g': 'uslw', 'x': 'w', 'la': 38.04, 'lo': -84.5,
     'st': 'KY', 'sf': 'secret-full-only-field'},
    {'n': 'Old Dupe FC', 'id': 'old-dupe-fc', 'g': 'upsl', 'x': 'm', 'st': 'TX', 'h': 1, 'dup': 0},
]


class SlimFile(unittest.TestCase):
    def test_every_club_keeps_order_id_and_the_fields_the_map_reads(self):
        slim = gen_slim.build(data_js(CLUBS))
        got = gen_slim.decode(slim)

        self.assertEqual([c['id'] for c in got], [c['id'] for c in CLUBS])
        self.assertEqual(got[0], {'n': 'Atlanta United', 'id': 'atlanta-united', 'g': 'mls', 'x': 'm',
                                  'la': 33.7553, 'lo': -84.4008, 'st': 'GA', 'r': 1853, 'rr': 2, 'acc': 'v'})
        self.assertEqual(got[2]['h'], 1)
        self.assertEqual(got[2]['dup'], 0)
        self.assertNotIn('la', got[2])

    def test_full_only_fields_stay_out_of_the_first_paint_payload(self):
        slim = gen_slim.build(data_js(CLUBS))

        for secret in ('crests/atlanta-united.png', 'atlutd.com', 'secret-full-only-field'):
            self.assertNotIn(secret, slim)

    def test_an_id_that_is_not_the_name_slug_survives(self):
        got = gen_slim.decode(gen_slim.build(data_js(CLUBS)))

        self.assertEqual(got[1]['id'], 'lexington-sc-usl-super-league')

    def test_verify_flags_a_slim_file_that_has_drifted_from_data_js(self):
        src = data_js(CLUBS)
        slim = gen_slim.build(src)
        changed = [dict(CLUBS[0], r=1999)] + CLUBS[1:]

        self.assertEqual(gen_slim.verify(slim, src), [])
        self.assertTrue(gen_slim.verify(slim, data_js(changed)))

    def test_slim_coordinates_carry_the_same_fingerprint_marks_as_staged_data(self):
        marked_src = fingerprint.mark_datajs(data_js(CLUBS), KEY)
        marked = _datajs.load_clubs(marked_src)

        got = gen_slim.decode(gen_slim.build(marked_src))

        self.assertNotEqual(marked[0]['la'], CLUBS[0]['la'])
        self.assertEqual([(c.get('la'), c.get('lo')) for c in got],
                         [(c.get('la'), c.get('lo')) for c in marked])
        self.assertEqual(gen_slim.verify(gen_slim.build(marked_src), marked_src), [])
        # and a slim built from the CLEAN repo copy would not verify against the marked one
        self.assertTrue(gen_slim.verify(gen_slim.build(data_js(CLUBS)), marked_src))


class RealData(unittest.TestCase):
    def test_slim_mirrors_the_real_data_js_in_the_repo(self):
        src = _datajs.DATA_JS.read_text()

        self.assertEqual(gen_slim.verify(gen_slim.build(src), src), [])

    def test_the_generated_file_on_disk_is_in_sync_with_data_js(self):
        slim_path = gen_slim.ROOT / 'js' / 'data-slim.js'
        if not slim_path.exists():
            self.skipTest('js/data-slim.js not generated yet (python3 scripts/gen_slim.py)')

        self.assertEqual(slim_path.read_text(), gen_slim.build(_datajs.DATA_JS.read_text()))

    def test_slim_is_far_smaller_than_the_full_file(self):
        src = _datajs.DATA_JS.read_text()

        self.assertLess(len(gen_slim.build(src)), len(src) * 0.5)


if __name__ == '__main__':
    unittest.main()
