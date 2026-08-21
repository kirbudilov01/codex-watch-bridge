import os from "node:os";
import path from "node:path";

export const label = "com.kirill.codex-apple-watch-bridge";
export const tunnelLabel = "com.kirill.codex-apple-watch-tunnel";
export const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
export const serviceHome = path.join(os.homedir(), ".codex-watch-bridge");
export const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
export const tunnelPlistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${tunnelLabel}.plist`);
export const defaultPort = process.env.CODEX_WATCH_SERVICE_PORT || "8767";
export const defaultRemotePort = process.env.CODEX_WATCH_REMOTE_PORT || "18767";
export const defaultRemoteHost = process.env.CODEX_WATCH_REMOTE_HOST || "trendvi-prod-current";
export const nodePath = process.execPath;

export function plist({ port = defaultPort, token = process.env.CODEX_WATCH_BRIDGE_TOKEN || "" } = {}) {
  const pathValue = [
    path.dirname(nodePath),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ].join(":");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(path.join(projectRoot, "scripts", "start-bridge.js"))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>${escapeXml(port)}</string>
    <key>PATH</key>
    <string>${escapeXml(pathValue)}</string>
    ${token ? `<key>CODEX_WATCH_BRIDGE_TOKEN</key>
    <string>${escapeXml(token)}</string>` : ""}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(serviceHome, "bridge.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(serviceHome, "bridge.err.log"))}</string>
</dict>
</plist>
`;
}

export function tunnelPlist({
  localPort = defaultPort,
  remotePort = defaultRemotePort,
  remoteHost = defaultRemoteHost
} = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(tunnelLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/ssh</string>
    <string>-N</string>
    <string>-o</string>
    <string>BatchMode=yes</string>
    <string>-o</string>
    <string>ExitOnForwardFailure=yes</string>
    <string>-o</string>
    <string>ServerAliveInterval=30</string>
    <string>-o</string>
    <string>ServerAliveCountMax=3</string>
    <string>-o</string>
    <string>ConnectTimeout=10</string>
    <string>-R</string>
    <string>127.0.0.1:${escapeXml(remotePort)}:127.0.0.1:${escapeXml(localPort)}</string>
    <string>${escapeXml(remoteHost)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(serviceHome, "tunnel.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(serviceHome, "tunnel.err.log"))}</string>
</dict>
</plist>
`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
