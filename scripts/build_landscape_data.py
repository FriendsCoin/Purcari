#!/usr/bin/env python3
"""Build the real landscape bundle for the Estate chapter.

Until now the ground under the stations was layered noise — an evocation, and
labelled as one, because no elevation model shipped with the survey. It does not
have to be: the estate is a real place with public data.

This fetches two open sources and reduces them to a compact runtime bundle:

  * SRTM 30 m elevation (opentopodata) over the estate's bounding box, giving
    the real relief — roughly 130 m of it, from the château on the valley floor
    up to the southern ridge.
  * OpenStreetMap geometry (Overpass) — building footprints including the
    château, vineyard parcels, tracks, watercourses and woodland.

Everything is projected to metres relative to the estate origin and quantised to
whole metres, which is well inside the accuracy of either source and keeps the
bundle small enough to inline in the single-file build.

Usage:
    python3 scripts/build_landscape_data.py --out public/data/landscape.json
    python3 scripts/build_landscape_data.py --out ... --dem-cache dem.json
"""

from __future__ import annotations

import argparse
import json
import math
import time
import urllib.error
import urllib.request
from pathlib import Path

ORIGIN_LAT = 46.5200
ORIGIN_LON = 29.8720

# Padded a little beyond the outermost stations so the terrain does not end at
# the edge of the data.
BBOX = {"south": 46.4980, "west": 29.8500, "north": 46.5360, "east": 29.8920}

# 30 m SRTM over ~4 km: a 72x72 grid samples it at roughly its native detail
# without inventing resolution that is not in the source.
GRID = 72

OPENTOPO = "https://api.opentopodata.org/v1/srtm30m"
OVERPASS = "https://overpass-api.de/api/interpreter"

OVERPASS_QUERY = """
[out:json][timeout:60];
(
  way["building"]({south},{west},{north},{east});
  way["landuse"~"vineyard|forest|orchard|meadow|farmland"]({south},{west},{north},{east});
  way["natural"="water"]({south},{west},{north},{east});
  way["waterway"]({south},{west},{north},{east});
  way["highway"~"track|residential|unclassified|service"]({south},{west},{north},{east});
);
out geom;
"""

# Padded a little beyond the map bbox: the village node of Purcari itself sits
# 100 m north of the DEM edge, and a map of the estate that cannot say the word
# "Purcari" is failing at its one job.
PLACES_QUERY = """
[out:json][timeout:60];
(
  node["place"]({s},{w},{n},{e});
  nwr["craft"="winery"]({s},{w},{n},{e});
);
out tags center;
"""


def to_xy(lat: float, lon: float) -> tuple[float, float]:
    """Equirectangular projection to metres east/north of the estate origin."""
    x = (lon - ORIGIN_LON) * 111320.0 * math.cos(math.radians(ORIGIN_LAT))
    y = (lat - ORIGIN_LAT) * 110540.0
    return x, y


# Both endpoints reject requests without one — urllib's default gets a bare
# 406 from opentopodata, and Overpass asks callers to identify themselves.
USER_AGENT = "purcari-installation/1.0 (biodiversity art installation; +https://github.com/FriendsCoin/Purcari)"


def fetch_json(url: str, data: bytes | None = None, tries: int = 4):
    for attempt in range(tries):
        try:
            request = urllib.request.Request(
                url, data=data, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.loads(response.read().decode())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            if attempt == tries - 1:
                raise
            # Both APIs rate-limit; back off rather than hammer them.
            time.sleep(2 * (attempt + 1))
            print(f"  retry {attempt + 1} after {err}")
    raise RuntimeError("unreachable")


def fetch_dem() -> dict:
    """Elevation grid over the bounding box, in metres."""
    lats = [
        BBOX["south"] + (BBOX["north"] - BBOX["south"]) * i / (GRID - 1) for i in range(GRID)
    ]
    lons = [
        BBOX["west"] + (BBOX["east"] - BBOX["west"]) * i / (GRID - 1) for i in range(GRID)
    ]

    points = [(la, lo) for la in lats for lo in lons]
    heights: list[float] = []
    # The public endpoint accepts 100 locations per call and one call a second.
    batch = 100
    for start in range(0, len(points), batch):
        chunk = points[start : start + batch]
        locations = "|".join(f"{la:.6f},{lo:.6f}" for la, lo in chunk)
        payload = fetch_json(f"{OPENTOPO}?locations={locations}")
        for result in payload["results"]:
            elevation = result.get("elevation")
            heights.append(float(elevation) if elevation is not None else 0.0)
        print(f"  dem {len(heights)}/{len(points)}")
        time.sleep(1.05)

    lo_h, hi_h = min(heights), max(heights)
    print(f"  elevation range: {lo_h:.0f} m .. {hi_h:.0f} m")

    # Store as whole metres; SRTM's own vertical error is several metres.
    return {
        "grid": GRID,
        "bbox": BBOX,
        "min": round(lo_h),
        "max": round(hi_h),
        "heights": [round(h) for h in heights],
        "source": "SRTM 30 m via opentopodata.org",
    }


def simplify(points: list[list[float]], tolerance: float = 4.0) -> list[list[float]]:
    """Ramer-Douglas-Peucker, in metres. Keeps shapes honest but small."""
    if len(points) < 3:
        return points

    def rdp(pts):
        if len(pts) < 3:
            return pts
        ax, ay = pts[0]
        bx, by = pts[-1]
        dx, dy = bx - ax, by - ay
        span = math.hypot(dx, dy)
        worst, index = 0.0, 0
        for i in range(1, len(pts) - 1):
            px, py = pts[i]
            if span == 0:
                distance = math.hypot(px - ax, py - ay)
            else:
                distance = abs(dy * px - dx * py + bx * ay - by * ax) / span
            if distance > worst:
                worst, index = distance, i
        if worst <= tolerance:
            return [pts[0], pts[-1]]
        return rdp(pts[: index + 1])[:-1] + rdp(pts[index:])

    return rdp(points)


def fetch_osm() -> dict:
    query = OVERPASS_QUERY.format(**BBOX)
    payload = fetch_json(OVERPASS, data=query.encode())

    buildings: list[dict] = []
    parcels: list[dict] = []
    water: list[list[list[float]]] = []
    tracks: list[list[list[float]]] = []
    streams: list[list[list[float]]] = []

    for element in payload.get("elements", []):
        geometry = element.get("geometry")
        if not geometry:
            continue
        tags = element.get("tags", {})
        pts = [list(to_xy(node["lat"], node["lon"])) for node in geometry]
        pts = [[round(x), round(y)] for x, y in simplify(pts)]
        if len(pts) < 2:
            continue

        if "building" in tags:
            # Footprint area, so the scene can pick out the substantial buildings
            # (the château and the cellars) from the sheds.
            area = 0.0
            for i in range(len(pts)):
                x1, y1 = pts[i]
                x2, y2 = pts[(i + 1) % len(pts)]
                area += x1 * y2 - x2 * y1
            buildings.append({"p": pts, "a": round(abs(area) / 2)})
        elif "landuse" in tags:
            parcels.append({"p": pts, "k": tags["landuse"]})
        elif tags.get("natural") == "water":
            water.append(pts)
        elif "waterway" in tags:
            streams.append(pts)
        elif "highway" in tags:
            tracks.append(pts)

    buildings.sort(key=lambda b: -b["a"])
    print(
        f"  osm: {len(buildings)} buildings, {len(parcels)} parcels, "
        f"{len(tracks)} tracks, {len(streams)} watercourses, {len(water)} water bodies"
    )
    if buildings:
        print(f"  largest footprint: {buildings[0]['a']} m2")

    return {
        "buildings": buildings,
        "parcels": parcels,
        "water": water,
        "streams": streams,
        "tracks": tracks,
        "source": "OpenStreetMap contributors, ODbL",
    }


def fetch_places() -> list[dict]:
    """Named anchors: the villages, the localities, and the winery itself.

    These are what turn the sheet from "some terrain" into "that terrain": a
    visitor from the region recognises Purcari and Hamza by name faster than by
    any contour. The winery node is the one non-place kept — OSM pins it inside
    the château complex, and the scene uses it to say which of 533 footprints
    is the house everything else is named after.
    """
    pad = 0.006  # ~650 m beyond the sheet, enough to catch the village node
    box = {
        "s": BBOX["south"] - pad,
        "w": BBOX["west"] - pad,
        "n": BBOX["north"] + pad,
        "e": BBOX["east"] + pad,
    }
    payload = fetch_json(OVERPASS, data=PLACES_QUERY.format(**box).encode())

    places: list[dict] = []
    for element in payload.get("elements", []):
        tags = element.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        lat = element.get("lat") or element.get("center", {}).get("lat")
        lon = element.get("lon") or element.get("center", {}).get("lon")
        if lat is None or lon is None:
            continue
        kind = "winery" if tags.get("craft") == "winery" else tags.get("place", "locality")
        # Hamlets and farms would label every barnyard; keep the map quiet.
        if kind not in ("winery", "village", "town", "locality"):
            continue
        x, y = to_xy(lat, lon)
        places.append({"n": name, "x": round(x), "y": round(y), "k": kind})

    places.sort(key=lambda p: (p["k"] != "winery", p["n"]))
    print(f"  places: {[(p['n'], p['k']) for p in places]}")
    return places


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--dem-cache", help="reuse a previously fetched DEM")
    parser.add_argument(
        "--reuse-dem-from",
        help="lift the DEM out of an existing landscape bundle instead of re-fetching",
    )
    args = parser.parse_args()

    if args.reuse_dem_from and Path(args.reuse_dem_from).exists():
        print("reusing DEM from existing bundle")
        dem = json.loads(Path(args.reuse_dem_from).read_text())["dem"]
    elif args.dem_cache and Path(args.dem_cache).exists():
        print("reusing cached DEM")
        dem = json.loads(Path(args.dem_cache).read_text())
    else:
        print("fetching elevation...")
        dem = fetch_dem()
        if args.dem_cache:
            Path(args.dem_cache).write_text(json.dumps(dem))

    print("fetching OpenStreetMap geometry...")
    osm = fetch_osm()
    print("fetching named places...")
    osm["places"] = fetch_places()

    bundle = {
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
        "dem": dem,
        **osm,
        "attribution": [
            "Elevation: SRTM 30 m via opentopodata.org",
            "Map data © OpenStreetMap contributors (ODbL)",
        ],
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
