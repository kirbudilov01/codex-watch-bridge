import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { defaultPort, defaultRemoteHost, defaultRemotePort, serviceHome, tunnelLabel, tunnelPlist, tunnelPlistPath } from "./launchd.js";

const localPort = process.env.CODEX_WATCH_SERVICE_PORT || defaultPort;
const remotePort = process.env.CODEX_WATCH_REMOTE_PORT || defaultRemotePort;
const remoteHost = process.env.CODEX_WATCH_REMOTE_HOST || defaultRemoteHost;

await mkdir(serviceHome, { recursive: true });
await mkdir(new URL(`file://${tunnelPlistPath}`).pathname.split("/").slice(0, -1).join("/"), { recursive: true });
await writeFile(tunnelPlistPath, tunnelPlist({ localPort, remotePort, remoteHost }));

spawnSync("launchctl", ["bootout", `gui/${process.getuid()}`, tunnelPlistPath], { stdio: "ignore" });
const bootstrap = spawnSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, tunnelPlistPath], { encoding: "utf8" });
if (bootstrap.status !== 0) {
  console.error(bootstrap.stderr || bootstrap.stdout);
  process.exit(bootstrap.status || 1);
}

spawnSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${tunnelLabel}`], { stdio: "inherit" });
console.log(`Installed ${tunnelLabel}`);
console.log(`Remote: ${remoteHost}:127.0.0.1:${remotePort} -> Mac 127.0.0.1:${localPort}`);
console.log(`Plist: ${tunnelPlistPath}`);
console.log(`Logs: ${serviceHome}/tunnel.out.log and ${serviceHome}/tunnel.err.log`);
