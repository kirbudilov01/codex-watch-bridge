import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tunnelLabel, tunnelPlistPath } from "./launchd.js";

spawnSync("launchctl", ["bootout", `gui/${process.getuid()}`, tunnelPlistPath], { stdio: "ignore" });
await rm(tunnelPlistPath, { force: true });
console.log(`Uninstalled ${tunnelLabel}`);
