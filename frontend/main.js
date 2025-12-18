const form = document.getElementById("upload-form");
const fileInput = document.getElementById("file-input");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const fileInfoEl = document.getElementById("file-info");
const mapEl = document.getElementById("map");
const mapLayoutEl = document.querySelector(".map-layout");
const mapTableSplitterEl = document.getElementById("map-table-splitter");
const fallbackCanvas = document.getElementById("fallback-canvas");
const legendMin = document.getElementById("legend-min");
const legendMax = document.getElementById("legend-max");
const pointsTableEl = document.getElementById("points-table");
const exportBtn = document.getElementById("export-csv");
const openDisplayModalBtn = document.getElementById("open-display-modal");
const displayModalEl = document.getElementById("display-modal");
const displayModalCloseBtn = document.getElementById("display-modal-close");
const colRangeCheckbox = document.getElementById("col-range");
const colDipoleCheckbox = document.getElementById("col-dipole");
const colSatCheckbox = document.getElementById("col-sat");
const colHdopCheckbox = document.getElementById("col-hdop");
const openHeightModalBtn = document.getElementById("open-height-modal");
const heightModalEl = document.getElementById("height-modal");
const heightModalCloseBtn = document.getElementById("height-modal-close");
const scaleMinInput = document.getElementById("scale-min");
const scaleMaxInput = document.getElementById("scale-max");
const scaleApplyBtn = document.getElementById("scale-apply");
const scaleResetBtn = document.getElementById("scale-reset");
const instHeightInput = document.getElementById("inst-height");
const instHeightApplyBtn = document.getElementById("inst-height-apply");
const instHeightResetBtn = document.getElementById("inst-height-reset");
const openDrillModalBtn = document.getElementById("open-drill-modal");
const drillModalEl = document.getElementById("drill-modal");
const drillModalCloseBtn = document.getElementById("drill-modal-close");
const drillForm = document.getElementById("drill-form");
const drillLatInput = document.getElementById("drill-lat");
const drillLonInput = document.getElementById("drill-lon");
const drillThicknessInput = document.getElementById("drill-thickness");
const drillClearBtn = document.getElementById("drill-clear");
const drillListEl = document.getElementById("drill-list");

let map;
let dataLayer;
let tileLayer;
let scaleControl;
let autoScale = null;
let manualScale = null;
let lastGeojson = null;
let currentInstHeight = 0.15;
let nextRowId = 1;
let pointsTable = null;
let pointsTableReady = null;
let readingsById = new Map();
let selectedRowId = null;
let markerByRowId = new Map();
let tableSyncLock = false;
let drillingPoints = [];
let drillingLayer = null;
let drillingMarkerById = new Map();
let nextDrillingId = 1;

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    statusEl.textContent = "Envoi...";
    const fd = new FormData();
    fd.append("file", file);
    try {
        const instHeight = readInstHeightOrDefault();
        currentInstHeight = instHeight;
        nextRowId = 1;
        const res = await fetch(`/api/upload?inst_height=${encodeURIComponent(instHeight)}`, {
            method: "POST",
            body: fd,
        });
        if (!res.ok) {
            throw new Error(`Upload échoué (${res.status})`);
        }
        const payload = await res.json();
        statusEl.textContent = "OK";
        lastGeojson = payload.geojson;
        prepareGeojson(lastGeojson, instHeight);
        rebuildReadingIndex(lastGeojson);
        updateMeta(payload);
        renderData(lastGeojson);
        fillTable(lastGeojson);
        updateFileInfo(payload);
    } catch (err) {
        console.error(err);
        statusEl.textContent = `Erreur: ${err.message}`;
    }
});

function readInstHeightOrDefault() {
    if (!instHeightInput) return 0.15;
    const v = parseFloat(instHeightInput.value);
    if (!Number.isFinite(v)) return 0.15;
    if (v < 0) {
        alert("Hauteur de l'EM31 invalide (>= 0).");
        return 0.15;
    }
    return v;
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function prepareGeojson(featureCollection, instHeight) {
    if (!featureCollection || !Array.isArray(featureCollection.features)) return;
    featureCollection.features.forEach((feature) => {
        if (!feature || !feature.properties) return;
        if (feature.properties.kind !== "reading") return;
        if (!feature.properties._row_id) {
            feature.properties._row_id = `r${nextRowId++}`;
        }
        const thicknessValue = feature.properties.thickness;
        if (typeof thicknessValue === "number" && Number.isFinite(thicknessValue)) {
            feature.properties._base_thickness = thicknessValue + instHeight;
        } else if (feature.properties._base_thickness === undefined) {
            feature.properties._base_thickness = null;
        }
    });
}

function rebuildReadingIndex(featureCollection) {
    readingsById = new Map();
    if (!featureCollection || !Array.isArray(featureCollection.features)) return;
    featureCollection.features.forEach((feature) => {
        if (!feature || !feature.properties) return;
        if (feature.properties.kind !== "reading") return;
        const id = feature.properties._row_id;
        if (id) readingsById.set(id, feature);
    });
}

function updateMeta(payload) {
    const header = payload.header || {};
    const lines = payload.lines || [];
    const totalReadings = lines.reduce((sum, l) => sum + (Number(l.readings) || 0), 0);
    const totalGps = lines.reduce((sum, l) => sum + (Number(l.gps_points) || 0), 0);
    const lineNames = lines.map((l) => l.line_name || "?").filter(Boolean);
    const linesLabel =
        lineNames.length <= 3 ? lineNames.join(", ") : `${lineNames.length} lignes`;
    metaEl.innerHTML = `
        <div class="meta-item meta-lines"><strong>Lignes:</strong> <span class="meta-value">${linesLabel || "—"}</span></div>
        <div class="meta-item"><strong>Mesures:</strong> <span class="meta-value">${lines.length ? totalReadings : "—"}</span></div>
        <div class="meta-item"><strong>GPS:</strong> <span class="meta-value">${lines.length ? totalGps : "—"}</span></div>
    `;
}

function renderData(featureCollection) {
    autoScale = conductivityStats(featureCollection);
    manualScale = null;
    setScaleInputs(autoScale);
    const scale = getScale();
    lastGeojson = featureCollection;
    if (window.L) {
        renderLeaflet(featureCollection, scale, { fitBounds: true });
    } else {
        renderFallback(featureCollection, scale);
        statusEl.textContent += " | Leaflet non trouvé (ajouter vendor/leaflet.js & .css)";
    }
}

function renderLeaflet(featureCollection, scale, { fitBounds } = {}) {
    fallbackCanvas.style.display = "none";
    mapEl.style.display = "block";
    if (!map) {
        map = L.map(mapEl);
        scaleControl = L.control.scale({ imperial: false, position: "bottomleft" });
        scaleControl.addTo(map);
    }
    if (!tileLayer) {
        tileLayer = L.tileLayer("/tiles/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "",
            errorTileUrl: "",
        });
        tileLayer.addTo(map);
    }
    ensureDrillingLayer();
    if (dataLayer) {
        dataLayer.remove();
    }
    const condStats = scale;
    markerByRowId = new Map();
    const geoJson = L.geoJSON(featureCollection, {
        pointToLayer: (feature, latlng) => {
            if (feature.properties.kind !== "reading") return null;
            const color = conductivityColor(
                feature.properties.conductivity,
                condStats
            );
            const marker = L.circleMarker(latlng, {
                radius: 5,
                color,
                fillColor: color,
                fillOpacity: 0.8,
                weight: 1,
            });
            marker.bindPopup(readingPopupHtml(feature.properties));
            if (feature.properties._row_id) {
                markerByRowId.set(feature.properties._row_id, marker);
            }
            marker.on("click", () => {
                selectRowInTable(feature.properties._row_id);
            });
            return marker;
        },
        style: (feature) => {
            if (feature.properties.kind === "track") {
                return { color: "#2c7be5", weight: 2 };
            }
            return {};
        },
        filter: (feature) => feature.geometry && feature.properties,
    });
    geoJson.addTo(map);
    dataLayer = geoJson;
    if (fitBounds !== false) {
        fitToBounds(map, featureCollection);
    }
    updateLegend(condStats);
}

function readingPopupHtml(properties) {
    return [
        `Cond: ${fmtNum(properties.conductivity, 3)} mS/m`,
        `Épaisseur: ${fmtNum(properties.thickness, 3)} m`,
        `Inphase: ${fmtNum(properties.inphase, 3)} ppt`,
        `GPS: Q${properties.gps_quality || "?"}`,
    ].join("<br>");
}

function updateLeafletMarker(rowId) {
    if (!window.L || !rowId) return;
    const feature = readingsById.get(rowId);
    const marker = markerByRowId.get(rowId);
    if (!feature || !marker) return;
    const scale = getScale();
    const color = conductivityColor(feature.properties.conductivity, scale);
    if (marker.setStyle) {
        marker.setStyle({ color, fillColor: color });
    }
    const popup = marker.getPopup?.();
    popup?.setContent(readingPopupHtml(feature.properties));
}

function openPopupForRow(rowId) {
    if (!window.L || !rowId) return;
    const marker = markerByRowId.get(rowId);
    marker?.openPopup?.();
}

function fitToBounds(map, fc) {
    if (fc.bounds) {
        const [[west, south], [east, north]] = [
            [fc.bounds[0], fc.bounds[1]],
            [fc.bounds[2], fc.bounds[3]],
        ];
        map.fitBounds(
            [
                [south, west],
                [north, east],
            ],
            { padding: [20, 20] }
        );
        return;
    }
    const layerBounds = dataLayer && dataLayer.getBounds && dataLayer.getBounds();
    if (layerBounds && layerBounds.isValid()) {
        map.fitBounds(layerBounds, { padding: [20, 20] });
    }
}

function renderFallback(featureCollection, scale) {
    mapEl.style.display = "none";
    fallbackCanvas.style.display = "block";
    const ctx = fallbackCanvas.getContext("2d");
    const w = mapEl.clientWidth || 800;
    const h = mapEl.clientHeight || 500;
    fallbackCanvas.width = w;
    fallbackCanvas.height = h;
    ctx.clearRect(0, 0, w, h);
    const condStats = scale;
    const coords = featureCollection.features
        .filter((f) => f.geometry && f.geometry.type === "Point")
        .map((f) => f.geometry.coordinates);
    if (!coords.length) return;
    const bounds = featureCollection.bounds || computeBounds(coords);
    const [minLon, minLat, maxLon, maxLat] = bounds;
    const scaleX = w / Math.max(maxLon - minLon, 1e-6);
    const scaleY = h / Math.max(maxLat - minLat, 1e-6);
    const project = ([lon, lat]) => [
        (lon - minLon) * scaleX,
        h - (lat - minLat) * scaleY,
    ];
    featureCollection.features
        .filter((f) => f.geometry && f.geometry.type === "LineString")
        .forEach((f) => {
            ctx.strokeStyle = "#2c7be5";
            ctx.lineWidth = 2;
            ctx.beginPath();
            f.geometry.coordinates.forEach((c, idx) => {
                const [x, y] = project(c);
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        });
    featureCollection.features
        .filter((f) => f.properties.kind === "reading")
        .forEach((f) => {
            const [x, y] = project(f.geometry.coordinates);
            ctx.beginPath();
            const color = conductivityColor(
                f.properties.conductivity,
                condStats
            );
            ctx.fillStyle = color;
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
    drawDrillingPointsFallback(ctx, project);
    updateLegend(condStats);
}

function conductivityStats(fc) {
    const values = fc.features
        .map((f) => f.properties.conductivity)
        .filter((v) => typeof v === "number");
    if (!values.length) return { min: 0, max: 0 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 1e-6);
    const pad = range * 0.05;
    return { min: min - pad, max: max + pad };
}

function conductivityColor(value, stats) {
    if (typeof value !== "number" || stats.max === stats.min) {
        return "#888";
    }
    const t = (value - stats.min) / (stats.max - stats.min);
    const clamped = Math.max(0, Math.min(1, t));
    return gradientColor(clamped);
}

function gradientColor(t) {
    const r = Math.round(255 * t);
    const g = Math.round(140 * (1 - t));
    const b = Math.round(255 * (1 - t));
    return `rgb(${r},${g},${b})`;
}

function updateLegend(stats) {
    legendMin.textContent = `${fmtNum(stats.min, 2)} mS/m`;
    legendMax.textContent = `${fmtNum(stats.max, 2)} mS/m`;
}

function fmtNum(value, digits = 2) {
    if (typeof value !== "number" || Number.isNaN(value)) return "—";
    return value.toFixed(digits);
}

function computeBounds(coords) {
    const lats = coords.map((c) => c[1]);
    const lons = coords.map((c) => c[0]);
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

function getScale() {
    if (manualScale && typeof manualScale.min === "number" && typeof manualScale.max === "number") {
        return manualScale;
    }
    return autoScale || { min: 0, max: 0 };
}

scaleApplyBtn.addEventListener("click", () => {
    const min = parseFloat(scaleMinInput.value);
    const max = parseFloat(scaleMaxInput.value);
    if (isNaN(min) || isNaN(max) || min >= max) {
        alert("Valeurs d'échelle invalides (min < max).");
        return;
    }
    manualScale = { min, max };
    rerenderWithScale();
});

scaleResetBtn.addEventListener("click", () => {
    manualScale = null;
    setScaleInputs(autoScale || { min: "", max: "" });
    rerenderWithScale();
});

function rerenderWithScale() {
    if (!lastGeojson) return;
    const fc = lastGeojson;
    const scale = getScale();
    if (window.L) {
        renderLeaflet(fc, scale, { fitBounds: true });
    } else {
        renderFallback(fc, scale);
    }
    updateLegend(scale);
}

function rerenderWithScaleOptions({ fitBounds }) {
    if (!lastGeojson) return;
    const fc = lastGeojson;
    const scale = getScale();
    if (window.L) {
        renderLeaflet(fc, scale, { fitBounds });
    } else {
        renderFallback(fc, scale);
    }
    updateLegend(scale);
}

function parseNullableNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    const str = String(value).trim();
    if (!str) return null;
    const normalized = str.replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableString(value) {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return str ? str : null;
}

function deleteReadingById(rowId) {
    if (!lastGeojson || !Array.isArray(lastGeojson.features) || !rowId) return false;
    lastGeojson.features = lastGeojson.features.filter((f) => !(f?.properties?.kind === "reading" && f.properties._row_id === rowId));
    readingsById.delete(rowId);
    markerByRowId.get(rowId)?.remove?.();
    markerByRowId.delete(rowId);
    if (selectedRowId === rowId) selectedRowId = null;
    return true;
}

function handleTableCellEdited(cell) {
    if (tableSyncLock) return;
    if (!cell) return;
    const row = cell.getRow?.();
    const rowData = row?.getData?.();
    const rowId = rowData?.id;
    const field = cell.getField?.();
    if (!rowId || !field) return;
    const feature = readingsById.get(rowId);
    if (!feature || !feature.properties) return;

    tableSyncLock = true;
    try {
        const currentValue = cell.getValue?.();
        let value = currentValue;
        const numericFields = new Set([
            "conductivity",
            "thickness",
            "inphase",
            "gps_satellites",
            "gps_hdop",
        ]);
        if (numericFields.has(field)) {
            value = parseNullableNumber(value);
        } else {
            value = parseNullableString(value);
        }

        // Normalize the value inside the table (keep numbers as numbers for formatting/sorting).
        if (value !== currentValue) {
            cell.setValue?.(value, true);
        }

        if (field === "thickness") {
            feature.properties.thickness = value;
            feature.properties._base_thickness = typeof value === "number" ? value + currentInstHeight : null;
        } else if (field === "lat" || field === "lon") {
            // Not editable in UI, but keep this guard for safety.
        } else {
            feature.properties[field] = value;
        }
    } finally {
        tableSyncLock = false;
    }

    updateLeafletMarker(rowId);
}

function ensurePointsTable() {
    if (pointsTable || !pointsTableEl) return;
    if (!window.Tabulator) {
        console.warn("Tabulator non trouvé (frontend/vendor/tabulator.min.js)");
        return;
    }
    let built = false;
    let resolveBuilt;
    pointsTableReady = new Promise((resolve) => {
        resolveBuilt = resolve;
    });
    const markBuilt = () => {
        if (built) return;
        built = true;
        resolveBuilt?.();
    };

    pointsTable = new Tabulator(pointsTableEl, {
        height: "100%",
        layout: "fitDataFill",
        index: "id",
        selectableRows: 1,
        columns: [
            { formatter: "rownum", headerSort: false, width: 50, hozAlign: "right" },
            { title: "Temps (ms)", field: "time_ms", hozAlign: "right", sorter: "number" },
            { title: "Lat", field: "lat", hozAlign: "right", sorter: "number", formatter: (cell) => fmtNum(cell.getValue(), 6), editable: false },
            { title: "Lon", field: "lon", hozAlign: "right", sorter: "number", formatter: (cell) => fmtNum(cell.getValue(), 6), editable: false },
            { title: "Cond (mS/m)", field: "conductivity", hozAlign: "right", sorter: "number", editor: "input", formatter: (cell) => fmtNum(cell.getValue(), 3) },
            { title: "Épaisseur (m)", field: "thickness", hozAlign: "right", sorter: "number", editor: "input", formatter: (cell) => fmtNum(cell.getValue(), 3) },
            { title: "Inphase (ppt)", field: "inphase", hozAlign: "right", sorter: "number", editor: "input", formatter: (cell) => fmtNum(cell.getValue(), 3) },
            { title: "Range", field: "range", hozAlign: "left", editor: "input", visible: false },
            { title: "Dipôle", field: "dipole_mode", hozAlign: "left", editor: "input", visible: false },
            { title: "Sat", field: "gps_satellites", hozAlign: "right", sorter: "number", editor: "input", visible: false },
            { title: "HDOP", field: "gps_hdop", hozAlign: "right", sorter: "number", editor: "input", formatter: (cell) => fmtNum(cell.getValue(), 2), visible: false },
        ],
    });

    // Tabulator v6 dispatches this as an external event (not an option callback).
    pointsTable.on?.("tableBuilt", markBuilt);
    // Fallback: unblock even if the event doesn't fire (we retry data injection if needed).
    setTimeout(markBuilt, 0);

    pointsTable.on?.("cellEdited", handleTableCellEdited);
    pointsTable.on?.("rowSelected", (row) => {
        const data = row?.getData?.();
        if (data?.id) {
            selectedRowId = data.id;
            openPopupForRow(data.id);
        }
    });
}

function selectRowInTable(rowId, { scrollTo = true } = {}) {
    ensurePointsTable();
    if (!pointsTable || !rowId) return;
    if (!pointsTableReady) pointsTableReady = Promise.resolve();
    pointsTableReady
        .then(() => {
            selectedRowId = rowId;
            pointsTable.deselectRow();
            pointsTable.selectRow(rowId);
            if (scrollTo) {
                pointsTable.scrollToRow(rowId, "center", true);
            }
        })
        .catch((err) => console.error(err));
}

function fillTable(featureCollection) {
    ensurePointsTable();
    if (!pointsTable || !featureCollection || !Array.isArray(featureCollection.features)) return;
    if (!pointsTableReady) pointsTableReady = Promise.resolve();
    const rows = featureCollection.features
        .filter((f) => f.properties && f.properties.kind === "reading")
        .map((f) => {
            const p = f.properties;
            const [lon, lat] = f.geometry.coordinates;
            return {
                id: p._row_id,
                time_ms: p.time_ms ?? null,
                lat,
                lon,
                conductivity: p.conductivity ?? null,
                thickness: p.thickness ?? null,
                inphase: p.inphase ?? null,
                range: p.range ?? null,
                dipole_mode: p.dipole_mode ?? null,
                gps_satellites: p.gps_satellites ?? null,
                gps_hdop: p.gps_hdop ?? null,
            };
        });
    pointsTableReady
        .then(() => {
            const tryReplaceData = (attempt = 0) => {
                const maxAttempts = 120;
                try {
                    const restoreSelection = () => {
                        if (selectedRowId) {
                            selectRowInTable(selectedRowId, { scrollTo: false });
                        }
                    };
                    const result = pointsTable.replaceData(rows);
                    if (result && typeof result.then === "function") {
                        result.then(restoreSelection).catch((err) => {
                            if (attempt >= maxAttempts) {
                                console.error(err);
                                return;
                            }
                            setTimeout(() => tryReplaceData(attempt + 1), 50);
                        });
                        return;
                    }
                    restoreSelection();
                } catch (err) {
                    if (attempt >= maxAttempts) {
                        console.error(err);
                        return;
                    }
                    setTimeout(() => tryReplaceData(attempt + 1), 50);
                }
            };

            tryReplaceData();
        })
        .catch((err) => console.error(err));
}

exportBtn.addEventListener("click", () => {
    if (!lastGeojson || !Array.isArray(lastGeojson.features)) return;
    const readings = lastGeojson.features.filter((f) => f.properties && f.properties.kind === "reading");
    const header = [
        "time_ms",
        "lat",
        "lon",
        "conductivity",
        "thickness",
        "inphase",
    ];
    const lines = [header.join(",")];
    readings.forEach((f) => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        lines.push(
            [
                p.time_ms,
                lat,
                lon,
                p.conductivity,
                p.thickness,
                p.inphase,
            ]
                .map((v) => (v === null || v === undefined ? "" : v))
                .join(",")
        );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "em31_points.csv";
    a.click();
    URL.revokeObjectURL(url);
});

function setTabulatorColumnVisible(field, visible) {
    ensurePointsTable();
    if (!pointsTable) return;
    const col = pointsTable.getColumn?.(field);
    if (!col) return;
    if (visible) col.show?.();
    else col.hide?.();
}

function getTabulatorColumnVisible(field) {
    ensurePointsTable();
    if (!pointsTable) return false;
    const col = pointsTable.getColumn?.(field);
    if (!col) return false;
    const visible = col.isVisible?.();
    if (typeof visible === "boolean") return visible;
    const def = col.getDefinition?.();
    return def?.visible !== false;
}

function syncDisplayModalState() {
    if (colRangeCheckbox) colRangeCheckbox.checked = getTabulatorColumnVisible("range");
    if (colDipoleCheckbox) colDipoleCheckbox.checked = getTabulatorColumnVisible("dipole_mode");
    if (colSatCheckbox) colSatCheckbox.checked = getTabulatorColumnVisible("gps_satellites");
    if (colHdopCheckbox) colHdopCheckbox.checked = getTabulatorColumnVisible("gps_hdop");
}

function openDisplayModal() {
    if (!displayModalEl) return;
    displayModalEl.classList.remove("is-hidden");
    syncDisplayModalState();
}

function closeDisplayModal() {
    displayModalEl?.classList?.add("is-hidden");
}

function openHeightModal() {
    if (!heightModalEl) return;
    heightModalEl.classList.remove("is-hidden");
    instHeightInput?.focus?.();
}

function closeHeightModal() {
    heightModalEl?.classList?.add("is-hidden");
}

openDisplayModalBtn?.addEventListener("click", openDisplayModal);
displayModalCloseBtn?.addEventListener("click", closeDisplayModal);
displayModalEl?.addEventListener("click", (e) => {
    if (e.target === displayModalEl) closeDisplayModal();
});

openHeightModalBtn?.addEventListener("click", openHeightModal);
heightModalCloseBtn?.addEventListener("click", closeHeightModal);
heightModalEl?.addEventListener("click", (e) => {
    if (e.target === heightModalEl) closeHeightModal();
});

colRangeCheckbox?.addEventListener("change", () => setTabulatorColumnVisible("range", !!colRangeCheckbox.checked));
colDipoleCheckbox?.addEventListener("change", () => setTabulatorColumnVisible("dipole_mode", !!colDipoleCheckbox.checked));
colSatCheckbox?.addEventListener("change", () => setTabulatorColumnVisible("gps_satellites", !!colSatCheckbox.checked));
colHdopCheckbox?.addEventListener("change", () => setTabulatorColumnVisible("gps_hdop", !!colHdopCheckbox.checked));

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

let pendingPaneResizeFrame = null;

function schedulePaneResizeRefresh() {
    if (pendingPaneResizeFrame) return;
    pendingPaneResizeFrame = requestAnimationFrame(() => {
        pendingPaneResizeFrame = null;
        if (window.L && map?.invalidateSize) {
            map.invalidateSize();
        }
        pointsTable?.redraw?.(true);
    });
}

function setTablePaneWidthPercent(percent) {
    if (!mapLayoutEl) return;
    const clamped = clampNumber(percent, 12, 80);
    mapLayoutEl.style.setProperty("--table-pane-width", `${clamped}%`);
    try {
        localStorage.setItem("em31_table_pane_pct", String(clamped));
    } catch {
        // ignore
    }
    schedulePaneResizeRefresh();
}

function setupTableSplitter() {
    if (!mapLayoutEl || !mapTableSplitterEl) return;
    const stored = Number.parseFloat(localStorage.getItem("em31_table_pane_pct"));
    if (Number.isFinite(stored)) {
        setTablePaneWidthPercent(stored);
    }

    let dragging = false;
    const onMove = (e) => {
        if (!dragging) return;
        const rect = mapLayoutEl.getBoundingClientRect();
        if (!rect.width) return;
        const tableWidthPx = rect.right - e.clientX;
        const pct = (tableWidthPx / rect.width) * 100;
        setTablePaneWidthPercent(pct);
        e.preventDefault();
    };
    const stop = () => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove("is-resizing");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", stop);
    };
    mapTableSplitterEl.addEventListener("mousedown", (e) => {
        dragging = true;
        document.body.classList.add("is-resizing");
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", stop);
        e.preventDefault();
    });
}

setupTableSplitter();

function updateFileInfo(payload) {
    const header = payload.header || {};
    const name = header.file_name || "inconnu";
    const version = header.version || "?";
    const program = header.program || "?";
    const mode = header.survey_type || "?";
    fileInfoEl.textContent = `Fichier: ${name} · Version: ${version} · Programme: ${program} · Mode: ${mode}`;
}

function setScaleInputs(scale) {
    if (!scale) return;
    if (typeof scale.min === "number") {
        scaleMinInput.value = scale.min.toFixed(2);
    }
    if (typeof scale.max === "number") {
        scaleMaxInput.value = scale.max.toFixed(2);
    }
}

function applyInstHeight(newHeight) {
    currentInstHeight = newHeight;
    if (!lastGeojson) return;
    (lastGeojson.features || []).forEach((feature) => {
        if (!feature || !feature.properties || feature.properties.kind !== "reading") return;
        const base = feature.properties._base_thickness;
        if (typeof base !== "number" || !Number.isFinite(base)) {
            feature.properties.thickness = null;
            return;
        }
        feature.properties.thickness = base - newHeight;
    });
    rerenderWithScaleOptions({ fitBounds: false });
    fillTable(lastGeojson);
}

function isEditingElement(el) {
    if (!el) return false;
    const tag = el.tagName;
    return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable === true
    );
}

document.addEventListener("keydown", (e) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (isEditingElement(e.target)) return;
    ensurePointsTable();
    if (!pointsTable) return;
    const selectedRows = pointsTable.getSelectedRows?.() || [];
    if (!selectedRows.length) return;
    const confirmMsg =
        selectedRows.length === 1
            ? "Supprimer la ligne sélectionnée ?"
            : `Supprimer ${selectedRows.length} lignes sélectionnées ?`;
    if (!confirm(confirmMsg)) return;
    e.preventDefault();
    selectedRows.forEach((row) => {
        const data = row?.getData?.();
        if (data?.id) {
            deleteReadingById(data.id);
        }
        row?.delete?.();
    });
});

instHeightApplyBtn?.addEventListener("click", () => {
    const h = readInstHeightOrDefault();
    applyInstHeight(h);
    closeHeightModal();
});

instHeightResetBtn?.addEventListener("click", () => {
    if (instHeightInput) instHeightInput.value = "0.15";
    applyInstHeight(0.15);
    closeHeightModal();
});

function ensureDrillingLayer() {
    if (!window.L || !map) return;
    if (drillingLayer) return;
    drillingLayer = L.layerGroup();
    drillingLayer.addTo(map);
    renderAllDrillingMarkers();
}

function drillPointPopupHtml(point) {
    return [
        `<strong>${escapeHtml(point.id)}</strong>`,
        `Épaisseur: ${fmtNum(point.thickness, 2)} m`,
        `GPS: ${fmtNum(point.lat, 6)}, ${fmtNum(point.lon, 6)}`,
    ].join("<br>");
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function makeDrillMarker(lat, lon) {
    if (!window.L || !map) return null;
    const icon = L.divIcon({
        className: "drill-marker",
        html: '<div class="drill-marker-inner"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
    });
    return L.marker([lat, lon], { icon, keyboard: true });
}

function renderAllDrillingMarkers() {
    if (!window.L || !map || !drillingLayer) return;
    drillingLayer.clearLayers?.();
    drillingMarkerById = new Map();
    drillingPoints.forEach((point) => {
        const marker = makeDrillMarker(point.lat, point.lon);
        if (!marker) return;
        marker.bindPopup(drillPointPopupHtml(point));
        marker.on("click", () => marker.openPopup?.());
        marker.addTo(drillingLayer);
        drillingMarkerById.set(point.id, marker);
    });
}

function addDrillingPoint(point) {
    drillingPoints.push(point);
    if (window.L && map) {
        ensureDrillingLayer();
        const marker = makeDrillMarker(point.lat, point.lon);
        if (marker) {
            marker.bindPopup(drillPointPopupHtml(point));
            marker.addTo(drillingLayer);
            drillingMarkerById.set(point.id, marker);
            marker.openPopup?.();
        }
    }
    renderDrillingList();
}

function removeDrillingPointById(id) {
    drillingPoints = drillingPoints.filter((p) => p.id !== id);
    drillingMarkerById.get(id)?.remove?.();
    drillingMarkerById.delete(id);
    renderDrillingList();
}

function clearDrillingPoints() {
    drillingPoints = [];
    drillingMarkerById.forEach((marker) => marker?.remove?.());
    drillingMarkerById = new Map();
    drillingLayer?.clearLayers?.();
    renderDrillingList();
}

function zoomToDrillPoint(id) {
    const point = drillingPoints.find((p) => p.id === id);
    if (!point) return;
    if (window.L && map) {
        map.setView([point.lat, point.lon], Math.max(map.getZoom?.() || 0, 16), { animate: true });
        const marker = drillingMarkerById.get(id);
        marker?.openPopup?.();
    }
}

function renderDrillingList() {
    if (!drillListEl) return;
    drillListEl.innerHTML = "";
    drillingPoints.forEach((point) => {
        const tr = document.createElement("tr");
        const latTd = document.createElement("td");
        latTd.textContent = fmtNum(point.lat, 6);
        const lonTd = document.createElement("td");
        lonTd.textContent = fmtNum(point.lon, 6);
        const thickTd = document.createElement("td");
        thickTd.textContent = fmtNum(point.thickness, 2);
        const actionsTd = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "row-actions";
        const zoomBtn = document.createElement("button");
        zoomBtn.type = "button";
        zoomBtn.className = "btn-secondary";
        zoomBtn.textContent = "Zoom";
        zoomBtn.addEventListener("click", () => zoomToDrillPoint(point.id));
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn-secondary";
        delBtn.textContent = "Supprimer";
        delBtn.addEventListener("click", () => removeDrillingPointById(point.id));
        actions.appendChild(zoomBtn);
        actions.appendChild(delBtn);
        actionsTd.appendChild(actions);

        tr.appendChild(latTd);
        tr.appendChild(lonTd);
        tr.appendChild(thickTd);
        tr.appendChild(actionsTd);
        drillListEl.appendChild(tr);
    });
}

function openDrillModal() {
    if (!drillModalEl) return;
    drillModalEl.classList.remove("is-hidden");
    renderDrillingList();
    drillLatInput?.focus?.();
}

function closeDrillModal() {
    drillModalEl?.classList?.add("is-hidden");
}

function readRequiredNumber(inputEl, label, { min = null, max = null } = {}) {
    const value = parseNullableNumber(inputEl?.value);
    if (typeof value !== "number") {
        alert(`${label} invalide.`);
        inputEl?.focus?.();
        return null;
    }
    if (min !== null && value < min) {
        alert(`${label} invalide (>= ${min}).`);
        inputEl?.focus?.();
        return null;
    }
    if (max !== null && value > max) {
        alert(`${label} invalide (<= ${max}).`);
        inputEl?.focus?.();
        return null;
    }
    return value;
}

function drawDrillingPointsFallback(ctx, project) {
    if (!ctx || !project || !drillingPoints.length) return;
    drillingPoints.forEach((p) => {
        const [x, y] = project([p.lon, p.lat]);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "#f59e0b";
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(-6, -6, 12, 12);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    });
}

openDrillModalBtn?.addEventListener("click", () => openDrillModal());
drillModalCloseBtn?.addEventListener("click", () => closeDrillModal());
drillModalEl?.addEventListener("click", (e) => {
    if (e.target === drillModalEl) closeDrillModal();
});
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (drillModalEl && !drillModalEl.classList.contains("is-hidden")) {
        closeDrillModal();
        return;
    }
    if (heightModalEl && !heightModalEl.classList.contains("is-hidden")) {
        closeHeightModal();
        return;
    }
    if (displayModalEl && !displayModalEl.classList.contains("is-hidden")) {
        closeDisplayModal();
    }
});

drillClearBtn?.addEventListener("click", () => {
    if (!drillingPoints.length) return;
    if (!confirm("Vider tous les points de forage ?")) return;
    clearDrillingPoints();
});

drillForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const lat = readRequiredNumber(drillLatInput, "Latitude", { min: -90, max: 90 });
    if (lat === null) return;
    const lon = readRequiredNumber(drillLonInput, "Longitude", { min: -180, max: 180 });
    if (lon === null) return;
    const thickness = readRequiredNumber(drillThicknessInput, "Épaisseur", { min: 0 });
    if (thickness === null) return;

    const point = {
        id: `pf${nextDrillingId++}`,
        lat,
        lon,
        thickness,
        createdAt: Date.now(),
    };
    addDrillingPoint(point);

    if (drillLatInput) drillLatInput.value = "";
    if (drillLonInput) drillLonInput.value = "";
    if (drillThicknessInput) drillThicknessInput.value = "";
    drillLatInput?.focus?.();
});

// Layout is fixed via CSS (no splitters / no dynamic resizing).
