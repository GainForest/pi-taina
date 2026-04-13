// Persistent per-user preferred language storage for Telegram users.
// Keeps a normalized language tag on disk so the bot can remember it across restarts.

import * as fs from 'fs';
import * as path from 'path';

interface UserLanguageData {
  preferences: Record<string, string>;
}

const USER_LANGUAGE_PATH = './data/user-languages.json';

let cache: UserLanguageData | null = null;

function userKey(userId: number): string {
  return String(userId);
}

function ensureLoaded(): UserLanguageData {
  if (cache) {
    return cache;
  }

  try {
    const raw = fs.readFileSync(USER_LANGUAGE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UserLanguageData>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.preferences !== 'object' || parsed.preferences === null) {
      throw new Error('Invalid user language file structure');
    }

    const preferences: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.preferences)) {
      const normalized = normalizeLanguageTag(value);
      if (normalized) {
        preferences[key] = normalized;
      }
    }

    cache = { preferences };
    return cache;
  } catch (err: unknown) {
    const isNotFound =
      err instanceof Error &&
      'code' in (err as NodeJS.ErrnoException) &&
      (err as NodeJS.ErrnoException).code === 'ENOENT';

    if (!isNotFound) {
      console.warn('[user-language] Warning: could not read language file, starting fresh.', err);
    }

    cache = { preferences: {} };
    return cache;
  }
}

function saveToDisk(): void {
  const data = ensureLoaded();
  const dir = path.dirname(USER_LANGUAGE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USER_LANGUAGE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Normalize a language code/tag to a canonical BCP 47 tag.
 */
export function normalizeLanguageTag(languageCode?: string): string | undefined {
  if (!languageCode) {
    return undefined;
  }

  const trimmed = languageCode.trim().replace(/_/g, '-');
  if (!trimmed) {
    return undefined;
  }

  try {
    const [canonical] = Intl.getCanonicalLocales(trimmed);
    return canonical;
  } catch {
    return undefined;
  }
}

/**
 * Read the persisted preferred language for a Telegram user.
 */
export function getPreferredLanguage(userId: number): string | undefined {
  return ensureLoaded().preferences[userKey(userId)];
}

/**
 * Persist a preferred language for a Telegram user.
 * Returns the normalized language tag if the input was valid.
 */
export function setPreferredLanguage(userId: number, languageCode: string): string | undefined {
  const normalized = normalizeLanguageTag(languageCode);
  if (!normalized) {
    return undefined;
  }

  const data = ensureLoaded();
  const key = userKey(userId);
  if (data.preferences[key] !== normalized) {
    data.preferences[key] = normalized;
    saveToDisk();
  }

  return normalized;
}

/**
 * Seed the user's preferred language from Telegram metadata if not already set.
 * Returns the existing or newly seeded normalized tag.
 */
export function ensurePreferredLanguage(userId: number, telegramLanguageCode?: string): string | undefined {
  const existing = getPreferredLanguage(userId);
  if (existing) {
    return existing;
  }

  if (!telegramLanguageCode) {
    return undefined;
  }

  return setPreferredLanguage(userId, telegramLanguageCode);
}
