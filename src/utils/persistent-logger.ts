// Tee process.stdout and process.stderr to a daily-rotated file under
// data/logs/ so the bot's output survives journald rotation.
// The 2026-05-18 incident left a ~1h54m gap that couldn't be diagnosed
// because journald had no historical entries for taina.service.

import { promises as fs } from "fs";
import { createWriteStream, type WriteStream } from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "data", "logs");

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let currentStream: WriteStream | null = null;
let currentDate: string | null = null;

function getStream(): WriteStream {
  const stamp = todayStamp();
  if (currentStream && currentDate === stamp) return currentStream;
  if (currentStream) currentStream.end();
  currentDate = stamp;
  currentStream = createWriteStream(path.join(LOG_DIR, `taina-${stamp}.log`), { flags: "a" });
  return currentStream;
}

export async function initPersistentLogger(): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
    try {
      getStream().write(typeof chunk === "string" ? chunk : (chunk as Buffer));
    } catch { /* swallow — never block real stdout */ }
    return origStdoutWrite(chunk as never, encoding as never, cb as never);
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
    try {
      getStream().write(typeof chunk === "string" ? chunk : (chunk as Buffer));
    } catch { /* swallow */ }
    return origStderrWrite(chunk as never, encoding as never, cb as never);
  }) as typeof process.stderr.write;
}
