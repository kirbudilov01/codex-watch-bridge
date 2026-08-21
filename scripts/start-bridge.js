import os from "node:os";
import { createServer } from "../src/server.js";

const requestedPort = Number(process.env.PORT || 8765);
start(requestedPort);

function start(port) {
  const server = createServer();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && !process.env.PORT && port < requestedPort + 20) {
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
      start(port + 1);
      return;
    }
    throw error;
  });

  server.listen(port, "0.0.0.0", () => {
    const addresses = lanAddresses();
    console.log(`Codex Watch Bridge listening on http://127.0.0.1:${port}`);
    if (addresses.length) {
      console.log("Use one of these URLs in WatchApp/Config.xcconfig for a physical Apple Watch:");
      for (const address of addresses) console.log(`  http://${address}:${port}`);
    }
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}
