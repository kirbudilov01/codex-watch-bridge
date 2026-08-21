import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { URL } from "node:url";
import { CodexStore } from "./codexStore.js";
import { CodexRunner } from "./codexRunner.js";

export function createServer({ store = new CodexStore(), runner = null } = {}) {
  const codexRunner = runner || new CodexRunner({ store });

  return http.createServer(async (req, res) => {
    const started = Date.now();
    let url;
    let method;
    try {
      if (!authorized(req)) return json(res, 401, { error: "Authentication failed" });
      url = new URL(req.url, "http://localhost");
      method = req.method || "GET";
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

      if (method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, codexHomeIndexBytes: await store.codexHomeSizeHint() });
      }

      if (method === "GET" && url.pathname === "/projects") {
        return json(res, 200, { projects: await store.listProjects() });
      }

      if (method === "GET" && url.pathname === "/limits") {
        return json(res, 200, { limits: await store.accountLimits() });
      }

      if (parts[0] === "projects" && parts[2] === "threads") {
        const projectId = parts[1];
        if (method === "GET") return json(res, 200, { threads: await store.listThreads(projectId) });
        if (method === "POST") {
          const body = await readBody(req);
          const title = String(body.title || "").trim();
          if (!title) return json(res, 400, { error: "Chat title is required" });
          const thread = await store.createThread(projectId, title);
          return json(res, 201, { thread });
        }
      }

      if (parts[0] === "threads" && parts[1]) {
        const threadId = parts[1];
        const thread = await store.getThread(threadId);
        if (!thread) return json(res, 404, { error: "Thread not found" });

        if (method === "GET" && parts.length === 2) return json(res, 200, { thread });
        if (method === "GET" && parts[2] === "messages") return json(res, 200, { messages: await store.getMessages(threadId) });
        if (method === "GET" && parts[2] === "status") return json(res, 200, { status: thread.status || "idle" });
        if (method === "POST" && parts[2] === "messages") {
          const body = await readBody(req);
          if (!body.text || !String(body.text).trim()) return json(res, 400, { error: "Message text is required" });
          const updated = await codexRunner.sendMessage(thread, String(body.text).trim());
          return json(res, 202, { thread: updated });
        }
      }

      return json(res, 404, { error: "Not found" });
    } catch (error) {
      return json(res, error.statusCode || 500, { error: error.message || "Backend error" });
    } finally {
      if (url?.pathname !== "/health") {
        console.log(`${new Date().toISOString()} ${method || req.method || "GET"} ${url?.pathname || req.url} ${res.statusCode} ${Date.now() - started}ms`);
      }
    }
  });
}

function authorized(req) {
  const token = process.env.CODEX_WATCH_BRIDGE_TOKEN;
  if (!token) return true;
  const expected = `Bearer ${token}`;
  const actual = String(req.headers.authorization || "");
  return safeEqual(actual, expected);
}

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw httpError(400, "Request body is too large");
  }
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw httpError(400, "Request body must be valid JSON");
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  res.end(body);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8765);
  createServer().listen(port, "0.0.0.0", () => {
    console.log(`Codex Watch Bridge listening on http://127.0.0.1:${port}`);
  });
}
