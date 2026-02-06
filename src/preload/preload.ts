import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("repopApi", {
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setSettings: (s: Record<string, string>) => ipcRenderer.invoke("set-settings", s),
  startWatching: () => ipcRenderer.invoke("start-watching"),
  stopWatching: () => ipcRenderer.invoke("stop-watching"),
  showOpenDialog: () => ipcRenderer.invoke("show-open-dialog") as Promise<string | null>,
  onConnectionStatus: (cb: (status: string) => void) => {
    const handler = (_: unknown, status: string) => cb(status);
    ipcRenderer.on("connection-status", handler);
    return () => ipcRenderer.removeListener("connection-status", handler);
  },
});
