import { execFile } from "child_process";
import { promisify } from "util";
import { accessSync, constants } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { loadEnvConfig } from "../env.js";
import { getPublishingClient, normalizePublishingError } from "../publishing.js";
import { reverseGeocode } from "./geocode-location.js";

const execFileAsync = promisify(execFile);

const AUDIOMOTH_WAV_PATTERN = /^\d{8}_\d{6}\.WAV$/i;
const DEPLOYMENT_COLLECTION = "app.gainforest.ac.deployment";

export interface DeploymentSummary {
  uri: string;
  rkey: string;
  name: string;
  deployedAt?: string;
  decimalLatitude?: string;
  decimalLongitude?: string;
  deviceSerialNumber?: string;
  locality?: string;
  country?: string;
  hasLocation: boolean;
}

export interface LocationInput {
  decimalLatitude: number | string;
  decimalLongitude: number | string;
  altitude?: number | string;
}

// Resolve the audiogoat binary for the current platform/arch.
// Falls back to 'audiogoat' on PATH if the bundled binary is missing.
function resolveAudiogoatBinary(): string {
  const platform = os.platform();
  const arch = os.arch();
  const bundled = path.join(process.cwd(), "lib", `audiogoat-${platform}-${arch}`);
  try {
    accessSync(bundled, constants.X_OK);
    return bundled;
  } catch {
    return "audiogoat";
  }
}

// Build env for audiogoat subprocess using Tainá's ATProto credentials.
function buildAudiogoatEnv(): NodeJS.ProcessEnv {
  const config = loadEnvConfig();
  return {
    ...process.env,
    ATP_USERNAME: config.atprotoHandle ?? "",
    ATP_PASSWORD: config.atprotoPassword ?? "",
    ATP_PDS_HOST: config.atprotoService !== "https://bsky.social" ? config.atprotoService : "",
    LOG_LEVEL: "warn",
  };
}

// Extract AudioMoth metadata from the first WAV file in folder using ffprobe.
async function extractWavMeta(
  folder: string
): Promise<{ deploymentId: string; deviceId: string; recordedAt: string } | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(folder);
  } catch {
    return null;
  }

  const wav = entries.find((e) => AUDIOMOTH_WAV_PATTERN.test(e) && !e.startsWith("._"));
  if (!wav) return null;

  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", path.join(folder, wav)],
      { timeout: 10_000 }
    );
    const data = JSON.parse(stdout) as {
      format?: { tags?: { artist?: string; comment?: string }; filename?: string };
    };
    const comment = data.format?.tags?.comment ?? "";
    const artist = data.format?.tags?.artist ?? "";

    const deploymentMatch = comment.match(/deployment\s+([0-9a-f]+)/i);
    const deviceMatch = artist.match(/AudioMoth\s+([0-9A-Fa-f]+)/i) ?? comment.match(/AudioMoth\s+([0-9A-Fa-f]+)/i);
    const tsMatch = wav.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.WAV$/i);
    const recordedAt = tsMatch
      ? `${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]}T${tsMatch[4]}:${tsMatch[5]}:${tsMatch[6]}Z`
      : new Date().toISOString();

    return {
      deploymentId: deploymentMatch?.[1] ?? "",
      deviceId: deviceMatch?.[1] ?? "unknown",
      recordedAt,
    };
  } catch {
    return null;
  }
}

// List deployments via ATProto repo.listRecords — gives us full records
// (lat/lon, deployedAt, serial) instead of having to parse CLI text.
async function listDeploymentsViaAtproto(telegramUserId?: number): Promise<DeploymentSummary[]> {
  const config = loadEnvConfig();
  const publisher = await getPublishingClient(config, telegramUserId);

  const result = await publisher.listRecords({
    collection: DEPLOYMENT_COLLECTION,
    limit: 100,
  });

  return result.records.map((r) => {
    const v = r.value as Record<string, unknown>;
    const rkey = r.uri.split("/").pop() ?? "";
    const lat = typeof v.decimalLatitude === "string" ? v.decimalLatitude : undefined;
    const lon = typeof v.decimalLongitude === "string" ? v.decimalLongitude : undefined;
    return {
      uri: r.uri,
      rkey,
      name: typeof v.name === "string" ? v.name : "AudioMoth deployment",
      deployedAt: typeof v.deployedAt === "string" ? v.deployedAt : undefined,
      decimalLatitude: lat,
      decimalLongitude: lon,
      deviceSerialNumber: typeof v.deviceSerialNumber === "string" ? v.deviceSerialNumber : undefined,
      hasLocation: Boolean(lat && lon),
    };
  });
}

// Patch lat/lon onto an existing deployment record using putRecord.
// Preserves all other fields (fetched first, then mutated).
export async function patchDeploymentLocation(
  uri: string,
  location: LocationInput,
  telegramUserId?: number,
): Promise<{ success: true } | { success: false; error: string }> {
  const config = loadEnvConfig();
  const publisher = await getPublishingClient(config, telegramUserId);

  const parts = uri.replace(/^at:\/\//, "").split("/");
  if (parts.length !== 3 || parts[1] !== DEPLOYMENT_COLLECTION) {
    return { success: false, error: `Invalid deployment URI: ${uri}` };
  }
  const [repo, collection, rkey] = parts;

  let existing: Record<string, unknown>;
  try {
    const res = await publisher.getRecord({ collection, rkey });
    existing = res.value as Record<string, unknown>;
  } catch (err) {
    return { success: false, error: `Failed to fetch deployment: ${err instanceof Error ? err.message : String(err)}` };
  }

  const updated: Record<string, unknown> = {
    ...existing,
    decimalLatitude: String(location.decimalLatitude),
    decimalLongitude: String(location.decimalLongitude),
  };
  if (location.altitude !== undefined) {
    updated.altitude = String(location.altitude);
  }

  try {
    await publisher.putRecord({
      collection,
      rkey,
      record: updated,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to patch deployment: ${normalizePublishingError(err)}` };
  }
}

// Create an AudioMoth deployment record on ATProto with location.
// Reverse-geocodes lat/lon for a friendly name. Used both by:
//   - chime-time registration (no SD folder yet, deployment ID known from chime)
//   - auto-create during upload when no matching deployment exists
export async function createAudioMothDeployment(input: {
  deploymentId: string;
  location: LocationInput;
  deployedAt?: string;
  deviceLabel?: string;
  telegramUserId?: number;
}): Promise<{ uri: string; name: string } | { error: string }> {
  const lat = typeof input.location.decimalLatitude === "number"
    ? input.location.decimalLatitude
    : parseFloat(String(input.location.decimalLatitude));
  const lon = typeof input.location.decimalLongitude === "number"
    ? input.location.decimalLongitude
    : parseFloat(String(input.location.decimalLongitude));

  let locality: string | undefined;
  if (!isNaN(lat) && !isNaN(lon)) {
    try {
      const rev = await reverseGeocode(lat, lon);
      if (rev.success) locality = rev.locality ?? rev.country;
    } catch {
      // best-effort; deployment still created
    }
  }

  const devicePart = input.deviceLabel ? ` ${input.deviceLabel}` : "";
  const name = locality
    ? `AudioMoth${devicePart} at ${locality}`
    : `AudioMoth${devicePart} at ${input.location.decimalLatitude},${input.location.decimalLongitude}`;

  const record: Record<string, unknown> = {
    $type: DEPLOYMENT_COLLECTION,
    name,
    device: "AudioMoth",
    deviceSerialNumber: input.deploymentId,
    deployedAt: input.deployedAt ?? new Date().toISOString(),
    decimalLatitude: String(input.location.decimalLatitude),
    decimalLongitude: String(input.location.decimalLongitude),
    createdAt: new Date().toISOString(),
    ...(input.location.altitude !== undefined && { altitude: String(input.location.altitude) }),
    ...(locality && { locality }),
  };

  try {
    const config = loadEnvConfig();
    const publisher = await getPublishingClient(config, input.telegramUserId);
    const result = await publisher.createRecord({ collection: DEPLOYMENT_COLLECTION, record });
    return { uri: result.uri, name };
  } catch (err) {
    return { error: normalizePublishingError(err) };
  }
}

// Thin wrapper for the upload flow: extracts deployment ID + timestamp from
// the SD card's WAV metadata, then delegates to createAudioMothDeployment.
async function autoCreateDeployment(
  _binary: string,
  _env: NodeJS.ProcessEnv,
  folder: string,
  location: LocationInput,
  telegramUserId?: number,
): Promise<{ uri: string; name: string } | null> {
  const meta = await extractWavMeta(folder);
  const result = await createAudioMothDeployment({
    deploymentId: meta?.deploymentId || "unknown",
    deployedAt: meta?.recordedAt,
    deviceLabel: meta?.deviceId && meta.deviceId !== "unknown" ? meta.deviceId : undefined,
    location,
    telegramUserId,
  });
  return "uri" in result ? result : null;
}

export interface IngestResult {
  success: true;
  uploaded: number;
  skipped: number;
  deploymentUri: string;
  deploymentName: string;
  output: string;
}

export interface IngestDeploymentChoiceNeeded {
  success: false;
  code: "deployment_choice_needed";
  deployments: DeploymentSummary[];
  suggestion: string;
}

export interface IngestLocationRequired {
  success: false;
  code: "location_required";
  reason: "no_deployment" | "deployment_missing_location";
  deploymentUri?: string;
  deploymentName?: string;
  suggestion: string;
}

export interface IngestError {
  success: false;
  code: "error";
  error: string;
}

export type UploadAudioMothResult =
  | IngestResult
  | IngestDeploymentChoiceNeeded
  | IngestLocationRequired
  | IngestError;

export async function uploadAudioMothSD(
  folder: string,
  deploymentUri?: string,
  location?: LocationInput,
  telegramUserId?: number,
): Promise<UploadAudioMothResult> {
  const binary = resolveAudiogoatBinary();
  const env = buildAudiogoatEnv();

  let resolvedDeployment: { uri: string; name: string; hasLocation: boolean } | null = null;

  // Path 1: caller already chose a specific deployment URI (from a previous
  // disambiguation turn). Honor it.
  if (deploymentUri) {
    let summaries: DeploymentSummary[];
    try {
      summaries = await listDeploymentsViaAtproto(telegramUserId);
    } catch (err) {
      return { success: false, code: "error", error: `Failed to list deployments: ${err instanceof Error ? err.message : String(err)}` };
    }
    const match = summaries.find((d) => d.uri === deploymentUri);
    if (!match) {
      return { success: false, code: "error", error: `Deployment ${deploymentUri} not found in current account.` };
    }
    if (!match.hasLocation) {
      // Caller may have passed a location to patch it. If not, ask.
      if (!location) {
        return {
          success: false,
          code: "location_required",
          reason: "deployment_missing_location",
          deploymentUri: match.uri,
          deploymentName: match.name,
          suggestion: `Deployment "${match.name}" has no GPS coordinates yet. Ask the user where the AudioMoth is placed (Telegram location, place name, or coordinates), then call upload_audiomoth_sd again with the same deploymentUri plus location.`,
        };
      }
      const patch = await patchDeploymentLocation(match.uri, location, telegramUserId);
      if (!patch.success) {
        return { success: false, code: "error", error: patch.error };
      }
    }
    resolvedDeployment = { uri: match.uri, name: match.name, hasLocation: true };
  }

  // Path 2: no URI provided — auto-resolve from the existing deployment set.
  if (!resolvedDeployment) {
    let deployments: DeploymentSummary[];
    try {
      deployments = await listDeploymentsViaAtproto(telegramUserId);
    } catch (err) {
      return { success: false, code: "error", error: `Failed to list deployments: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Serial-based auto-match: if the WAV metadata embeds a deployment ID
    // that matches an existing deployment's deviceSerialNumber, use it
    // silently. This is the path the field-registered chime flow lands on:
    // the user already created the deployment via the chime tool, so we
    // never need to ask them for location during upload.
    const wavMeta = await extractWavMeta(folder);
    const wavSerial = wavMeta?.deploymentId;
    if (wavSerial) {
      const match = deployments.find((d) => d.deviceSerialNumber === wavSerial);
      if (match) {
        if (!match.hasLocation) {
          if (!location) {
            return {
              success: false,
              code: "location_required",
              reason: "deployment_missing_location",
              deploymentUri: match.uri,
              deploymentName: match.name,
              suggestion: `Deployment "${match.name}" matches this SD card by serial but has no GPS coordinates yet. Ask the user where the AudioMoth is placed, then call upload_audiomoth_sd again with the same deploymentUri plus location.`,
            };
          }
          const patch = await patchDeploymentLocation(match.uri, location, telegramUserId);
          if (!patch.success) {
            return { success: false, code: "error", error: patch.error };
          }
        }
        resolvedDeployment = { uri: match.uri, name: match.name, hasLocation: true };
        // Skip the count-based branching below — we resolved by serial.
        deployments = []; // not used after this point on this branch
      }
    }

    if (resolvedDeployment) {
      // fall through to the ingest call below
    } else if (deployments.length === 0) {
      // No existing deployments — must create one. Requires location.
      if (!location) {
        return {
          success: false,
          code: "location_required",
          reason: "no_deployment",
          suggestion: "No AudioMoth deployment exists yet. Ask the user where this AudioMoth is placed (Telegram location, place name, or coordinates), then call upload_audiomoth_sd again with location.",
        };
      }
      const created = await autoCreateDeployment(binary, env, folder, location, telegramUserId);
      if (!created) {
        return {
          success: false,
          code: "error",
          error: "Failed to create deployment. Make sure ATProto credentials are configured and audiogoat is logged in.",
        };
      }
      resolvedDeployment = { uri: created.uri, name: created.name, hasLocation: true };
    } else if (deployments.length === 1) {
      const only = deployments[0];
      if (!only.hasLocation) {
        if (!location) {
          return {
            success: false,
            code: "location_required",
            reason: "deployment_missing_location",
            deploymentUri: only.uri,
            deploymentName: only.name,
            suggestion: `Deployment "${only.name}" has no GPS coordinates yet. Ask the user where the AudioMoth is placed, then call upload_audiomoth_sd again with the same deploymentUri plus location.`,
          };
        }
        const patch = await patchDeploymentLocation(only.uri, location, telegramUserId);
        if (!patch.success) {
          return { success: false, code: "error", error: patch.error };
        }
      }
      resolvedDeployment = { uri: only.uri, name: only.name, hasLocation: true };
    } else {
      return {
        success: false,
        code: "deployment_choice_needed",
        deployments,
        suggestion: "Multiple AudioMoth deployments found. Show the user the list (name, locality if available, deployedAt) and ask which one this SD card belongs to. Then call upload_audiomoth_sd again with the chosen deploymentUri.",
      };
    }
  }

  // All resolution paths converge here with a deployment that has location.
  const args = [
    "ingest",
    "--folder", folder,
    "--deployment", resolvedDeployment.uri,
  ];

  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(binary, args, {
      env,
      timeout: 15 * 60 * 1000,
    }));
  } catch (err: any) {
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
    if (!stdout && !stderr) {
      return { success: false, code: "error", error: String(err) };
    }
  }

  const output = [stdout, stderr].filter(Boolean).join("\n").trim();

  const uploadedMatch = output.match(/Uploaded:\s*(\d+)/);
  const processedMatch = output.match(/Processed:\s*(\d+)/);
  const skippedMatch = output.match(/Skipping\s+(\d+)\s+already/);

  const uploaded = uploadedMatch ? parseInt(uploadedMatch[1]) : 0;
  const processed = processedMatch ? parseInt(processedMatch[1]) : 0;
  const skipped = skippedMatch ? parseInt(skippedMatch[1]) : Math.max(0, processed - uploaded);

  return {
    success: true,
    uploaded,
    skipped,
    deploymentUri: resolvedDeployment.uri,
    deploymentName: resolvedDeployment.name,
    output,
  };
}
