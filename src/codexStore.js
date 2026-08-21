import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readJsonl, textFromContent } from "./jsonl.js";
import { BridgeStorage } from "./localStorage.js";
import { isActiveStatus, ThreadStatus } from "./status.js";
import { AppServerClient } from "./appServerClient.js";

const DEFAULT_CODEX_HOME = path.join(process.env.HOME || ".", ".codex");
const STALE_LOCAL_RUN_MS = 2 * 60 * 1000;
const APP_SERVER_THREADS_CACHE_MS = 10 * 1000;
const DEFAULT_PROJECT_LIMIT = 150;

function slug(input) {
  return Buffer.from(input || "unknown").toString("base64url");
}

function unslug(input) {
  try {
    return Buffer.from(input, "base64url").toString("utf8");
  } catch {
    return input;
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(dir, predicate, output = []) {
  if (!(await exists(dir))) return output;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, predicate, output);
    } else if (predicate(full)) {
      output.push(full);
    }
  }
  return output;
}

export class CodexStore {
  constructor({ codexHome = process.env.CODEX_HOME || DEFAULT_CODEX_HOME, storage = new BridgeStorage(), appServer = new AppServerClient() } = {}) {
    this.codexHome = codexHome;
    this.storage = storage;
    this.appServer = appServer;
    this.sessionFileMap = null;
    this.sessionMetaMap = new Map();
    this.appServerThreadsCache = null;
    this.appServerThreadsPromise = null;
  }

  async readSessionIndex() {
    const file = path.join(this.codexHome, "session_index.jsonl");
    if (!(await exists(file))) return [];
    const lines = (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean);
    const byId = new Map();
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.id) byId.set(item.id, item);
      } catch {
        // Ignore malformed index rows.
      }
    }
    return [...byId.values()].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  }

  async findSessionFile(threadId) {
    if (!this.sessionFileMap) this.sessionFileMap = await this.buildSessionFileMap();
    return this.sessionFileMap.get(threadId) || null;
  }

  async buildSessionFileMap() {
    const map = new Map();
    const roots = [path.join(this.codexHome, "sessions"), path.join(this.codexHome, "archived_sessions")];
    for (const root of roots) {
      const files = await walkFiles(root, (file) => file.endsWith(".jsonl"));
      for (const file of files.sort()) {
        const match = path.basename(file).match(/rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
        if (match) map.set(match[1], file);
      }
    }
    return map;
  }

  async sessionMeta(threadId) {
    if (this.sessionMetaMap.has(threadId)) return this.sessionMetaMap.get(threadId);
    const file = await this.findSessionFile(threadId);
    if (!file) {
      const missing = { file: null, cwd: null };
      this.sessionMetaMap.set(threadId, missing);
      return missing;
    }
    const rows = await readJsonl(file, { limit: 6 });
    const meta = rows.find((row) => row.type === "session_meta")?.payload || {};
    const result = { file, cwd: meta.cwd || null, originator: meta.originator || null };
    this.sessionMetaMap.set(threadId, result);
    return result;
  }

  async listProjects() {
    await this.reconcileLocalRuns();
    const appServerProjects = await this.listProjectsFromAppServer().catch((error) => {
      console.error(`Codex app-server project list unavailable: ${error.message}`);
      return null;
    });
    if (appServerProjects) return appServerProjects;

    const index = await this.readSessionIndex();
    const local = await this.storage.listThreads();
    const projects = new Map();

    const active = await this.activeProcessIds();
    for (const thread of index) {
      const meta = await this.sessionMeta(thread.id);
      const cwd = meta.cwd || "Codex";
      const id = slug(cwd);
      const existing = projects.get(id) || {
        id,
        name: cwd === "Codex" ? "Codex" : path.basename(cwd),
        cwd,
        threadCount: 0,
        activeCount: 0,
        updatedAt: thread.updated_at || null
      };
      existing.threadCount += 1;
      if (active.has(thread.id)) existing.activeCount += 1;
      if (String(thread.updated_at || "") > String(existing.updatedAt || "")) existing.updatedAt = thread.updated_at;
      projects.set(id, existing);
    }

    for (const thread of local) {
      const id = thread.projectId || slug(thread.cwd);
      const existing = projects.get(id) || {
        id,
        name: thread.projectName || path.basename(thread.cwd || "Codex"),
        cwd: thread.cwd,
        threadCount: 0,
        activeCount: 0,
        updatedAt: null
      };
      existing.threadCount += 1;
      if (["queued", "running", "waiting_for_input"].includes(thread.status)) existing.activeCount += 1;
      if (String(thread.updatedAt || "") > String(existing.updatedAt || "")) existing.updatedAt = thread.updatedAt;
      projects.set(id, existing);
    }

    return limitProjects([...projects.values()].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))));
  }

  async appServerThreads() {
    const now = Date.now();
    if (this.appServerThreadsCache && now - this.appServerThreadsCache.createdAt < APP_SERVER_THREADS_CACHE_MS) {
      return this.appServerThreadsCache.threads;
    }
    if (this.appServerThreadsPromise) return this.appServerThreadsPromise;

    this.appServerThreadsPromise = this.appServer.listThreads({ limit: Number(process.env.CODEX_WATCH_MAX_THREADS || 5000) })
      .then((threads) => {
        this.appServerThreadsCache = { createdAt: Date.now(), threads };
        this.appServerThreadsPromise = null;
        return threads;
      })
      .catch((error) => {
        this.appServerThreadsPromise = null;
        throw error;
      });
    return this.appServerThreadsPromise;
  }

  async listProjectsFromAppServer() {
    if (!this.appServer?.listThreads) return null;
    const threads = await this.appServerThreads();
    const local = await this.storage.listThreads();
    const projects = new Map();

    for (const thread of threads) {
      const cwd = thread.cwd || "Codex";
      const id = slug(cwd);
      const updatedAt = isoFromSeconds(thread.updatedAt || thread.recencyAt || thread.createdAt);
      const existing = projects.get(id) || {
        id,
        name: cwd === "Codex" ? "Codex" : path.basename(cwd),
        cwd,
        threadCount: 0,
        activeCount: 0,
        updatedAt
      };
      existing.threadCount += 1;
      if (isActiveStatus(normalizeAppServerStatus(thread.status))) existing.activeCount += 1;
      if (String(updatedAt || "") > String(existing.updatedAt || "")) existing.updatedAt = updatedAt;
      projects.set(id, existing);
    }

    for (const thread of local) {
      const id = thread.projectId || slug(thread.cwd);
      const existing = projects.get(id) || {
        id,
        name: thread.projectName || path.basename(thread.cwd || "Codex"),
        cwd: thread.cwd,
        threadCount: 0,
        activeCount: 0,
        updatedAt: null
      };
      if (!projects.has(id) || thread.source === "watch") existing.threadCount += 1;
      if (isActiveStatus(thread.status)) existing.activeCount += 1;
      if (String(thread.updatedAt || "") > String(existing.updatedAt || "")) existing.updatedAt = thread.updatedAt;
      projects.set(id, existing);
    }

    return limitProjects([...projects.values()].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))));
  }

  async projectFromId(projectId) {
    const projects = await this.listProjects();
    return projects.find((project) => project.id === projectId) || {
      id: projectId,
      name: path.basename(unslug(projectId)),
      cwd: unslug(projectId),
      threadCount: 0,
      activeCount: 0,
      updatedAt: null
    };
  }

  async listThreadsFromAppServer(project) {
    if (!this.appServer?.listThreads) return null;
    const threads = (await this.appServerThreads()).filter((thread) => (thread.cwd || "Codex") === project.cwd);
    const local = (await this.storage.listThreads()).filter((thread) => thread.projectId === project.id);
    const byId = new Map();
    for (const thread of threads.map((thread) => normalizeAppServerThread(thread, project))) {
      byId.set(thread.id, thread);
    }
    for (const thread of local) {
      const existing = byId.get(thread.id);
      byId.set(thread.id, existing ? mergeThread(thread, existing) : thread);
    }
    return [...byId.values()].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  async listThreads(projectId) {
    await this.reconcileLocalRuns();
    const project = await this.projectFromId(projectId);

    const appServerThreads = await this.listThreadsFromAppServer(project).catch((error) => {
      console.error(`Codex app-server thread list unavailable for ${projectId}: ${error.message}`);
      return null;
    });
    if (appServerThreads) return appServerThreads;

    const index = await this.readSessionIndex();
    const result = [];

    const active = await this.activeProcessIds();
    for (const item of index) {
      const meta = await this.sessionMeta(item.id);
      if ((meta.cwd || "Codex") !== project.cwd) continue;
      result.push({
        id: item.id,
        source: "codex",
        projectId,
        title: item.thread_name || "Untitled",
        preview: "",
        updatedAt: item.updated_at || null,
        status: active.has(item.id) ? ThreadStatus.running : ThreadStatus.completed,
        codexThreadId: item.id
      });
    }

    const local = (await this.storage.listThreads()).filter((thread) => thread.projectId === projectId);
    const byId = new Map();
    for (const thread of [...local, ...result]) {
      const existing = byId.get(thread.id);
      byId.set(thread.id, existing ? mergeThread(existing, thread) : thread);
    }
    return [...byId.values()].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  async getThread(threadId) {
    await this.reconcileLocalRuns();
    const local = await this.storage.getThread(threadId);
    if (local?.source === "watch") return local;
    const index = await this.readSessionIndex();
    const item = index.find((row) => row.id === threadId);
    if (!item && local) return {
      ...local,
      status: local.status || ThreadStatus.idle,
      tokenUsage: await this.tokenUsageForCodexThread(local.codexThreadId || local.id).catch(() => null)
    };
    if (!item) return null;
    const meta = await this.sessionMeta(threadId);
    return {
      id: threadId,
      source: "codex",
      projectId: slug(meta.cwd || "Codex"),
      projectName: meta.cwd ? path.basename(meta.cwd) : "Codex",
      cwd: meta.cwd || "Codex",
      title: local?.title || item.thread_name || "Untitled",
      preview: local?.preview || "",
      createdAt: null,
      updatedAt: item.updated_at || null,
      status: await this.statusForCodexThread(threadId),
      codexThreadId: threadId,
      tokenUsage: await this.tokenUsageForCodexThread(threadId)
    };
  }

  async createThread(projectId, title) {
    const project = await this.projectFromId(projectId);
    try {
      const native = await this.appServer.startThread({ cwd: project.cwd, title });
      return this.storage.createThread({
        id: native.id,
        source: "codex",
        codexThreadId: native.id,
        projectId,
        projectName: project.name,
        cwd: native.cwd || project.cwd,
        title: title || native.name || "New Chat",
        status: normalizeAppServerStatus(native.status),
        preview: native.preview || ""
      });
    } catch (error) {
      console.error(`Native Codex thread creation failed, falling back to local thread: ${error.message}`);
    }
    return this.storage.createThread({
      projectId,
      projectName: project.name,
      cwd: project.cwd,
      title
    });
  }

  async getMessages(threadId) {
    await this.reconcileLocalRuns();
    const local = await this.storage.getThread(threadId);
    if (local?.source === "watch") return local.messages || [];

    const appServerMessages = await this.messagesFromAppServer(local?.codexThreadId || threadId).catch((error) => {
      console.error(`Codex app-server thread/read unavailable for ${threadId}: ${error.message}`);
      return null;
    });
    if (appServerMessages?.length) return mergeMessages(local?.messages || [], appServerMessages);

    const file = await this.findSessionFile(local?.codexThreadId || threadId);
    if (!file) return local?.messages || [];
    const rows = await readJsonl(file);
    const messages = [];
    for (const [index, row] of rows.entries()) {
      if (row.type === "response_item" && row.payload?.type === "message") {
        const role = row.payload.role === "assistant" ? "codex" : row.payload.role || "system";
        const content = textFromContent(row.payload.content);
        if (content.trim()) {
          messages.push({
            id: row.payload.id || `${threadId}-${index}`,
            role,
            content,
            createdAt: row.timestamp || null
          });
        }
      }
      if (row.type === "event_msg") {
        const payload = row.payload || {};
        if (payload.type === "token_count") continue;
        const message = payload.message || payload.title || payload.type || "";
        if (payload.type && payload.type !== "user_message" && message && String(message).length < 500) {
          messages.push({
            id: `${threadId}-event-${index}`,
            role: "status",
            content: String(message),
            createdAt: row.timestamp || null,
            status: this.statusFromEvent(payload)
          });
        }
      }
    }
    return messages;
  }

  async tokenUsageForCodexThread(threadId) {
    const file = await this.findSessionFile(threadId);
    if (!file) return null;
    const rows = await readJsonl(file);
    const row = rows.findLast((item) => item.type === "event_msg" && item.payload?.type === "token_count");
    if (!row) return null;

    const info = row.payload?.info || {};
    const usage = info.total_token_usage || {};
    const contextTokens = numberOrNull(usage.total_tokens)
      ?? sumNumbers(usage.input_tokens, usage.output_tokens);
    const contextWindow = numberOrNull(info.model_context_window);
    const contextPercent = contextTokens != null && contextWindow
      ? Math.min(100, Math.round((contextTokens / contextWindow) * 100))
      : null;
    const rateLimitPercent = numberOrNull(row.payload?.rate_limits?.primary?.used_percent);

    if (contextTokens == null && contextPercent == null && rateLimitPercent == null) return null;
    return {
      contextTokens,
      contextWindow,
      contextPercent,
      rateLimitPercent,
      updatedAt: row.timestamp || null
    };
  }

  statusFromEvent(payload) {
    if (payload.type === "agent_message") return ThreadStatus.running;
    if (payload.type === "task_complete") return ThreadStatus.completed;
    if (payload.type === "error") return ThreadStatus.failed;
    return undefined;
  }

  async statusForCodexThread(threadId) {
    const appServerStatus = await this.statusFromAppServer(threadId).catch(() => null);
    if (appServerStatus) return appServerStatus;

    const active = await this.activeProcessIds();
    if (active.has(threadId)) return ThreadStatus.running;
    const messages = await this.getMessages(threadId).catch(() => []);
    const last = messages.at(-1);
    if (!last) return ThreadStatus.idle;
    if (last.role === "user") return ThreadStatus.completed;
    if (last.status) return last.status;
    return ThreadStatus.completed;
  }

  async statusFromAppServer(threadId) {
    if (!this.appServer?.readThread) return null;
    const thread = await this.appServer.readThread(threadId, { includeTurns: true });
    const status = normalizeAppServerStatus(thread.status);
    if (status !== ThreadStatus.idle) return status;
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    const lastTurn = turns.at(-1);
    if (!lastTurn) return status;
    if (lastTurn.status === "inProgress") return ThreadStatus.running;
    if (lastTurn.status === "failed") return ThreadStatus.failed;
    if (lastTurn.status === "interrupted") return ThreadStatus.cancelled;
    if (lastTurn.status === "completed") return ThreadStatus.completed;
    return status;
  }

  async messagesFromAppServer(threadId) {
    if (!this.appServer?.readThread) return null;
    const thread = await this.appServer.readThread(threadId, { includeTurns: true });
    const messages = [];
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    for (const [turnIndex, turn] of turns.entries()) {
      const createdAt = isoFromSeconds(turn.startedAt || turn.completedAt || thread.updatedAt || null);
      for (const [itemIndex, item] of (turn.items || []).entries()) {
        const message = messageFromAppServerItem(item, `${threadId}-${turnIndex}-${itemIndex}`, createdAt);
        if (message) messages.push(message);
      }
      if (turn.status === "inProgress") {
        messages.push({
          id: `${threadId}-${turnIndex}-status-running`,
          role: "status",
          content: "Running...",
          createdAt,
          status: ThreadStatus.running
        });
      } else if (turn.status === "failed") {
        messages.push({
          id: `${threadId}-${turnIndex}-status-failed`,
          role: "status",
          content: turn.error?.message ? `Failed: ${turn.error.message}` : "Failed",
          createdAt: isoFromSeconds(turn.completedAt || turn.startedAt || thread.updatedAt || null),
          status: ThreadStatus.failed
        });
      }
    }
    return messages;
  }

  async activeProcessIds() {
    const file = path.join(this.codexHome, "process_manager", "chat_processes.json");
    try {
      const rows = JSON.parse(await readFile(file, "utf8"));
      return new Set(rows.map((row) => row.conversationId).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  async appendUserMessage(threadId, text) {
    return this.storage.appendMessage(threadId, {
      id: randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString()
    });
  }

  async appendStatus(threadId, content, status) {
    return this.storage.appendMessage(threadId, {
      id: randomUUID(),
      role: "status",
      content,
      status,
      createdAt: new Date().toISOString()
    });
  }

  async updateLocalThread(threadId, patch) {
    return this.storage.updateThread(threadId, patch);
  }

  async reconcileLocalRuns() {
    const now = Date.now();
    const threads = await this.storage.listThreads();
    for (const thread of threads) {
      if (thread.source !== "watch" || !isActiveStatus(thread.status)) continue;
      if (thread.runnerPid && processAlive(thread.runnerPid)) continue;

      const updatedAt = Date.parse(thread.updatedAt || thread.createdAt || "");
      if (Number.isFinite(updatedAt) && now - updatedAt < STALE_LOCAL_RUN_MS) continue;
      if (thread.reconciledStaleAt) continue;

      const reason = thread.runnerPid
        ? `Codex process ${thread.runnerPid} is no longer running.`
        : "Codex process is no longer running.";
      await this.appendStatus(thread.id, `Failed: ${reason}`, ThreadStatus.failed);
      await this.updateLocalThread(thread.id, {
        status: ThreadStatus.failed,
        runnerPid: null,
        runnerStartedAt: null,
        runnerCommand: null,
        reconciledStaleAt: new Date().toISOString()
      });
    }
  }

  async codexHomeSizeHint() {
    const index = path.join(this.codexHome, "session_index.jsonl");
    try {
      return (await stat(index)).size;
    } catch {
      return 0;
    }
  }

  async accountLimits() {
    try {
      return await this.appServer.rateLimits();
    } catch (error) {
      console.error(`Codex app-server rate limits unavailable: ${error.message}`);
      return await this.latestObservedRateLimits();
    }
  }

  async latestObservedRateLimits() {
    if (!this.sessionFileMap) this.sessionFileMap = await this.buildSessionFileMap();
    let latest = null;
    for (const [threadId, file] of this.sessionFileMap.entries()) {
      const usage = await this.tokenUsageForCodexThread(threadId).catch(() => null);
      if (!usage?.rateLimitPercent) continue;
      if (!latest || String(usage.updatedAt || "") > String(latest.updatedAt || "")) {
        latest = usage;
      }
    }
    return {
      primary: latest ? {
        id: "codex",
        name: "Codex",
        usedPercent: latest.rateLimitPercent,
        secondaryUsedPercent: null,
        windowDurationMins: null,
        resetsAt: null,
        planType: null,
        reached: false
      } : null,
      buckets: [],
      resetCredits: null,
      updatedAt: latest?.updatedAt || null,
      source: latest ? "observed_session" : "unavailable"
    };
  }
}

function normalizeAppServerStatus(status) {
  if (status && typeof status === "object") {
    if (status.type === "active") {
      return Array.isArray(status.activeFlags) && status.activeFlags.includes("waitingOnUserInput")
        ? ThreadStatus.waitingForInput
        : ThreadStatus.running;
    }
    if (status.type === "systemError") return ThreadStatus.failed;
    if (status.type === "idle" || status.type === "notLoaded") return ThreadStatus.idle;
  }
  const raw = String(status || "").toLowerCase();
  if (raw.includes("run")) return ThreadStatus.running;
  if (raw.includes("queue")) return ThreadStatus.queued;
  if (raw.includes("wait")) return ThreadStatus.waitingForInput;
  if (raw.includes("fail") || raw.includes("error")) return ThreadStatus.failed;
  if (raw.includes("cancel")) return ThreadStatus.cancelled;
  if (raw.includes("complete")) return ThreadStatus.completed;
  return ThreadStatus.idle;
}

function messageFromAppServerItem(item, fallbackId, createdAt) {
  if (!item || typeof item !== "object") return null;
  if (item.type === "userMessage") {
    const content = textFromUserInput(item.content);
    if (!content.trim()) return null;
    return { id: item.id || fallbackId, role: "user", content, createdAt };
  }
  if (item.type === "agentMessage") {
    const content = String(item.text || "").trim();
    if (!content) return null;
    return { id: item.id || fallbackId, role: "codex", content, createdAt };
  }
  if (item.type === "plan") {
    const content = String(item.text || "").trim();
    if (!content) return null;
    return { id: item.id || fallbackId, role: "status", content, createdAt, status: ThreadStatus.running };
  }
  if (item.type === "reasoning") {
    const content = [...(item.summary || []), ...(item.content || [])].map(String).filter(Boolean).join("\n").trim();
    if (!content) return null;
    return { id: item.id || fallbackId, role: "status", content, createdAt, status: ThreadStatus.running };
  }
  return null;
}

function normalizeAppServerThread(thread, project) {
  const updatedAt = isoFromSeconds(thread.updatedAt || thread.recencyAt || thread.createdAt);
  return {
    id: thread.id,
    source: "codex",
    projectId: project.id,
    projectName: project.name,
    cwd: thread.cwd || project.cwd,
    title: thread.name || thread.thread_name || "Untitled",
    preview: thread.preview || "",
    updatedAt,
    status: normalizeAppServerStatus(thread.status),
    codexThreadId: thread.id
  };
}

function textFromUserInput(input) {
  if (!Array.isArray(input)) return "";
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      if (item.type === "text") return item.text || "";
      if (item.type === "mention") return item.name || item.path || "";
      if (item.type === "skill") return item.name || item.path || "";
      if (item.type === "image" || item.type === "localImage") return "[image]";
      if (item.type === "audio" || item.type === "localAudio") return "[audio]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function mergeMessages(localMessages, appServerMessages) {
  const byId = new Map();
  for (const message of [...localMessages, ...appServerMessages]) {
    byId.set(message.id, message);
  }
  return [...byId.values()];
}

function isoFromSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number * 1000).toISOString();
}

function mergeThread(existing, incoming) {
  const merged = { ...existing, ...incoming };
  if (existing.title && existing.title !== "Untitled") merged.title = existing.title;
  if (existing.preview && !incoming.preview) merged.preview = existing.preview;
  if (existing.projectId) merged.projectId = existing.projectId;
  if (existing.projectName) merged.projectName = existing.projectName;
  if (existing.cwd) merged.cwd = existing.cwd;
  return merged;
}

function limitProjects(projects) {
  const limit = Number(process.env.CODEX_WATCH_PROJECT_LIMIT || DEFAULT_PROJECT_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) return projects;
  return projects.slice(0, limit);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumNumbers(...values) {
  const numbers = values.map(numberOrNull).filter((value) => value != null);
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0);
}

function processAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}
