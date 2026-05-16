// Local draft observation queue — SQLite + on-disk image blobs
// Lets users save an assembled Darwin Core observation offline
// and flush it to ATProto later via commands or the agent.

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import type { OccurrenceInput } from "./tools/publish-occurrence.js";

const DATA_DIR = "./data";
const DB_PATH = path.join(DATA_DIR, "drafts.db");
const IMAGES_DIR = path.join(DATA_DIR, "drafts");

export interface DraftSummary {
  id: string;
  userId: number;
  scientificName: string;
  vernacularName?: string;
  createdAt: string;
  imageCount: number;
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    throw new Error("drafts DB not initialized — call initDrafts() at startup");
  }
  return db;
}

export function initDrafts(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      id              TEXT PRIMARY KEY,
      user_id         INTEGER NOT NULL,
      scientific_name TEXT NOT NULL,
      vernacular_name TEXT,
      created_at      TEXT NOT NULL,
      payload         TEXT NOT NULL,
      image_paths     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id);
  `);
}

function mimeToExt(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("png")) return "png";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("gif")) return "gif";
  if (lower.includes("heic")) return "heic";
  return "bin";
}

function extToMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    default:
      return "application/octet-stream";
  }
}

export function saveDraft(input: OccurrenceInput): { draftId: string } {
  const draftId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const draftImageDir = path.join(IMAGES_DIR, draftId);
  fs.mkdirSync(draftImageDir, { recursive: true });

  const imagePaths: string[] = [];
  const images = (input.images ?? []).slice(0, MAX_DRAFT_IMAGES);
  for (let i = 0; i < images.length; i++) {
    const ext = mimeToExt(images[i].mimeType);
    const filePath = path.join(draftImageDir, `image-${i + 1}.${ext}`);
    fs.writeFileSync(filePath, images[i].data);
    imagePaths.push(filePath);
  }

  // Strip the binary image buffers — paths above represent them now.
  const { images: _omit, ...payloadWithoutImages } = input;

  getDb()
    .prepare(
      `INSERT INTO drafts
         (id, user_id, scientific_name, vernacular_name, created_at, payload, image_paths)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      draftId,
      input.submittedBy.id,
      input.scientificName,
      input.vernacularName ?? null,
      createdAt,
      JSON.stringify(payloadWithoutImages),
      JSON.stringify(imagePaths),
    );

  return { draftId };
}

export function listDrafts(userId: number): DraftSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, user_id, scientific_name, vernacular_name, created_at, image_paths
         FROM drafts
        WHERE user_id = ?
        ORDER BY created_at ASC`,
    )
    .all(userId) as Array<{
    id: string;
    user_id: number;
    scientific_name: string;
    vernacular_name: string | null;
    created_at: string;
    image_paths: string;
  }>;

  return rows.map((row) => {
    const paths = JSON.parse(row.image_paths) as string[];
    return {
      id: row.id,
      userId: row.user_id,
      scientificName: row.scientific_name,
      vernacularName: row.vernacular_name ?? undefined,
      createdAt: row.created_at,
      imageCount: paths.length,
    };
  });
}

export function loadDraft(draftId: string, userId: number): OccurrenceInput | null {
  const row = getDb()
    .prepare(
      `SELECT payload, image_paths
         FROM drafts
        WHERE id = ? AND user_id = ?`,
    )
    .get(draftId, userId) as
    | { payload: string; image_paths: string }
    | undefined;

  if (!row) return null;

  const payload = JSON.parse(row.payload) as Omit<OccurrenceInput, "images">;
  const imagePaths = JSON.parse(row.image_paths) as string[];

  const images = imagePaths
    .filter((p) => fs.existsSync(p))
    .map((p) => ({
      data: fs.readFileSync(p),
      mimeType: extToMime(path.extname(p).slice(1)),
    }));

  return { ...payload, images };
}

const MAX_DRAFT_IMAGES = 5;

export interface AttachImagesResult {
  added: number;
  totalAfter: number;
  capped: boolean;
}

export function attachImagesToDraft(
  draftId: string,
  userId: number,
  images: Array<{ data: Buffer; mimeType: string }>,
): AttachImagesResult | null {
  const row = getDb()
    .prepare(
      `SELECT image_paths FROM drafts WHERE id = ? AND user_id = ?`,
    )
    .get(draftId, userId) as { image_paths: string } | undefined;

  if (!row) return null;

  const existing = JSON.parse(row.image_paths) as string[];
  const remaining = Math.max(0, MAX_DRAFT_IMAGES - existing.length);
  const toAdd = images.slice(0, remaining);
  const capped = images.length > remaining;

  if (toAdd.length === 0) {
    return { added: 0, totalAfter: existing.length, capped };
  }

  const draftImageDir = path.join(IMAGES_DIR, draftId);
  fs.mkdirSync(draftImageDir, { recursive: true });

  const newPaths: string[] = [];
  for (let i = 0; i < toAdd.length; i++) {
    const ext = mimeToExt(toAdd[i].mimeType);
    const index = existing.length + newPaths.length + 1;
    const filePath = path.join(draftImageDir, `image-${index}.${ext}`);
    fs.writeFileSync(filePath, toAdd[i].data);
    newPaths.push(filePath);
  }

  const allPaths = [...existing, ...newPaths];
  getDb()
    .prepare(`UPDATE drafts SET image_paths = ? WHERE id = ? AND user_id = ?`)
    .run(JSON.stringify(allPaths), draftId, userId);

  return { added: newPaths.length, totalAfter: allPaths.length, capped };
}

export function getDraftImageCount(draftId: string, userId: number): number | null {
  const row = getDb()
    .prepare(`SELECT image_paths FROM drafts WHERE id = ? AND user_id = ?`)
    .get(draftId, userId) as { image_paths: string } | undefined;
  if (!row) return null;
  return (JSON.parse(row.image_paths) as string[]).length;
}

export function deleteDraft(draftId: string, userId: number): boolean {
  const result = getDb()
    .prepare(`DELETE FROM drafts WHERE id = ? AND user_id = ?`)
    .run(draftId, userId);

  if (result.changes === 0) return false;

  const draftImageDir = path.join(IMAGES_DIR, draftId);
  if (fs.existsSync(draftImageDir)) {
    fs.rmSync(draftImageDir, { recursive: true, force: true });
  }
  return true;
}
