const lastOutputAt = new Map<string, number>();
const RATE_LIMIT_MS = 30_000;

export function safeStderr(key: string, message: string): void {
  const now = Date.now();
  const previous = lastOutputAt.get(key) ?? 0;
  if (now - previous < RATE_LIMIT_MS) return;
  lastOutputAt.set(key, now);
  try {
    process.stderr.write(`[crash-recorder] ${message}\n`);
  } catch {
    // Crash Recorder 失败不能继续抛错。
  }
}
