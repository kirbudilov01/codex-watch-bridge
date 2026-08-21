import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ThreadStatus } from "./status.js";

export class BridgeStorage {
  constructor(root = process.env.CODEX_WATCH_BRIDGE_HOME || path.join(process.env.HOME || ".", ".codex-watch-bridge")) {
    this.root = root;
    this.file = path.join(root, "threads.json");
  }

  async load() {
    try {
      return JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      return { threads: [] };
    }
  }

  async save(data) {
    await mkdir(this.root, { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, this.file);
  }

  async listThreads() {
    return (await this.load()).threads || [];
  }

  async getThread(id) {
    return (await this.listThreads()).find((thread) => thread.id === id) || null;
  }

  async createThread({ id = null, source = "watch", codexThreadId = null, projectId, projectName, cwd, title, status = ThreadStatus.idle, preview = "" }) {
    const data = await this.load();
    const now = new Date().toISOString();
    const thread = {
      id: id || `watch-${randomUUID()}`,
      source,
      codexThreadId,
      projectId,
      projectName,
      cwd,
      title: title?.trim() || "New Chat",
      preview,
      createdAt: now,
      updatedAt: now,
      status,
      messages: []
    };
    data.threads = [thread, ...(data.threads || [])];
    await this.save(data);
    return thread;
  }

  async appendMessage(threadId, message) {
    const data = await this.load();
    const thread = data.threads.find((item) => item.id === threadId);
    if (!thread) return null;
    thread.messages ||= [];
    thread.messages.push(message);
    thread.preview = message.content.slice(0, 160);
    thread.updatedAt = message.createdAt;
    await this.save(data);
    return thread;
  }

  async updateThread(threadId, patch) {
    const data = await this.load();
    const thread = data.threads.find((item) => item.id === threadId);
    if (!thread) return null;
    Object.assign(thread, patch, { updatedAt: new Date().toISOString() });
    await this.save(data);
    return thread;
  }
}
