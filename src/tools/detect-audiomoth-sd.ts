import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const AUDIOMOTH_PATTERN = /^\d{8}_\d{6}\.WAV$/i;
const SKIP_MACOS_VOLUMES = new Set(["Macintosh HD", "Preboot", "Recovery", "VM", "Data"]);

export interface SDCardInfo {
  path: string;
  label: string;
  wavFileCount: number;
}

export interface DetectSDCardsResult {
  cards: SDCardInfo[];
}

async function countAudioMothFiles(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.filter((e) => AUDIOMOTH_PATTERN.test(e)).length;
  } catch {
    return 0;
  }
}

async function checkAndAdd(results: SDCardInfo[], dirPath: string, label: string): Promise<void> {
  const count = await countAudioMothFiles(dirPath);
  if (count > 0) {
    results.push({ path: dirPath, label, wavFileCount: count });
  }
}

export async function detectAudioMothSDCards(): Promise<DetectSDCardsResult | { error: string }> {
  const platform = os.platform();
  const results: SDCardInfo[] = [];

  if (platform === "darwin") {
    let volumes: string[];
    try {
      volumes = await fs.readdir("/Volumes");
    } catch (err) {
      return { error: `Cannot scan /Volumes: ${err}` };
    }
    for (const vol of volumes) {
      if (SKIP_MACOS_VOLUMES.has(vol)) continue;
      const volPath = path.join("/Volumes", vol);
      try {
        const stat = await fs.lstat(volPath);
        if (stat.isSymbolicLink()) continue;
      } catch {
        continue;
      }
      await checkAndAdd(results, volPath, vol);
    }
  } else if (platform === "linux") {
    const user = os.userInfo().username;
    for (const base of [`/media/${user}`, `/run/media/${user}`]) {
      try {
        const dirs = await fs.readdir(base);
        for (const dir of dirs) {
          await checkAndAdd(results, path.join(base, dir), dir);
        }
      } catch {
        // base dir doesn't exist — skip
      }
    }
    // Also check /proc/mounts for SD (mmcblk) and USB (sd*) devices
    try {
      const mounts = await fs.readFile("/proc/mounts", "utf-8");
      for (const line of mounts.split("\n")) {
        const parts = line.split(" ");
        const device = parts[0];
        const mountPoint = parts[1];
        if (!device || !mountPoint) continue;
        if (!/\/(sd[a-z]\d+|mmcblk\d+p\d+)$/.test(device)) continue;
        await checkAndAdd(results, mountPoint, path.basename(mountPoint));
      }
    } catch {
      // /proc/mounts not available
    }
  } else {
    return { error: `Unsupported platform: ${platform}` };
  }

  return { cards: results };
}
