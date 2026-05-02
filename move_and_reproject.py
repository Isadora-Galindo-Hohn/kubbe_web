import os
import glob
import json
import rasterio
import numpy as np
from rasterio.warp import calculate_default_transform, reproject, Resampling

# --- KONFIGURATION ---
input_dir = r'C:\Users\k000952\Dokument\QGIS\Modeling results\Pluvial\hiprad\base_hiprad\postprocessed\run0'
output_dir = r'C:\Users\k000952\Dokument\QGIS\kubbe_web\floodmaps_mercator\base_cases\hiprad'

src_crs = 'EPSG:3006'  # SWEREF 99 TM
dst_crs = 'EPSG:3857'  # Web Mercator

os.makedirs(output_dir, exist_ok=True)
files = glob.glob(os.path.join(input_dir, "res-*.tif"))

print(f"Hittade {len(files)} filer. Startar reprojicering...")

for file_path in files:
    file_name = os.path.basename(file_path)
    clean_name = file_name.replace('res-', '').split('_')
    if len(clean_name) < 2: continue
    
    output_path = os.path.join(output_dir, f"{clean_name[0]}_{clean_name[1]}.tif")

    # 1. SKRIV-FAS: Skapa och projicera om filen
    with rasterio.open(file_path) as src:
        source_crs = src.crs if src.crs is not None else src_crs
        if src.crs is None:
            print(f"Obs: Källfilen saknar CRS, antar {source_crs} för {file_name}")

        transform, width, height = calculate_default_transform(
            source_crs, dst_crs, src.width, src.height, *src.bounds)
        
        kwargs = src.meta.copy()
        kwargs.update({
            'crs': dst_crs,
            'transform': transform,
            'width': width,
            'height': height,
            'compress': 'lzw',
            'nodata': -9999.0
        })

        with rasterio.open(output_path, 'w', **kwargs) as dst:
            for i in range(1, src.count + 1):
                band_data = src.read(i)
                reproject(
                    source=band_data,
                    destination=rasterio.band(dst, i),
                    src_transform=src.transform,
                    src_crs=source_crs,
                    dst_transform=transform,
                    dst_crs=dst_crs,
                    resampling=Resampling.nearest,
                    src_nodata=-9999.0,
                    dst_nodata=-9999.0
                )

    # 2. UPPDATERINGS-FAS: Öppna filen igen för att läsa statistik och skriva taggar
    with rasterio.open(output_path, 'r+') as dst:
        res_data = dst.read(1)
        valid_pixels = res_data[res_data != -9999.0]
        
        if valid_pixels.size > 0:
            mi, ma = np.min(valid_pixels), np.max(valid_pixels)
            dst.update_tags(1, STATISTICS_MINIMUM=mi, STATISTICS_MAXIMUM=ma)
            status = f"Data OK! Min: {mi:.2f}, Max: {ma:.2f}"
        else:
            status = "Varning: Ingen mätdata hittades"

    print(f"Klar: {os.path.basename(output_path)} ({status})")

# --- SKAPA MANIFEST ---
print("\nSkapar manifest.json...")
generated_files = glob.glob(os.path.join(output_dir, "*.tif"))
time_steps = sorted([os.path.basename(f).replace('.tif', '') for f in generated_files])
with open(os.path.join(output_dir, 'manifest.json'), 'w') as f:
    json.dump(time_steps, f)

print("Allt klart!")