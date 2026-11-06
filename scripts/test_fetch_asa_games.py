"""Stdlib unittest, no network: a league whose ASA fetch fails keeps its last
results on The Wire, the same way it already keeps its ratings. Dropping them
took 41 USL Super League results off the live site on 2026-11-06 and made the
freshness gate report "newest rated result none" during an ASA outage."""
import json, pathlib, sys, tempfile, unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import fetch_asa_games as asa

OLD_USLW = {'d': '2026-11-01', 'lg': 'uslw', 'gid': 'old-w', 't1': 'A', 't2': 'B', 's1': 1, 's2': 0}
OLD_USLC = {'d': '2026-10-01', 'lg': 'uslc', 'gid': 'old-c', 't1': 'C', 't2': 'D', 's1': 0, 's2': 0}
DATA_JS = 'export const CLUBS=[];\nexport const REGIONS=[];\n'


def fake_get(failing):
    """ASA stand-in: `failing` slugs return None, every other slug has one game."""
    def get(path):
        slug, resource = path.lstrip('/').split('/', 1)
        if slug in failing:
            return None
        if resource == 'teams':
            return [{'team_id': 't1', 'team_name': 'Home'}, {'team_id': 't2', 'team_name': 'Away'}]
        if resource.startswith('games/xgoals'):
            return []
        return [{'game_id': f'new-{slug}', 'status': 'FullTime', 'date_time_utc': '2026-11-05 19:00:00 UTC',
                 'home_team_id': 't1', 'away_team_id': 't2', 'home_score': 2, 'away_score': 1}]
    return get


class WireOnFetchFailure(unittest.TestCase):
    def run_main(self, failing, prior=(OLD_USLW, OLD_USLC)):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'js').mkdir()
            (root / 'data').mkdir()
            (root / 'js' / 'data.js').write_text(DATA_JS)
            if prior is not None:
                (root / 'data' / 'wire_asa.json').write_text(json.dumps(list(prior)))
            with mock.patch.object(asa, 'get', fake_get(failing)), \
                    mock.patch.object(asa, 'stored_nudges', lambda: {}), \
                    mock.patch.object(asa.time, 'sleep'):
                asa.main(root=str(root))
            return json.loads((root / 'data' / 'wire_asa.json').read_text())

    def test_failed_league_keeps_its_last_results(self):
        wire = self.run_main(failing={'usls'})
        self.assertEqual([r['gid'] for r in wire if r['lg'] == 'uslw'], ['old-w'])

    def test_other_leagues_still_refresh_when_one_fails(self):
        wire = self.run_main(failing={'usls'})
        self.assertEqual([r['gid'] for r in wire if r['lg'] == 'uslc'], ['new-uslc'])

    def test_successful_league_replaces_its_old_results(self):
        wire = self.run_main(failing=set())
        self.assertEqual([r['gid'] for r in wire if r['lg'] == 'uslw'], ['new-usls'])

    def test_full_outage_leaves_the_wire_unchanged(self):
        wire = self.run_main(failing={'mls', 'uslc', 'usl1', 'mlsnp', 'nwsl', 'usls'})
        self.assertCountEqual([r['gid'] for r in wire], ['old-w', 'old-c'])

    def test_failed_league_with_no_earlier_wire_file_is_simply_absent(self):
        wire = self.run_main(failing={'usls'}, prior=None)
        self.assertEqual([r for r in wire if r['lg'] == 'uslw'], [])


if __name__ == '__main__':
    unittest.main()
