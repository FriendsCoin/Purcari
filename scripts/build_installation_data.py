#!/usr/bin/env python3
"""Build the runtime data bundle for the Purcari media-art installation.

Reads the raw Every1Counts sensor exports (camera-trap CSV + BirdNET acoustic CSV)
and emits a single compact JSON consumed by the WebGL installation.

Usage:
    python3 scripts/build_installation_data.py \
        --camera <camera.csv> --sound <sound.csv> --out public/data/installation.json
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

# Purcari estate reference point (Ștefan Vodă, Moldova)
ORIGIN_LAT = 46.5200
ORIGIN_LON = 29.8720

# The 12 hotspots, each a paired camera trap + acoustic recorder.
#
# `typology` is the Every1Counts cross-method classification (E1C analysis deck,
# slide 6): the estate resolves into a rich stable core, poorer edges, and sites
# whose value depends entirely on which taxa you look for. `cameraClass` and
# `soundClass` are the same land re-classified by mammals alone (slide 36) and by
# birds alone (slide 41) — the disagreement between the three is a finding in its
# own right, and the installation animates it directly.
SITE_META = {
    "H1": {
        "label": "Ridge core · east",
        "habitat": "hedgerow",
        "typology": "core", "cameraClass": "high", "soundClass": "intermediate",
        "note": "The only station that ran all 365 days. Anchor of both similarity clusters.",
    },
    "H4": {
        "label": "Open farmland · west",
        "habitat": "vineyard",
        "typology": "periphery", "cameraClass": "low", "soundClass": "low",
        "note": "Poorest station on both methods, and the most daylight-bound: 89.7% of its animals move by day.",
    },
    "H5": {
        "label": "Vineyard block · south",
        "habitat": "treeline",
        "typology": "transition", "cameraClass": "intermediate", "soundClass": "low",
        "note": "Consistently intermediate. Lost to equipment failure after 01.11.25.",
    },
    "H6": {
        "label": "Southern tip",
        "habitat": "valley",
        "typology": "periphery", "cameraClass": "low", "soundClass": "low",
        "note": "Low-diversity periphery. Its mammal community is 65% plant-eating — a grazing edge.",
    },
    "H7": {
        "label": "Forest edge · east",
        "habitat": "woodland_edge",
        "typology": "method_dependent", "cameraClass": "intermediate", "soundClass": "high",
        "note": "The starkest split on the estate: 2 species on camera, 123 in the air.",
    },
    "H9": {
        "label": "Central grassland",
        "habitat": "grassland",
        "typology": "core", "cameraClass": "high", "soundClass": "high",
        "note": "The richest and most stable acoustic station — the only site to hold its own statistical group.",
    },
    "H10": {
        "label": "Northern woodland",
        "habitat": "woodland",
        "typology": "method_dependent", "cameraClass": "low", "soundClass": "high",
        "note": "Loudest place on the estate — 7,859 bird detections — yet almost nothing walks past the camera.",
    },
    "H11": {
        "label": "Western forest block",
        "habitat": "ravine",
        "typology": "transition", "cameraClass": "high", "soundClass": "intermediate",
        "note": "Moved three times over the year. Strongest camera similarity pair on the estate.",
    },
    "H12": {
        "label": "Interior forest",
        "habitat": "woodland",
        "typology": "method_dependent", "cameraClass": "intermediate", "soundClass": "high",
        "note": "Carries the heaviest mammals — the wild boar station.",
    },
    "H13": {
        "label": "Northern woodland edge",
        "habitat": "woodland_edge",
        "typology": "core", "cameraClass": "high", "soundClass": "intermediate",
        "note": "Highest camera richness on the estate: 18 species, 1,106 encounters.",
    },
    "H14": {
        "label": "Southern margin",
        "habitat": "wetland",
        "typology": "method_dependent", "cameraClass": "high", "soundClass": "low",
        "note": "Installed last, in January. The most nocturnal station: 56.8% of its life happens after dark.",
    },
    "HC": {
        "label": "Château grounds",
        "habitat": "chateau",
        "typology": "method_dependent", "cameraClass": "low", "soundClass": "high",
        "note": "One month of camera before the hardware moved to H9. Lightest, most aerial bird community on the estate.",
    },
}

# Species the reports single out: conservation status, or narrative weight.
# status: iucn global category where notable, else regional significance.
FLAGSHIP = {
    "Lutra lutra": {"status": "NT", "note": "Eurasian otter — clean-water indicator"},
    "Felis silvestris": {"status": "LC*", "note": "European wildcat — forest continuity"},
    "Ciconia ciconia": {"status": "LC", "note": "White stork — open-meadow forager"},
    "Streptopelia turtur": {"status": "VU", "note": "Turtle dove — vulnerable, collapsing in Europe"},
    "Lanius collurio": {"status": "LC", "note": "Red-backed shrike — hedgerow specialist, Annex I"},
    "Caprimulgus europaeus": {"status": "LC", "note": "European nightjar — nocturnal, Annex I"},
    "Merops apiaster": {"status": "LC", "note": "Bee-eater — warm-slope colonial nester"},
    "Lullula arborea": {"status": "LC", "note": "Woodlark — mosaic-edge specialist, Annex I"},
    "Canis aureus": {"status": "LC", "note": "Golden jackal — expanding apex mesopredator"},
    "Meles meles": {"status": "LC", "note": "Eurasian badger — deep-set territories"},
    "Oriolus oriolus": {"status": "LC", "note": "Golden oriole — mature canopy"},
    "Luscinia luscinia": {"status": "LC", "note": "Thrush nightingale — dense scrub"},
    "Strix aluco": {"status": "LC", "note": "Tawny owl — night territory holder"},
    "Nycticorax nycticorax": {"status": "LC", "note": "Night heron — wetland"},
    "Ixobrychus minutus": {"status": "LC", "note": "Little bittern — reedbed, Annex I"},
    "Capreolus capreolus": {"status": "LC", "note": "Roe deer — browsing pressure"},
    "Sus scrofa": {"status": "LC", "note": "Wild boar — soil turnover"},
}

# Ecological guild drives colour, orbital shell and motion in the installation.
#
# Assigned by genus across every taxon the survey actually recorded. A generic
# "it's a bird, call it a songbird" fallback put diving ducks and nightjars in
# with the finches, which is both wrong on a wall label and visually flattening —
# it collapsed the whole choir to one colour. Anything genuinely unmatched falls
# back to `bird`, which is honest rather than confidently wrong.
GUILD_BY_GENUS = {
    # --- owls: night hunters, separated from day raptors on purpose
    "Strix": "owl", "Otus": "owl", "Athene": "owl", "Asio": "owl",
    "Bubo": "owl", "Tyto": "owl", "Aegolius": "owl", "Glaucidium": "owl",

    # --- waterfowl, rails, herons, storks
    "Anas": "waterbird", "Anser": "waterbird", "Cygnus": "waterbird",
    "Aythya": "waterbird", "Bucephala": "waterbird", "Mergus": "waterbird",
    "Melanitta": "waterbird", "Mareca": "waterbird", "Alopochen": "waterbird",
    "Tadorna": "waterbird", "Spatula": "waterbird", "Netta": "waterbird",
    "Clangula": "waterbird", "Somateria": "waterbird",
    "Fulica": "waterbird", "Gallinula": "waterbird", "Rallus": "waterbird",
    "Porzana": "waterbird", "Crex": "waterbird", "Grus": "waterbird",
    "Podiceps": "waterbird", "Tachybaptus": "waterbird", "Gavia": "waterbird",
    "Phalacrocorax": "waterbird", "Pelecanus": "waterbird",
    "Ardea": "waterbird", "Egretta": "waterbird", "Nycticorax": "waterbird",
    "Ixobrychus": "waterbird", "Botaurus": "waterbird", "Ardeola": "waterbird",
    "Ciconia": "waterbird", "Platalea": "waterbird", "Plegadis": "waterbird",

    # --- shorebirds and gulls
    "Charadrius": "wader", "Pluvialis": "wader", "Vanellus": "wader",
    "Tringa": "wader", "Actitis": "wader", "Calidris": "wader",
    "Arenaria": "wader", "Numenius": "wader", "Gallinago": "wader",
    "Scolopax": "wader", "Limosa": "wader", "Himantopus": "wader",
    "Recurvirostra": "wader", "Haematopus": "wader", "Burhinus": "wader",
    "Larus": "wader", "Chroicocephalus": "wader", "Hydroprogne": "wader",
    "Chlidonias": "wader", "Sterna": "wader", "Sternula": "wader",
    "Glareola": "wader", "Philomachus": "wader", "Lymnocryptes": "wader",

    # --- day raptors
    "Accipiter": "raptor", "Buteo": "raptor", "Falco": "raptor",
    "Circus": "raptor", "Milvus": "raptor", "Aquila": "raptor",
    "Hieraaetus": "raptor", "Haliaeetus": "raptor", "Pandion": "raptor",
    "Pernis": "raptor", "Circaetus": "raptor", "Clanga": "raptor",

    # --- woodpeckers
    "Dendrocopos": "woodpecker", "Dendrocoptes": "woodpecker",
    "Dryobates": "woodpecker", "Dryocopus": "woodpecker",
    "Picus": "woodpecker", "Jynx": "woodpecker",

    # --- gamebirds
    "Phasianus": "gamebird", "Perdix": "gamebird", "Coturnix": "gamebird",
    "Alectoris": "gamebird", "Lyrurus": "gamebird", "Tetrao": "gamebird",
    "Tetrastes": "gamebird",

    # --- corvids
    "Corvus": "corvid", "Coloeus": "corvid", "Pica": "corvid",
    "Garrulus": "corvid", "Nucifraga": "corvid", "Pyrrhocorax": "corvid",

    # --- doves
    "Columba": "dove", "Streptopelia": "dove",

    # --- aerial hunters: the guild in steepest decline across Europe
    "Merops": "aerial", "Apus": "aerial", "Tachymarptis": "aerial",
    "Caprimulgus": "aerial", "Hirundo": "aerial", "Delichon": "aerial",
    "Riparia": "aerial", "Ptyonoprogne": "aerial", "Coracias": "aerial",
    "Alcedo": "aerial", "Upupa": "aerial", "Cuculus": "aerial",
    "Clamator": "aerial",

    "Canis": "carnivore", "Vulpes": "carnivore", "Meles": "carnivore",
    "Martes": "carnivore", "Mustela": "carnivore", "Lutra": "carnivore",
    "Felis": "carnivore",
    "Lepus": "herbivore", "Capreolus": "herbivore", "Sus": "herbivore",
    "Equus": "herbivore", "Apodemus": "rodent", "Rattus": "rodent",
}

# Findings that live in the reports rather than in the raw detections. Kept here
# so the installation's wall text and the survey never drift apart, and so every
# claim on screen can be traced to a source.
NARRATIVE = {
    "thesis": (
        "Overall, biodiversity is driven by landscape heterogeneity: a stable rich core, "
        "consistently poorer edges, and sites whose value depends on the taxa considered. "
        "Maintaining habitat mosaics and structural complexity is key to long-term "
        "ecological resilience."
    ),
    "thesisSource": "Every1Counts, 12-month analysis of Château Purcari, July 2026",
    "dawnChorus": {
        "meanSpecies": 6.0,
        "mornings": 349,
        "verdict": "Rich chorus — the site is alive and little disturbed at dawn.",
        "text": (
            "At daybreak, birds sing all together: this is the dawn chorus. The richer it is "
            "in different species, the healthier the site. It is often the first indicator to "
            "drop when a habitat degrades — even before total richness changes."
        ),
    },
    "refuge": (
        "Purcari stands out as the most species-rich site, highlighting its exceptional "
        "ecological quality and the diversity of habitats it offers, making it a particularly "
        "valuable refuge for bird biodiversity within the landscape."
    ),
    # The tension the piece is built on: the estate is a refuge with no legal standing.
    "protection": {
        "protConn": 0.0,
        "protectedHectares": 0,
        "natura2000Zones": 0,
        "text": "Not one hectare of this refuge holds any protected status.",
        "policy": "Kunming-Montreal Global Biodiversity Framework, Target 3 (30x30)",
    },
    # Every1Counts network benchmark — camera-trap Shannon by land use.
    "benchmark": [
        {"landUse": "Vineyard", "shannon": 2.32, "richness": 32, "self": False},
        {"landUse": "Château Purcari", "shannon": 2.26, "richness": 26, "self": True},
        {"landUse": "Vineyard (2)", "shannon": 2.25, "richness": 25, "self": False},
        {"landUse": "Wooded park", "shannon": 2.02, "richness": 20, "self": False},
        {"landUse": "Peri-urban", "shannon": 1.36, "richness": 14, "self": False},
        {"landUse": "Arable agriculture", "shannon": 1.19, "richness": 11, "self": False},
        {"landUse": "Industrial land", "shannon": 1.00, "richness": 14, "self": False},
    ],
    "birdBenchmark": [
        {"landUse": "Château Purcari", "richness": 140, "self": True},
        {"landUse": "Vineyard", "richness": 120, "self": False},
        {"landUse": "Vineyard (2)", "richness": 108, "self": False},
        {"landUse": "Peri-urban", "richness": 91, "self": False},
        {"landUse": "Arable agriculture", "richness": 90, "self": False},
        {"landUse": "Wooded park", "richness": 87, "self": False},
    ],
    # Ecosystem Score V3: intrinsic biodiversity is thin, connectivity is excellent.
    "ecosystemScore": {
        "overall": 56.2,
        "intrinsic": 34.6,
        "landscape": 48.2,
        "connectivity": 78.4,
    },
    "landCover": [
        {"label": "Agricultural", "share": 0.631},
        {"label": "Natural", "share": 0.286},
        {"label": "Water", "share": 0.043},
        {"label": "Built", "share": 0.040},
    ],
    "estate": {
        "dripIrrigationHectares": 300,
        "irrigationInvestmentEuro": 3_000_000,
        "waterSavingLow": 0.15,
        "waterSavingHigh": 0.30,
        "organicConversionHectares": 25,
        "phytosanitaryReduction": 0.40,
        "founded": 1827,
    },
    # Landscape units from the estate's own terroir survey (Arpentin, RO-WINE 2026).
    "terroir": {
        "units": ["Podiș", "Coline", "Poale"],
        "unitsEn": ["Plateau", "Hillslopes", "Footslopes"],
        "soils": [
            "Cernoziom obișnuit", "Cernoziom carbonatic",
            "Cernoziom levigat, gleizat", "Cernoziom carbonatic, erodat, nisipos",
        ],
        "measurementsPerHectare": 16000,
        "line": "Descifrând terroir-ul Purcari — de la sol la expresia vinului",
    },
    # Day/night here is recomputed from civil twilight at 46.52N/29.87E for each
    # detection's own date. It reproduces the report's site *ranking* exactly
    # (H14 most nocturnal, H4/HC least) but runs lower in absolute terms — the
    # report layers a nominal 07:00-19:00 day window on top of twilight. Shown
    # numbers are therefore ours, not the report's; both are stated where it matters.
    "nightMethod": "civil twilight (sun < -6 deg) at the estate, per detection date",
    "credits": {
        "survey": "Every1Counts",
        "terroir": "Gh. Arpentin, Purcari Wineries Group",
        "acoustics": "BirdNET (Kahl et al. 2021)",
    },
}

# The camera export labels most species only in French (`Species` is "Others",
# `vernacular_name` is e.g. "Sanglier"), so without this the wall would read
# "Chat domestique" in an otherwise English piece. Acoustic rows already carry an
# English BirdNET common name and need no mapping.
CAMERA_NAMES = {
    "Phasianus colchicus": "Common Pheasant",
    "Lepus europaeus": "Brown Hare",
    "Canis aureus": "Golden Jackal",
    "Vulpes vulpes": "Red Fox",
    "Meles meles": "Eurasian Badger",
    "Sturnus vulgaris": "Common Starling",
    "Turdus merula": "Eurasian Blackbird",
    "Canis lupus": "Domestic Dog",
    "Corvus frugilegus": "Rook",
    "Sus scrofa": "Wild Boar",
    "Turdus philomelos": "Song Thrush",
    "Felis catus": "Domestic Cat",
    "Corvus cornix": "Hooded Crow",
    "Apodemus sylvaticus": "Wood Mouse",
    "Parus major": "Great Tit",
    "Capreolus capreolus": "Roe Deer",
    "Passer domesticus": "House Sparrow",
    "Corvus corone": "Carrion Crow",
    "Felis silvestris": "European Wildcat",
    "Coloeus monedula": "Western Jackdaw",
    "Fringilla coelebs": "Common Chaffinch",
    "Equus caballus": "Horse",
    "Martes foina": "Beech Marten",
    "Lanius collurio": "Red-backed Shrike",
    "Columba palumbus": "Common Wood Pigeon",
    "Mustela nivalis": "Least Weasel",
    "Lutra lutra": "Eurasian Otter",
    "Phoenicurus ochruros": "Black Redstart",
    "Rattus norvegicus": "Brown Rat",
    "Erithacus rubecula": "European Robin",
    "Ciconia ciconia": "White Stork",
    "Coccothraustes coccothraustes": "Hawfinch",
    "Scolopax rusticola": "Eurasian Woodcock",
    "Turdus iliacus": "Redwing",
    "Turdus pilaris": "Fieldfare",
}

# Domesticated or feral animals. They are genuine detections and stay in every
# count, but the outdoor piece is about wild animals returning to a quiet place —
# a horse walking back would undo the whole premise — so it filters on this flag.
DOMESTIC = {"Canis lupus", "Felis catus", "Equus caballus"}

NOCTURNAL_HINT = {
    "Strix aluco", "Caprimulgus europaeus", "Otus scops", "Athene noctua",
    "Tyto alba", "Asio otus", "Nycticorax nycticorax", "Meles meles",
    "Lutra lutra", "Martes foina", "Sus scrofa", "Vulpes vulpes",
    "Erinaceus roumanicus", "Apodemus sylvaticus", "Rattus norvegicus",
}


# True passerine genera recorded here, so unmatched acoustic taxa are not all
# labelled "songbird" on sight. Anything outside both lists becomes plain "bird".
PASSERINE_GENERA = {
    "Acanthis", "Acrocephalus", "Aegithalos", "Alauda", "Anthus", "Bombycilla",
    "Calandrella", "Calcarius", "Carduelis", "Carpodacus", "Certhia", "Cettia",
    "Chloris", "Coccothraustes", "Curruca", "Cyanistes", "Emberiza", "Eremophila",
    "Erithacus", "Ficedula", "Fringilla", "Galerida", "Hippolais", "Iduna",
    "Lanius", "Linaria", "Locustella", "Lophophanes", "Loxia", "Lullula",
    "Luscinia", "Melanocorypha", "Motacilla", "Muscicapa", "Oenanthe", "Oriolus",
    "Panurus", "Parus", "Passer", "Pastor", "Periparus", "Phoenicurus",
    "Phylloscopus", "Plectrophenax", "Poecile", "Prunella", "Pyrrhula",
    "Regulus", "Remiz", "Riparia", "Saxicola", "Serinus", "Sitta", "Spinus",
    "Sturnus", "Sylvia", "Troglodytes", "Turdus", "Tichodroma", "Petronia",
    "Montifringilla", "Bombycilla", "Chloris", "Cinclus",
}


def guild_for(scientific: str, modality: str) -> str:
    genus = scientific.split(" ")[0]
    if genus in GUILD_BY_GENUS:
        return GUILD_BY_GENUS[genus]
    if genus in PASSERINE_GENERA:
        return "songbird"
    return "bird" if modality == "sound" else "mammal"


def shannon(counts) -> float:
    total = sum(counts)
    if total <= 0:
        return 0.0
    return -sum((c / total) * math.log(c / total) for c in counts if c > 0)


def simpson(counts) -> float:
    """Gini-Simpson index (1 - D): probability two draws differ."""
    total = sum(counts)
    if total <= 1:
        return 0.0
    return 1.0 - sum(c * (c - 1) for c in counts) / (total * (total - 1))


def chao1(counts) -> float:
    """Chao1 richness estimator — how many species the sensors have NOT yet heard."""
    observed = sum(1 for c in counts if c > 0)
    singletons = sum(1 for c in counts if c == 1)
    doubletons = sum(1 for c in counts if c == 2)
    if doubletons == 0:
        return observed + singletons * (singletons - 1) / 2
    return observed + (singletons ** 2) / (2 * doubletons)


def solar_events(day_of_year: int, lat: float = ORIGIN_LAT, altitude_deg: float = -0.833):
    """Sunrise/sunset in *local clock* hours (NOAA low-precision model).

    `altitude_deg` is the sun's elevation at the event: -0.833 for the visible
    disc, -6 for civil twilight. The report classifies day/night by real civil
    twilight rather than a fixed clock window, so day/night here must match.
    """
    decl = 0.4093 * math.sin(2 * math.pi * (284 + day_of_year) / 365.0)
    phi = math.radians(lat)
    cos_h = (math.sin(math.radians(altitude_deg)) - math.sin(phi) * math.sin(decl)) / (
        math.cos(phi) * math.cos(decl)
    )
    cos_h = max(-1.0, min(1.0, cos_h))
    half_day = math.degrees(math.acos(cos_h)) / 15.0

    # Solar noon drifts from clock noon by longitude and by the summer time shift.
    # Purcari sits at 29.87°E — 1.99 h east of UTC — against EET (+2) / EEST (+3).
    tz = 3.0 if 80 <= day_of_year <= 303 else 2.0
    solar_noon = 12.0 + tz - ORIGIN_LON / 15.0
    return round(solar_noon - half_day, 2), round(solar_noon + half_day, 2)


def is_night(row_doy: int, row_hour: float) -> bool:
    """True when the sun is below civil twilight at that moment on the estate."""
    dawn, dusk = solar_events(int(row_doy), altitude_deg=-6.0)
    return row_hour < dawn or row_hour >= dusk


def to_local_xy(lat: float, lon: float):
    """Equirectangular projection to metres relative to the estate origin."""
    x = (lon - ORIGIN_LON) * 111320.0 * math.cos(math.radians(ORIGIN_LAT))
    y = (lat - ORIGIN_LAT) * 110540.0
    return round(x, 1), round(y, 1)


def load(path: str, modality: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["modality"] = modality
    df["startdate"] = pd.to_datetime(df["startdate"], errors="coerce")
    df = df.dropna(subset=["startdate", "scientific_name", "site"])
    df["hour"] = df["startdate"].dt.hour
    df["month"] = df["startdate"].dt.month
    df["doy"] = df["startdate"].dt.dayofyear
    df["date"] = df["startdate"].dt.strftime("%Y-%m-%d")
    df["count"] = pd.to_numeric(df["detection_count"], errors="coerce").fillna(1)
    # Precise hour-of-day, then day/night by civil twilight for that calendar date.
    exact = df["startdate"].dt.hour + df["startdate"].dt.minute / 60.0
    df["night"] = [is_night(d, h) for d, h in zip(df["doy"], exact)]
    return df


def common_name(sci: str, group: pd.DataFrame) -> str:
    """Best English label: curated camera name, then `Species`, then vernacular."""
    if sci in CAMERA_NAMES:
        return CAMERA_NAMES[sci]
    for col in ("Species", "vernacular_name"):
        if col not in group:
            continue
        vals = [v for v in group[col].dropna().unique() if v and v != "Others"]
        if vals:
            return str(vals[0])
    return ""


def alt_name(name: str, group: pd.DataFrame) -> str:
    """The vernacular label, only when it actually adds something to `name`."""
    if "vernacular_name" not in group or not group["vernacular_name"].notna().any():
        return ""
    alt = str(group["vernacular_name"].dropna().iloc[0])
    return "" if alt.strip().lower() == name.strip().lower() else alt


def build(camera_csv: str, sound_csv: str) -> dict:
    cam = load(camera_csv, "camera")
    snd = load(sound_csv, "sound")
    both = pd.concat([cam, snd], ignore_index=True)

    # ---------------------------------------------------------------- sites
    sites = []
    for site_id, meta in SITE_META.items():
        sub = both[both.site == site_id]
        if sub.empty:
            continue
        cam_sub = sub[sub.modality == "camera"]
        snd_sub = sub[sub.modality == "sound"]
        lat = float(sub.latitude.iloc[0])
        lon = float(sub.longitude.iloc[0])
        x, y = to_local_xy(lat, lon)

        abundance = sub.groupby("scientific_name")["count"].sum()
        counts = [int(v) for v in abundance.values]
        hourly = [0] * 24
        for h, v in sub.groupby("hour")["count"].sum().items():
            hourly[int(h)] = int(v)
        monthly = [0] * 12
        for m, v in sub.groupby("month")["count"].sum().items():
            monthly[int(m) - 1] = int(v)

        night = int(sub[sub.night]["count"].sum())
        total = int(sub["count"].sum())

        top = (
            abundance.sort_values(ascending=False)
            .head(6)
            .index.tolist()
        )

        sites.append({
            "id": site_id,
            "label": meta["label"],
            "habitat": meta["habitat"],
            "typology": meta["typology"],
            "cameraClass": meta["cameraClass"],
            "soundClass": meta["soundClass"],
            "note": meta["note"],
            "lat": lat,
            "lon": lon,
            "x": x,
            "y": y,
            "cameraDetections": int(cam_sub["count"].sum()),
            "cameraSpecies": int(cam_sub.scientific_name.nunique()),
            "soundDetections": int(snd_sub["count"].sum()),
            "soundSpecies": int(snd_sub.scientific_name.nunique()),
            "richness": int(sub.scientific_name.nunique()),
            "detections": total,
            "shannon": round(shannon(counts), 3),
            "simpson": round(simpson(counts), 3),
            "evenness": round(shannon(counts) / math.log(len(counts)), 3) if len(counts) > 1 else 0.0,
            "chao1": round(chao1(counts), 1),
            "nightRatio": round(night / total, 3) if total else 0.0,
            "activeDays": int(sub.date.nunique()),
            "topSpecies": top,
            "hourly": hourly,
            "monthly": monthly,
        })

    # -------------------------------------------------------------- species
    species = []
    for sci, group in both.groupby("scientific_name"):
        total = int(group["count"].sum())
        modality = "both" if group.modality.nunique() > 1 else group.modality.iloc[0]
        hourly = [0] * 24
        for h, v in group.groupby("hour")["count"].sum().items():
            hourly[int(h)] = int(v)
        monthly = [0] * 12
        for m, v in group.groupby("month")["count"].sum().items():
            monthly[int(m) - 1] = int(v)
        by_site = {str(s): int(v) for s, v in group.groupby("site")["count"].sum().items()}

        night = int(group[group.night]["count"].sum())
        primary = group.modality.value_counts().idxmax()
        flag = FLAGSHIP.get(sci)

        name = common_name(sci, group) or sci

        conf = None
        if "Birdnet_confidence_index" in group:
            vals = pd.to_numeric(group["Birdnet_confidence_index"], errors="coerce").dropna()
            if len(vals):
                conf = round(float(vals.mean()), 3)

        species.append({
            "sci": sci,
            "name": name,
            "alt": alt_name(name, group),
            "domestic": sci in DOMESTIC,
            "modality": modality,
            "guild": guild_for(sci, primary),
            "total": total,
            "sites": by_site,
            "siteCount": len(by_site),
            "hourly": hourly,
            "monthly": monthly,
            "nightRatio": round(night / total, 3) if total else 0.0,
            "nocturnal": sci in NOCTURNAL_HINT or (total >= 20 and night / max(total, 1) > 0.55),
            "peakHour": int(max(range(24), key=lambda h: hourly[h])),
            "peakMonth": int(max(range(12), key=lambda m: monthly[m])) + 1,
            "confidence": conf,
            "flagship": bool(flag),
            "status": flag["status"] if flag else None,
            "note": flag["note"] if flag else None,
        })

    species.sort(key=lambda s: -s["total"])
    for rank, sp in enumerate(species):
        sp["rank"] = rank

    # ------------------------------------------------------------- temporal
    # 24h × 12 months activity surface, split by modality — the "chronogram".
    surface = {}
    for modality, frame in (("camera", cam), ("sound", snd)):
        grid = [[0] * 24 for _ in range(12)]
        for (m, h), v in frame.groupby(["month", "hour"])["count"].sum().items():
            grid[int(m) - 1][int(h)] = int(v)
        surface[modality] = grid

    # Weekly phenology across the full survey year.
    weekly = []
    for week, group in both.groupby("week_start"):
        if pd.isna(week):
            continue
        weekly.append({
            "week": str(week),
            "camera": int(group[group.modality == "camera"]["count"].sum()),
            "sound": int(group[group.modality == "sound"]["count"].sum()),
            "richness": int(group.scientific_name.nunique()),
        })
    weekly.sort(key=lambda w: w["week"])

    sun = [
        {"month": m, "sunrise": solar_events(int(15 + 30.4 * (m - 1)))[0],
         "sunset": solar_events(int(15 + 30.4 * (m - 1)))[1]}
        for m in range(1, 13)
    ]

    # --------------------------------------------------------------- network
    # Species→site bipartite edges, and site↔site similarity (Jaccard) for the
    # constellation's connecting filaments.
    site_species = {
        s["id"]: set(both[both.site == s["id"]].scientific_name.unique()) for s in sites
    }
    links = []
    ids = [s["id"] for s in sites]
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            inter = len(site_species[a] & site_species[b])
            union = len(site_species[a] | site_species[b])
            if union and inter:
                links.append({
                    "a": a, "b": b,
                    "jaccard": round(inter / union, 3),
                    "shared": inter,
                })
    links.sort(key=lambda link: -link["jaccard"])

    # ----------------------------------------------------------- guild totals
    guilds = defaultdict(lambda: {"total": 0, "species": 0})
    for sp in species:
        guilds[sp["guild"]]["total"] += sp["total"]
        guilds[sp["guild"]]["species"] += 1

    # ------------------------------------------------------------ highlights
    flagships = [s for s in species if s["flagship"]]
    flagships.sort(key=lambda s: (s["status"] not in ("NT", "VU"), -s["total"]))

    all_counts = [s["total"] for s in species]
    start = both.startdate.min()
    end = both.startdate.max()

    return {
        "meta": {
            "site": "Château Purcari",
            "region": "Ștefan Vodă, Moldova",
            "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
            "surveyStart": start.strftime("%Y-%m-%d"),
            "surveyEnd": end.strftime("%Y-%m-%d"),
            "surveyDays": int((end - start).days),
            "stations": len(sites),
            "cameraTraps": int(cam.Sensor.nunique()),
            "acousticRecorders": int(snd.Sensor.nunique()),
            "totalDetections": int(both["count"].sum()),
            "cameraDetections": int(cam["count"].sum()),
            "soundDetections": int(snd["count"].sum()),
            "totalSpecies": int(both.scientific_name.nunique()),
            "cameraSpecies": int(cam.scientific_name.nunique()),
            "soundSpecies": int(snd.scientific_name.nunique()),
            "shannon": round(shannon(all_counts), 3),
            "simpson": round(simpson(all_counts), 3),
            "chao1": round(chao1(all_counts), 1),
            "nightRatio": round(
                float(both[both.night]["count"].sum()) / float(both["count"].sum()), 3),
            "cameraNightRatio": round(
                float(cam[cam.night]["count"].sum()) / float(cam["count"].sum()), 3),
        },
        "narrative": NARRATIVE,
        "sites": sites,
        "species": species,
        "surface": surface,
        "weekly": weekly,
        "sun": sun,
        "links": links,
        "guilds": {k: v for k, v in sorted(guilds.items(), key=lambda kv: -kv[1]["total"])},
        "flagships": [s["sci"] for s in flagships],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", required=True)
    parser.add_argument("--sound", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    bundle = build(args.camera, args.sound)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")))

    meta = bundle["meta"]
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} kB)")
    print(f"  {meta['stations']} stations · {meta['totalSpecies']} species · "
          f"{meta['totalDetections']} detections · {meta['surveyDays']} days")
    print(f"  Shannon {meta['shannon']} · Simpson {meta['simpson']} · "
          f"Chao1 {meta['chao1']} · night {meta['nightRatio']:.0%}")


if __name__ == "__main__":
    main()
