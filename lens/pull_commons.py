#!/usr/bin/env python3
"""Pull Wikimedia Commons photos that carry EXIF FocalLengthIn35mmFilm.

Phase A: geosearch around ~70 landmarks in ~50 cities (group = landmark).
Phase B: extra long-lens (>70 mm) and ultrawide (<20 mm) photos from lens-focal-length categories.
Output (repo-root data/ is git-ignored): data/lens/images/*.jpg (768 px), data/lens/meta.jsonl.
Committed: lens/CREDITS.tsv. Resumable: rerun and it skips titles already seen.

Commons etiquette: descriptive User-Agent, <= 2 requests/s across API and image downloads, Retry-After honoured.
"""
import argparse, hashlib, json, math, re, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
import urllib.error, urllib.parse, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from labels import f35_with_zoom, to_bin

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data" / "lens"
IMAGES = DATA / "images"
META = DATA / "meta.jsonl"
SEEN = DATA / "seen.txt"
UA = "shotmatch-lens/0.1 (HackUTD 2026 research; contact: benz16107 on GitHub)"
API = "https://commons.wikimedia.org/w/api.php"
MIN_GAP = 0.55  # seconds between any two requests -> under 2/s
LICENSE_OK = re.compile(r"^(CC[ -]BY(?:[ -]SA)?[ -][0-9.]+(?: \w+)?|CC0.*|Public domain.*|PD.*)$", re.I)

# (group, lat, lon, radius_m)
SITES = [
    ("nyc_dumbo", 40.7033, -73.9894, 750), ("nyc_flatiron", 40.7411, -73.9897, 500),
    ("nyc_liberty", 40.6892, -74.0445, 600), ("nyc_timessq", 40.7580, -73.9855, 400),
    ("nyc_bethesda", 40.7739, -73.9712, 500), ("sf_goldengate", 37.8199, -122.4783, 900),
    ("sf_alamo", 37.7764, -122.4346, 500), ("sf_transamerica", 37.7952, -122.4028, 500),
    ("sf_battery_spencer", 37.8296, -122.4826, 400), ("chicago_cloudgate", 41.8827, -87.6233, 500),
    ("chicago_riverwalk", 41.8886, -87.6355, 500), ("toronto_cityhall", 43.6525, -79.3835, 500),
    ("toronto_cntower", 43.6426, -79.3871, 600), ("toronto_gooderham", 43.6486, -79.3743, 400),
    ("toronto_islands", 43.6210, -79.3790, 700), ("montreal_oldport", 45.5017, -73.5540, 600),
    ("vancouver_gastown", 49.2844, -123.1089, 600), ("seattle_spaceneedle", 47.6205, -122.3493, 500),
    ("la_griffith", 34.1184, -118.3004, 700), ("la_hollywood", 34.1015, -118.3406, 500),
    ("dc_lincoln", 38.8893, -77.0502, 600), ("dc_capitol", 38.8899, -77.0091, 600),
    ("boston_commons", 42.3554, -71.0640, 600), ("dallas_reunion", 32.7757, -96.8089, 600),
    ("austin_congress", 30.2747, -97.7404, 600), ("mexico_zocalo", 19.4326, -99.1332, 500),
    ("rio_corcovado", -22.9519, -43.2105, 600), ("buenos_aires_mayo", -34.6081, -58.3702, 500),
    ("paris_eiffel", 48.8584, 2.2945, 700), ("paris_notredame", 48.8530, 2.3499, 500),
    ("paris_louvre", 48.8606, 2.3376, 500), ("paris_sacrecoeur", 48.8867, 2.3431, 400),
    ("paris_trocadero", 48.8616, 2.2893, 400), ("london_towerbridge", 51.5055, -0.0754, 500),
    ("london_bigben", 51.5007, -0.1246, 500), ("london_stpauls", 51.5138, -0.0984, 400),
    ("london_eye", 51.5033, -0.1195, 400), ("rome_colosseum", 41.8902, 12.4922, 500),
    ("rome_trevi", 41.9009, 12.4833, 300), ("rome_stpeters", 41.9022, 12.4539, 500),
    ("barcelona_sagrada", 41.4036, 2.1744, 500), ("barcelona_guell", 41.4145, 2.1527, 500),
    ("berlin_brandenburg", 52.5163, 13.3777, 500), ("berlin_reichstag", 52.5186, 13.3761, 400),
    ("amsterdam_dam", 52.3731, 4.8926, 500), ("prague_charles", 50.0865, 14.4114, 500),
    ("vienna_schonbrunn", 48.1845, 16.3122, 600), ("venice_rialto", 45.4380, 12.3359, 500),
    ("istanbul_hagiasophia", 41.0086, 28.9802, 500), ("budapest_parliament", 47.5071, 19.0457, 600),
    ("lisbon_belem", 38.6916, -9.2160, 600), ("athens_acropolis", 37.9715, 23.7257, 600),
    ("edinburgh_castle", 55.9486, -3.1999, 600), ("florence_duomo", 43.7731, 11.2560, 400),
    ("munich_marienplatz", 48.1374, 11.5755, 500), ("sydney_opera", -33.8568, 151.2153, 600),
    ("sydney_harbourbridge", -33.8523, 151.2108, 500), ("melbourne_federation", -37.8180, 144.9691, 500),
    ("tokyo_shibuya", 35.6595, 139.7005, 500), ("tokyo_skytree", 35.7101, 139.8107, 600),
    ("kyoto_fushimi", 34.9671, 135.7727, 500), ("kyoto_kinkakuji", 35.0394, 135.7292, 400),
    ("osaka_castle", 34.6873, 135.5262, 600), ("seoul_gyeongbok", 37.5796, 126.9770, 600),
    ("hk_harbour", 22.2930, 114.1694, 800), ("singapore_marinabay", 1.2834, 103.8607, 700),
    ("bangkok_wat_arun", 13.7437, 100.4888, 500), ("agra_taj", 27.1751, 78.0421, 600),
    ("dubai_burj", 25.1972, 55.2744, 700), ("beijing_forbidden", 39.9163, 116.3972, 700),
    ("shanghai_bund", 31.2400, 121.4900, 700), ("cairo_giza", 29.9792, 31.1342, 800),
    ("capetown_waterfront", -33.9037, 18.4210, 700),
]
# Phase B categories: real focal lengths in mm (a crop sensor multiplies these, the f35 filter decides)
TELE_MM = [85, 100, 105, 135, 150, 170, 200, 250, 300, 350, 400, 500, 600, 800]
WIDE_MM = [8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19]
PER_SITE_CAP = 90      # accepted photos per landmark (DUMBO gets more)
PER_CAT_CAP = 40


_last = 0.0
_lock = threading.Lock()


def http(url, data_is_json=True, max_wait=900):
    global _last
    for attempt in range(8):
        with _lock:  # the lock spaces request starts, so parallel image downloads still total < 2/s
            wait = MIN_GAP - (time.time() - _last)
            if wait > 0:
                time.sleep(wait)
            _last = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                body = r.read()
            return json.loads(body) if data_is_json else body
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                ra = e.headers.get("Retry-After")
                pause = min(int(ra), 900) if ra and ra.isdigit() else 30 * (attempt + 1)
                if pause > max_wait:  # one throttled image is not worth a 10 minute stall; skip it instead of retrying
                    return None
                print(f"  {e.code} on {url[:90]}, waiting {pause}s", flush=True)
                time.sleep(pause)
            elif e.code == 404:
                return None
            else:
                time.sleep(10 * (attempt + 1))
        except Exception as e:
            print("  net error", e, flush=True)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("giving up on " + url[:120])


def api(**p):
    p.update(format="json", formatversion=2)
    for attempt in range(6):
        r = http(API + "?" + urllib.parse.urlencode(p))
        if r and "error" not in r:
            return r
        print("  api error", (r or {}).get("error"), flush=True)
        time.sleep(20 * (attempt + 1))
    raise RuntimeError("api kept failing")


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*$", str(v))
    if m:
        return float(m[1]) / float(m[2]) if float(m[2]) else None
    try:
        return float(v)
    except ValueError:
        return None


def haversine(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def nearest_site(lat, lon, within=3000):
    best = min(SITES, key=lambda s: haversine((lat, lon), (s[1], s[2])))
    return best[0] if haversine((lat, lon), (best[1], best[2])) <= within else None


def parse(page, fallback_gps=None):
    """Return a record or None. Keeps only JPEGs with a 35 mm tag and an open license."""
    ii = (page.get("imageinfo") or [None])[0]
    if not ii or ii.get("mime") != "image/jpeg" or not ii.get("thumburl"):
        return None
    md = {m["name"]: m["value"] for m in (ii.get("metadata") or []) if isinstance(m, dict)}
    raw35 = num(md.get("FocalLengthIn35mmFilm"))
    zoom = num(md.get("DigitalZoomRatio"))
    make = (md.get("Make") or "").strip() or None
    f35 = f35_with_zoom(raw35, zoom, make)
    if f35 is None or not 6 <= f35 <= 1500:
        return None
    em = ii.get("extmetadata", {})
    lic = em.get("LicenseShortName", {}).get("value", "")
    if not LICENSE_OK.match(lic.strip()):
        return None
    lat, lon = num(md.get("GPSLatitude")), num(md.get("GPSLongitude"))
    if lat is not None and lon is not None:
        if md.get("GPSLatitudeRef") == "S" and lat > 0: lat = -lat
        if md.get("GPSLongitudeRef") == "W" and lon > 0: lon = -lon
    elif fallback_gps:
        lat, lon = fallback_gps
    else:
        lat = lon = None
    strip = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()
    return dict(
        title=page["title"], page_url=ii.get("descriptionurl"), thumb=ii["thumburl"],
        f35_raw=raw35, zoom=zoom, f35=round(f35, 2), bin=to_bin(f35), focal_mm=num(md.get("FocalLength")),
        make=make, model=(md.get("Model") or "").strip() or None,
        lat=lat, lon=lon, heading_deg=num(md.get("GPSImgDirection")),
        orig_width=ii.get("width"), orig_height=ii.get("height"),
        license=lic.strip(), author=strip(em.get("Artist", {}).get("value"))[:120] or "Unknown",
        license_url=em.get("LicenseUrl", {}).get("value"),
    )


class Store:
    def __init__(self):
        IMAGES.mkdir(parents=True, exist_ok=True)
        self.seen = set(SEEN.read_text().splitlines()) if SEEN.exists() else set()
        rows = [json.loads(l) for l in META.read_text().splitlines()] if META.exists() else []
        self.rows = list({r["title"]: r for r in rows}.values())  # drop duplicate lines from an interrupted run
        if len(self.rows) != len(rows):
            META.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in self.rows))
        self.per_group = {}
        self.titles = {r["title"] for r in self.rows}
        for r in self.rows:
            self.per_group[r["group"]] = self.per_group.get(r["group"], 0) + 1

    def counts(self):
        c = {}
        for r in self.rows:
            c[r["bin"]] = c.get(r["bin"], 0) + 1
        return c

    def mark(self, titles):
        new = [t for t in titles if t not in self.seen]
        self.seen.update(new)
        with SEEN.open("a") as f:
            f.writelines(t + "\n" for t in new)

    def reserve(self, rec, group, source):
        if rec["title"] in self.titles:
            return False
        self.titles.add(rec["title"])
        rec.update(file=hashlib.sha1(rec["title"].encode()).hexdigest()[:14] + ".jpg", group=group, source=source)
        self.per_group[group] = self.per_group.get(group, 0) + 1  # counts toward caps before the download lands
        return True

    def download(self, rec):
        body = http(rec["thumb"], data_is_json=False, max_wait=120)
        if not body:
            self.per_group[rec["group"]] -= 1
            return
        (IMAGES / rec["file"]).write_bytes(body)
        with META.open("a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.rows.append(rec)


def fetch_info(titles):
    r = api(action="query", titles="|".join(titles), prop="imageinfo", iiurlwidth=768,
            iiprop="url|metadata|extmetadata|size|mime")
    return r.get("query", {}).get("pages", [])


def scan(store, titles, group_for, source, accept, gps_for=lambda t: None):
    titles = [t for t in dict.fromkeys(titles) if t not in store.seen]
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        keep = []
        for pg in fetch_info(batch):
            rec = parse(pg, gps_for(pg["title"]))
            if rec:
                g = group_for(rec)
                if accept(rec, g) and store.reserve(rec, g, source):
                    keep.append(rec)
        with ThreadPoolExecutor(2) as ex:
            list(ex.map(store.download, keep))
        store.mark(batch)


def phase_a(store, only=None):
    for name, lat, lon, rad in SITES:
        if only and name not in only:
            continue
        cap = 260 if name == "nyc_dumbo" else PER_SITE_CAP
        r = api(action="query", list="geosearch", gsnamespace=6, gscoord=f"{lat}|{lon}", gsradius=rad, gslimit=500)
        gs = r["query"]["geosearch"]
        gps = {g["title"]: (g["lat"], g["lon"]) for g in gs}
        scan(store, [g["title"] for g in gs], lambda rec, n=name: n, "geosearch",
             # long and ultrawide shots are rare, so they bypass the per-landmark cap
             lambda rec, g, cap=cap: store.per_group.get(g, 0) < cap or rec["bin"] in ("super-tele", "ultrawide") or rec["f35"] > 70,
             gps.get)
        print(f"A {name}: {len(gs)} geotagged files, group now {store.per_group.get(name, 0)}, total {len(store.rows)} {store.counts()}", flush=True)


def category_files(cat, limit=1500):
    out, cont = [], {}
    while len(out) < limit:
        r = api(action="query", list="categorymembers", cmtitle=cat, cmtype="file", cmlimit=500, **cont)
        if not r or "query" not in r:
            break
        out += [m["title"] for m in r["query"]["categorymembers"]]
        if "continue" not in r:
            break
        cont = {"cmcontinue": r["continue"]["cmcontinue"]}
    return out


def phase_b(store, want_tele, want_wide):
    jobs = [("tele", mm) for mm in TELE_MM] + [("wide", mm) for mm in WIDE_MM]
    for kind, mm in jobs:
        c = store.counts()
        tele = c.get("tele", 0) + c.get("super-tele", 0)
        if (kind == "tele" and tele >= want_tele) or (kind == "wide" and c.get("ultrawide", 0) >= want_wide):
            continue
        cat = f"Category:Lens focal length {mm} mm"
        titles = category_files(cat)
        if not titles:
            continue
        want = (lambda rec: rec["f35"] > 70) if kind == "tele" else (lambda rec: rec["f35"] < 20)
        def group_for(rec, cat=cat):
            site = nearest_site(rec["lat"], rec["lon"]) if rec["lat"] is not None else None
            return site or "cat:" + cat.split(":", 1)[1]
        scan(store, titles, group_for, "category:" + cat,
             lambda rec, g, want=want: want(rec) and (g.startswith("cat:") and store.per_group.get(g, 0) < PER_CAT_CAP or not g.startswith("cat:")))
        print(f"B {cat}: {len(titles)} files, total {len(store.rows)} {store.counts()}", flush=True)


def write_credits():
    rows = [json.loads(l) for l in META.read_text().splitlines()]
    with (HERE / "CREDITS.tsv").open("w") as f:
        f.write("file\ttitle\tauthor\tlicense\tpage\n")
        for r in rows:
            cell = lambda s: str(s).replace("\t", " ").replace("\n", " ")
            f.write("\t".join(cell(x) for x in ("images/" + r["file"], r["title"], r["author"], r["license"], r["page_url"])) + "\n")
    print("CREDITS.tsv:", len(rows), "rows")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tele", type=int, default=260, help="target count of >70 mm photos")
    ap.add_argument("--wide", type=int, default=100, help="target count of <20 mm photos")
    ap.add_argument("--sites", nargs="*", help="only these landmark names")
    ap.add_argument("--skip-a", action="store_true")
    ap.add_argument("--credits-only", action="store_true")
    a = ap.parse_args()
    if not a.credits_only:
        st = Store()
        if not a.skip_a:
            phase_a(st, set(a.sites or []))
        phase_b(st, a.tele, a.wide)
        print("DONE", len(st.rows), st.counts(), flush=True)
    write_credits()
