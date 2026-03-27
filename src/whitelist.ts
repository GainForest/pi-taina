// Local-first access control whitelist
// Manages a JSON file on disk — no external database required
// File persists across bot restarts

import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'member';

export interface WhitelistEntry {
  userId: number;        // Telegram user ID
  role: Role;
  addedBy: number;       // Telegram user ID of who added them
  addedAt: string;       // ISO 8601 timestamp
  displayName?: string;  // optional, for human readability
}

export interface JoinRequest {
  userId: number;
  displayName: string;
  username?: string;
  requestedAt: string;   // ISO 8601
}

interface WhitelistData {
  entries: WhitelistEntry[];
  pendingRequests: JoinRequest[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const WHITELIST_PATH = './data/whitelist.json';

// ── Module-level cache ───────────────────────────────────────────────────────

let cache: WhitelistData = {
  entries: [],
  pendingRequests: [],
};

// ── File I/O helpers ─────────────────────────────────────────────────────────

function loadFromDisk(adminUserId: number): WhitelistData {
  try {
    const raw = fs.readFileSync(WHITELIST_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as WhitelistData;
    // Basic shape validation
    if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.pendingRequests)) {
      throw new Error('Invalid whitelist file structure');
    }
    return parsed;
  } catch (err: unknown) {
    const isNotFound =
      err instanceof Error &&
      'code' in (err as NodeJS.ErrnoException) &&
      (err as NodeJS.ErrnoException).code === 'ENOENT';

    if (!isNotFound) {
      console.warn('[whitelist] Warning: could not read whitelist file, starting fresh.', err);
    }

    // Return fresh data with just the admin
    return {
      entries: [
        {
          userId: adminUserId,
          role: 'admin',
          addedBy: adminUserId,
          addedAt: new Date().toISOString(),
        },
      ],
      pendingRequests: [],
    };
  }
}

function saveToDisk(): void {
  const dir = path.dirname(WHITELIST_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(WHITELIST_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

// ── Exported functions ───────────────────────────────────────────────────────

/**
 * Load whitelist from disk. If file doesn't exist OR adminUserId is not in
 * entries, ensure adminUserId is present with role 'admin'. Cache in memory.
 */
export function initWhitelist(adminUserId: number): void {
  const data = loadFromDisk(adminUserId);

  // Ensure admin is always present
  const adminEntry = data.entries.find((e) => e.userId === adminUserId);
  if (!adminEntry) {
    data.entries.push({
      userId: adminUserId,
      role: 'admin',
      addedBy: adminUserId,
      addedAt: new Date().toISOString(),
    });
  }

  cache = data;
  saveToDisk();
}

/**
 * Return the role of the user, or null if not whitelisted.
 * Reads from in-memory cache.
 */
export function getRole(userId: number): Role | null {
  const entry = cache.entries.find((e) => e.userId === userId);
  return entry ? entry.role : null;
}

/**
 * Returns true if user has any role (admin or member).
 */
export function isAuthorized(userId: number): boolean {
  return getRole(userId) !== null;
}

/**
 * Returns true if user role is 'admin'.
 */
export function isAdmin(userId: number): boolean {
  return getRole(userId) === 'admin';
}

/**
 * Add user as 'member'. If already exists, return false. Save to disk. Return true.
 */
export function addMember(
  userId: number,
  addedBy: number,
  displayName?: string
): boolean {
  const existing = cache.entries.find((e) => e.userId === userId);
  if (existing) return false;

  cache.entries.push({
    userId,
    role: 'member',
    addedBy,
    addedAt: new Date().toISOString(),
    displayName,
  });

  saveToDisk();
  return true;
}

/**
 * Remove user from entries. Cannot remove admins (return false).
 * Save to disk. Return true if removed.
 */
export function removeMember(userId: number): boolean {
  const entry = cache.entries.find((e) => e.userId === userId);
  if (!entry) return false;
  if (entry.role === 'admin') return false;

  cache.entries = cache.entries.filter((e) => e.userId !== userId);
  saveToDisk();
  return true;
}

/**
 * Add to pendingRequests if not already there and not already a member.
 * Save to disk. Return true if added.
 */
export function addJoinRequest(
  userId: number,
  displayName: string,
  username?: string
): boolean {
  // Already a member or admin — don't add to pending
  if (isAuthorized(userId)) return false;

  // Already has a pending request
  const alreadyPending = cache.pendingRequests.some((r) => r.userId === userId);
  if (alreadyPending) return false;

  cache.pendingRequests.push({
    userId,
    displayName,
    username,
    requestedAt: new Date().toISOString(),
  });

  saveToDisk();
  return true;
}

/**
 * Return copy of pendingRequests array.
 */
export function getPendingRequests(): JoinRequest[] {
  return [...cache.pendingRequests];
}

/**
 * Move user from pendingRequests to entries as 'member'.
 * Save to disk. Return true if found and moved.
 */
export function approveRequest(userId: number, approvedBy: number): boolean {
  const requestIndex = cache.pendingRequests.findIndex((r) => r.userId === userId);
  if (requestIndex === -1) return false;

  const request = cache.pendingRequests[requestIndex];

  // Remove from pending
  cache.pendingRequests.splice(requestIndex, 1);

  // Add to entries as member
  cache.entries.push({
    userId,
    role: 'member',
    addedBy: approvedBy,
    addedAt: new Date().toISOString(),
    displayName: request.displayName,
  });

  saveToDisk();
  return true;
}

/**
 * Remove from pendingRequests. Save to disk. Return true if found.
 */
export function denyRequest(userId: number): boolean {
  const index = cache.pendingRequests.findIndex((r) => r.userId === userId);
  if (index === -1) return false;

  cache.pendingRequests.splice(index, 1);
  saveToDisk();
  return true;
}

/**
 * Return copy of entries array.
 */
export function getMembers(): WhitelistEntry[] {
  return [...cache.entries];
}
