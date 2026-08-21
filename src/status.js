export const ThreadStatus = Object.freeze({
  idle: "idle",
  queued: "queued",
  running: "running",
  waitingForInput: "waiting_for_input",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled"
});

export function isActiveStatus(status) {
  return status === ThreadStatus.queued ||
    status === ThreadStatus.running ||
    status === ThreadStatus.waitingForInput;
}

export function normalizeStatus(value) {
  if (!value) return ThreadStatus.idle;
  const raw = String(value).toLowerCase();
  if (raw.includes("wait")) return ThreadStatus.waitingForInput;
  if (raw.includes("queue")) return ThreadStatus.queued;
  if (raw.includes("run") || raw.includes("work") || raw.includes("progress")) return ThreadStatus.running;
  if (raw.includes("fail") || raw.includes("error")) return ThreadStatus.failed;
  if (raw.includes("cancel")) return ThreadStatus.cancelled;
  if (raw.includes("complete") || raw.includes("done") || raw.includes("finish")) return ThreadStatus.completed;
  return ThreadStatus.idle;
}
