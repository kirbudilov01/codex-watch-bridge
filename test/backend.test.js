import { chmod, mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { CodexStore } from "../src/codexStore.js";
import { BridgeStorage } from "../src/localStorage.js";
import { createServer } from "../src/server.js";
import { CodexRunner } from "../src/codexRunner.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-watch-"));
  const codexHome = path.join(root, "codex");
  const storageHome = path.join(root, "bridge");
  const workdir = path.join(root, "want2view");
  const sessionDir = path.join(codexHome, "sessions", "2026", "08", "21");
  await mkdir(sessionDir, { recursive: true });
  await mkdir(workdir, { recursive: true });
  const id = "01a02367-ade6-78d2-bb6f-105b0b311c6c";
  await writeFile(path.join(codexHome, "session_index.jsonl"), `${JSON.stringify({ id, thread_name: "Audit Apple Watch", updated_at: "2026-08-21T08:20:00.000Z" })}\n`);
  await writeFile(path.join(sessionDir, `rollout-2026-08-21T11-19-52-${id}.jsonl`), [
    JSON.stringify({ timestamp: "2026-08-21T08:19:52.000Z", type: "session_meta", payload: { id, cwd: workdir, originator: "Codex Desktop" } }),
    JSON.stringify({ timestamp: "2026-08-21T08:19:53.000Z", type: "response_item", payload: { type: "message", id: "u1", role: "user", content: [{ type: "input_text", text: "Run tests" }] } }),
    JSON.stringify({ timestamp: "2026-08-21T08:19:54.000Z", type: "event_msg", payload: { type: "agent_message", message: "Running tests..." } }),
    JSON.stringify({ timestamp: "2026-08-21T08:19:55.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 52236, output_tokens: 1139, total_tokens: 53375 }, model_context_window: 258400 }, rate_limits: { primary: { used_percent: 76 } } } }),
    JSON.stringify({ timestamp: "2026-08-21T08:20:00.000Z", type: "response_item", payload: { type: "message", id: "a1", role: "assistant", content: { content: [{ type: "output_text", text: "Tests passed" }] } } })
  ].join("\n"));
  const storage = new BridgeStorage(storageHome);
  return { root, codexHome, storage, id, workdir };
}

const unavailableAppServer = {
  startThread: async () => {
    throw new Error("app-server unavailable");
  },
  rateLimits: async () => {
    throw new Error("app-server unavailable");
  }
};

async function addIndexedSession({ codexHome, workdir, id, name, updatedAt = "2026-08-20T00:00:00.000Z" }) {
  const sessionDir = path.join(codexHome, "sessions", "2026", "08", "20");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(codexHome, "session_index.jsonl"), `${JSON.stringify({ id, thread_name: name, updated_at: updatedAt })}\n`, { flag: "a" });
  await writeFile(path.join(sessionDir, `rollout-2026-08-20T00-00-00-${id}.jsonl`), [
    JSON.stringify({ timestamp: updatedAt, type: "session_meta", payload: { id, cwd: workdir, originator: "Codex Desktop" } }),
    JSON.stringify({ timestamp: updatedAt, type: "response_item", payload: { type: "message", id: `${id}-m`, role: "assistant", content: [{ type: "output_text", text: name }] } })
  ].join("\n"));
}

test("lists projects, threads, and normalized messages from Codex sessions", async () => {
  const { codexHome, storage, id } = await fixture();
  const store = new CodexStore({ codexHome, storage, appServer: unavailableAppServer });

  const projects = await store.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "want2view");

  const threads = await store.listThreads(projects[0].id);
  assert.equal(threads[0].id, id);
  assert.equal(threads[0].title, "Audit Apple Watch");

  const messages = await store.getMessages(id);
  assert.deepEqual(messages.map((message) => message.role), ["user", "status", "codex"]);
  assert.equal(messages.at(-1).content, "Tests passed");

  const thread = await store.getThread(id);
  assert.equal(thread.tokenUsage.contextPercent, 21);
  assert.equal(thread.tokenUsage.rateLimitPercent, 76);
});

test("creates watch thread and preserves project mapping", async () => {
  const { codexHome, storage, workdir } = await fixture();
  const store = new CodexStore({ codexHome, storage, appServer: unavailableAppServer });
  const [project] = await store.listProjects();
  const thread = await store.createThread(project.id, "Fix Instagram scraper");

  assert.match(thread.id, /^watch-/);
  assert.equal(thread.title, "Fix Instagram scraper");
  assert.equal(thread.cwd, workdir);

  const persisted = JSON.parse(await readFile(storage.file, "utf8"));
  assert.equal(persisted.threads[0].projectId, project.id);
});

test("creates native Codex thread through app-server when available", async () => {
  const { codexHome, storage, workdir } = await fixture();
  const nativeId = "00000000-0000-4000-8000-000000000999";
  const appServer = {
    startThread: async ({ cwd, title }) => ({
      id: nativeId,
      cwd,
      name: title,
      preview: "",
      status: "idle"
    })
  };
  const store = new CodexStore({ codexHome, storage, appServer });
  const [project] = await store.listProjects();

  const thread = await store.createThread(project.id, "Native from watch");

  assert.equal(thread.id, nativeId);
  assert.equal(thread.source, "codex");
  assert.equal(thread.codexThreadId, nativeId);
  assert.equal(thread.cwd, workdir);
});

test("does not clip projects or threads at old index limits", async () => {
  const { codexHome, storage, workdir } = await fixture();
  for (let index = 0; index < 505; index += 1) {
    await addIndexedSession({
      codexHome,
      workdir,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: `Older chat ${index}`
    });
  }

  const store = new CodexStore({ codexHome, storage, appServer: unavailableAppServer });
  const [project] = await store.listProjects();
  const threads = await store.listThreads(project.id);

  assert.equal(project.threadCount, 506);
  assert.equal(threads.length, 506);
});

test("reports active Codex sessions in project counts", async () => {
  const { codexHome, storage, id } = await fixture();
  await mkdir(path.join(codexHome, "process_manager"), { recursive: true });
  await writeFile(path.join(codexHome, "process_manager", "chat_processes.json"), JSON.stringify([{ conversationId: id }]));

  const store = new CodexStore({ codexHome, storage, appServer: unavailableAppServer });
  const [project] = await store.listProjects();
  const [thread] = await store.listThreads(project.id);

  assert.equal(project.activeCount, 1);
  assert.equal(thread.status, "running");
});

test("HTTP API returns projects and supports creating a thread", async () => {
  const { codexHome, storage } = await fixture();
  const store = new CodexStore({ codexHome, storage, appServer: unavailableAppServer });
  const server = createServer({ store, runner: { sendMessage: async () => null } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const projectsResponse = await fetch(`${base}/projects`);
    assert.equal(projectsResponse.status, 200);
    const { projects } = await projectsResponse.json();

    const createResponse = await fetch(`${base}/projects/${encodeURIComponent(projects[0].id)}/threads`, {
      method: "POST",
      body: JSON.stringify({ title: "Watch-created chat" })
    });
    assert.equal(createResponse.status, 201);
    const { thread } = await createResponse.json();
    assert.equal(thread.title, "Watch-created chat");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HTTP API returns account rate limits", async () => {
  const { codexHome, storage } = await fixture();
  const appServer = {
    rateLimits: async () => ({
      primary: { id: "codex", name: "Codex", usedPercent: 29, secondaryUsedPercent: null, windowDurationMins: 10080, resetsAt: null, planType: "pro", reached: false },
      buckets: [],
      resetCredits: null,
      updatedAt: "2026-08-21T00:00:00.000Z"
    })
  };
  const store = new CodexStore({ codexHome, storage, appServer });
  const server = createServer({ store, runner: { sendMessage: async () => null } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/limits`);
    assert.equal(response.status, 200);
    const { limits } = await response.json();
    assert.equal(limits.primary.usedPercent, 29);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runner sends existing Codex thread through app-server when available", async () => {
  const { codexHome, storage, id, workdir } = await fixture();
  const turns = [];
  const appServer = {
    startTurn: async (threadId, text, options) => {
      turns.push({ threadId, text, options });
      return { ok: true };
    }
  };
  const store = new CodexStore({ codexHome, storage, appServer });
  const runner = new CodexRunner({ command: "/missing/codex", store });
  const thread = await store.getThread(id);

  const queued = await runner.sendMessage(thread, "Check status");

  assert.equal(queued.status, "queued");
  assert.deepEqual(turns, [{ threadId: id, text: "Check status", options: { cwd: workdir } }]);
});

test("reads native Codex messages from app-server turns before JSONL exists", async () => {
  const { codexHome, storage, id } = await fixture();
  const nativeId = "00000000-0000-4000-8000-000000000123";
  const appServer = {
    readThread: async (threadId) => ({
      id: threadId,
      updatedAt: 1787313600,
      status: { type: "idle" },
      turns: [{
        id: "turn-1",
        status: "completed",
        startedAt: 1787313600,
        completedAt: 1787313602,
        items: [
          { type: "userMessage", id: "user-1", clientId: null, content: [{ type: "text", text: "Smoke", text_elements: [] }] },
          { type: "agentMessage", id: "agent-1", text: "BRIDGE_OK", phase: null, memoryCitation: null, delivery: null }
        ]
      }]
    })
  };
  const store = new CodexStore({ codexHome, storage, appServer });
  await storage.createThread({
    id: nativeId,
    source: "codex",
    codexThreadId: nativeId,
    projectId: "project",
    projectName: "Project",
    cwd: "/tmp/project",
    title: "Native"
  });

  const messages = await store.getMessages(nativeId);
  const thread = await store.getThread(id);

  assert.deepEqual(messages.map((message) => [message.role, message.content]), [["user", "Smoke"], ["codex", "BRIDGE_OK"]]);
  assert.equal(thread.status, "completed");
});

test("runner falls back to codex queue when app-server turn fails", async () => {
  const { root, codexHome, storage, id } = await fixture();
  const appServer = {
    startTurn: async () => {
      throw new Error("app-server down");
    }
  };
  const store = new CodexStore({ codexHome, storage, appServer });
  const fakeCodex = path.join(root, "fake-codex-queue.sh");
  await writeFile(fakeCodex, "#!/bin/sh\nexit 0\n");
  await chmod(fakeCodex, 0o755);
  const runner = new CodexRunner({ command: fakeCodex, store });
  const thread = await store.getThread(id);

  const queued = await runner.sendMessage(thread, "Fallback");

  assert.equal(queued.status, "queued");
});

test("runner sends watch thread through command and stores assistant response", async () => {
  const { root, codexHome, storage } = await fixture();
  const store = new CodexStore({ codexHome, storage, appServer: unavailableAppServer });
  const [project] = await store.listProjects();
  const thread = await store.createThread(project.id, "Runner smoke");
  const fakeCodex = path.join(root, "fake-codex.sh");
  await writeFile(fakeCodex, "#!/bin/sh\nprintf '%s\\n' '{\"payload\":{\"message\":\"Fake completed\"}}'\n");
  await chmod(fakeCodex, 0o755);
  const runner = new CodexRunner({ command: fakeCodex, store });

  const queued = await runner.sendMessage(thread, "Hello");
  assert.equal(queued.status, "queued");

  const updated = await waitFor(async () => {
    const value = await store.getThread(thread.id);
    return value?.status === "completed" ? value : null;
  });
  const messages = await store.getMessages(thread.id);
  assert.equal(updated.status, "completed");
  assert.equal(messages[0].role, "user");
  assert.equal(messages.at(-1).role, "codex");
});

test("stale watch runs recover to failed instead of staying running forever", async () => {
  const { codexHome, storage } = await fixture();
  const store = new CodexStore({ codexHome, storage, appServer: unavailableAppServer });
  const [project] = await store.listProjects();
  const thread = await store.createThread(project.id, "Stale run");
  const data = await storage.load();
  const local = data.threads.find((item) => item.id === thread.id);
  local.status = "running";
  local.updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await storage.save(data);

  const recovered = await store.getThread(thread.id);
  const messages = await store.getMessages(thread.id);

  assert.equal(recovered.status, "failed");
  assert.match(messages.at(-1).content, /Codex process is no longer running/);
});

async function waitFor(fn, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return fn();
}
