/**
 * example.js
 */

// Globala variabler
let timeSteps = [];
let currentLayer = null;
let markerLayerGroup = null;
let legendControl = null;
let timeSliderControl = null;
const baseDataDir = 'floodmaps_mercator/base_cases/hiprad';
let isLoading = false;

// --- Helper funktioner ---
function formatLegendValue(value) {
    return Number.isInteger(value) ? value : value.toFixed(1);
}

function isNoDataValue(value, noData) {
    if (value === null || value === undefined || isNaN(value)) return true;
    if (Array.isArray(noData)) return noData.some(nd => Number(value) === Number(nd));
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

// --- Custom Leaflet Control för Slidern ---
L.Control.TimeSlider = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function(map) {
        const container = L.DomUtil.create('div', 'leaflet-time-control');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        this._display = L.DomUtil.create('div', '', container);
        this._display.id = 'time-display';
        this._display.style.fontWeight = 'bold';
        this._display.style.marginBottom = '5px';
        this._display.style.textAlign = 'center';
        this._display.innerText = 'Laddar...';

        this._slider = L.DomUtil.create('input', 'time-slider-input', container);
        this._slider.type = 'range';
        this._slider.style.width = '200px';
        this._slider.min = 0;
        this._slider.max = 0;
        this._slider.value = 0;

        L.DomEvent.on(this._slider, 'input', (e) => {
            loadRaster(parseInt(e.target.value));
        });

        return container;
    },
    updateMax: function(max) { this._slider.max = max; },
    updateDisplay: function(text) { this._display.innerText = text; }
});

// --- Initiera kartan ---
const map = L.map('map').setView([63.51, 18.06], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

// Lägg till kontrollerna
timeSliderControl = new L.Control.TimeSlider();
timeSliderControl.addTo(map);

// --- Värdeskala (Legend) Återställd ---
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
    L.DomEvent.disableClickPropagation(this._div);
    return this._div;
};

legendControl.update = function () {
    const ranges = [
        { label: 'Mycket låg', lower: 0.05, upper: 0.5, color: '#b3e5fc' },
        { label: 'Låg', lower: 0.5, upper: 1.0, color: '#81d4fa' },
        { label: 'Mellan', lower: 1.0, upper: 1.5, color: '#4fc3f7' },
        { label: 'Hög', lower: 1.5, upper: 2.0, color: '#29b6f6' },
        { label: 'Superhög', lower: 2.0, upper: 4.0, color: '#0277bd' },
        { label: 'Extra hög', lower: 4.0, upper: Infinity, color: '#01579b' }
    ];

    if (!this._div) return;
    this._div.innerHTML = '<strong>Värdeskala</strong><br><small>Rastervärde (m vatten)</small>';

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
legendControl.update(); // Kör initialt

async function initApp() {
    try {
        const response = await fetch(`${baseDataDir}/manifest.json`);
        timeSteps = await response.json();
        if (timeSteps.length > 0) {
            timeSliderControl.updateMax(timeSteps.length - 1);
            loadRaster(0);
        }
    } catch (err) {
        timeSliderControl.updateDisplay("Fel: Manifest saknas");
    }
}

async function loadRaster(index) {
    if (isLoading) return;
    isLoading = true;

    const timeString = timeSteps[index];
    const url = `${baseDataDir}/${timeString}.tif`;
    const formattedTime = timeString.replace('_', ' ');
    
    timeSliderControl.updateDisplay(`Laddar...`);

    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const georaster = await parseGeoraster(arrayBuffer);
        const noData = georaster.noDataValue;

        if (currentLayer) map.removeLayer(currentLayer);

        currentLayer = new GeoRasterLayer({
            georaster: georaster,
            opacity: 0.7,
            pixelValuesToColorFn: v => isNoDataValue(v, noData) ? null : getRasterColor(v),
            resolution: 128
        });

        currentLayer.addTo(map);
        timeSliderControl.updateDisplay(`Tid: ${formattedTime}`);
        isLoading = false;
    } catch (error) {
        console.error(error);
        isLoading = false;
    }
}

initApp();