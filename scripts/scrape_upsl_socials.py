#!/usr/bin/env python3
"""Discover UPSL club websites + socials by domain inference, then verify.

Never records a handle without a source_url the handle was literally scraped from.
"""
import json, re, socket, sys, time, unicodedata, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/127.0 Safari/537.36")
TLDS = (".com", ".org", ".net", ".club", ".us", ".soccer")
SOCCER_WORDS = ("soccer", "football", "fc ", " fc", "club", "academy", "futbol", "upsl")
PARKED = ("domain is for sale", "buy this domain", "godaddy.com/forsale",
          "parked free", "hugedomains", "afternic", "sedoparking",
          "this domain may be for sale", "namecheap parking")
# Handles that belong to site vendors/themes/platforms, not the club.
VENDOR = {"themesaxiom", "axiomthemes", "wordpress", "wordpressdotcom", "elementor",
          "wix", "wixcom", "squarespace", "godaddy", "weebly", "shopify", "duda",
          "sportspress", "teamsnap", "leagueapps", "sportsengine", "bootstrap",
          "youtube", "google", "vimeo", "linkedin", "tiktok", "pinterest",
          "upslsoccer", "upsl", "envato", "themeforest", "joomla", "drupal"}
STOP = {"fc", "sc", "cf", "club", "soccer", "football", "the", "of", "ii", "2", "iii", "b"}
SOCIAL_RE = re.compile(
    r'https?://(?:www\.)?(instagram\.com|twitter\.com|x\.com|facebook\.com)/'
    r'([A-Za-z0-9_.\-]+)', re.I)
BAD_HANDLE = {"p", "reel", "reels", "explore", "share", "tr", "home", "profile.php",
              "sharer", "intent", "hashtag", "pages", "groups", "people", "story.php",
              "accounts", "login", "privacy", "policies", "help", "about", "plugins",
              "dialog", "permalink.php", "watch", "events", "media", "search", "i"}


def ascii_fold(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def tokens(name):
    s = re.sub(r"[^a-z0-9 ]+", " ", ascii_fold(name).lower())
    return [w for w in s.split() if w]


def core_tokens(name):
    return [w for w in tokens(name) if w not in STOP]


def candidates(name):
    """Plausible domains for a club name, most-likely first."""
    t = tokens(name)
    c = core_tokens(name) or t
    joined_all = "".join(t)
    joined_core = "".join(c)
    stems = []
    for stem in (joined_all, joined_core, joined_core + "fc", joined_core + "sc",
                 joined_core + "soccer", joined_all + "soccer", "-".join(c)):
        if stem and stem not in stems and 3 <= len(stem) <= 40:
            stems.append(stem)
    out = []
    for stem in stems:
        for tld in TLDS:
            d = stem + tld
            if d not in out:
                out.append(d)
    return out[:26]


def resolves(host):
    try:
        socket.getaddrinfo(host, None)
        return True
    except Exception:
        return False


def fetch(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept": "text/html,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(700_000)
            return r.geturl(), raw.decode("utf8", "ignore")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 406, 429):
            try:
                return url, e.read(400_000).decode("utf8", "ignore")
            except Exception:
                return None, None
        return None, None
    except Exception:
        return None, None


def norm_text(html):
    """Strip tags/entities down to lowercase letters+digits+single spaces."""
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html,
               flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = ascii_fold(t).lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


# Foreign ccTLDs: a US amateur club never lives here. Catches Santos F.C. ->
# santosfc.com.br (the Brazilian Serie A club).
FOREIGN_TLD = re.compile(
    r"\.(br|mx|ar|uk|de|es|it|fr|nl|pt|co|cl|pe|ve|jp|cn|ru|au|nz|za|in|ie)(/|$)")


def loc_tokens(loc):
    """'Chula Vista, CA' -> ['chula vista', 'ca'] (city phrase, state)."""
    if not loc:
        return None, None
    parts = [p.strip() for p in ascii_fold(loc).split(",")]
    city = re.sub(r"[^a-z0-9 ]+", " ", parts[0].lower()).strip() if parts else ""
    state = parts[1].strip().lower() if len(parts) > 1 else ""
    return (city or None), (state or None)


def name_present(text, name, loc=None, window=60):
    """Club name appears contiguously, or all core tokens inside one short window.

    A single generic core token ('Houston FC II', 'Santos F.C.', 'FC Bandera')
    is never sufficient alone -- it must be corroborated by the club's own city,
    since those domains resolve to a city portal, a Brazilian club, and a
    newspaper respectively.
    """
    core = core_tokens(name)
    if not core:
        return False
    squashed = text.replace(" ", "")
    if len(core) == 1:
        tok = core[0]
        if len(tok) < 4 or tok not in squashed:
            return False
        city, _state = loc_tokens(loc)
        if not city:
            return False
        return city.replace(" ", "") in squashed and tok != city.replace(" ", "")
    if "".join(core) in squashed:
        return True
    first = core[0]
    for m in re.finditer(re.escape(first), text):
        seg = text[m.start():m.start() + window]
        if all(w in seg for w in core[1:]):
            return True
    return False


def looks_like_club(html, name, loc=None, final_url=""):
    if FOREIGN_TLD.search((final_url or "").split("://")[-1].split("/")[0] + "/"):
        return False
    low = html.lower()
    if any(p in low for p in PARKED):
        return False
    if not any(w in low for w in SOCCER_WORDS):
        return False
    return name_present(norm_text(html), name, loc)


def extract_socials(html, page_url, name):
    """Collect handles, preferring ones that share a word with the club name."""
    core = set(core_tokens(name))
    by_key = {}
    for m in SOCIAL_RE.finditer(html):
        dom, handle = m.group(1).lower(), m.group(2)
        h = handle.lower().strip(".")
        if (h in BAD_HANDLE or h in VENDOR or len(h) < 3
                or handle.isdigit() or h.startswith("http")
                or "." in h and not h.endswith(".php")):
            continue
        key = {"instagram.com": "instagram", "twitter.com": "twitter",
               "x.com": "twitter", "facebook.com": "facebook"}[dom]
        squash = re.sub(r"[^a-z0-9]", "", h)
        overlap = sum(1 for w in core if len(w) > 2 and w in squash)
        cand = {"handle": handle, "source_url": page_url, "overlap": overlap}
        if key not in by_key or overlap > by_key[key]["overlap"]:
            by_key[key] = cand
    return by_key


def probe_club(rec):
    """rec: {'name','loc','portal'} -> result dict"""
    name = rec["name"]
    tried = []
    for dom in candidates(name):
        if not resolves(dom):
            continue
        for scheme in ("https://", "http://"):
            final, html = fetch(scheme + dom)
            if not html:
                continue
            tried.append(dom)
            if not looks_like_club(html, name, rec.get("loc"), final):
                break
            socials = extract_socials(html, final, name)
            # follow one contact/about page if nothing on the homepage
            if not socials:
                for path in ("/contact", "/about", "/contact-us"):
                    f2, h2 = fetch(final.rstrip("/") + path, timeout=8)
                    if h2:
                        socials = extract_socials(h2, f2, name)
                        if socials:
                            break
            conf = "high" if any(v["overlap"] > 0 for v in socials.values()) \
                else ("low" if socials else "none")
            return {**rec, "website": final, "socials": socials,
                    "confidence": conf,
                    "status": "found" if socials else "site-no-socials"}
        # domain resolved but didn't validate -> keep trying other candidates
    return {**rec, "website": None, "socials": {}, "status": "not-found",
            "tried": tried[:5]}


def load_clubs(path):
    d = json.load(open(path))
    out, seen = [], set()
    for portal, v in d.items():
        n = (v.get("name") or "").strip()
        if not n or n.lower() in seen:
            continue
        seen.add(n.lower())
        out.append({"name": n, "loc": v.get("loc"),
                    "division": v.get("division"), "portal": portal})
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else \
        "/Users/jeremykientz/pyramid-app/data/upsl_locations.json"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    outp = sys.argv[3] if len(sys.argv) > 3 else "upsl_socials_out.json"
    clubs = load_clubs(src)
    if limit:
        step = max(1, len(clubs) // limit)
        clubs = clubs[::step][:limit]      # spread the sample across the alphabet
    t0 = time.time()
    results, done = [], 0
    with ThreadPoolExecutor(max_workers=14) as ex:
        futs = {ex.submit(probe_club, c): c for c in clubs}
        for f in as_completed(futs):
            try:
                r = f.result()
            except Exception as e:
                c = futs[f]
                r = {**c, "website": None, "socials": {},
                     "status": "error", "error": str(e)[:80]}
            results.append(r)
            done += 1
            if done % 10 == 0 or done == len(clubs):
                el = time.time() - t0
                print("  %d/%d  %.0fs  %.2f clubs/s"
                      % (done, len(clubs), el, done / el), flush=True)
    el = time.time() - t0
    found = [r for r in results if r["status"] == "found"]
    hi = [r for r in found if r.get("confidence") == "high"]
    sites = [r for r in results if r["website"]]
    json.dump(sorted(results, key=lambda r: r["name"]), open(outp, "w"), indent=1)
    print("\n--- pilot ---")
    print("clubs        : %d" % len(results))
    print("site found   : %d (%.0f%%)" % (len(sites), 100 * len(sites) / len(results)))
    print("with socials : %d (%.0f%%)" % (len(found), 100 * len(found) / len(results)))
    print("  high conf  : %d" % len(hi))
    print("  low conf   : %d" % (len(found) - len(hi)))
    print("elapsed      : %.1fs  -> %.2f clubs/s" % (el, len(results) / el))
    print("out          : %s" % outp)
    for r in found[:16]:
        s = "[%s] " % r.get("confidence", "?") + " ".join(
            "%s=%s" % (k, v["handle"]) for k, v in r["socials"].items())
        print("   %-30s %-34s %s" % (r["name"][:30], (r["website"] or "")[:34], s[:60]))


if __name__ == "__main__":
    main()
