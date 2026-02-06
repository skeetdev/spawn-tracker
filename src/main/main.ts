import path from "path";
import fs from "fs";
import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import Store from "electron-store";
import { parseSlainLine } from "../parser";

/** Set this before building; users never enter the server URL. */
const SERVER_URL = "http://localhost:4000";

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

let mainWindow: BrowserWindow | null = null;
let watcherTimer: ReturnType<typeof setInterval> | null = null;
let logPosition = 0;
let logPath: string | null = null;

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

function stopWatching() {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }
  logPath = null;
  sendToRenderer("connection-status", "stopped");
}

async function reportSlain(settings: Settings, match: { npcName: string; zone?: string; pvp: number; killedAt: Date }) {
  const base = settings.serverUrl.replace(/\/$/, "");
  const url = `${base}/api/slain`;
  const body = JSON.stringify({
    npcName: match.npcName,
    ...(match.zone ? { zone: match.zone } : {}),
    pvp: match.pvp,
    killedAt: match.killedAt.toISOString(),
  });

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
      sendToRenderer("connection-status", "invalid_key");
      return;
    }
    if (res.ok) {
      sendToRenderer("connection-status", "connected");
    } else {
      sendToRenderer("connection-status", "error");
    }
  } catch (err) {
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
  try {
    const stats = fs.statSync(filePath);
    logPosition = stats.size;
  } catch {
    sendToRenderer("connection-status", "file_not_found");
    return;
  }

  const base = settings.serverUrl.replace(/\/$/, "");
  const healthUrl = `${base}/api/health`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      sendToRenderer("connection-status", "server_offline");
      return;
    }
  } catch {
    sendToRenderer("connection-status", "server_offline");
    return;
  }

  logPath = filePath;
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
          const match = parseSlainLine(line);
          if (match) {
            await reportSlain(settings, match);
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
});

app.on("window-all-closed", () => {
  stopWatching();
  app.quit();
});
