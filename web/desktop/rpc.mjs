// Discord Rich Presence manager for the Anila desktop wrapper.
//
// Runs in the Electron main process. The renderer sends activity updates over
// IPC; this keeps one RPC connection to the local Discord client, reconnecting
// if Discord isn't running yet, and exposes a status string for the UI.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let Client = null;
try {
  ({ Client } = require("@xhayper/discord-rpc"));
} catch {
  Client = null; // dependency not installed -> presence becomes a no-op
}

const RETRY_MS = 15000;

export class DiscordPresence {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.supported = !!Client;
    this.client = null;
    this.clientId = "";
    this.enabled = false;
    this.status = "disabled"; // disabled | unavailable | connecting | connected | not-running
    this.pending = null;
    this.retryTimer = null;
    this.onStatus = () => {};
  }

  setStatus(status) {
    if (status === this.status) return;
    this.status = status;
    this.log(`status -> ${status}`);
    try {
      this.onStatus(status);
    } catch {
      /* ignore */
    }
  }

  // Called by the renderer whenever the settings change.
  configure({ enabled, clientId } = {}) {
    if (!this.supported) {
      this.setStatus("unavailable");
      return;
    }
    this.enabled = !!enabled;
    this.clientId = String(clientId || "").trim();
    if (!this.enabled || !this.clientId) {
      this.teardown();
      this.pending = null;
      this.setStatus("disabled");
      return;
    }
    this.connect();
  }

  connect() {
    if (!this.supported || !this.enabled || !this.clientId) return;
    this.teardown();
    this.setStatus("connecting");
    const client = new Client({ clientId: this.clientId, transport: { type: "ipc" } });
    this.client = client;

    client.on("ready", () => {
      if (client !== this.client) return;
      this.setStatus("connected");
      this.applyPending();
    });
    client.on("disconnected", () => {
      if (client !== this.client) return;
      this.setStatus("not-running");
      this.scheduleRetry();
    });

    client.login({ clientId: this.clientId }).catch((err) => {
      if (client !== this.client) return;
      this.log(`login failed: ${err?.message || err}`);
      this.setStatus("not-running");
      this.scheduleRetry();
    });
  }

  scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.enabled && this.clientId) this.connect();
    }, RETRY_MS);
    this.retryTimer.unref?.();
  }

  teardown() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners?.();
      client.destroy?.().catch?.(() => {});
    }
  }

  async applyPending() {
    if (!this.pending) return;
    await this.setActivity(this.pending);
  }

  async setActivity(activity) {
    this.pending = activity;
    const client = this.client;
    if (!client || !client.user || !client.isConnected) return;
    try {
      await client.user.setActivity(activity);
    } catch (err) {
      this.log(`setActivity failed: ${err?.message || err}`);
    }
  }

  async clearActivity() {
    this.pending = null;
    const client = this.client;
    if (!client || !client.user || !client.isConnected) return;
    try {
      await client.user.clearActivity();
    } catch (err) {
      this.log(`clearActivity failed: ${err?.message || err}`);
    }
  }

  async destroy() {
    this.enabled = false;
    this.teardown();
    this.setStatus("disabled");
  }
}
