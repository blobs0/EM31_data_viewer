const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || "8000", 10);
const START_URL = process.env.ELECTRON_START_URL || `http://127.0.0.1:${BACKEND_PORT}`;
const APP_ROOT = path.resolve(__dirname, "..");
const BACKEND_MODULE = "backend.app";
const BACKEND_BIN_NAME = process.platform === "win32" ? "em31-backend.exe" : "em31-backend";
const PACKAGED_BACKEND_PATH = path.join(process.resourcesPath, "backend-dist", BACKEND_BIN_NAME);
const PYTHON_BIN =
    process.env.PYTHON_PATH ||
    process.env.PYTHON ||
    (process.platform === "win32" ? "python" : "python3");

let backendProcess = null;
let externalBackend = false;
let mainWindow = null;
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

function pingBackend(timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            {
                host: "127.0.0.1",
                port: BACKEND_PORT,
                path: "/api/health",
                timeout: timeoutMs,
            },
            (res) => {
                res.resume();
                resolve(res.statusCode === 200);
            }
        );
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy(new Error("Backend healthcheck timeout"));
        });
    });
}

function waitForBackend(timeoutMs = 15000, retryDelay = 400) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const retry = () => {
            if (Date.now() > deadline) {
                reject(new Error(`Backend not reachable on port ${BACKEND_PORT}`));
                return;
            }
            setTimeout(check, retryDelay);
        };
        const check = () => {
            pingBackend()
                .then((ok) => {
                    if (ok) {
                        resolve();
                    } else {
                        retry();
                    }
                })
                .catch(() => retry());
        };
        check();
    });
}

async function ensureBackend() {
    try {
        const alreadyUp = await pingBackend(500);
        if (alreadyUp) {
            externalBackend = true;
            console.log(`Backend already running on port ${BACKEND_PORT}, reuse it.`);
            return;
        }
    } catch (_) {
        // Normal case: nothing listening yet
    }
    const env = { ...process.env, BACKEND_PORT: String(BACKEND_PORT) };
    const packagedExists = fs.existsSync(PACKAGED_BACKEND_PATH);
    const usePackaged = app.isPackaged && packagedExists;
    if (app.isPackaged && !packagedExists) {
        throw new Error(
            `Binaire backend introuvable (${PACKAGED_BACKEND_PATH}). Rebuild l'application ou installe l'artefact complet (deb/tar.gz/zip).`
        );
    }
    const spawnCmd = usePackaged
        ? [PACKAGED_BACKEND_PATH, []]
        : [PYTHON_BIN, ["-m", BACKEND_MODULE]];
    const spawnOpts = usePackaged
        ? { cwd: path.dirname(PACKAGED_BACKEND_PATH), env, stdio: ["ignore", "pipe", "pipe"] }
        : { cwd: APP_ROOT, env, stdio: ["ignore", "pipe", "pipe"] };
    backendProcess = spawn(spawnCmd[0], spawnCmd[1], spawnOpts);
    if (usePackaged) {
        console.log(`Starting packaged backend binary at ${PACKAGED_BACKEND_PATH}`);
    } else {
        console.log("Starting backend with local Python (backend.app)");
    }
    backendProcess.stdout?.on("data", (data) => {
        process.stdout.write(`[backend] ${data}`);
    });
    backendProcess.stderr?.on("data", (data) => {
        process.stderr.write(`[backend] ${data}`);
    });
    backendProcess.on("exit", (code, signal) => {
        if (!externalBackend) {
            console.log(`Backend process exited (code=${code}, signal=${signal})`);
        }
    });
    const waitPromise = waitForBackend();
    await new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        backendProcess.once("error", onError);
        waitPromise
            .then(resolve)
            .catch(reject)
            .finally(() => backendProcess?.off("error", onError));
    });
}

function stopBackend() {
    if (externalBackend || !backendProcess) return;
    backendProcess.kill();
    backendProcess = null;
}

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 900,
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.on("ready-to-show", () => mainWindow?.show());
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    await mainWindow.loadURL(START_URL);
}

async function bootstrap() {
    try {
        await ensureBackend();
        await createWindow();
    } catch (err) {
        console.error(err);
        dialog.showErrorBox("EM31 – Electron", err?.message || "Erreur inconnue au démarrage.");
        stopBackend();
        app.quit();
    }
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("before-quit", stopBackend);
app.on("quit", stopBackend);

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught exception", err);
});
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection", reason);
});
