import { execFile } from "child_process";
import { promisify } from "util";
import { accessSync, constants } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { loadEnvConfig } from "../env.js";

const execFileAsync = promisify(execFile);

const AUDIOMOTH_WAV_PATTERN = /^\d{8}_\d{6}\.WAV$/i;

// Resolve the audiogoat binary for the current platform/arch.
// Falls back to 'audiogoat' on PATH if the bundled binary is missing.
function resolveAudiogoatBinary(): string {
  const platform = os.platform(); // 'darwin' | 'linux'
  const arch = os.arch();         // 'arm64' | 'x64'
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

// Parse the DID from the cached audiogoat session file.
async function readAudiogoatDID(): Promise<string | null> {
  let stateDir = path.join(os.homedir(), ".local", "state", "audiogoat");
  if (process.platform === "darwin") {
    stateDir = path.join(os.homedir(), "Library", "Application Support", "audiogoat");
  } else if (process.platform === "win32") {
    stateDir = path.join(process.env.APPDATA || os.homedir(), "audiogoat", "data");
  }
  const sessionFile = path.join(stateDir, "auth-session.json");
  try {
    const raw = await fs.readFile(sessionFile, "utf-8");
    const parsed = JSON.parse(raw) as { did?: string };
    return parsed.did ?? null;
  } catch {
    return null;
  }
}

// Run `audiogoat deployment list` and return parsed entries.
async function listDeployments(
  binary: string,
  env: NodeJS.ProcessEnv
): Promise<Array<{ uri: string; name: string }>> {
  let stdout = "";
  try {
    const r = await execFileAsync(binary, ["deployment", "list"], { env, timeout: 30_000 });
    stdout = r.stdout;
    console.log("audiogoat stdout:", stdout);
  } catch (err: any) {
    stdout = err.stdout ?? "";
    console.log("audiogoat error stdout:", stdout, "error:", err);
  }

  if (stdout.includes("(no deployments found)")) return [];

  // Output format: rkey  NAME  DEVICE  DEPLOYED  ...  (columns separated by 2+ spaces)
  const did = await readAudiogoatDID();
  if (!did) return [];

  return stdout
    .split("\n")
    .slice(2) // skip header + separator lines
    .map((line) => {
      const cols = line.trim().split(/\s{2,}/);
      const rkey = cols[0]?.trim();
      const name = cols[1]?.trim() ?? "";
      if (!rkey || rkey === "--") return null;
      return { uri: `at://${did}/app.gainforest.ac.deployment/${rkey}`, name };
    })
    .filter((d): d is { uri: string; name: string } => d !== null && d.uri.length > 10);
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
    // Parse timestamp from filename: YYYYMMDD_HHMMSS.WAV
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

// Auto-create a deployment record using WAV metadata.
// Stores the AudioMoth deployment ID in --serial so future ingests auto-match.
async function autoCreateDeployment(
  binary: string,
  env: NodeJS.ProcessEnv,
  folder: string
): Promise<string | null> {
  const meta = await extractWavMeta(folder);
  const name = meta ? `AudioMoth ${meta.deviceId}` : "AudioMoth (auto)";
  const serial = meta?.deploymentId || "unknown";
  const deployedAt = meta?.recordedAt ?? new Date().toISOString();

  const args = [
    "deployment", "create",
    "--name", name,
    "--device", "AudioMoth",
    "--serial", serial,
    "--deployed-at", deployedAt,
  ];

  try {
    const { stdout } = await execFileAsync(binary, args, { env, timeout: 30_000 });
    // Output: "Created deployment: at://did:.../app.gainforest.ac.deployment/rkey"
    const match = stdout.match(/at:\/\/[^\s]+/);
    return match?.[0] ?? null;
  } catch {
    return null;
  }
}

export interface IngestResult {
  success: true;
  uploaded: number;
  skipped: number;
  output: string;
}

export interface IngestDeploymentChoiceNeeded {
  success: false;
  code: "deployment_choice_needed";
  deployments: Array<{ uri: string; name: string }>;
  suggestion: string;
}

export interface IngestError {
  success: false;
  code: "error";
  error: string;
}

export type UploadAudioMothResult = IngestResult | IngestDeploymentChoiceNeeded | IngestError;

export async function uploadAudioMothSD(
  folder: string,
  deploymentUri?: string
): Promise<UploadAudioMothResult> {
  const binary = resolveAudiogoatBinary();
  const env = buildAudiogoatEnv();

  let resolvedDeploymentUri = deploymentUri;

  if (!resolvedDeploymentUri) {
    const deployments = await listDeployments(binary, env);
    console.log("Found deployments:", deployments);

    if (deployments.length === 0) {
      const created = await autoCreateDeployment(binary, env, folder);
      if (!created) {
        return {
          success: false,
          code: "error",
          error: "No deployments found and failed to auto-create one. Make sure ATProto credentials are configured.",
        };
      }
      resolvedDeploymentUri = created;
    } else if (deployments.length === 1) {
      resolvedDeploymentUri = deployments[0].uri;
    } else {
      return {
        success: false,
        code: "deployment_choice_needed",
        deployments,
        suggestion: "Multiple recorder deployments found. Ask the user which deployment this SD card belongs to, then call upload_audiomoth_sd again with the chosen deploymentUri.",
      };
    }
  }

  const args = [
    "ingest",
    "--folder", folder,
    "--deployment", resolvedDeploymentUri,
  ];

  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(binary, args, {
      env,
      timeout: 15 * 60 * 1000, // 15 min for large SD cards
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

  return { success: true, uploaded, skipped, output };
}
