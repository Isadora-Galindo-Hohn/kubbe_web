import os
import glob
import json
import shutil
import argparse
import traceback
from concurrent.futures import ProcessPoolExecutor, as_completed
from enum import StrEnum


import numpy as np
import rasterio
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds


# ----------------------------------------------------
# KONFIGURATION
# ----------------------------------------------------
case_id = "hiprad"
case_name = "HIPRAD"

src_crs_fallback = "EPSG:3006"
dst_crs = "EPSG:3857"
nodata_value = -9999.0

# SVG bör helst köras 1:1 först. Höj bara om du verkligen vill testa.
upscale_factor = 1

max_workers = 8

web_case_path = "floodmaps_mercator_svg/base_cases/hiprad"

cases_path = r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\cases.json"

class CASE_CATEGORIES(StrEnum):
    BASE = "base"
    SENSITIVITY = "sensitivity"
    COMBINED = "combined"

# ----------------------------------------------------
# DATAKÄLLOR / CASES
# ----------------------------------------------------
DATA_SOURCES = [
    #base cases
    {
        "case_id": "base_hiprad",
        "case_name": "HIPRAD",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\base_hiprad\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\base_cases\base_hiprad",
        "web_case_path": "floodmaps_mercator_svg/base_cases/base_hiprad",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.BASE,
    },
    {
        "case_id": "base_cheddarobs",
        "case_name": "Cheddar Obs",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\cheddarobs\base_cheddarobs\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\base_cases\base_cheddarobs",
        "web_case_path": "floodmaps_mercator_svg/base_cases/base_cheddarobs",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.BASE,
    },
    {
        "case_id": "base_baltrad",
        "case_name": "BALTRAD",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\500m\base\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\base_cases\BALTRAD",
        "web_case_path": "floodmaps_mercator_svg/base_cases/BALTRAD",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.BASE,
    },
    {
        "case_id": "base_obsradar",
        "case_name": "Observational Radar",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\obsradar\base\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\base_cases\OBSRADAR",
        "web_case_path": "floodmaps_mercator_svg/base_cases/OBSRADAR",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.BASE,
    },
    {
        "case_id": "base_PTHVB",
        "case_name": "PTHVB",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\PTHVB\base_PTHVB\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\base_cases\PTHVB",
        "web_case_path": "floodmaps_mercator_svg/base_cases/PTHVB",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.BASE,
    },
    #sensitivity ansalysis cases
    {
        "case_id": "sens_initial_moisture_0,5",
        "case_name": "Initial Soil Moisture 50%",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\initial_moisture_0,5\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\initial_moisture_0,5",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/initial_moisture_0,5",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_initial_moisture_1,0",
        "case_name": "Initial Soil Moisture 100%",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\initial_moisture_wet\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\initial_moisture_1,0",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/initial_moisture_1,0",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_manning_1,1",
        "case_name": "Manning's n +10%",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\maning_x.1.1\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\manning_1,1",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/manning_1,1",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_manning_0,9",
        "case_name": "Manning's n -10%",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\manning_x0.9\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\manning_0,9",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/manning_0,9",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_res2m",
        "case_name": "Resolution 2m",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\res_2m\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\res_2m",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/res_2m",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_res10m",
        "case_name": "Resolution 10m",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\res_10m\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\res_10m",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/res_10m",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_start_2025_09_04",
        "case_name": "Start 2025-09-04",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\start_2025_09_04\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\start_2025_09_04",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/start_2025_09_04",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_start_2025_09_06",
        "case_name": "Start 2025-09-06",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\start_2025_09_06\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\start_2025_09_06",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/start_2025_09_06",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_wet_inf_50%",
        "case_name": "Green and Ampt timestep 30 min",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\wet_inf_50%\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\wet_inf_50%",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/wet_inf_50%",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_wet_inf_200%",
        "case_name": "Green and Ampt timestep 2 hours",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\wet_inf_200%\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\wet_inf_200%",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/wet_inf_200%",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_ws_+1",
        "case_name": "Water Surface Correction +1m",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\ws_+1\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\ws_+1",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/ws_+1",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    {
        "case_id": "sens_ws_-1",
        "case_name": "Water Surface Correction -1m",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\sensativity analysis\ws_-1\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\sensitivity_analysis\ws_-1",
        "web_case_path": "floodmaps_mercator_svg/sensitivity_analysis/ws_-1",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.SENSITIVITY,
    },
    # Combined event cases
    {
        "case_id": "combined_free",
        "case_name": "FREE",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial_fluvial\Final\FREE\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\combined_cases\free",
        "web_case_path": "floodmaps_mercator_svg/combined_cases/free",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.COMBINED,
    },
    {
        "case_id": "combined_hfix_110",
        "case_name": "HFIX 110m",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial_fluvial\Final\HFIX_110\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\combined_cases\hfix_110",
        "web_case_path": "floodmaps_mercator_svg/combined_cases/hfix_110",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.COMBINED,
    },
    {
        "case_id": "combined_hfix_111",
        "case_name": "HFIX 111m",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial_fluvial\Final\HFIX_111\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\combined_cases\hfix_111",
        "web_case_path": "floodmaps_mercator_svg/combined_cases/hfix_111",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.COMBINED,
    },
    {
        "case_id": "combined_hfix_112",
        "case_name": "HFIX 112m",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial_fluvial\Final\HFIX_112\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\combined_cases\hfix_112",
        "web_case_path": "floodmaps_mercator_svg/combined_cases/hfix_112",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.COMBINED,
    },
    {
        "case_id": "combined_hfix_113",
        "case_name": "HFIX 113m",
        "input_dir": r"C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial_fluvial\Final\HFIX_113\postprocessed\run0",
        "output_dir": r"C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator_svg\combined_cases\hfix_113",
        "web_case_path": "floodmaps_mercator_svg/combined_cases/hfix_113",
        "enabled": True,
        "opacity": 0.8,
        "category": CASE_CATEGORIES.COMBINED,
    },
]


# ----------------------------------------------------
# KLASSNING
# ----------------------------------------------------
class COLORS(StrEnum):
    LIGHT_BLUE = "#ADD8E6"  # 0.05–0.5 m
    BLUE = "#0000FF"        # 0.5–1.0 m
    DARK_BLUE = "#00008B"   # 1.0–1.5 m
    MAGENTA = "#800080"     # 1.5–2.0 m
    ORANGE = "#FFA500"      # 2.0–4.0 m
    RED = "#FF0000"         # 4+ m

# 0 = transparent / no data
# 1-6 = dina översvämningsklasser
CLASS_COLORS = {
    1: COLORS.LIGHT_BLUE,
    2: COLORS.BLUE,
    3: COLORS.DARK_BLUE,
    4: COLORS.MAGENTA,
    5: COLORS.ORANGE,
    6: COLORS.RED,
}


CLASS_DEFINITIONS = [
    {"class": 1, "label": "0.05–0.5 m", "color": COLORS.LIGHT_BLUE},
    {"class": 2, "label": "0.5–1.0 m", "color": COLORS.BLUE},
    {"class": 3, "label": "1.0–1.5 m", "color": COLORS.DARK_BLUE},
    {"class": 4, "label": "1.5–2.0 m", "color": COLORS.MAGENTA},
    {"class": 5, "label": "2.0–4.0 m", "color": COLORS.ORANGE},
    {"class": 6, "label": "4+ m", "color": COLORS.RED},
]


def classify_to_classes(data, nodata=nodata_value):
    classes = np.zeros(data.shape, dtype=np.uint8)

    data = data.astype(np.float32)

    valid = (
        np.isfinite(data) &
        (data != nodata) &
        (data >= 0.05) &
        (data <= 50)
    )

    classes[valid & (data >= 0.05) & (data < 0.5)] = 1
    classes[valid & (data >= 0.5) & (data < 1.0)] = 2
    classes[valid & (data >= 1.0) & (data < 1.5)] = 3
    classes[valid & (data >= 1.5) & (data < 2.0)] = 4
    classes[valid & (data >= 2.0) & (data < 4.0)] = 5
    classes[valid & (data >= 4.0) & (data <= 50)] = 6

    return classes


# ----------------------------------------------------
# HJÄLPFUNKTIONER
# ----------------------------------------------------
def parse_time_name(file_name):
    clean_name = file_name.replace("res-", "").replace(".tif", "").split("_")
    if len(clean_name) < 2:
        return None
    return f"{clean_name[0]}_{clean_name[1]}"


def classes_to_svg(classes, output_path):
    """
    Skapar SVG med horisontella run-length-rects.
    Varje sammanhängande radsekvens med samma klass blir en rect.
    """
    height, width = classes.shape
    rect_count = 0

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" '
        f'shape-rendering="crispEdges">',
        '<g>'
    ]

    for y in range(height):
        row = classes[y]
        x = 0

        while x < width:
            cls = int(row[x])

            if cls == 0:
                x += 1
                continue

            start_x = x
            x += 1

            while x < width and int(row[x]) == cls:
                x += 1

            run_width = x - start_x
            color = CLASS_COLORS.get(cls)

            if color is None:
                raise ValueError(
                    f"Saknar färg för klass {cls}. "
                    f"Tillgängliga klasser: {list(CLASS_COLORS.keys())}. "
                    f"Unika klasser i raster: {np.unique(classes).tolist()}"
                )

            parts.append(
                f'<rect x="{start_x}" y="{y}" width="{run_width}" height="1" fill="{color}"/>'
            )
            rect_count += 1

    parts.append('</g></svg>')

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))

    return rect_count


def make_svg_for_file(args):
    file_path, time_name, output_dir = args
    svg_output_path = os.path.join(output_dir, f"{time_name}.svg")

    with rasterio.open(file_path) as src:
        source_crs = src.crs if src.crs is not None else src_crs_fallback
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

            out_height = vrt.height * upscale_factor
            out_width = vrt.width * upscale_factor

            data = vrt.read(
                1,
                out_shape=(out_height, out_width),
                fill_value=nodata_value,
                resampling=Resampling.nearest
            ).astype(np.float32)

            data[~np.isfinite(data)] = nodata_value
            data[data == actual_nodata] = nodata_value
            data[data < 0.05] = nodata_value
            data[data > 50] = nodata_value

            classes = classify_to_classes(data, nodata=nodata_value)
            visible_pixels = int(np.count_nonzero(classes))

            rect_count = classes_to_svg(classes, svg_output_path)

            west, south, east, north = transform_bounds(
                dst_crs,
                "EPSG:4326",
                vrt.bounds.left,
                vrt.bounds.bottom,
                vrt.bounds.right,
                vrt.bounds.top,
                densify_pts=21
            )

            file_size_mb = os.path.getsize(svg_output_path) / (1024 * 1024)

            return {
                "time_name": time_name,
                "bounds": {
                    "west": west,
                    "south": south,
                    "east": east,
                    "north": north
                },
                "visible_pixels": visible_pixels,
                "rect_count": rect_count,
                "width": int(classes.shape[1]),
                "height": int(classes.shape[0]),
                "file_size_mb": file_size_mb,
                "warning": src.crs is None
            }
        
def process_case(config):
    input_dir = config["input_dir"]
    output_dir = config["output_dir"]
    case_id = config["case_id"]
    case_name = config["case_name"]

    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)

    os.makedirs(output_dir, exist_ok=True)

    files = sorted(glob.glob(os.path.join(input_dir, "res-*.tif")))

    if not files:
        print(f"Inga filer hittades för {case_name}")
        return None

    jobs = []

    for file_path in files:
        file_name = os.path.basename(file_path)
        time_name = parse_time_name(file_name)

        if time_name is None:
            print(f"Hoppar över fil med oväntat namn: {file_name}")
            continue

        jobs.append((file_path, time_name, output_dir))

    print(f"Hittade {len(jobs)} filer för {case_name}")

    all_bounds_4326 = []
    generated_time_steps = []

    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        future_to_job = {
            executor.submit(make_svg_for_file, job): job
            for job in jobs
        }

        for future in as_completed(future_to_job):
            file_path, time_name, output_dir = future_to_job[future]

            try:
                result = future.result()
                time_name = result["time_name"]

                all_bounds_4326.append(result["bounds"])
                generated_time_steps.append(time_name)

                print(
                    f"Klar: {case_name} / {time_name}.svg | "
                    f"{result['file_size_mb']:.2f} MB | "
                    f"rects: {result['rect_count']}"
                )

            except Exception as e:
                print("\n" + "!" * 80)
                print(f"FEL I CASE: {case_name}")
                print(f"FIL: {file_path}")
                print(f"TIME_NAME: {time_name}")
                print("TRACEBACK:")
                traceback.print_exc()
                print("!" * 80 + "\n")

    generated_time_steps = sorted(generated_time_steps)

    with open(os.path.join(output_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(generated_time_steps, f, indent=2)

    if all_bounds_4326:
        metadata = {
            "caseId": case_id,
            "name": case_name,
            "category": config.get("category", CASE_CATEGORIES.BASE),
            "crs": "EPSG:3857",
            "displayBoundsCrs": "EPSG:4326",
            "bounds": {
                "west": min(b["west"] for b in all_bounds_4326),
                "south": min(b["south"] for b in all_bounds_4326),
                "east": max(b["east"] for b in all_bounds_4326),
                "north": max(b["north"] for b in all_bounds_4326)
            },
            "classes": CLASS_DEFINITIONS,
            "opacityDefault": config.get("opacity", 0.8),
            "timeStepHours": 1,
            "fileType": "svg",
            "imageUrlTemplate": "{time}.svg",
            "upscaleFactor": upscale_factor
        }

        with open(os.path.join(output_dir, "metadata.json"), "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)

    print(f"Färdig med case: {case_name}")
    return True

# ---------------------------------------------------
def build_cases_json_entries(data_sources):
    entries = []

    for config in data_sources:
        entries.append({
            "id": config["case_id"],
            "name": config["case_name"],
            "category": str(config.get("category", CASE_CATEGORIES.BASE)),
            "path": config["web_case_path"],
            "enabled": config.get("enabled", False),
            "opacity": config.get("opacity", 0.8)
        })

    return entries


def write_cases_json(data_sources, output_path):
    all_case_entries = build_cases_json_entries(data_sources)

    output_dir = os.path.dirname(output_path)
    os.makedirs(output_dir, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_case_entries, f, indent=2)

    print(f"Skapade cases.json med {len(all_case_entries)} cases:")
    print(output_path)

    return all_case_entries


# ----------------------------------------------------
# MAIN
# ----------------------------------------------------
# ----------------------------------------------------
# MAIN
# ----------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generera SVG-floodmaps och cases.json."
    )

    parser.add_argument(
        "--cases-json-only",
        action="store_true",
        help="Skapa bara cases.json utan att processa raster/SVG-filer."
    )

    parser.add_argument(
        "--case",
        dest="case_ids",
        action="append",
        help=(
            "Processa bara ett specifikt case_id. "
            "Kan anges flera gånger, t.ex. --case base_hiprad --case combined_free."
        )
    )

    args = parser.parse_args()

    if args.case_ids:
        selected_case_ids = set(args.case_ids)
        selected_sources = [
            config for config in DATA_SOURCES
            if config["case_id"] in selected_case_ids
        ]

        missing_case_ids = selected_case_ids - {
            config["case_id"] for config in selected_sources
        }

        if missing_case_ids:
            print(f"Varning: hittade inte dessa case_id: {sorted(missing_case_ids)}")

        if not selected_sources:
            raise ValueError("Inga matchande cases hittades. Avbryter.")

    else:
        selected_sources = DATA_SOURCES

    if args.cases_json_only:
        write_cases_json(DATA_SOURCES, cases_path)
        print("Allt klart!")
        raise SystemExit(0)

    processed_case_entries = []

    for config in selected_sources:
        print("\n" + "=" * 80)
        print(f"Startar case: {config['case_name']}")
        print("=" * 80)

        result = process_case(config)

        if result is not None:
            processed_case_entries.append({
                "id": config["case_id"],
                "name": config["case_name"],
                "category": str(config.get("category", CASE_CATEGORIES.BASE)),
                "path": config["web_case_path"],
                "enabled": config.get("enabled", False),
                "opacity": config.get("opacity", 0.8)
            })

    # Viktigt:
    # Skriv alltid global cases.json för ALLA cases, inte bara de processade.
    # Annars försvinner oprocessade lager ur webappen.
    write_cases_json(DATA_SOURCES, cases_path)

    print(f"\nProcessade {len(processed_case_entries)} cases.")
    print("Allt klart!")