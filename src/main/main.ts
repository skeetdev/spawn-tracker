import path from "path";
import fs from "fs";
import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import Store from "electron-store";
import dotenv from "dotenv";
import { parseSlainLine, parseEarthquakeLine } from "../parser";

dotenv.config({ path: path.join(app.getAppPath(), ".env") });

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:4000";

type Settings = {
  serverUrl: string;
  apiKey: string;
  logPath: string;
};

const store = new Store<Settings>({
  defaults: {
    serverUrl: "",
    apiKey: "",
    logPath: "",
  },
});

function getStoredSettings(): Settings {
  return {
    serverUrl: SERVER_URL,
    apiKey: store.get("apiKey") ?? "",
    logPath: store.get("logPath") ?? "",
  };
}

/** Normalize NPC name for dedup matching between PVP and non-PVP lines */
function normalizeForDedup(name: string): string {
  return name.replace(/^#+/, "").replace(/_/g, " ").toLowerCase().trim().replace(/\s+/g, " ");
}

let mainWindow: BrowserWindow | null = null;
let watcherTimer: ReturnType<typeof setInterval> | null = null;
let logPosition = 0;
let logPath: string | null = null;
const pendingNonPvp: Map<string, { match: { npcName: string; zone?: string; pvp: number; killedAt: Date; playerName?: string; guildName?: string }; timeout: ReturnType<typeof setTimeout> }> = new Map();
const BUFFER_MS = 2000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 420,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(app.getAppPath(), "src", "renderer", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
    stopWatching();
  });
}

function sendToRenderer(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function debugLog(message: string, type: "info" | "success" | "error" | "parse" = "info") {
  sendToRenderer("debug-log", message, type);
}

function stopWatching() {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }
  for (const pending of pendingNonPvp.values()) {
    clearTimeout(pending.timeout);
  }
  pendingNonPvp.clear();
  logPath = null;
  sendToRenderer("connection-status", "stopped");
}

async function reportSlain(settings: Settings, match: { npcName: string; zone?: string; pvp: number; killedAt: Date; playerName?: string; guildName?: string }) {
  const base = settings.serverUrl.replace(/\/$/, "");
  const url = `${base}/api/slain`;
  const bodyData = {
    npcName: match.npcName,
    ...(match.zone ? { zone: match.zone } : {}),
    pvp: match.pvp,
    killedAt: match.killedAt.toISOString(),
    ...(match.playerName ? { playerName: match.playerName } : {}),
    ...(match.guildName ? { guildName: match.guildName } : {}),
  };
  const body = JSON.stringify(bodyData);

  const logMsg = `Reporting: ${match.npcName}${match.playerName ? ` (killed by ${match.playerName}${match.guildName ? ` of <${match.guildName}>` : ""})` : ""}`;
  debugLog(logMsg, "info");

  try {
    const apiKey = (settings.apiKey ?? "").trim();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    if (res.status === 401) {
      debugLog("API Error: Invalid key (401)", "error");
      sendToRenderer("connection-status", "invalid_key");
      return;
    }
    if (res.ok) {
      debugLog(" Reported successfully", "success");
      sendToRenderer("connection-status", "connected");
    } else {
      debugLog(`API Error: ${res.status} ${res.statusText}`, "error");
      sendToRenderer("connection-status", "error");
    }
  } catch (err) {
    debugLog(`Network Error: ${err instanceof Error ? err.message : String(err)}`, "error");
    sendToRenderer("connection-status", "error");
  }
}

async function reportEarthquake(settings: Settings, logLine: string) {
  const base = settings.serverUrl.replace(/\/$/, "");
  const url = `${base}/api/earthquake`;
  const body = JSON.stringify({
    logLine,
    timezone: "GMT-0500", // Eastern time for EQ
  });

  debugLog("Reporting earthquake announcement", "info");

  try {
    const apiKey = (settings.apiKey ?? "").trim();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    if (res.status === 401) {
      debugLog("API Error: Invalid key (401)", "error");
      sendToRenderer("connection-status", "invalid_key");
      return;
    }
    if (res.ok) {
      debugLog(" Earthquake reported successfully", "success");
      sendToRenderer("connection-status", "connected");
    } else {
      debugLog(`API Error: ${res.status} ${res.statusText}`, "error");
      sendToRenderer("connection-status", "error");
    }
  } catch (err) {
    debugLog(`Network Error: ${err instanceof Error ? err.message : String(err)}`, "error");
    sendToRenderer("connection-status", "error");
  }
}

async function startWatching(settings: Settings) {
  stopWatching();
  if (!settings.serverUrl?.trim() || !settings.apiKey?.trim() || !settings.logPath?.trim()) {
    sendToRenderer("connection-status", "missing_config");
    return;
  }

  const filePath = settings.logPath.trim();
  debugLog(`Starting log watcher: ${filePath}`, "info");

  try {
    const stats = fs.statSync(filePath);
    logPosition = stats.size;
    debugLog(`Log file found, size: ${stats.size} bytes`, "info");
  } catch {
    debugLog("Log file not found", "error");
    sendToRenderer("connection-status", "file_not_found");
    return;
  }

  const base = settings.serverUrl.replace(/\/$/, "");
  const healthUrl = `${base}/api/health`;
  debugLog(`Checking server health: ${base}`, "info");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      debugLog("Server is offline or unreachable", "error");
      sendToRenderer("connection-status", "server_offline");
      return;
    }
    debugLog(" Server is online", "success");
  } catch {
    debugLog("Server connection failed", "error");
    sendToRenderer("connection-status", "server_offline");
    return;
  }

  // Validate API key before starting watcher
  const apiKeyTestUrl = `${base}/api/auth/api-key`;
  debugLog("Validating API key...", "info");

  try {
    const apiKey = (settings.apiKey ?? "").trim();
    const res = await fetch(apiKeyTestUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (res.status === 401) {
      debugLog("API key validation failed (401)", "error");
      sendToRenderer("connection-status", "invalid_key");
      return;
    }

    if (!res.ok) {
      debugLog(`API key check failed: ${res.status} ${res.statusText}`, "error");
      sendToRenderer("connection-status", "error");
      return;
    }

    debugLog(" API key is valid", "success");
  } catch (err) {
    debugLog(`API key validation error: ${err instanceof Error ? err.message : String(err)}`, "error");
    sendToRenderer("connection-status", "error");
    return;
  }

  logPath = filePath;
  debugLog(" Watching started", "success");
  sendToRenderer("connection-status", "connected");

  watcherTimer = setInterval(async () => {
    if (!logPath) return;
    try {
      const stats = fs.statSync(logPath);
      if (stats.size > logPosition) {
        const stream = fs.createReadStream(logPath, {
          start: logPosition,
          end: stats.size,
          encoding: "utf8",
        });
        let buffer = "";
        for await (const chunk of stream) {
          buffer += chunk;
        }
        logPosition = stats.size;
        const lines = buffer.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          // Check for earthquake announcement
          const earthquakeMatch = parseEarthquakeLine(line);
          if (earthquakeMatch) {
            debugLog(`Parsed: Earthquake (${earthquakeMatch.days}d ${earthquakeMatch.hours}h ${earthquakeMatch.minutes}m ${earthquakeMatch.seconds}s)`, "parse");
            await reportEarthquake(settings, line);
            continue;
          }

          // Check for slain events
          const match = parseSlainLine(line);
          if (match) {
            const killerInfo = match.playerName ? ` by ${match.playerName}${match.guildName ? ` <${match.guildName}>` : ""}` : "";
            debugLog(`Parsed: ${match.npcName}${killerInfo} [${match.pvp ? "PVP" : "Non-PVP"}]`, "parse");

            const key = normalizeForDedup(match.npcName);
            if (match.pvp === 1) {
              // PVP line — report immediately and cancel any buffered non-PVP for the same NPC
              const pending = pendingNonPvp.get(key);
              if (pending) {
                clearTimeout(pending.timeout);
                pendingNonPvp.delete(key);
                debugLog(`Cancelled buffered non-PVP for ${match.npcName}`, "info");
              }
              await reportSlain(settings, match);
            } else {
              // Non-PVP line — buffer it; if no PVP line arrives within the window, report it
              const existing = pendingNonPvp.get(key);
              if (existing) {
                clearTimeout(existing.timeout);
              }
              debugLog(`Buffering non-PVP kill for ${BUFFER_MS}ms`, "info");
              const timeout = setTimeout(() => {
                pendingNonPvp.delete(key);
                void reportSlain(settings, match);
              }, BUFFER_MS);
              pendingNonPvp.set(key, { match, timeout });
            }
          }
        }
      }
    } catch (err) {
      sendToRenderer("connection-status", "error");
    }
  }, 1000);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  ipcMain.handle("get-settings", () => getStoredSettings());
  ipcMain.handle("set-settings", (_e, s: Partial<Settings>) => {
    if (s.apiKey !== undefined) store.set("apiKey", s.apiKey);
    if (s.logPath !== undefined) store.set("logPath", s.logPath);
  });
  ipcMain.handle("start-watching", async () => {
    await startWatching(getStoredSettings());
  });
  ipcMain.handle("stop-watching", () => {
    stopWatching();
  });
  ipcMain.handle("show-open-dialog", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = await dialog.showOpenDialog(win!, {
      title: "Select EQ log file",
      properties: ["openFile"],
      filters: [{ name: "Log files", extensions: ["txt", "log"] }, { name: "All files", extensions: ["*"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("set-window-size", (_e, width: number, height: number) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setSize(width, height);
    }
  });
});

app.on("window-all-closed", () => {
  stopWatching();
  app.quit();
});
