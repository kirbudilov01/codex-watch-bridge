import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { defaultPort, label, plist, plistPath, serviceHome } from "./launchd.js";

const port = process.env.PORT || defaultPort;
await mkdir(serviceHome, { recursive: true });
await mkdir(new URL(`file://${plistPath}`).pathname.split("/").slice(0, -1).join("/"), { recursive: true });
await writeFile(plistPath, plist({ port }));

spawnSync("launchctl", ["bootout", `gui/${process.getuid()}`, plistPath], { stdio: "ignore" });
const bootstrap = spawnSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath], { encoding: "utf8" });
if (bootstrap.status !== 0) {
  console.error(bootstrap.stderr || bootstrap.stdout);
  process.exit(bootstrap.status || 1);
}

spawnSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${label}`], { stdio: "inherit" });
console.log(`Installed ${label}`);
console.log(`Port: ${port}`);
console.log(`Plist: ${plistPath}`);
console.log(`Logs: ${serviceHome}/bridge.out.log and ${serviceHome}/bridge.err.log`);
