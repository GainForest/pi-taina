// Centralized environment variable access for Pi-Tainá
// All env var reads go through this module — no process.env scattered in code

export interface EnvConfig {
  // Required
  telegramBotToken: string;
  geminiApiKey: string;
  // Required for access control — Telegram user ID of the initial admin
  adminUserId: number;

  // ATProto (optional — publishing disabled without these)
  atprotoHandle: string | undefined;
  atprotoPassword: string | undefined;
  atprotoService: string; // defaults to "https://bsky.social"

  // Optional AI providers (for Pi agent multi-model support)
  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;

  // Model overrides
  piModel: string;        // defaults to "google/gemini-3.5-flash" — text/routing/vision
  speciesIdModel: string; // defaults to "gemini-3.5-flash" — vision (species ID)

  // GFW Data API (optional — enables forest monitoring features)
  gfwDataApiKey: string | undefined;

  // Polygon Web App (optional — enables organization territory capture)
  polygonWebAppBaseUrl: string;

  // GainForest invite code (optional — used as default for org creation
  // on gainforest.id when the user doesn't supply one inline).
  gainforestInviteCode: string | undefined;
}

// Validate required env vars and return typed config
// Throws with descriptive error listing ALL missing vars (not just the first one)
export function loadEnvConfig(): EnvConfig {
  const missing: string[] = [];

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) missing.push("TELEGRAM_BOT_TOKEN");

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) missing.push("GEMINI_API_KEY");

  const adminUserIdRaw = process.env.ADMIN_USER_ID;
  let adminUserId: number | undefined;
  if (!adminUserIdRaw) {
    missing.push("ADMIN_USER_ID");
  } else {
    adminUserId = parseInt(adminUserIdRaw, 10);
    if (isNaN(adminUserId)) {
      missing.push("ADMIN_USER_ID (must be a number)");
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    telegramBotToken: telegramBotToken!,
    geminiApiKey: geminiApiKey!,
    adminUserId: adminUserId!,

    atprotoHandle: process.env.ATPROTO_HANDLE || undefined,
    atprotoPassword: process.env.ATPROTO_PASSWORD || undefined,
    atprotoService: process.env.ATPROTO_SERVICE || "https://bsky.social",

    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,

    // Both default to Gemini 3.5 Flash — GA model that fixed the
    // degeneration loop seen in 3-flash-preview (where Gemini emitted
    // 31_500 emojis in a single reply on 2026-05-19). The pi-ai SDK 0.57.1
    // doesn't ship this model in its registry yet, so agent.ts has a
    // MANUAL_MODELS table that adds it back. Override via env to test
    // other variants (e.g. gemini-3-flash-preview, gemini-2.5-flash).
    piModel: process.env.PI_MODEL || "google/gemini-3.5-flash",
    speciesIdModel: process.env.SPECIES_ID_MODEL || "gemini-3.5-flash",

    gfwDataApiKey: process.env.GFW_DATA_API_KEY || undefined,

    polygonWebAppBaseUrl:
      process.env.POLYGON_WEB_APP_BASE_URL || "https://polygons-gainforest.vercel.app",

    gainforestInviteCode: process.env.GAINFOREST_INVITE_CODE || undefined,
  };
}

// Check if ATProto publishing is configured
// Returns true only if BOTH atprotoHandle AND atprotoPassword are set
export function isAtprotoConfigured(config: EnvConfig): boolean {
  return config.atprotoHandle !== undefined && config.atprotoPassword !== undefined;
}

// Check if GFW Data API is configured
// Returns true if gfwDataApiKey is defined and non-empty
export function isGfwConfigured(config: EnvConfig): boolean {
  return config.gfwDataApiKey !== undefined && config.gfwDataApiKey.length > 0;
}
