// Print a JSON snapshot of this Pi's local Taina state.
// Consumed by the pi-taina-monitor agent and shipped to Healthchecks.io
// as part of the heartbeat body so the monitor dashboard can render
// "what this community has locally" alongside what's already on ATProto.
//
// Usage:  npm run --silent stats
// Output: single-line JSON, no logs to stdout (logs go to stderr).

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import Database from "better-sqlite3";
import "dotenv/config";

const DATA_DIR = "./data";
const DRAFTS_DB = path.join(DATA_DIR, "drafts.db");
const WHITELIST_PATH = path.join(DATA_DIR, "whitelist.json");
const LANGUAGES_PATH = path.join(DATA_DIR, "user-languages.json");
const PACKAGE_PATH = "./package.json";

interface DraftRow {
  user_id: number;
  created_at: string;
  image_paths: string;
}

interface DraftStats {
  total: number;
  with_images: number;
  users: number;
  oldest_iso: string | null;
}

function readDraftStats(): DraftStats {
  if (!fs.existsSync(DRAFTS_DB)) {
    return { total: 0, with_images: 0, users: 0, oldest_iso: null };
  }
  const db = new Database(DRAFTS_DB, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare("SELECT user_id, created_at, image_paths FROM drafts")
      .all() as DraftRow[];
    const users = new Set(rows.map((r) => r.user_id));
    const withImages = rows.filter((r) => {
      try {
        const arr = JSON.parse(r.image_paths) as unknown;
        return Array.isArray(arr) && arr.length > 0;
      } catch {
        return false;
      }
    }).length;
    const oldest = rows.reduce<string | null>((acc, r) => {
      if (!acc || r.created_at < acc) return r.created_at;
      return acc;
    }, null);
    return { total: rows.length, with_images: withImages, users: users.size, oldest_iso: oldest };
  } finally {
    db.close();
  }
}

interface WhitelistFile {
  entries?: Array<{ role?: string }>;
  pendingRequests?: unknown[];
}

function readWhitelist(): { total: number; admins: number; pending: number } {
  if (!fs.existsSync(WHITELIST_PATH)) return { total: 0, admins: 0, pending: 0 };
  try {
    const data = JSON.parse(fs.readFileSync(WHITELIST_PATH, "utf-8")) as WhitelistFile;
    const entries = data.entries ?? [];
    return {
      total: entries.length,
      admins: entries.filter((e) => e.role === "admin").length,
      pending: (data.pendingRequests ?? []).length,
    };
  } catch {
    return { total: 0, admins: 0, pending: 0 };
  }
}

function readLanguageUsers(): number {
  if (!fs.existsSync(LANGUAGES_PATH)) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(LANGUAGES_PATH, "utf-8")) as Record<string, unknown>;
    return Object.keys(data).length;
  } catch {
    return 0;
  }
}

function readVersion(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf-8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function readGitSha(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function main() {
  const draftStats = readDraftStats();
  const whitelist = readWhitelist();
  const languageUsers = readLanguageUsers();
  const version = readVersion();
  const gitSha = readGitSha();

  const snapshot = {
    schema: 1,
    generated_at: new Date().toISOString(),
    version,
    git_sha: gitSha,
    atproto: {
      handle: process.env.ATPROTO_HANDLE ?? null,
    },
    drafts: draftStats,
    whitelist,
    languages: { users: languageUsers },
  };

  process.stdout.write(JSON.stringify(snapshot) + "\n");
}

main();
