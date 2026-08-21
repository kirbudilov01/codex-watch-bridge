import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { label, plistPath } from "./launchd.js";

spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/${label}`], { stdio: "ignore" });
spawnSync("launchctl", ["bootout", `gui/${process.getuid()}`, plistPath], { stdio: "ignore" });
await rm(plistPath, { force: true });
console.log(`Uninstalled ${label}`);
