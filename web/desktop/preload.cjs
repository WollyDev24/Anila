const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  isSettingsWindow: process.argv.includes("--anila-settings-window"),
  platform: process.platform,
  electron: process.versions.electron || "",
  openSettings: () => ipcRenderer.send("settings:open"),
  onSettingsRefresh: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("settings:refresh", handler);
    return () => ipcRenderer.removeListener("settings:refresh", handler);
  },
  discord: {
    defaultClientId: process.env.ANILA_DISCORD_CLIENT_ID || "1559288695616569464",
    configure: (cfg) => ipcRenderer.send("discord:configure", cfg),
    setActivity: (activity) => ipcRenderer.send("discord:set-activity", activity),
    clear: () => ipcRenderer.send("discord:clear-activity"),
    getStatus: () => ipcRenderer.invoke("discord:get-status"),
    onStatus: (cb) => {
      const handler = (_e, status) => cb(status);
      ipcRenderer.on("discord:status", handler);
      return () => ipcRenderer.removeListener("discord:status", handler);
    },
  },
  updates: {
    getState: () => ipcRenderer.invoke("updates:get-state"),
    check: () => ipcRenderer.invoke("updates:check"),
    install: () => ipcRenderer.send("updates:install"),
    openRelease: (url) => ipcRenderer.send("updates:open-release", url),
    onStatus: (cb) => {
      const handler = (_e, state) => cb(state);
      ipcRenderer.on("updates:status", handler);
      return () => ipcRenderer.removeListener("updates:status", handler);
    },
  },
  downloads: {
    chooseSave: (opts) => ipcRenderer.invoke("downloads:choose-save", opts),
    download: (payload) => ipcRenderer.invoke("downloads:download", payload),
    list: () => ipcRenderer.invoke("downloads:list"),
    openFolder: () => ipcRenderer.invoke("downloads:open-folder"),
    onProgress: (cb) => {
      const handler = (_e, p) => cb(p);
      ipcRenderer.on("downloads:progress", handler);
      return () => ipcRenderer.removeListener("downloads:progress", handler);
    },
  },
});
