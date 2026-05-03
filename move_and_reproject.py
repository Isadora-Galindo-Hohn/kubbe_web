import os
import glob
import json
import shutil

import numpy as np
import rasterio
import mercantile

from PIL import Image
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.transform import from_bounds
from rasterio.warp import (
    reproject,
    transform_bounds,
    Resampling
)


# ----------------------------------------------------
# KONFIGURATION
# ----------------------------------------------------
input_dir = r'C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\base_hiprad\postprocessed\run0'
output_dir = r'C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_tiles\base_cases\hiprad'

case_id = "hiprad"
case_name = "HIPRAD"

src_crs_fallback = "EPSG:3006"
dst_crs = "EPSG:3857"

nodata_value = -9999.0

zoom_min = 14
zoom_max = 14

tile_size = 256

# True = sparar bara tiles där översvämning finns
# False = sparar även tomma transparenta tiles
skip_empty_tiles = False

# Detta ska matcha hur webben når filerna
web_case_path = "floodmaps_mercator_tiles/base_cases/hiprad"

os.makedirs(output_dir, exist_ok=True)


# ----------------------------------------------------
# FÄRGSÄTTNING
# ----------------------------------------------------
def classify_to_rgba(data, nodata=nodata_value):
    height, width = data.shape
    rgba = np.zeros((height, width, 4), dtype=np.uint8)

    data = data.astype(np.float32)

    # Allt som inte är verkligt översvämningsdjup blir transparent
    invalid = (
        ~np.isfinite(data) |
        (data == nodata) |
        (data < 0.05) |
        (data > 50)
    )

    valid = ~invalid

    def apply_color(mask, color):
        rgba[mask, 0] = color[0]
        rgba[mask, 1] = color[1]
        rgba[mask, 2] = color[2]
        rgba[mask, 3] = color[3]

    apply_color(valid & (data >= 0.05) & (data < 0.5), [173, 216, 230, 255])
    apply_color(valid & (data >= 0.5) & (data < 1.0), [0, 0, 255, 255])
    apply_color(valid & (data >= 1.0) & (data < 1.5), [0, 0, 139, 255])
    apply_color(valid & (data >= 1.5) & (data < 2.0), [128, 0, 128, 255])
    apply_color(valid & (data >= 2.0) & (data < 4.0), [255, 165, 0, 255])
    apply_color(valid & (data >= 4.0) & (data <= 50), [255, 0, 0, 255])

    return rgba

# ----------------------------------------------------
# HJÄLPFUNKTIONER
# ----------------------------------------------------
def parse_time_name(file_name):
    clean_name = file_name.replace("res-", "").replace(".tif", "").split("_")
    if len(clean_name) < 2:
        return None
    return f"{clean_name[0]}_{clean_name[1]}"


def intersects(a, b):
    return not (
        a["right"] <= b["left"] or
        a["left"] >= b["right"] or
        a["top"] <= b["bottom"] or
        a["bottom"] >= b["top"]
    )


def get_tile_range(bounds_4326, zoom):
    west = bounds_4326["west"]
    south = bounds_4326["south"]
    east = bounds_4326["east"]
    north = bounds_4326["north"]

    tiles = list(mercantile.tiles(west, south, east, north, [zoom]))

    return tiles


def save_png_tile(rgba, output_path):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    img = Image.fromarray(rgba, mode="RGBA")
    img.save(output_path, optimize=True)


def make_tiles_for_file(file_path, time_name):
    tiles_output_path = os.path.join(output_dir, time_name)

    if os.path.exists(tiles_output_path):
        shutil.rmtree(tiles_output_path)

    with rasterio.open(file_path) as src:
        source_crs = rasterio.crs.CRS.from_epsg(3006)

        if src.crs is None:
            print(f"Obs: {os.path.basename(file_path)} saknar CRS, antar {src_crs_fallback}")

        actual_nodata = src.nodata if src.nodata is not None else nodata_value

        with WarpedVRT(
            src,
            src_crs=source_crs,
            crs=dst_crs,
            nodata=nodata_value,
            src_nodata=actual_nodata,
            dst_nodata=nodata_value,
            resampling=Resampling.nearest
        ) as vrt:

            bounds_4326_tuple = transform_bounds(
                dst_crs,
                "EPSG:4326",
                vrt.bounds.left,
                vrt.bounds.bottom,
                vrt.bounds.right,
                vrt.bounds.top,
                densify_pts=21
            )

            west, south, east, north = bounds_4326_tuple

            bounds_4326 = {
                "west": west,
                "south": south,
                "east": east,
                "north": north
            }

            total_tiles = 0
            written_tiles = 0

            for z in range(zoom_min, zoom_max + 1):
                tiles = list(mercantile.tiles(west, south, east, north, [z]))

                for tile in tiles:
                    total_tiles += 1

                    tb = mercantile.xy_bounds(tile)

                    window = vrt.window(
                        tb.left,
                        tb.bottom,
                        tb.right,
                        tb.top
                    )

                    data = vrt.read(
                        1,
                        window=window,
                        out_shape=(tile_size, tile_size),
                        fill_value=nodata_value,
                        resampling=Resampling.nearest
                    ).astype(np.float32)

                    data[~np.isfinite(data)] = nodata_value
                    data[data == actual_nodata] = nodata_value
                    data[data < 0.05] = nodata_value
                    data[data > 50] = nodata_value

                    rgba = classify_to_rgba(data, nodata=nodata_value)

                    if skip_empty_tiles and np.all(rgba[:, :, 3] == 0):
                        continue

                    tile_path = os.path.join(
                        tiles_output_path,
                        str(z),
                        str(tile.x),
                        f"{tile.y}.png"
                    )

                    save_png_tile(rgba, tile_path)
                    written_tiles += 1

            print(f"Klar: {time_name} | tiles skapade: {written_tiles}/{total_tiles}")

            return bounds_4326, written_tiles
# ----------------------------------------------------
# HUVUDLOOP
# ----------------------------------------------------
files = sorted(glob.glob(os.path.join(input_dir, "res-*.tif")))

print(f"Hittade {len(files)} filer. Startar tile-export med rasterio + mercantile...")

all_bounds_4326 = []
generated_time_steps = []

for file_path in files:
    file_name = os.path.basename(file_path)
    time_name = parse_time_name(file_name)

    if time_name is None:
        print(f"Hoppar över fil med oväntat namn: {file_name}")
        continue

    try:
        bounds_4326, written_tiles = make_tiles_for_file(file_path, time_name)

        all_bounds_4326.append(bounds_4326)

        generated_time_steps.append(time_name)

        if written_tiles == 0:
            print(f"Inga synliga tiles skapades för {time_name} men tidssteget sparas i manifest.")

    except Exception as e:
        print(f"Fel för {time_name}: {e}")


# ----------------------------------------------------
# MANIFEST
# ----------------------------------------------------
generated_time_steps = sorted(generated_time_steps)

manifest_path = os.path.join(output_dir, "manifest.json")

with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(generated_time_steps, f, indent=2)

print(f"\nSkapade manifest.json med {len(generated_time_steps)} tidssteg.")


# ----------------------------------------------------
# METADATA
# ----------------------------------------------------
if all_bounds_4326:
    metadata = {
        "caseId": case_id,
        "name": case_name,
        "crs": "EPSG:3857",
        "displayBoundsCrs": "EPSG:4326",
        "bounds": {
            "west": min(b["west"] for b in all_bounds_4326),
            "south": min(b["south"] for b in all_bounds_4326),
            "east": max(b["east"] for b in all_bounds_4326),
            "north": max(b["north"] for b in all_bounds_4326)
        },
        "classes": [
            {"label": "0.05–0.5 m", "color": "#ADD8E6"},
            {"label": "0.5–1.0 m", "color": "#0000FF"},
            {"label": "1.0–1.5 m", "color": "#00008B"},
            {"label": "1.5–2.0 m", "color": "#800080"},
            {"label": "2.0–4.0 m", "color": "#FFA500"},
            {"label": "4+ m", "color": "#FF0000"}
        ],
        "opacityDefault": 0.8,
        "timeStepHours": 1,
        "fileType": "tiles",
        "tileUrlTemplate": "{time}/{z}/{x}/{y}.png",
        "zoomMin": zoom_min,
        "zoomMax": zoom_max,
        "tileScheme": "xyz",
        "skipEmptyTiles": skip_empty_tiles
    }

    metadata_path = os.path.join(output_dir, "metadata.json")

    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print("Skapade metadata.json.")
else:
    print("Kunde inte skapa metadata.json eftersom inga bounds hittades.")


# ----------------------------------------------------
# CASES.JSON
# ----------------------------------------------------
cases_path = os.path.join(os.path.dirname(output_dir), "cases.json")

case_entry = [
    {
        "id": case_id,
        "name": case_name,
        "path": web_case_path,
        "enabled": True,
        "opacity": 0.8
    }
]

with open(cases_path, "w", encoding="utf-8") as f:
    json.dump(case_entry, f, indent=2)

print("Skapade cases.json.")
print("\nAllt klart!")