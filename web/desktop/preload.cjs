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
});
