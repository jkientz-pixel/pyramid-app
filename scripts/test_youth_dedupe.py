#!/usr/bin/env python3
"""The youth directory pins one entry per club per sex. A club is its name AND
its state: 'Pride SC' of Colorado Springs is not 'FC Pride' of Indianapolis,
though both normalize to 'pride'.

    python3 -m unittest scripts/test_youth_dedupe.py -v
"""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_youth_layers import place_youth
from audit_youth_locations import conference_states, within_conference

PINS = {('Indianapolis', 'IN'): (39.77, -86.16), ('Colorado Springs', 'CO'): (38.83, -104.82),
        ('Lancaster', 'MA'): (42.46, -71.67)}
geocode = lambda city, st: PINS.get((city, st))
row = lambda name, city, st: {'name': name, 'city': city, 'st': st}


def placed(sources):
    new_youth, _ = place_youth(sources, clubs=[], geocode=geocode)
    return sorted((c['n'], c['g'], c['st']) for c in new_youth)


class OneEntryPerClubPerSex(unittest.TestCase):
    def test_same_name_in_another_state_is_a_different_club(self):
        got = placed([('ecnlb', 'm', [row('FC Pride', 'Indianapolis', 'IN'),
                                      row('Pride SC', 'Colorado Springs', 'CO')])])
        self.assertEqual(got, [('FC Pride', 'ecnlb', 'IN'), ('Pride SC', 'ecnlb', 'CO')])

    def test_the_outcome_does_not_depend_on_directory_order(self):
        a = [row('FC Pride', 'Indianapolis', 'IN'), row('Pride SC', 'Colorado Springs', 'CO')]
        self.assertEqual(placed([('ecnlb', 'm', a)]), placed([('ecnlb', 'm', a[::-1])]))

    def test_a_club_in_two_leagues_still_pins_once_under_the_higher_one(self):
        got = placed([('ecnlb', 'm', [row('FC Pride', 'Indianapolis', 'IN')]),
                      ('ecrlb', 'm', [row('FC Pride', 'Indianapolis', 'IN')])])
        self.assertEqual(got, [('FC Pride', 'ecnlb', 'IN')])

    def test_the_other_state_club_is_reported_nowhere_as_a_duplicate(self):
        _, report = place_youth([('ecnlb', 'm', [row('FC Pride', 'Indianapolis', 'IN'),
                                                 row('Pride SC', 'Colorado Springs', 'CO')])],
                                clubs=[], geocode=geocode)
        self.assertEqual(report['ecnlb']['youth_dup'], [])

    def test_boys_and_girls_sides_of_one_club_keep_separate_entries(self):
        got = placed([('ecnlb', 'm', [row('FC Stars', 'Lancaster', 'MA')]),
                      ('ecnlg', 'w', [row('FC Stars', 'Lancaster', 'MA')])])
        self.assertEqual(got, [('FC Stars', 'ecnlb', 'MA'), ('FC Stars', 'ecnlg', 'MA')])


class ANameJoinStaysInsideTheConference(unittest.TestCase):
    """EA states no locations, so a member's city is joined in from another
    league's directory by name. 'FC Stars' plays in EA's Mid-America conference;
    the only FC Stars in the ECNL directory is in Massachusetts."""
    MEMBERS = [{'n': 'Chicago City Soccer Club', 'conf': 'man', 'st': 'IL'},
               {'n': 'Forward Madison', 'conf': 'man', 'st': 'WI'},
               {'n': 'FC Stars', 'conf': 'man', 'st': None},
               {'n': 'Everett FC', 'conf': 'pacnw', 'st': 'WA'}]

    def test_the_footprint_is_what_members_state_for_themselves(self):
        self.assertEqual(conference_states(self.MEMBERS)['man'], {'IL', 'WI'})

    def test_a_match_outside_the_conference_is_refused(self):
        fp = conference_states(self.MEMBERS)
        self.assertFalse(within_conference({'n': 'FC Stars', 'conf': 'man', 'st': None},
                                           {'city': 'Lancaster', 'st': 'MA'}, fp))

    def test_a_match_inside_the_conference_is_kept(self):
        fp = conference_states(self.MEMBERS)
        self.assertTrue(within_conference({'n': 'Croatian Eagles SC', 'conf': 'man', 'st': None},
                                          {'city': 'Franklin', 'st': 'WI'}, fp))

    def test_a_member_that_states_its_own_state_is_never_second_guessed(self):
        fp = conference_states(self.MEMBERS)
        self.assertTrue(within_conference({'n': 'Everett FC', 'conf': 'pacnw', 'st': 'WA'},
                                          {'city': 'Everett', 'st': 'WA'}, fp))


if __name__ == '__main__':
    unittest.main()
