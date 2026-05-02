/**
 * example.js
 * Web-GIS för visualisering av tidsraster (översvämningsmodellering)
 */

// Globala variabler
let timeSteps = [];
let currentLayer = null;
let markerLayerGroup = null;
let legendControl = null;
const baseDataDir = 'floodmaps_mercator/base_cases/hiprad';
const slider = document.getElementById('time-slider');
const display = document.getElementById('time-display');
let isLoading = false;

function formatLegendValue(value) {
    return Number.isInteger(value) ? value : value.toFixed(1);
}

function isNoDataValue(value, noData) {
    if (value === null || value === undefined || isNaN(value)) {
        return true;
    }
    if (Array.isArray(noData)) {
        return noData.some(nd => Number(value) === Number(nd));
    }
    return Number(value) === Number(noData);
}

function getRasterColor(value) {
    if (value < 0.5) return '#b3e5fc';
    if (value < 1.0) return '#81d4fa';
    if (value < 1.5) return '#4fc3f7';
    if (value < 2.0) return '#29b6f6';
    if (value < 4.0) return '#0277bd';
    return '#01579b';
}

function rasterPixelToLatLng(row, col, georaster) {
    const pixelWidth = typeof georaster.pixelWidth === 'number' ? georaster.pixelWidth : (georaster.xmax - georaster.xmin) / georaster.width;
    const pixelHeight = typeof georaster.pixelHeight === 'number' ? georaster.pixelHeight : (georaster.ymax - georaster.ymin) / georaster.height;
    const x = georaster.xmin + col * pixelWidth;
    const y = georaster.ymax + row * pixelHeight;
    return L.latLng(y, x);
}

// Initiera kartan centrerad på Kubbe
const map = L.map('map').setView([63.51, 18.06], 12);

// Lägg till bakgrundskarta (OpenStreetMap)
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

legendControl = L.control({ position: 'bottomright' });
legendControl.onAdd = function () {
    this._div = L.DomUtil.create('div', 'info legend');
    this._div.style.background = 'rgba(255, 255, 255, 0.97)';
    this._div.style.padding = '12px 14px';
    this._div.style.borderRadius = '8px';
    this._div.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';
    this._div.style.fontSize = '13px';
    this._div.style.lineHeight = '1.4';
    this._div.style.color = '#222';
    this._div.innerHTML = '<strong>Värdeskala</strong><br><small>Rastervärde (högre = mer vatten)</small>';
    L.DomEvent.disableClickPropagation(this._div);
    return this._div;
};
legendControl.update = function (min, max) {
    // Static legend based on predefined ranges
    const ranges = [
        { label: 'Mycket låg', lower: 0.05, upper: 0.5, color: '#b3e5fc' },
        { label: 'Låg', lower: 0.5, upper: 1.0, color: '#81d4fa' },
        { label: 'Mellan', lower: 1.0, upper: 1.5, color: '#4fc3f7' },
        { label: 'Hög', lower: 1.5, upper: 2.0, color: '#29b6f6' },
        { label: 'Superhög', lower: 2.0, upper: 4.0, color: '#0277bd' },
        { label: 'Extra hög', lower: 4.0, upper: Infinity, color: '#01579b' }
    ];

    if (!this._div) return;
    this._div.innerHTML = '<strong>Värdeskala</strong><br><small>Rastervärde (högre = mer vatten)</small>';

    for (const range of ranges) {
        const upperText = range.upper === Infinity ? '4+' : formatLegendValue(range.upper);
        this._div.innerHTML +=
            '<div style="display:flex; align-items:center; margin-top:8px;">'
            + '<span style="display:inline-block;width:18px;height:14px;margin-right:8px;background:' + range.color + ';border:1px solid #999;"></span>'
            + '<span><strong>' + range.label + '</strong><br>'
            + formatLegendValue(range.lower) + ' – ' + upperText + '</span>'
            + '</div>';
    }
};
legendControl.addTo(map);

/**
 * Initierar applikationen genom att hämta manifestet
 */
async function initApp() {
    try {
        const response = await fetch(`${baseDataDir}/manifest.json`);
        if (!response.ok) throw new Error("Kunde inte ladda manifest.json. Kontrollera sökvägen.");
        
        timeSteps = await response.json();
        
        // Konfigurera slidern
        slider.max = timeSteps.length - 1;
        slider.value = 0;
        
        // Ladda det första tidssteget direkt
        if (timeSteps.length > 0) {
            loadRaster(0);
        } else {
            display.innerText = "Inga tidssteg hittades i manifestet.";
        }
    } catch (err) {
        console.error("Initieringsfel:", err);
        display.innerText = "Fel: Kunde inte ladda tidsdata.";
    }
}

/**
 * Laddar och visar en specifik GeoTIFF-fil baserat på index
 */
async function loadRaster(index) {
    if (isLoading) return;
    isLoading = true;
    const timeString = timeSteps[index];
    const url = `${baseDataDir}/${timeString}.tif`;
    
    console.log('loadRaster', { index, timeString, url });

    // Formatera tid för display (t.ex. 20250913_0000 -> 2025-09-13 00:00)
    const formattedTime = timeString.replace('_', ' ');
    display.innerText = `Laddar: ${formattedTime}...`;

    try {
        const response = await fetch(url, { cache: 'no-cache' });
        console.log('fetch status', response.status, response.statusText, url);
        if (!response.ok) throw new Error(`Kunde inte hämta filen: ${url}`);
        
        const arrayBuffer = await response.arrayBuffer();
        console.log('arrayBuffer length', arrayBuffer.byteLength);
        const georaster = await parseGeoraster(arrayBuffer);
        console.log('georaster object keys', Object.keys(georaster));

        const noData = georaster.noDataValue;
        const sampleInfo = {
            width: georaster.width,
            height: georaster.height,
            noDataValue: noData,
            projection: georaster.projection,
            pixelType: georaster.pixelType,
            xmin: georaster.xmin,
            xmax: georaster.xmax,
            ymin: georaster.ymin,
            ymax: georaster.ymax,
            mins: georaster.mins,
            maxs: georaster.maxs,
            ranges: georaster.ranges,
        };
        console.log('georaster metadata', sampleInfo);

        let minValue = Array.isArray(georaster.mins) ? georaster.mins[0] : 0;
        let maxValue = Array.isArray(georaster.maxs) ? georaster.maxs[0] : 1;

        if (georaster.values && georaster.values.length > 0) {
            const bandRows = georaster.values[0];
            console.log('bandRows count', bandRows.length, 'rowWidth', bandRows[0].length);
            console.log('row0 sample', Array.from(bandRows[0].slice(0, 20)));
            const midRow = Math.floor(bandRows.length / 2);
            console.log('mid row sample', Array.from(bandRows[midRow].slice(0, 20)));

            let validCount = 0;
            let firstValid = null;
            let lastValid = null;
            const rowsWithData = new Set();
            const validSample = [];
            let computedMin = Infinity;
            let computedMax = -Infinity;

            for (let rowIndex = 0; rowIndex < bandRows.length; rowIndex++) {
                const row = bandRows[rowIndex];
                for (let colIndex = 0; colIndex < row.length; colIndex++) {
                    const v = row[colIndex];
                    if (!isNoDataValue(v, noData)) {
                        validCount += 1;
                        rowsWithData.add(rowIndex);
                        computedMin = Math.min(computedMin, v);
                        computedMax = Math.max(computedMax, v);
                        if (!firstValid) {
                            firstValid = { row: rowIndex, col: colIndex, value: v };
                        }
                        lastValid = { row: rowIndex, col: colIndex, value: v };
                        if (validSample.length < 20) {
                            validSample.push({ row: rowIndex, col: colIndex, value: v });
                        }
                    }
                }
            }

            if (computedMin !== Infinity && computedMax !== -Infinity) {
                minValue = computedMin;
                maxValue = computedMax;
            }

            console.log('georaster valid sample count', validCount, validSample);
            console.log('georaster valid row range', Math.min(...rowsWithData), Math.max(...rowsWithData), 'distinct rows', rowsWithData.size);
            console.log('georaster first/last valid pixel', firstValid, lastValid);
        }

        if (markerLayerGroup) {
            map.removeLayer(markerLayerGroup);
        }
        markerLayerGroup = L.layerGroup();

        if (georaster.values && georaster.values.length > 0) {
            const bandRows = georaster.values[0];
            for (let rowIndex = 0; rowIndex < bandRows.length; rowIndex++) {
                const row = bandRows[rowIndex];
                for (let colIndex = 0; colIndex < row.length; colIndex++) {
                    const value = row[colIndex];
                    if (isNoDataValue(value, noData)) {
                        continue;
                    }
                    const latlng = rasterPixelToLatLng(rowIndex, colIndex, georaster);
                    const color = getRasterColor(value);
                    const marker = L.circleMarker(latlng, {
                        radius: 3,
                        fillColor: color,
                        color: color,
                        weight: 0,
                        fillOpacity: 0.9,
                        interactive: false
                    });
                    markerLayerGroup.addLayer(marker);
                }
            }
        }

        if (currentLayer) {
            map.removeLayer(currentLayer);
        }

        // Skapa GeoRasterLayer med färgskala för vatten
        console.log('georaster min/max values', minValue, maxValue);

        legendControl.update(minValue, maxValue);

        currentLayer = new GeoRasterLayer({
            georaster: georaster,
            opacity: 0.7,
            pixelValuesToColorFn: value => {
                if (isNoDataValue(value, noData)) {
                    return null; // Transparent
                }

                return getRasterColor(value);
            },
            resolution: {
                0: 256,   // High resolution at low zoom to reduce aggregation
                8: 128,   // Moderate at mid zoom
                12: 64    // Lower at high zoom for performance
            }
        });

        currentLayer.addTo(map);
        if (markerLayerGroup && !map.hasLayer(markerLayerGroup)) {
            markerLayerGroup.addTo(map);
        }
        display.innerText = `Tid: ${formattedTime}`;
        isLoading = false;
        
    } catch (error) {
        console.error("GIS Error:", error);
        display.innerText = `Fel vid laddning av tidssteg: ${timeString}`;
        isLoading = false;
    }
}

// Event listener för slidern
slider.addEventListener('input', (e) => {
    if (isLoading) return;
    console.log('slider input', e.target.value);
    loadRaster(parseInt(e.target.value));
});

// Starta programmet
initApp();