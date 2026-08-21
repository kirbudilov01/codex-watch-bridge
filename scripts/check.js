import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const testFiles = readdirSync("test")
  .filter((file) => file.endsWith(".test.js"))
  .map((file) => path.join("test", file));

const steps = [
  ["node", ["--test", ...testFiles], {}],
  ["swift", ["build"], {}],
  ["node", ["scripts/doctor.js"], {}]
];

for (const [command, args, options] of steps) {
  console.log(`\n> ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
