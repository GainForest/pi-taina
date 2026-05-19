// Wrap a promise with a hard timeout budget.
// On timeout, rejects with a labelled error so callers can surface a fast
// fail-fast message instead of blocking the polling loop indefinitely.
// Added after the 2026-05-18 incident where slow Gemini/Telegram calls
// stalled the bot for tens of seconds while users waited.

export class TimeoutError extends Error {
  readonly code = "timeout";
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
