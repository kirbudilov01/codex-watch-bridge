import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

const REQUEST_TIMEOUT_MS = 8000;

export class AppServerClient {
  constructor({ url = process.env.CODEX_APP_SERVER_URL || null } = {}) {
    this.url = url;
  }

  async available() {
    return Boolean(await this.resolveURL());
  }

  async rateLimits() {
    const result = await this.request("account/rateLimits/read");
    return normalizeRateLimits(result);
  }

  async startThread({ cwd, title }) {
    const response = await this.request("thread/start", {
      cwd,
      ephemeral: false,
      threadSource: "other"
    });
    const thread = response?.thread;
    if (!thread?.id) throw new Error("Codex app-server did not return a thread id.");
    if (title?.trim()) {
      await this.setThreadName(thread.id, title.trim()).catch((error) => {
        console.error(`Codex thread/name/set failed for ${thread.id}: ${error.message}`);
      });
    }
    return thread;
  }

  async setThreadName(threadId, name) {
    return this.request("thread/name/set", { threadId, name });
  }

  async startTurn(threadId, text, { cwd = null } = {}) {
    return this.request("turn/start", {
      threadId,
      clientUserMessageId: randomUUID(),
      input: [{ type: "text", text, text_elements: [] }],
      cwd
    });
  }

  async readThread(threadId, { includeTurns = false } = {}) {
    const response = await this.request("thread/read", { threadId, includeTurns });
    if (!response?.thread) throw new Error("Codex app-server did not return a thread.");
    return response.thread;
  }

  async listThreads({ cwd = null, limit = 5000 } = {}) {
    const threads = [];
    let cursor = null;
    do {
      const response = await this.request("thread/list", {
        cursor,
        limit: Math.min(100, limit - threads.length),
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        useStateDbOnly: true,
        ...(cwd ? { cwd } : {})
      });
      threads.push(...(response?.data || []));
      cursor = response?.nextCursor || null;
    } while (cursor && threads.length < limit);
    return threads;
  }

  async request(method, params) {
    const url = await this.resolveURL();
    if (!url) throw new Error("Codex Desktop app-server is unavailable.");
    if (typeof WebSocket === "undefined") throw new Error("Node WebSocket support is unavailable.");

    const id = randomUUID();
    const ws = new WebSocket(url);
    let initialized = false;
    let settled = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        finish(reject, new Error(`Codex app-server request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        fn(value);
      };

      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: "init",
          method: "initialize",
          params: {
            clientInfo: { name: "codex-watch-bridge", title: "Codex Watch Bridge", version: "0.1.0" },
            capabilities: { experimentalApi: true, requestAttestation: false }
          }
        }));
      };

      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (message.id === "init") {
          if (message.error) return finish(reject, new Error(errorText(message.error)));
          initialized = true;
          ws.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }));
          return;
        }

        if (message.id !== id) return;
        if (!initialized) return;
        if (message.error) return finish(reject, new Error(errorText(message.error)));
        finish(resolve, message.result);
      };

      ws.onerror = () => {
        finish(reject, new Error("Codex app-server websocket failed."));
      };
    });
  }

  async resolveURL() {
    if (this.url) return this.url;
    const stdout = await execFileText("ps", ["-eo", "pid,command"]);
    const matches = [...stdout.matchAll(/app-server --listen (ws:\/\/127\.0\.0\.1:\d+)/g)];
    return matches.at(-1)?.[1] || null;
  }
}

function normalizeRateLimits(response) {
  const primary = response?.rateLimitsByLimitId?.codex || response?.rateLimits || null;
  const buckets = response?.rateLimitsByLimitId || {};
  return {
    primary: normalizeLimit(primary),
    buckets: Object.entries(buckets)
      .map(([id, value]) => normalizeLimit(value, id))
      .filter(Boolean),
    resetCredits: response?.rateLimitResetCredits || null,
    updatedAt: new Date().toISOString()
  };
}

function normalizeLimit(limit, fallbackId = null) {
  if (!limit) return null;
  return {
    id: limit.limitId || fallbackId,
    name: limit.limitName || limit.limitId || fallbackId || "Codex",
    usedPercent: numberOrNull(limit.primary?.usedPercent),
    secondaryUsedPercent: numberOrNull(limit.secondary?.usedPercent),
    windowDurationMins: numberOrNull(limit.primary?.windowDurationMins),
    resetsAt: numberOrNull(limit.primary?.resetsAt),
    planType: limit.planType || null,
    reached: Boolean(limit.rateLimitReachedType || limit.spendControlReached)
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function errorText(error) {
  if (typeof error === "string") return error;
  if (error?.message) return error.message;
  return JSON.stringify(error);
}

function execFileText(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 2_000_000 }, (_error, stdout) => resolve(stdout || ""));
  });
}
