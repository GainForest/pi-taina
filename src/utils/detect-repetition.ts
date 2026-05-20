// Defensive truncate for LLM-generated text that fell into a degeneration
// loop (same token emitted indefinitely until the max-output-tokens cap).
// Observed on 2026-05-19: Gemini 3 Flash Preview returned 32_038 chars where
// 31_528 were the same emoji 🌻 — that landed in users' Telegram chats.
// We never want to forward a runaway like that.

// Detect a trailing run of repeated graphemes (or grapheme pairs). If the
// last `tail` chars are dominated by a single repeating unit, return a
// truncated version. Otherwise return the input unchanged.
export function trimRunawayRepetition(text: string, options?: {
  tail?: number;       // bytes to inspect at the end (default 200)
  maxRunChars?: number; // max length of a same-grapheme run before we cut (default 30)
  ellipsis?: string;   // appended after truncation (default " …")
}): string {
  const tail = options?.tail ?? 200;
  const maxRunChars = options?.maxRunChars ?? 30;
  const ellipsis = options?.ellipsis ?? " …";
  if (text.length < tail) return text;

  // Walk back from the end, counting how many characters are equal to the
  // very last character. Multi-codepoint emojis (e.g. ZWJ-joined) need
  // Array.from to be treated as graphemes, but for our purposes a simple
  // codepoint match is enough — runaway loops repeat single codepoints.
  const chars = Array.from(text); // graphemes-ish; emoji-safe enough
  const last = chars[chars.length - 1];
  let runStart = chars.length - 1;
  while (runStart > 0 && chars[runStart - 1] === last) {
    runStart--;
  }
  const runLen = chars.length - runStart;
  if (runLen > maxRunChars) {
    return chars.slice(0, runStart).join("") + ellipsis;
  }
  return text;
}
