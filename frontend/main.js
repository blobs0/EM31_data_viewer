const form = document.getElementById("upload-form");
const fileInput = document.getElementById("file-input");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const fileInfoEl = document.getElementById("file-info");
const mapEl = document.getElementById("map");
const fallbackCanvas = document.getElementById("fallback-canvas");
const legendMin = document.getElementById("legend-min");
const legendMax = document.getElementById("legend-max");
const pointsTableEl = document.getElementById("points-table");
const exportBtn = document.getElementById("export-csv");
const scaleMinInput = document.getElementById("scale-min");
const scaleMaxInput = document.getElementById("scale-max");
const scaleApplyBtn = document.getElementById("scale-apply");
const scaleResetBtn = document.getElementById("scale-reset");
const instHeightInput = document.getElementById("inst-height");
const instHeightApplyBtn = document.getElementById("inst-height-apply");
const instHeightResetBtn = document.getElementById("inst-height-reset");

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
    const linesInfo = lines
        .map(
            (l) =>
                `${l.line_name || "?"}: ${l.readings} mesures, ${l.gps_points} GPS`
        )
        .join("<br>");
    metaEl.innerHTML = `
        <div><strong>Programme:</strong> ${header.program || "?"} ${header.version || ""}</div>
        <div><strong>Mode:</strong> ${header.survey_type || "?"}</div>
        <div><strong>Lignes:</strong><br>${linesInfo || "—"}</div>
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
        `Range: ${properties.range ?? ""}`,
        `Dipôle: ${properties.dipole_mode ?? ""}`,
        `GPS: Q${properties.gps_quality || "?"} (${properties.gps_satellites || "?"} sat.)`,
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
            { title: "Range", field: "range", hozAlign: "left", editor: "input" },
            { title: "Dipôle", field: "dipole_mode", hozAlign: "left", editor: "input" },
            { title: "Sat", field: "gps_satellites", hozAlign: "right", sorter: "number", editor: "input" },
            { title: "HDOP", field: "gps_hdop", hozAlign: "right", sorter: "number", editor: "input", formatter: (cell) => fmtNum(cell.getValue(), 2) },
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
        "range",
        "dipole_mode",
        "marker",
        "station",
        "gps_quality",
        "gps_satellites",
        "gps_hdop",
        "gps_altitude",
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
                p.range,
                p.dipole_mode,
                p.marker,
                p.station,
                p.gps_quality,
                p.gps_satellites,
                p.gps_hdop,
                p.gps_altitude,
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

function updateFileInfo(payload) {
    const header = payload.header || {};
    const name = header.file_name || "inconnu";
    const version = header.version || "?";
    fileInfoEl.textContent = `Fichier: ${name} · Version: ${version}`;
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
});

instHeightResetBtn?.addEventListener("click", () => {
    if (instHeightInput) instHeightInput.value = "0.15";
    applyInstHeight(0.15);
});

// Layout is fixed via CSS (no splitters / no dynamic resizing).
