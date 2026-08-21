import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ThreadStatus } from "./status.js";

const DEFAULT_RUN_TIMEOUT_MS = 45 * 60 * 1000;

async function executableAvailable(command) {
  if (command.includes("/")) {
    try {
      await access(command);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

export class CodexRunner {
  constructor({ command = process.env.CODEX_WATCH_CODEX_COMMAND || "codex", store } = {}) {
    this.command = command;
    this.store = store;
    this.runTimeoutMs = Number(process.env.CODEX_WATCH_RUN_TIMEOUT_MS || DEFAULT_RUN_TIMEOUT_MS);
  }

  async sendMessage(thread, text) {
    if (!thread) throw new Error("Thread not found.");

    if (thread.source === "watch") {
      if (!(await executableAvailable(this.command))) {
        throw new Error(`Codex command is not available: ${this.command}`);
      }
      await this.store.appendUserMessage(thread.id, text);
      await this.store.updateLocalThread(thread.id, { status: ThreadStatus.queued });
      await this.store.appendStatus(thread.id, "Queued", ThreadStatus.queued);
      this.runWatchThreadInBackground(thread, text);
      return this.store.getThread(thread.id);
    }

    const queued = await this.sendExistingThreadViaAppServer(thread, text);
    if (queued) return queued;

    if (!(await executableAvailable(this.command))) {
      throw new Error(`Codex command is not available: ${this.command}`);
    }
    this.queueExistingThreadInBackground(thread, text);
    return { ...thread, status: ThreadStatus.queued };
  }

  async sendExistingThreadViaAppServer(thread, text) {
    if (!this.store?.appServer?.startTurn) return null;
    const threadId = thread.codexThreadId || thread.id;
    try {
      await this.store.appendUserMessage(thread.id, text).catch(() => {});
      await this.store.updateLocalThread(thread.id, { status: ThreadStatus.queued }).catch(() => {});
      await this.store.appendStatus(thread.id, "Queued", ThreadStatus.queued).catch(() => {});
      await this.store.appServer.startTurn(threadId, text, { cwd: thread.cwd || null });
      console.log(`Codex app-server turn started thread=${thread.id} target=${threadId}`);
      return { ...thread, status: ThreadStatus.queued };
    } catch (error) {
      console.error(`Codex app-server turn/start failed for ${thread.id}, falling back to codex queue: ${error.message}`);
      return null;
    }
  }

  queueExistingThreadInBackground(thread, text) {
    setTimeout(async () => {
      const args = ["queue", "--thread", thread.codexThreadId || thread.id, "--message", text];
      console.log(`Codex queue spawn thread=${thread.id} target=${thread.codexThreadId || thread.id}`);
      const child = spawn(this.command, args, {
        cwd: thread.cwd || process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env
      });

      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", (error) => {
        console.error(`Codex queue failed for ${thread.id}: ${error.message}`);
      });
      child.on("close", (code) => {
        if (code !== 0) console.error(`Codex queue failed for ${thread.id}: ${stderr.trim()}`);
        else console.log(`Codex queue completed thread=${thread.id}`);
      });
    }, 0);
  }

  runWatchThreadInBackground(thread, text) {
    setTimeout(async () => {
      await this.store.updateLocalThread(thread.id, { status: ThreadStatus.running });
      await this.store.appendStatus(thread.id, "Working...", ThreadStatus.running);

      const targetThread = thread.codexThreadId || null;
      const args = targetThread
        ? ["queue", "--thread", targetThread, "--message", text]
        : ["exec", "--json", "--cd", thread.cwd || process.cwd(), "--skip-git-repo-check", text];
      const child = spawn(this.command, args, {
        cwd: thread.cwd || process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env
      });
      console.log(`Codex run spawn thread=${thread.id} pid=${child.pid || "unknown"} command=${this.command} ${args[0]}`);
      await this.store.updateLocalThread(thread.id, {
        runnerPid: child.pid || null,
        runnerStartedAt: new Date().toISOString(),
        runnerCommand: `${this.command} ${args[0]}`
      });

      let stdout = "";
      let stderr = "";
      let closed = false;
      let lastStatus = "";
      const timeout = Number.isFinite(this.runTimeoutMs) && this.runTimeoutMs > 0
        ? setTimeout(async () => {
            if (closed) return;
            console.error(`Codex run timed out thread=${thread.id} pid=${child.pid || "unknown"}`);
            child.kill("SIGTERM");
            await this.fail(thread.id, "Codex run timed out.", { clearRunner: true });
          }, this.runTimeoutMs)
        : null;
      child.stdout.on("data", (chunk) => {
        const textChunk = chunk.toString();
        stdout += textChunk;
        const nativeThreadId = this.extractThreadId(textChunk);
        if (nativeThreadId) {
          this.store.updateLocalThread(thread.id, { codexThreadId: nativeThreadId }).catch(() => {});
        }
        const status = this.extractStatusMessage(textChunk);
        if (status && status !== lastStatus) {
          lastStatus = status;
          this.store.appendStatus(thread.id, status, ThreadStatus.running).catch(() => {});
        }
      });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

      child.on("error", async (error) => {
        closed = true;
        if (timeout) clearTimeout(timeout);
        await this.fail(thread.id, error.message, { clearRunner: true });
      });

      child.on("close", async (code) => {
        closed = true;
        if (timeout) clearTimeout(timeout);
        console.log(`Codex run close thread=${thread.id} pid=${child.pid || "unknown"} code=${code}`);
        if (code === 0) {
          const content = this.extractFinalMessage(stdout) || "Completed";
          await this.store.appendStatus(thread.id, "Completed", ThreadStatus.completed);
          await this.store.storage.appendMessage(thread.id, {
            id: randomUUID(),
            role: "codex",
            content,
            createdAt: new Date().toISOString(),
            status: ThreadStatus.completed
          });
          await this.store.updateLocalThread(thread.id, {
            status: ThreadStatus.completed,
            preview: content.slice(0, 160),
            runnerPid: null,
            runnerStartedAt: null,
            runnerCommand: null
          });
        } else {
          await this.fail(thread.id, stderr.trim() || `Codex exited with code ${code}`, { clearRunner: true });
        }
      });
    }, 0);
  }

  async fail(threadId, message, { clearRunner = false } = {}) {
    const safeMessage = message.replaceAll(process.env.HOME || "", "~").slice(0, 1000);
    await this.store.appendStatus(threadId, `Failed: ${safeMessage}`, ThreadStatus.failed);
    await this.store.updateLocalThread(threadId, {
      status: ThreadStatus.failed,
      ...(clearRunner ? { runnerPid: null, runnerStartedAt: null, runnerCommand: null } : {})
    });
  }

  extractThreadId(output) {
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const payload = event.payload || event;
        const id = payload.session_id || payload.id || payload.thread_id;
        if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) return id;
      } catch {
        // Non-JSON CLI output is ignored.
      }
    }
    return null;
  }

  extractFinalMessage(output) {
    const messages = [];
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const item = event.payload || event;
        const message = item.message || item.content || item.text || item.output_text;
        if (typeof message === "string" && message.trim()) messages.push(message.trim());
      } catch {
        // Ignore non-JSON lines.
      }
    }
    return messages.at(-1) || output.trim();
  }

  extractStatusMessage(output) {
    const messages = [];
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const item = event.payload || event;
        if (item.type === "token_count") continue;
        const message = item.message || item.title || "";
        if (typeof message === "string" && message.trim() && message.length < 500) {
          messages.push(message.trim());
        }
      } catch {
        // Ignore partial/non-JSON lines.
      }
    }
    return messages.at(-1) || null;
  }
}
