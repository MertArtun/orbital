#!/usr/bin/env python3
"""Generate self-contained procedural globe textures for the ORBITAL starter.

The assets are intentionally synthetic so the starter has no ambiguous third-party
image license. Pillow, Matplotlib and Basemap are used only to regenerate assets.
"""
from __future__ import annotations

from pathlib import Path
import math
import random

from PIL import Image, ImageDraw, ImageFilter
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.basemap import Basemap

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "textures"
OUT.mkdir(parents=True, exist_ok=True)
RNG = random.Random(25544)

WORLD_CITIES = [
    (41.0053, 28.9770), (39.9208, 32.8541), (38.4189, 27.1287),
    (51.5074, -0.1278), (48.8566, 2.3522), (52.5200, 13.4050),
    (40.7128, -74.0060), (34.0522, -118.2437), (19.4326, -99.1332),
    (-23.5505, -46.6333), (-34.6037, -58.3816), (30.0444, 31.2357),
    (-33.9249, 18.4241), (6.5244, 3.3792), (-1.2921, 36.8219),
    (25.2048, 55.2708), (28.6139, 77.2090), (19.0760, 72.8777),
    (1.3521, 103.8198), (13.7563, 100.5018), (39.9042, 116.4074),
    (31.2304, 121.4737), (35.6762, 139.6503), (37.5665, 126.9780),
    (-6.2088, 106.8456), (-33.8688, 151.2093), (-37.8136, 144.9631),
]


def save_earth_night() -> None:
    width, height, dpi = 2048, 1024, 128
    fig = plt.figure(figsize=(width / dpi, height / dpi), dpi=dpi, facecolor="#020512")
    ax = fig.add_axes([0, 0, 1, 1])
    m = Basemap(
        projection="cyl",
        llcrnrlon=-180,
        urcrnrlon=180,
        llcrnrlat=-90,
        urcrnrlat=90,
        resolution="l",
        ax=ax,
    )
    m.drawmapboundary(fill_color="#020512", linewidth=0)
    m.fillcontinents(color="#071422", lake_color="#020512", zorder=1)
    m.drawcoastlines(color="#183149", linewidth=0.34, zorder=2)
    m.drawcountries(color="#0f263b", linewidth=0.18, zorder=2)

    # Deterministic low-density lights across land, weighted toward inhabited latitudes.
    random_lons: list[float] = []
    random_lats: list[float] = []
    attempts = 0
    while len(random_lons) < 2400 and attempts < 24000:
        attempts += 1
        lat = RNG.triangular(-58, 68, 24)
        lon = RNG.uniform(-180, 180)
        try:
            if m.is_land(lon, lat):
                random_lons.append(lon)
                random_lats.append(lat)
        except Exception:
            break

    if random_lons:
        ax.scatter(random_lons, random_lats, s=0.12, c="#f8d58b", alpha=0.24, linewidths=0, zorder=3)

    # City clusters create recognizable light concentrations without claiming population accuracy.
    cluster_lons: list[float] = []
    cluster_lats: list[float] = []
    for lat, lon in WORLD_CITIES:
        for _ in range(42):
            cluster_lats.append(max(-85, min(85, RNG.gauss(lat, 0.62))))
            cluster_lons.append(((RNG.gauss(lon, 0.82) + 180) % 360) - 180)
    ax.scatter(cluster_lons, cluster_lats, s=0.52, c="#ffd88a", alpha=0.34, linewidths=0, zorder=4)
    ax.scatter([lon for lat, lon in WORLD_CITIES], [lat for lat, lon in WORLD_CITIES], s=2.2, c="#fff3c4", alpha=0.84, linewidths=0, zorder=5)

    # Faint latitude bands give the globe a technical texture while remaining subtle.
    for latitude in (-60, -30, 0, 30, 60):
        ax.plot([-180, 180], [latitude, latitude], color="#0b2137", linewidth=0.18, alpha=0.35, zorder=2)

    ax.set_axis_off()
    fig.savefig(OUT / "earth-night.jpg", dpi=dpi, facecolor=fig.get_facecolor(), bbox_inches=None, pad_inches=0, pil_kwargs={"quality": 92})
    plt.close(fig)


def save_topology() -> None:
    width, height, dpi = 2048, 1024, 128
    fig = plt.figure(figsize=(width / dpi, height / dpi), dpi=dpi, facecolor="black")
    ax = fig.add_axes([0, 0, 1, 1])
    m = Basemap(projection="cyl", llcrnrlon=-180, urcrnrlon=180, llcrnrlat=-90, urcrnrlat=90, resolution="l", ax=ax)
    m.drawmapboundary(fill_color="black", linewidth=0)
    m.fillcontinents(color="#7c7c7c", lake_color="black", zorder=1)
    m.drawcoastlines(color="#a8a8a8", linewidth=0.28, zorder=2)
    ax.set_axis_off()
    fig.savefig(OUT / "earth-topology.png", dpi=dpi, facecolor="black", bbox_inches=None, pad_inches=0)
    plt.close(fig)


def save_star_field() -> None:
    width, height = 2048, 1024
    base = Image.new("RGB", (width, height), (2, 3, 17))
    pixels = base.load()

    # Smooth navy/violet/cyan nebula fields.
    fields = [
        (0.20 * width, 0.24 * height, 560, (18, 28, 73), 0.52),
        (0.78 * width, 0.38 * height, 640, (34, 15, 63), 0.43),
        (0.55 * width, 0.88 * height, 480, (4, 42, 61), 0.32),
    ]
    for y in range(height):
        for x in range(width):
            r, g, b = 2.0, 3.0, 17.0
            for cx, cy, radius, color, strength in fields:
                distance2 = (x - cx) ** 2 + (y - cy) ** 2
                factor = math.exp(-distance2 / (2 * radius * radius)) * strength
                r += color[0] * factor
                g += color[1] * factor
                b += color[2] * factor
            pixels[x, y] = (min(255, int(r)), min(255, int(g)), min(255, int(b)))

    sharp = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    sharp_draw = ImageDraw.Draw(sharp)
    glow_draw = ImageDraw.Draw(glow)

    for _ in range(3400):
        x = RNG.randrange(width)
        y = RNG.randrange(height)
        chance = RNG.random()
        radius = 0 if chance < 0.86 else 1 if chance < 0.985 else 2
        alpha = RNG.randint(55, 190) if radius == 0 else RNG.randint(130, 245)
        tint = RNG.choice([(215, 232, 255), (255, 247, 224), (194, 226, 255), (225, 213, 255)])
        sharp_draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*tint, alpha))
        if radius >= 1:
            glow_draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(*tint, 35))

    glow = glow.filter(ImageFilter.GaussianBlur(4.5))
    base = Image.alpha_composite(base.convert("RGBA"), glow)
    base = Image.alpha_composite(base, sharp).convert("RGB")
    base.save(OUT / "night-sky.png", optimize=True)


def main() -> None:
    save_earth_night()
    save_topology()
    save_star_field()
    print(f"Generated ORBITAL textures in {OUT}")


if __name__ == "__main__":
    main()
