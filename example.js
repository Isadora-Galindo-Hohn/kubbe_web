/**
 * example.js
 * Stabil och korrekt tidsstyrd visning av GeoTIFF‑översvämningsdata i Leaflet
 */

// ----------------------------------------------------
// Globala variabler
// ----------------------------------------------------
let timeSteps = [];
let currentLayer = null;
let legendControl = null;
let timeSliderControl = null;
let baseLayer = null;

const baseDataDir = 'floodmaps_mercator/base_cases/hiprad';

let currentAbortController = null;
let requestId = 0;

// ----------------------------------------------------
// Hjälpfunktioner
// ----------------------------------------------------
function isNoDataValue(value, noData) {
  if (value === null || value === undefined || isNaN(value)) return true;
  if (noData === undefined || noData === null) return false;
  if (Array.isArray(noData)) {
    return noData.some(nd => Number(value) === Number(nd));
  }
  return Number(value) === Number(noData);
}

function rasterHasValidData(georaster) {
  const band = georaster.values[0];
  const noData = georaster.noDataValue;

  for (let r = 0; r < band.length; r++) {
    for (let c = 0; c < band[r].length; c++) {
      const v = band[r][c];
      if (!isNoDataValue(v, noData) && v > 0) {
        return true;
      }
    }
  }
  return false;
}

function getRasterColor(value) {
  if (value < 0.5) return '#b3e5fc';
  if (value < 1.0) return '#81d4fa';
  if (value < 1.5) return '#4fc3f7';
  if (value < 2.0) return '#29b6f6';
  if (value < 4.0) return '#0277bd';
  return '#01579b';
}

function clearCurrentRaster() {
  map.eachLayer(function(layer) {
    if (layer !== baseLayer) {
      map.removeLayer(layer);
    }
  });
  console.log(map._layers);
  currentLayer = null;
}

// ----------------------------------------------------
// Tids-slider kontroll
// ----------------------------------------------------

// (Valfri) Funktion för att formatera tidssteg till mer läsbart format
// Exempel: "20250911_2000" → "2025-09-11 20:00"
function formatTextTimeStamp(ts) {
    if (typeof ts !== 'string' || ts.length < 13) return ts;
    const datePart = ts.slice(0, 8);
    const timePart = ts.slice(9, 13);
    return `${datePart.slice(0,4)}-${datePart.slice(4,6)}-${datePart.slice(6,8)} ${timePart.slice(0,2)}:${timePart.slice(2,4)}`;
}

function onAddTimeSlider() {
    const container = L.DomUtil.create('div', 'leaflet-time-control');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const label = L.DomUtil.create('div', '', container);
    label.id = 'time-label';

    const input = L.DomUtil.create('input', 'time-slider-input', container);
    input.type = 'range';
    input.min = 0;
    input.step = 1;
    input.value = 0;

    function onInput() {
      const index = Number(input.value);
      this.updateLabel(`Tid: ${formatTextTimeStamp(timeSteps[index]) ?? '–'}`);
      loadRaster(index);
    }

    input.addEventListener('input', onInput.bind(this));

    this._input = input;
    this._label = label;
    return container;
}
L.Control.TimeSlider = L.Control.extend({
  options: { position: 'bottomleft' },
  updateLabel(text) {
    if (this._label) {
      this._label.textContent = text;
    }
  },

  onAdd: onAddTimeSlider,

  updateMax(max) {
    if (this._input) {
      this._input.max = max;
    }
  },  
});

// ----------------------------------------------------
// Initiera karta
// ----------------------------------------------------
const map = L.map('map').setView([63.51, 18.06], 12);
const openstreetmap = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
 baseLayer = L.tileLayer(openstreetmap, {
   attribution: '© OpenStreetMap'
}).addTo(map);

// ----------------------------------------------------
// Legend
// ----------------------------------------------------
legendControl = L.control({ position: 'bottomright' });

legendControl.onAdd = function () {
  const container = L.DomUtil.create('div', 'info legend');
  container.style.background = 'rgba(255,255,255,0.97)';
  container.style.padding = '12px 14px';
  container.style.borderRadius = '8px';
  container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';
  container.style.fontSize = '13px';
  container.style.color = '#222';

  container.innerHTML = `
    <strong>Översvämningsdjup (m)</strong><br>
    <i style="background:#b3e5fc"></i> 0.05–0.5<br>
    <i style="background:#81d4fa"></i> 0.5–1.0<br>
    <i style="background:#4fc3f7"></i> 1.0–1.5<br>
    <i style="background:#29b6f6"></i> 1.5–2.0<br>
    <i style="background:#0277bd"></i> 2.0–4.0<br>
    <i style="background:#01579b"></i> >4.0
  `;
  this._div = container;
  return container;
};

legendControl.addTo(map);

// ----------------------------------------------------
// Lägg till tidskontroll
// ----------------------------------------------------
timeSliderControl = new L.Control.TimeSlider();
timeSliderControl.addTo(map);

// ----------------------------------------------------
// Initiera app
// ----------------------------------------------------
async function initApp() {
  try {
    const response = await fetch(`${baseDataDir}/manifest.json`);
    timeSteps = await response.json();

    if (!Array.isArray(timeSteps) || timeSteps.length === 0) {
      timeSliderControl.updateLabel('Ingen data');
      return;
    }

    timeSliderControl.updateMax(timeSteps.length - 1);
    loadRaster(0);

  } catch (err) {
    console.error(err);
    timeSliderControl.updateLabel('Fel: kan ej läsa manifest');
  }
}

// ----------------------------------------------------
// Ladda och visa raster
// ----------------------------------------------------
async function loadRaster(index) {
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const localRequestId = ++requestId;

  const filename = timeSteps[index];
  if (!filename) {
    timeSliderControl.updateLabel('Tid: –');
    return;
  }

  console.log(filename, currentLayer?.filename || "");

  const formattedTime = formatTextTimeStamp(filename);

  if (currentLayer && currentLayer.filename === filename) {
    timeSliderControl.updateLabel(`Tid: ${formattedTime}`);
    return;
  }

  clearCurrentRaster();

  try {
    const response = await fetch(`${baseDataDir}/${filename}.tif`, { signal });

    if (!response.ok) {
      timeSliderControl.updateLabel(`Tid: ${formattedTime} – raster saknas`);
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const georaster = await parseGeoraster(arrayBuffer);

    if (!rasterHasValidData(georaster)) {
      timeSliderControl.updateLabel(`Tid: ${formattedTime} – ingen översvämning`);
    }

    if (localRequestId !== requestId) return;

    currentLayer = new GeoRasterLayer({
      georaster,
      opacity: 0.7,
      resolution: 256,
      pixelValuesToColorFn: value => {
        if (value === null || value === undefined || isNaN(value)) return null;
        if (value <= 0) return null;
        return getRasterColor(value);
      }
    });

    currentLayer.filename = filename;

    currentLayer.addTo(map);
    timeSliderControl.updateLabel(`Tid: ${formattedTime}`);

  } catch (err) {
    if (err.name !== 'AbortError') {
      timeSliderControl.updateLabel('Fel vid inläsning');
    }
  }
}

// ----------------------------------------------------
initApp();