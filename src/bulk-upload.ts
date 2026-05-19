// Bulk upload CLI — identify species for a folder of photos in parallel
// and publish each as a Darwin Core occurrence under a given org account.
//
// Usage:
//   GEMINI_API_KEY=... \
//   BULK_ORG_HANDLE=cabarete-sostenible.gainforest.id \
//   BULK_ORG_PASSWORD=... \
//   npm run bulk -- \
//     --dir ./photos \
//     --user-id 123456789 --username diegorb --user-name "Diego" \
//     --lat 19.752 --lng -70.413 --locality "Cabarete" --country "Dominican Republic" --country-code DO \
//     [--concurrency 4] [--service https://gainforest.id] [--dry-run]
//
// Per-photo sidecar override:
//   For photo.jpg you can drop photo.jpg.json next to it with:
//     { "lat": ..., "lng": ..., "locality": "...", "country": "...", "countryCode": "..." }
//   Sidecar values override the global --lat/--lng/... flags for that one photo.

import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
import { AtpAgent } from "@atproto/api";
import * as fs from "fs";
import * as path from "path";

// --env-file <path> loads an extra .env file (overrides .env) before flags are parsed.
{
  const idx = process.argv.indexOf("--env-file");
  if (idx !== -1 && process.argv[idx + 1]) {
    const envFilePath = process.argv[idx + 1];
    dotenvConfig({ path: envFilePath, override: true });
    process.argv.splice(idx, 2);
  }
}
import {
  identifySpecies,
  type IdentificationResult,
  type SpeciesIdentification,
} from "./tools/identify-species.js";
import { publishOccurrence, type OccurrenceInput } from "./tools/publish-occurrence.js";
import { initOrgContext } from "./hyperindex.js";

interface Flags {
  dir: string;
  userId: number;
  username?: string;
  userName: string;
  lat?: number;
  lng?: number;
  locality?: string;
  country?: string;
  countryCode?: string;
  stateProvince?: string;
  municipality?: string;
  concurrency: number;
  service: string;
  dryRun: boolean;
  includeCultivated: boolean;
  maxRetries: number;
}

interface Sidecar {
  lat?: number;
  lng?: number;
  locality?: string;
  country?: string;
  countryCode?: string;
  stateProvince?: string;
  municipality?: string;
}

type PhotoOutcome =
  | { file: string; status: "published"; species: string; hyperscanUrl: string }
  | { file: string; status: "skipped"; reason: string; species?: string }
  | { file: string; status: "error"; error: string };

const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

function parseArgs(argv: string[]): Flags {
  const map: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      map[key] = "true";
    } else {
      map[key] = next;
      i++;
    }
  }

  // Flag value, falling back to env var, then optional default.
  const v = (flag: string, envKey: string, fallback?: string): string | undefined => {
    return map[flag] ?? process.env[envKey] ?? fallback;
  };
  const need = (flag: string, envKey: string): string => {
    const out = v(flag, envKey);
    if (!out) throw new Error(`Missing --${flag} (or env ${envKey})`);
    return out;
  };
  const num = (flag: string, envKey: string, required: boolean): number | undefined => {
    const raw = v(flag, envKey);
    if (raw === undefined) {
      if (required) throw new Error(`Missing --${flag} (or env ${envKey})`);
      return undefined;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`--${flag} must be numeric, got: ${raw}`);
    return n;
  };

  return {
    dir: need("dir", "BULK_DIR"),
    userId: num("user-id", "BULK_TG_USER_ID", true) as number,
    username: v("username", "BULK_TG_USERNAME"),
    userName: need("user-name", "BULK_TG_USER_NAME"),
    lat: num("lat", "BULK_LAT", false),
    lng: num("lng", "BULK_LNG", false),
    locality: v("locality", "BULK_LOCALITY"),
    country: v("country", "BULK_COUNTRY"),
    countryCode: v("country-code", "BULK_COUNTRY_CODE"),
    stateProvince: v("state-province", "BULK_STATE_PROVINCE"),
    municipality: v("municipality", "BULK_MUNICIPALITY"),
    concurrency: Number(v("concurrency", "BULK_CONCURRENCY") ?? "4") || 4,
    service: v("service", "BULK_ATPROTO_SERVICE") ?? "https://gainforest.id",
    dryRun: map["dry-run"] === "true",
    includeCultivated:
      map["include-cultivated"] === "true" ||
      process.env.BULK_INCLUDE_CULTIVATED === "1" ||
      process.env.BULK_INCLUDE_CULTIVATED === "true",
    maxRetries: Number(v("max-retries", "BULK_MAX_RETRIES") ?? "2") || 2,
  };
}

function isTransientGeminiError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("timeout") ||
    m.includes("rate") ||
    m.includes("429") ||
    m.includes("500") ||
    m.includes("502") ||
    m.includes("503") ||
    m.includes("504") ||
    m.includes("econnreset") ||
    m.includes("enotfound") ||
    m.includes("etimedout")
  );
}

async function identifyWithRetry(
  base64: string,
  mimeType: string,
  geminiApiKey: string,
  maxRetries: number,
  fileLabel: string,
): Promise<IdentificationResult> {
  let lastErr: IdentificationResult | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await identifySpecies(base64, mimeType, geminiApiKey);
    if (!("error" in result)) return result;
    lastErr = result;
    if (!isTransientGeminiError(result.error) || attempt === maxRetries) {
      return result;
    }
    const backoffMs = 2000 * (attempt + 1);
    console.log(
      `   ↻ ${fileLabel} transient Gemini error, retry ${attempt + 1}/${maxRetries} in ${backoffMs}ms`,
    );
    await new Promise((r) => setTimeout(r, backoffMs));
  }
  return lastErr!;
}

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    default:
      return "application/octet-stream";
  }
}

function readSidecar(photoPath: string): Sidecar | undefined {
  const sidecarPath = `${photoPath}.json`;
  if (!fs.existsSync(sidecarPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, "utf-8")) as Sidecar;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️  Could not parse sidecar ${sidecarPath}: ${message}`);
    return undefined;
  }
}

function scanPhotos(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && PHOTO_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dir, e.name))
    .sort();
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function buildOccurrenceInput(
  photoBytes: Buffer,
  mimeType: string,
  id: SpeciesIdentification,
  flags: Flags,
  sidecar: Sidecar | undefined,
): OccurrenceInput {
  const lat = sidecar?.lat ?? flags.lat;
  const lng = sidecar?.lng ?? flags.lng;
  const locality = sidecar?.locality ?? flags.locality;
  const country = sidecar?.country ?? flags.country;
  const countryCode = sidecar?.countryCode ?? flags.countryCode;
  const stateProvince = sidecar?.stateProvince ?? flags.stateProvince;
  const municipality = sidecar?.municipality ?? flags.municipality;

  const specificEpithet = id.scientificName.trim().split(/\s+/)[1];

  return {
    scientificName: id.scientificName,
    vernacularName: id.commonName,
    decimalLatitude: lat,
    decimalLongitude: lng,
    locality,
    country,
    countryCode,
    stateProvince,
    municipality,
    habitat: id.habitat,
    kingdom: id.taxonomy.kingdom,
    phylum: id.taxonomy.phylum,
    class_: id.taxonomy.class,
    order: id.taxonomy.order,
    family: id.taxonomy.family,
    genus: id.taxonomy.genus,
    specificEpithet,
    taxonRank: "species",
    images: [{ data: photoBytes, mimeType }],
    submittedBy: {
      id: flags.userId,
      username: flags.username,
      displayName: flags.userName,
    },
  };
}

async function processPhoto(
  photoPath: string,
  flags: Flags,
  geminiApiKey: string,
  override: { agent: AtpAgent; did: string; handle: string },
): Promise<PhotoOutcome> {
  const file = path.basename(photoPath);
  const mimeType = mimeForExt(path.extname(photoPath));
  const bytes = fs.readFileSync(photoPath);
  const base64 = bytes.toString("base64");

  const sidecar = readSidecar(photoPath);
  const hasLocation =
    (sidecar?.lat !== undefined && sidecar?.lng !== undefined) ||
    (flags.lat !== undefined && flags.lng !== undefined) ||
    sidecar?.locality ||
    flags.locality;
  if (!hasLocation) {
    return { file, status: "error", error: "No location (no --lat/--lng/--locality flag, no sidecar)" };
  }

  const idResult = await identifyWithRetry(base64, mimeType, geminiApiKey, flags.maxRetries, file);
  if ("error" in idResult) {
    return { file, status: "error", error: `identify: ${idResult.error}` };
  }

  const sciName = (idResult.scientificName ?? "").trim();
  if (!sciName || sciName.toLowerCase() === "unknown") {
    return {
      file,
      status: "skipped",
      reason: `no organism identified${idResult.nonWildlifeReason ? ` (${idResult.nonWildlifeReason})` : ""}`,
      species: idResult.commonName,
    };
  }

  if (idResult.isWildlife === false && !flags.includeCultivated) {
    return {
      file,
      status: "skipped",
      reason: `not wildlife (${idResult.nonWildlifeReason ?? "no reason given"})`,
      species: idResult.commonName,
    };
  }
  if (idResult.imageQuality?.overall === "poor") {
    return {
      file,
      status: "skipped",
      reason: "image quality: poor",
      species: idResult.commonName,
    };
  }

  if (flags.dryRun) {
    return {
      file,
      status: "skipped",
      reason: "dry-run",
      species: `${idResult.commonName} (${idResult.scientificName})`,
    };
  }

  const occurrenceInput = buildOccurrenceInput(bytes, mimeType, idResult, flags, sidecar);
  const pubResult = await publishOccurrence(occurrenceInput, override);
  if (!pubResult.success) {
    return { file, status: "error", error: `publish: ${pubResult.error}` };
  }

  return {
    file,
    status: "published",
    species: `${idResult.commonName} (${idResult.scientificName})`,
    hyperscanUrl: pubResult.hyperscanUrl,
  };
}

function printSummary(outcomes: PhotoOutcome[]) {
  const published = outcomes.filter((o) => o.status === "published");
  const skipped = outcomes.filter((o) => o.status === "skipped");
  const errored = outcomes.filter((o) => o.status === "error");

  console.log("\n========== Bulk upload summary ==========");
  console.log(`Total:     ${outcomes.length}`);
  console.log(`Published: ${published.length}`);
  console.log(`Skipped:   ${skipped.length}`);
  console.log(`Errors:    ${errored.length}`);

  if (published.length > 0) {
    console.log("\n--- Published ---");
    for (const o of published) {
      if (o.status === "published") {
        console.log(`  ✅ ${o.file} → ${o.species}\n     ${o.hyperscanUrl}`);
      }
    }
  }
  if (skipped.length > 0) {
    console.log("\n--- Skipped ---");
    for (const o of skipped) {
      if (o.status === "skipped") {
        const sp = o.species ? ` [${o.species}]` : "";
        console.log(`  ⏭️  ${o.file}${sp} — ${o.reason}`);
      }
    }
  }
  if (errored.length > 0) {
    console.log("\n--- Errors ---");
    for (const o of errored) {
      if (o.status === "error") console.log(`  ❌ ${o.file} — ${o.error}`);
    }
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) throw new Error("Missing GEMINI_API_KEY");
  const orgHandle = process.env.BULK_ORG_HANDLE;
  const orgPassword = process.env.BULK_ORG_PASSWORD;
  if (!flags.dryRun && (!orgHandle || !orgPassword)) {
    throw new Error("Missing BULK_ORG_HANDLE and/or BULK_ORG_PASSWORD env vars");
  }

  if (!fs.existsSync(flags.dir) || !fs.statSync(flags.dir).isDirectory()) {
    throw new Error(`--dir is not a directory: ${flags.dir}`);
  }
  const photos = scanPhotos(flags.dir);
  if (photos.length === 0) {
    console.log(`No photos found in ${flags.dir} (looking for ${[...PHOTO_EXTS].join(", ")})`);
    return;
  }

  console.log(`Found ${photos.length} photo(s) in ${flags.dir}`);
  console.log(`Concurrency: ${flags.concurrency}`);
  console.log(`Org handle:  ${orgHandle ?? "(dry-run, no login)"}`);
  console.log(`Service:     ${flags.service}`);
  const attrib = flags.username
    ? `${flags.userName} (@${flags.username}, tg:${flags.userId})`
    : `${flags.userName} (tg:${flags.userId})`;
  console.log(`Attribution: ${attrib}`);
  console.log(
    `Filter:      ${flags.includeCultivated ? "include cultivated (only skip non-organisms)" : "wildlife only"}`,
  );
  console.log(`Retries:     up to ${flags.maxRetries} per photo on transient Gemini errors`);
  if (flags.dryRun) console.log("DRY RUN — identifications only, nothing published\n");

  const agent = new AtpAgent({ service: flags.service });
  let did: string;
  let handle: string;
  if (flags.dryRun) {
    did = "did:dry:run";
    handle = orgHandle ?? "dry-run";
  } else {
    const login = await agent.login({ identifier: orgHandle!, password: orgPassword! });
    did = login.data.did;
    handle = login.data.handle;
    console.log(`Logged in as @${handle} (${did})`);
    await initOrgContext(did);
  }

  const started = Date.now();
  const outcomes = await mapWithLimit(photos, flags.concurrency, async (photoPath, i) => {
    const file = path.basename(photoPath);
    console.log(`[${i + 1}/${photos.length}] ${file} — starting`);
    const result = await processPhoto(photoPath, flags, geminiApiKey, { agent, did, handle });
    const tag =
      result.status === "published" ? "✅" : result.status === "skipped" ? "⏭️ " : "❌";
    console.log(`[${i + 1}/${photos.length}] ${file} — ${tag} ${result.status}`);
    return result;
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  printSummary(outcomes);
  console.log(`\nElapsed: ${elapsed}s`);

  const errored = outcomes.filter((o) => o.status === "error").length;
  if (errored > 0) process.exitCode = 1;
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Fatal: ${message}`);
  process.exit(1);
});
