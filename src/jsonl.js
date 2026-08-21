import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export async function readJsonl(filePath, { limit = 0 } = {}) {
  const rows = [];
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
      if (limit > 0 && rows.length >= limit) {
        lines.close();
        input.destroy();
        break;
      }
    } catch {
      // Ignore corrupt partial lines; Codex may be appending while we read.
    }
  }
  return rows;
}

export function textFromContent(content) {
  return extractText(content).join("\n").trim();
}

function extractText(value) {
  if (value == null) return [];
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => extractText(item));
  if (typeof value !== "object") return [];

  const preferredKeys = ["text", "input_text", "output_text", "message", "content", "summary"];
  const direct = [];
  for (const key of preferredKeys) {
    if (Object.hasOwn(value, key)) direct.push(...extractText(value[key]));
  }
  if (direct.length > 0) return direct;

  const ignoredKeys = new Set(["id", "type", "role", "status", "metadata", "created_at", "updated_at"]);
  return Object.entries(value)
    .filter(([key]) => !ignoredKeys.has(key))
    .flatMap(([, item]) => extractText(item));
}
