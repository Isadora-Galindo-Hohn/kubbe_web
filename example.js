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

const casesJsonPath = 'floodmaps_mercator_svg/cases.json';

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
  return `${caseItem.path}/${time}.svg`;
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

const CASE_CATEGORY_LABELS = {
  base: "Base cases",
  sensitivity: "Sensitivity cases",
  combined: "Combined cases"
};

function getCaseCategory(caseItem) {
  return caseItem.category || "base";
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
  const enabledCaseIds = new Set(enabledCases.map(c => c.id));
  const requestId = ++loadRequestId;

  // Ta först bort lager som inte längre är enabled
  Object.keys(activeImageLayers).forEach(caseId => {
    if (!enabledCaseIds.has(caseId)) {
      removeLayerSafe(activeImageLayers[caseId]);
      delete activeImageLayers[caseId];
    }
  });

  Object.keys(pendingImageLayers).forEach(caseId => {
    if (!enabledCaseIds.has(caseId)) {
      removeLayerSafe(pendingImageLayers[caseId]);
      delete pendingImageLayers[caseId];
    }
  });

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
      zIndex: 500,
    });

    pendingImageLayers[caseItem.id] = newLayer;

    newLayer.once("load", () => {
      const stillEnabled = caseItem.enabled === true;
      const isStillLatest = latestRequestByCase[caseItem.id] === requestId;

      if (!stillEnabled || !isStillLatest) {
        removeLayerSafe(newLayer);

        if (pendingImageLayers[caseItem.id] === newLayer) {
          delete pendingImageLayers[caseItem.id];
        }

        return;
      }

      if (oldLayer) {
        removeLayerSafe(oldLayer);
      }

      newLayer.setOpacity(caseItem.opacity ?? 0.8);
      activeImageLayers[caseItem.id] = newLayer;

      if (pendingImageLayers[caseItem.id] === newLayer) {
        delete pendingImageLayers[caseItem.id];
      }
    });

    newLayer.once("error", () => {
      console.warn(`Kunde inte ladda bild: ${imageUrl}`);

      removeLayerSafe(newLayer);

      if (pendingImageLayers[caseItem.id] === newLayer) {
        delete pendingImageLayers[caseItem.id];
      }

      if (oldLayer) {
        removeLayerSafe(oldLayer);
        delete activeImageLayers[caseItem.id];
      }
    });

    newLayer.addTo(map);
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

function createLegend(container) {
  const legend = L.DomUtil.create("div", "legend-section", container);

  legend.innerHTML = `
    <div class="panel-title">Legend</div>

    <div class="legend-item">
      <i style="background:#ADD8E6"></i>
      <span>0.05–0.5 m</span>
    </div>
    <div class="legend-item">
      <i style="background:#0000FF"></i>
      <span>0.5–1.0 m</span>
    </div>
    <div class="legend-item">
      <i style="background:#00008B"></i>
      <span>1.0–1.5 m</span>
    </div>
    <div class="legend-item">
      <i style="background:#800080"></i>
      <span>1.5–2.0 m</span>
    </div>
    <div class="legend-item">
      <i style="background:#FFA500"></i>
      <span>2.0–4.0 m</span>
    </div>
    <div class="legend-item">
      <i style="background:#FF0000"></i>
      <span>4+ m</span>
    </div>
  `;
}

// Case update helpers
function getCaseById(caseId) {
  return cases.find(c => c.id === caseId);
}

function setCaseEnabled(caseId, enabled, shouldReload = true) {
  const caseItem = getCaseById(caseId);
  if (!caseItem) return;

  caseItem.enabled = enabled;

  if (!enabled) {
    if (activeImageLayers[caseId]) {
      removeLayerSafe(activeImageLayers[caseId]);
      delete activeImageLayers[caseId];
    }

    if (pendingImageLayers[caseId]) {
      removeLayerSafe(pendingImageLayers[caseId]);
      delete pendingImageLayers[caseId];
    }

    delete latestRequestByCase[caseId];
  }

  if (shouldReload) {
    loadTimeIndex(timeSliderControl.getValue());
  }

  if (caseControl?.syncUiFromState) {
    caseControl.syncUiFromState();
  }
}

function setCategoryEnabled(category, enabled) {
  cases
    .filter(caseItem => getCaseCategory(caseItem) === category)
    .forEach(caseItem => {
      setCaseEnabled(caseItem.id, enabled, false);
    });

  loadTimeIndex(timeSliderControl.getValue());

  if (caseControl?.syncUiFromState) {
    caseControl.syncUiFromState();
  }
}

function setCaseOpacity(caseId, opacity) {
  const caseItem = getCaseById(caseId);
  if (!caseItem) return;

  caseItem.opacity = opacity;

  const activeLayer = activeImageLayers[caseId];
  if (activeLayer) {
    activeLayer.setOpacity(opacity);
  }

  const pendingLayer = pendingImageLayers[caseId];
  if (pendingLayer) {
    pendingLayer.setOpacity(opacity);
  }

  if (caseControl?.syncUiFromState) {
    caseControl.syncUiFromState();
  }
}
// End of case update helpers

L.Control.CaseControl = L.Control.extend({
  options: { position: "topright" },

  onAdd: function () {
    const container = L.DomUtil.create("div", "left-map-panel");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    this._caseCheckboxes = {};
    this._categoryCheckboxes = {};
    this._opacitySliders = {};
    this._opacityValues = {};

    const layerSection = L.DomUtil.create("div", "layer-section", container);

    const title = L.DomUtil.create("div", "panel-title", layerSection);
    title.textContent = "Lager";

    const layerList = L.DomUtil.create("div", "layer-list", layerSection);

    const groupedCases = cases.reduce((groups, caseItem) => {
      const category = getCaseCategory(caseItem);

      if (!groups[category]) {
        groups[category] = [];
      }

      groups[category].push(caseItem);
      return groups;
    }, {});

    const categoryOrder = ["base", "sensitivity", "combined"];

   categoryOrder.forEach(category => {
      const categoryCases = groupedCases[category];

      if (!categoryCases || categoryCases.length === 0) return;

      const categoryBlock = L.DomUtil.create("div", "case-category is-open", layerList);

      const categoryHeader = L.DomUtil.create("div", "case-category-header", categoryBlock);

      const categoryCheckBox = L.DomUtil.create("input", "case-category-checkbox", categoryHeader);
      categoryCheckBox.type = "checkbox";

      const categoryToggle = L.DomUtil.create("button", "case-category-toggle", categoryHeader);
      categoryToggle.type = "button";
      categoryToggle.textContent = CASE_CATEGORY_LABELS[category] || category;

      const categoryArrow = L.DomUtil.create("span", "case-category-arrow", categoryHeader);
      categoryArrow.textContent = "🡡";

      const categoryContent = L.DomUtil.create("div", "case-category-content", categoryBlock);

      this._categoryCheckboxes[category] = categoryCheckBox;

      let isCategoryOpen = true;

      function setCategoryOpen(open) {
        isCategoryOpen = open;
        categoryBlock.classList.toggle("is-open", isCategoryOpen);
        categoryArrow.textContent = isCategoryOpen ? "🡡" : "🡣";
      }

      categoryToggle.addEventListener("click", () => {
        setCategoryOpen(!isCategoryOpen);
      });

      categoryArrow.addEventListener("click", () => {
        setCategoryOpen(!isCategoryOpen);
      });

      categoryCheckBox.addEventListener("change", () => {
        setCategoryEnabled(category, categoryCheckBox.checked);
      });

      categoryCases.forEach(caseItem => {
        const row = L.DomUtil.create("div", "case-row", categoryContent);

        const header = L.DomUtil.create("div", "case-row-header", row);

        const checkbox = L.DomUtil.create("input", "case-checkbox", header);
        checkbox.type = "checkbox";

        this._caseCheckboxes[caseItem.id] = checkbox;

        checkbox.addEventListener("change", () => {
          setCaseEnabled(caseItem.id, checkbox.checked);
        });

        const label = L.DomUtil.create("button", "case-disclosure-button", header);
        label.type = "button";
        label.textContent = caseItem.name;

        const arrow = L.DomUtil.create("span", "case-disclosure-arrow", header);
        arrow.textContent = "🡣";

        const details = L.DomUtil.create("div", "case-row-details", row);

        const opacityLabel = L.DomUtil.create("label", "opacity-label", details);
        opacityLabel.textContent = "Opacity";

        const opacity = L.DomUtil.create("input", "opacity-slider", details);
        opacity.type = "range";
        opacity.min = 0;
        opacity.max = 1;
        opacity.step = 0.05;

        const opacityValue = L.DomUtil.create("span", "opacity-value", details);

        this._opacitySliders[caseItem.id] = opacity;
        this._opacityValues[caseItem.id] = opacityValue;

        let isOpen = false;

        function setOpen(open) {
          isOpen = open;
          row.classList.toggle("is-open", isOpen);
          arrow.textContent = isOpen ? "🡡" : "🡣";
        }

        label.addEventListener("click", () => {
          setOpen(!isOpen);
        });

        arrow.addEventListener("click", () => {
          setOpen(!isOpen);
        });

        opacity.addEventListener("input", () => {
          setCaseOpacity(caseItem.id, Number(opacity.value));
        });
      });
    });

    createLegend(container);

    this.syncUiFromState();

    return container;
  },

  syncUiFromState: function () {
    cases.forEach(caseItem => {
      const checkbox = this._caseCheckboxes?.[caseItem.id];
      const opacitySlider = this._opacitySliders?.[caseItem.id];
      const opacityValue = this._opacityValues?.[caseItem.id];

      if (checkbox) {
        checkbox.checked = caseItem.enabled === true;
      }

      if (opacitySlider) {
        opacitySlider.value = caseItem.opacity ?? 0.8;
      }

      if (opacityValue) {
        opacityValue.textContent = `${Math.round((caseItem.opacity ?? 0.8) * 100)}%`;
      }
    });

    Object.keys(this._categoryCheckboxes || {}).forEach(category => {
      const categoryCases = cases.filter(caseItem => getCaseCategory(caseItem) === category);
      const categoryCheckbox = this._categoryCheckboxes[category];

      const enabledCount = categoryCases.filter(caseItem => caseItem.enabled).length;

      categoryCheckbox.checked = enabledCount === categoryCases.length;
      categoryCheckbox.indeterminate = enabledCount > 0 && enabledCount < categoryCases.length;
    });
  }
});


L.control.scale({
  position: "topleft",
  metric: true,
  imperial: false
}).addTo(map);

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