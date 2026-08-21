import { spawnSync } from "node:child_process";
import { label } from "./launchd.js";

const result = spawnSync("launchctl", ["print", `gui/${process.getuid()}/${label}`], { encoding: "utf8" });
if (result.status === 0) {
  console.log(result.stdout.replace(/(CODEX_WATCH_BRIDGE_TOKEN => ).+/g, "$1<redacted>"));
} else {
  console.error(result.stderr || `${label} is not loaded`);
  process.exit(result.status || 1);
}
