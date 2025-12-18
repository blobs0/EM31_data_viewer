const form = document.getElementById("upload-form");
const fileInput = document.getElementById("file-input");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const fileInfoEl = document.getElementById("file-info");
const mapEl = document.getElementById("map");
const fallbackCanvas = document.getElementById("fallback-canvas");
const legendMin = document.getElementById("legend-min");
const legendMax = document.getElementById("legend-max");
const tableBody = document.querySelector("#points-table tbody");
const exportBtn = document.getElementById("export-csv");
const scaleMinInput = document.getElementById("scale-min");
const scaleMaxInput = document.getElementById("scale-max");
const scaleApplyBtn = document.getElementById("scale-apply");
const scaleResetBtn = document.getElementById("scale-reset");
const mapLayout = document.querySelector(".map-layout");
const layoutSplitter = document.getElementById("layout-splitter");
const heightSplitter = document.getElementById("height-splitter");

let map;
let dataLayer;
let tileLayer;
let scaleControl;
let lastFeatures = [];
let autoScale = null;
let manualScale = null;
let lastGeojson = null;

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    statusEl.textContent = "Envoi...";
    const fd = new FormData();
    fd.append("file", file);
    try {
        const res = await fetch("/api/upload", {
            method: "POST",
            body: fd,
        });
        if (!res.ok) {
            throw new Error(`Upload échoué (${res.status})`);
        }
        const payload = await res.json();
        statusEl.textContent = "OK";
        updateMeta(payload);
        renderData(payload.geojson);
        fillTable(payload.geojson);
        updateFileInfo(payload);
        setMapWidth(65, false);
        setPaneHeight(480, false);
    } catch (err) {
        console.error(err);
        statusEl.textContent = `Erreur: ${err.message}`;
    }
});

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
        renderLeaflet(featureCollection, scale);
    } else {
        renderFallback(featureCollection, scale);
        statusEl.textContent += " | Leaflet non trouvé (ajouter vendor/leaflet.js & .css)";
    }
    lastFeatures = featureCollection.features || [];
}

function renderLeaflet(featureCollection, scale) {
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
    const geoJson = L.geoJSON(featureCollection, {
        pointToLayer: (feature, latlng) => {
            if (feature.properties.kind !== "reading") return null;
            const color = conductivityColor(
                feature.properties.conductivity,
                condStats
            );
            return L.circleMarker(latlng, {
                radius: 5,
                color,
                fillColor: color,
                fillOpacity: 0.8,
                weight: 1,
            }).bindPopup(
                [
                    `Cond: ${fmtNum(feature.properties.conductivity, 3)} mS/m`,
                    `Épaisseur: ${fmtNum(feature.properties.thickness, 3)} m`,
                    `Inphase: ${fmtNum(feature.properties.inphase, 3)} ppt`,
                    `Range: ${feature.properties.range}`,
                    `Dipôle: ${feature.properties.dipole_mode}`,
                    `GPS: Q${feature.properties.gps_quality || "?"} (${feature.properties.gps_satellites || "?"} sat.)`,
                ].join("<br>")
            );
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
    fitToBounds(map, featureCollection);
    updateLegend(condStats);
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
        renderLeaflet(fc, scale);
    } else {
        renderFallback(fc, scale);
    }
    updateLegend(scale);
}

function fillTable(featureCollection) {
    const rows = featureCollection.features
        .filter((f) => f.properties && f.properties.kind === "reading")
        .map((f) => {
            const p = f.properties;
            const [lon, lat] = f.geometry.coordinates;
            return `
                <tr>
                    <td>${p.time_ms ?? ""}</td>
                    <td>${fmtNum(lat, 6)}</td>
                    <td>${fmtNum(lon, 6)}</td>
                    <td>${fmtNum(p.conductivity, 3)} mS/m</td>
                    <td>${fmtNum(p.thickness, 3)} m</td>
                    <td>${fmtNum(p.inphase, 3)} ppt</td>
                    <td>${p.range ?? ""}</td>
                    <td>${p.dipole_mode ?? ""}</td>
                    <td>${p.gps_satellites ?? ""}</td>
                    <td>${fmtNum(p.gps_hdop, 2)}</td>
                </tr>
            `;
        })
        .join("");
    tableBody.innerHTML = rows;
}

exportBtn.addEventListener("click", () => {
    if (!lastFeatures.length) return;
    const readings = lastFeatures.filter((f) => f.properties && f.properties.kind === "reading");
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

function applyLayoutControls() {
    // no-op placeholder kept for compatibility
}

function setMapWidth(pct, invalidate = true) {
    const clamped = Math.min(80, Math.max(40, pct));
    document.documentElement.style.setProperty("--map-width", `${clamped}%`);
    if (map && invalidate) {
        map.invalidateSize();
    }
}

function setPaneHeight(px, invalidate = true) {
    const clamped = Math.min(800, Math.max(300, px));
    document.documentElement.style.setProperty("--pane-height", `${clamped}px`);
    if (invalidate) {
        rerenderWithScale();
        if (map) {
            map.invalidateSize();
        }
    }
}

if (layoutSplitter) {
    let dragging = false;
    layoutSplitter.addEventListener("mousedown", (e) => {
        dragging = true;
        e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const rect = mapLayout.getBoundingClientRect();
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        setMapWidth(pct);
    });
    window.addEventListener("mouseup", () => {
        dragging = false;
    });
}

if (heightSplitter) {
    let draggingH = false;
    let startY = 0;
    let startHeight = 480;
    heightSplitter.addEventListener("mousedown", (e) => {
        draggingH = true;
        startY = e.clientY;
        const current = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--pane-height")
        );
        startHeight = isNaN(current) ? 480 : current;
        e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
        if (!draggingH) return;
        const delta = e.clientY - startY;
        setPaneHeight(startHeight + delta);
    });
    window.addEventListener("mouseup", () => {
        draggingH = false;
    });
}

// Init layout defaults
setMapWidth(65, false);
setPaneHeight(480, false);
