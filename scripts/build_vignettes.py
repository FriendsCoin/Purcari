#!/usr/bin/env python3
"""Turn generated stills into the point clouds the vignettes are drawn from.

Why point clouds and not the images. This piece is made entirely of additive
marks on black; a shaded illustration pasted into a corner would read as a
different work laid over this one. Sampling each still into a few hundred
points keeps the drawing, keeps the visual language, costs ~8 kB instead of
~70 kB, and lets the marks move — the vignette's motion is procedural, so the
image supplies the shape and the engine supplies the life. Exactly the contract
`build_glyph_clouds.mjs` uses for the two animal forms.

Sampling is importance-weighted by luminance: a mark lands where the picture is
bright, which on a near-black plate is where the drawing is. Uniform sampling
would spend nine tenths of its budget on empty black.

Deterministic — a fixed low-discrepancy sequence, no RNG — so rebuilding gives
byte-identical output and a vignette always draws the same way.

Usage:
    python3 scripts/build_vignettes.py --out src/installation/ui/vignettes.json \
        camera=path/cam.png sound=path/mic.png drip=path/drip.png
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

# Marks per vignette. Enough to read as a drawing, few enough to stay a sketch.
POINTS = 700
# The plate is resampled to this before sampling: finer than the mark size the
# vignette draws at, coarse enough that one bright pixel cannot dominate.
GRID = 192
# Below this luminance a pixel is plate, not drawing.
#
# Low on purpose. The generator draws the important secondary structure — the
# rings leaving a microphone, the ground glow under a deer — at a tenth of the
# brightness of the subject, and a 0.06 floor cropped the rings off the plate
# entirely and left a mic on a post with nothing to spread. The vignette's
# motion animates marks it is given, so anything the floor removes is motion
# that cannot happen.
FLOOR = 0.06

# Per-plate overrides. One floor cannot serve every plate: the camera-trap
# deer is a crisp subject over a broad dim ground glow and wants a high floor
# or it dissolves into its own halo, while the vine's roots are drawn faint on
# purpose and vanish at the same setting. Named rather than inferred, because
# the right floor is a judgement about the drawing.
FLOORS = {"camera": 0.06, "sound": 0.05, "drip": 0.025}


def sample(path: str, floor: float = FLOOR) -> tuple[list[int], float]:
    """`POINTS` marks over one plate, weighted by luminance.

    Returns a flat [x, y, brightness, ...] list. x and y are 0..255 across the
    plate; brightness is 0..255 of the source luminance, so the vignette can
    draw a faint mark faintly instead of flattening the picture to a stencil.
    """
    plate = Image.open(path).convert("L")
    # Crop to the drawing before sampling. The generator centres its subject in
    # a large field of black, so a plate used whole puts the diagram in the
    # middle fifth of the panel and wastes the rest — measured at roughly a
    # tenth of the box on the first bake. getbbox() after a threshold finds the
    # ink; the margin keeps the crop from shaving a faint outer ember.
    ink = plate.point(lambda v: 255 if v > floor * 255 else 0)
    box = ink.getbbox()
    aspect = 1.0
    if box:
        w, h = plate.size
        pad = round(max(box[2] - box[0], box[3] - box[1]) * 0.05)
        crop = (
            max(0, box[0] - pad),
            max(0, box[1] - pad),
            min(w, box[2] + pad),
            min(h, box[3] + pad),
        )
        plate = plate.crop(crop)
        # The crop is not squared: these subjects are genuinely wide-and-thin
        # (a deer over a ground glow) or tall-and-narrow (a mic on a post), and
        # squaring them puts most of the panel back into empty black. The shape
        # travels with the cloud instead, and the renderer letterboxes by it —
        # so the drawing fills its box without being stretched.
        aspect = (crop[2] - crop[0]) / max(1, crop[3] - crop[1])

    image = plate.resize((GRID, GRID), Image.LANCZOS)
    pixels = list(image.tobytes())

    # Cumulative luminance over the plate, so a point can be placed by walking
    # to a target weight — the 2D equivalent of the area-weighted triangle walk
    # the glyph clouds use.
    cumulative: list[float] = []
    total = 0.0
    for value in pixels:
        v = value / 255.0
        total += max(0.0, v - floor) ** 1.35
        cumulative.append(total)
    if total <= 0:
        raise SystemExit(f"{path}: plate is empty")

    out: list[int] = []
    # Two plastic-number streams: one walks the distribution, one jitters inside
    # the chosen cell so the marks do not sit on a visible lattice.
    frac = lambda x: x - int(x)  # noqa: E731
    for i in range(POINTS):
        target = ((i + 0.5) / POINTS) * total
        lo, hi = 0, len(cumulative) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if cumulative[mid] < target:
                lo = mid + 1
            else:
                hi = mid
        gx = lo % GRID
        gy = lo // GRID
        jx = frac(i * 0.7548776662466927)
        jy = frac(i * 0.5698402909980532)
        x = (gx + jx) / GRID
        y = (gy + jy) / GRID
        out.append(max(0, min(255, round(x * 255))))
        out.append(max(0, min(255, round(y * 255))))
        out.append(pixels[lo])
    return out, aspect


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("plates", nargs="+", help="name=path.png")
    args = parser.parse_args()

    items: dict[str, list[int]] = {}
    aspects: dict[str, float] = {}
    for spec in args.plates:
        name, _, path = spec.partition("=")
        if not path:
            raise SystemExit(f"expected name=path, got {spec!r}")
        items[name], ratio = sample(path, FLOORS.get(name, FLOOR))
        aspects[name] = round(ratio, 3)
        print(f"  {name}: {POINTS} marks from {path} (aspect {ratio:.2f})")

    bundle = {
        "points": POINTS,
        "plates": items,
        "aspects": aspects,
        "source": (
            "Point clouds sampled from stills generated with FLUX. Illustration, "
            "not a record: these are diagrams of how the survey works and what a "
            "practice does, drawn in the piece's own marks — not photographs of "
            "this estate or of any animal recorded on it."
        ),
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size / 1024:.1f} kB)")


if __name__ == "__main__":
    main()
