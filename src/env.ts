// Centralized environment variable access for Pi-Tainá
// All env var reads go through this module — no process.env scattered in code

export interface EnvConfig {
  // Required
  telegramBotToken: string;
  geminiApiKey: string;

  // ATProto (optional — publishing disabled without these)
  atprotoHandle: string | undefined;
  atprotoPassword: string | undefined;
  atprotoService: string; // defaults to "https://bsky.social"

  // Optional AI providers (for Pi agent multi-model support)
  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;

  // Model overrides
  piModel: string;        // defaults to "google/gemini-2.5-flash"
  speciesIdModel: string; // defaults to "gemini-2.5-flash"
}

// Validate required env vars and return typed config
// Throws with descriptive error listing ALL missing vars (not just the first one)
export function loadEnvConfig(): EnvConfig {
  const missing: string[] = [];

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) missing.push("TELEGRAM_BOT_TOKEN");

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) missing.push("GEMINI_API_KEY");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    telegramBotToken: telegramBotToken!,
    geminiApiKey: geminiApiKey!,

    atprotoHandle: process.env.ATPROTO_HANDLE || undefined,
    atprotoPassword: process.env.ATPROTO_PASSWORD || undefined,
    atprotoService: process.env.ATPROTO_SERVICE || "https://bsky.social",

    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,

    piModel: process.env.PI_MODEL || "google/gemini-2.5-flash",
    speciesIdModel: process.env.SPECIES_ID_MODEL || "gemini-2.5-flash",
  };
}

// Check if ATProto publishing is configured
// Returns true only if BOTH atprotoHandle AND atprotoPassword are set
export function isAtprotoConfigured(config: EnvConfig): boolean {
  return config.atprotoHandle !== undefined && config.atprotoPassword !== undefined;
}
