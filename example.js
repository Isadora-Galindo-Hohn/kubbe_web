let timeSteps = [];
let cases = [];
let metadataByCase = {};

let activeImageLayers = {};
let pendingImageLayers = {};
let latestRequestByCase = {};
let loadRequestId = 0;

let timeSliderControl = null;
let caseControl = null;
let legendControl = null;
let baseLayer = null;

let isPlaying = false;
let playTimer = null;
let playSpeedMs = 500;

const casesJsonPath = 'floodmaps_mercator_png/base_cases/cases.json';

function formatTextTimeStamp(ts) {
  if (typeof ts !== 'string' || ts.length < 13) return ts;
  const datePart = ts.slice(0, 8);
  const timePart = ts.slice(9, 13);
  return `${datePart.slice(0,4)}-${datePart.slice(4,6)}-${datePart.slice(6,8)} ${timePart.slice(0,2)}:${timePart.slice(2,4)}`;
}

function getEnabledCases() {
  return cases.filter(c => c.enabled);
}

function getImageUrl(caseItem, time) {
  return `${caseItem.path}/${time}.png`;
}

function getBounds(caseItem) {
  const metadata = metadataByCase[caseItem.id];
  return [
    [metadata.bounds.south, metadata.bounds.west],
    [metadata.bounds.north, metadata.bounds.east]
  ];
}

function removeLayerSafe(layer) {
  if (layer && map.hasLayer(layer)) {
    map.removeLayer(layer);
  }
}

const map = L.map('map').setView([63.51, 18.066], 14);

baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
  maxZoom: 19
}).addTo(map);

function loadTimeIndex(index) {
  const time = timeSteps[index];
  if (!time) return;

  timeSliderControl.setValue(index);
  timeSliderControl.updateLabel(`Tid: ${formatTextTimeStamp(time)}`);

  const enabledCases = getEnabledCases();
  const requestId = ++loadRequestId;

  enabledCases.forEach(caseItem => {
    latestRequestByCase[caseItem.id] = requestId;

    if (pendingImageLayers[caseItem.id]) {
      removeLayerSafe(pendingImageLayers[caseItem.id]);
      delete pendingImageLayers[caseItem.id];
    }

    const oldLayer = activeImageLayers[caseItem.id];
    const imageUrl = getImageUrl(caseItem, time);
    const bounds = getBounds(caseItem);

    const newLayer = L.imageOverlay(imageUrl, bounds, {
      opacity: 0,
      interactive: false,
      zIndex: 500
    });

    pendingImageLayers[caseItem.id] = newLayer;

    newLayer.once('load', () => {
      const isStillLatest = latestRequestByCase[caseItem.id] === requestId;

      if (!isStillLatest) {
        removeLayerSafe(newLayer);
        return;
      }

      if (oldLayer) {
        removeLayerSafe(oldLayer);
      }

      newLayer.setOpacity(caseItem.opacity ?? 0.8);
      activeImageLayers[caseItem.id] = newLayer;
      delete pendingImageLayers[caseItem.id];
    });

    newLayer.once('error', () => {
      console.warn(`Kunde inte ladda bild: ${imageUrl}`);
      removeLayerSafe(newLayer);
      delete pendingImageLayers[caseItem.id];

      if (oldLayer) {
        removeLayerSafe(oldLayer);
        delete activeImageLayers[caseItem.id];
      }
    });

    newLayer.addTo(map);
  });

  Object.keys(activeImageLayers).forEach(caseId => {
    const stillEnabled = enabledCases.some(c => c.id === caseId);
    if (!stillEnabled) {
      removeLayerSafe(activeImageLayers[caseId]);
      delete activeImageLayers[caseId];
    }
  });

  Object.keys(pendingImageLayers).forEach(caseId => {
    const stillEnabled = enabledCases.some(c => c.id === caseId);
    if (!stillEnabled) {
      removeLayerSafe(pendingImageLayers[caseId]);
      delete pendingImageLayers[caseId];
    }
  });
}

function onAddTimeSlider() {
  const container = L.DomUtil.create('div', 'leaflet-time-control');
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);

  const label = L.DomUtil.create('div', 'time-label', container);
  label.textContent = 'Tid: –';

  const row = L.DomUtil.create('div', 'time-player-row', container);

  const prevButton = L.DomUtil.create('button', 'time-button', row);
  prevButton.textContent = '⏮';

  const playButton = L.DomUtil.create('button', 'time-button', row);
  playButton.textContent = '▶';

  const nextButton = L.DomUtil.create('button', 'time-button', row);
  nextButton.textContent = '⏭';

  const input = L.DomUtil.create('input', 'time-slider-input', row);
  input.type = 'range';
  input.min = 0;
  input.step = 1;
  input.value = 0;

  const speed = L.DomUtil.create('select', 'time-button', row);
  speed.innerHTML = `
    <option value="1000">1x</option>
    <option value="500" selected>2x</option>
    <option value="250">4x</option>
    <option value="100">10x</option>
  `;

  input.addEventListener('input', () => {
    loadTimeIndex(Number(input.value));
  });

  prevButton.addEventListener('click', () => {
    loadTimeIndex(Math.max(0, Number(input.value) - 1));
  });

  nextButton.addEventListener('click', () => {
    loadTimeIndex(Math.min(timeSteps.length - 1, Number(input.value) + 1));
  });

  playButton.addEventListener('click', togglePlay);

  speed.addEventListener('change', () => {
    playSpeedMs = Number(speed.value);
    if (isPlaying) {
      stopPlay();
      startPlay();
    }
  });

  this._input = input;
  this._label = label;
  this._playButton = playButton;

  return container;
}

L.Control.TimeSlider = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd: onAddTimeSlider,

  updateLabel(text) {
    if (this._label) this._label.textContent = text;
  },

  updateMax(max) {
    if (this._input) this._input.max = max;
  },

  setValue(value) {
    if (this._input) this._input.value = value;
  },

  getValue() {
    return this._input ? Number(this._input.value) : 0;
  },

  updatePlayButton() {
    if (this._playButton) {
      this._playButton.textContent = isPlaying ? '⏸' : '▶';
    }
  }
});

function startPlay() {
  isPlaying = true;
  timeSliderControl.updatePlayButton();

  playTimer = setInterval(() => {
    let index = timeSliderControl.getValue() + 1;
    if (index >= timeSteps.length) index = 0;
    loadTimeIndex(index);
  }, playSpeedMs);
}

function stopPlay() {
  isPlaying = false;
  timeSliderControl.updatePlayButton();

  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
}

function togglePlay() {
  isPlaying ? stopPlay() : startPlay();
}

L.Control.CaseControl = L.Control.extend({
  options: { position: 'topleft' },

  onAdd: function () {
    const container = L.DomUtil.create('div', 'case-control');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    container.innerHTML = `<strong>Lager</strong>`;

    cases.forEach(caseItem => {
      const row = L.DomUtil.create('div', 'case-row', container);

      const checkbox = L.DomUtil.create('input', '', row);
      checkbox.type = 'checkbox';
      checkbox.checked = caseItem.enabled;

      const label = L.DomUtil.create('span', '', row);
      label.textContent = caseItem.name;

      const opacity = L.DomUtil.create('input', '', row);
      opacity.type = 'range';
      opacity.min = 0;
      opacity.max = 1;
      opacity.step = 0.05;
      opacity.value = caseItem.opacity ?? 0.8;

      checkbox.addEventListener('change', () => {
        caseItem.enabled = checkbox.checked;
        loadTimeIndex(timeSliderControl.getValue());
      });

      opacity.addEventListener('input', () => {
        caseItem.opacity = Number(opacity.value);

        const layer = activeImageLayers[caseItem.id];
        if (layer) {
          layer.setOpacity(caseItem.opacity);
        }
      });
    });

    return container;
  }
});

legendControl = L.control({ position: 'bottomright' });

legendControl.onAdd = function () {
  const container = L.DomUtil.create('div', 'info legend');

  container.innerHTML = `
    <strong>Översvämningsdjup (m)</strong><br>
    <i style="background:#ADD8E6"></i> 0.05–0.5<br>
    <i style="background:#0000FF"></i> 0.5–1.0<br>
    <i style="background:#00008B"></i> 1.0–1.5<br>
    <i style="background:#800080"></i> 1.5–2.0<br>
    <i style="background:#FFA500"></i> 2.0–4.0<br>
    <i style="background:#FF0000"></i> 4+
  `;

  return container;
};

async function initApp() {
  try {
    cases = await fetch(casesJsonPath).then(r => r.json());

    for (const caseItem of cases) {
      caseItem.manifest = await fetch(`${caseItem.path}/manifest.json`).then(r => r.json());
      metadataByCase[caseItem.id] = await fetch(`${caseItem.path}/metadata.json`).then(r => r.json());
    }

    timeSteps = cases[0].manifest;

    timeSliderControl = new L.Control.TimeSlider();
    timeSliderControl.addTo(map);
    timeSliderControl.updateMax(timeSteps.length - 1);

    caseControl = new L.Control.CaseControl();
    caseControl.addTo(map);

    legendControl.addTo(map);

    const firstMetadata = metadataByCase[cases[0].id];
    if (firstMetadata?.bounds) {
      map.fitBounds([
        [firstMetadata.bounds.south, firstMetadata.bounds.west],
        [firstMetadata.bounds.north, firstMetadata.bounds.east]
      ]);
    }

    loadTimeIndex(0);

  } catch (err) {
    console.error('Fel vid initiering:', err);
  }
}

initApp();