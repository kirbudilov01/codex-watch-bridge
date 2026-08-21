import { spawnSync } from "node:child_process";
import { AppServerClient } from "../src/appServerClient.js";
import { CodexStore } from "../src/codexStore.js";

const store = new CodexStore();
const appServer = new AppServerClient();
const codex = spawnSync("codex", ["--version"], { encoding: "utf8" });
const started = Date.now();
const projects = await store.listProjects();
const limits = await store.accountLimits().catch(() => null);
const appServerAvailable = await appServer.available();

console.log(JSON.stringify({
  node: process.version,
  codexCli: codex.status === 0 ? codex.stdout.trim() : `failed: ${codex.stderr.trim() || codex.error?.message}`,
  codexDesktopAppServer: appServerAvailable ? "available" : "unavailable",
  bridgeToken: process.env.CODEX_WATCH_BRIDGE_TOKEN ? "configured" : "not configured",
  projects: projects.length,
  projectsLatencyMs: Date.now() - started,
  firstProject: projects[0]?.name || null,
  accountLimitLeftPercent: limits?.primary?.usedPercent == null ? null : Math.floor(100 - limits.primary.usedPercent),
  limitsSource: limits?.source || "app-server"
}, null, 2));
