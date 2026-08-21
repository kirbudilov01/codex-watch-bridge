import { spawnSync } from "node:child_process";
import { tunnelLabel } from "./launchd.js";

const result = spawnSync("launchctl", ["print", `gui/${process.getuid()}/${tunnelLabel}`], { encoding: "utf8" });
if (result.status === 0) {
  console.log(result.stdout);
} else {
  console.error(result.stderr || `${tunnelLabel} is not loaded`);
  process.exit(result.status || 1);
}
