// Persistent organization store — written to orgs.json on disk.
// Read dynamically so new organizations take effect without a restart.

import fs from "fs";
import path from "path";
import type { OrganizationRole } from "./cgs.js";

const ORG_ACCOUNTS_FILE = path.join(process.cwd(), "orgs.json");

export interface StandaloneOrgAccount {
  kind: "standalone";
  handle: string;   // full handle e.g. "cabarete-sostenible.gainforest.id"
  did: string;
  password: string;
  createdAt: string;
}

export interface SharedOrgAccount {
  kind: "group";
  handle: string;
  did: string;
  role?: OrganizationRole;
  serviceDid?: string;
  createdAt: string;
  // Returned once when the shared organization account is created. It is for
  // recovery/credible exit, not for normal publishing.
  recoveryPassword?: string;
}

export type OrgAccount = StandaloneOrgAccount | SharedOrgAccount;

type LegacyOrgAccount = Omit<StandaloneOrgAccount, "kind"> & { kind?: undefined };

function normalizeAccount(account: OrgAccount | LegacyOrgAccount): OrgAccount {
  if ((account as OrgAccount).kind === "group") return account as SharedOrgAccount;
  return { ...(account as LegacyOrgAccount), kind: "standalone" };
}

export function loadOrgAccounts(): OrgAccount[] {
  if (!fs.existsSync(ORG_ACCOUNTS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(ORG_ACCOUNTS_FILE, "utf-8")) as Array<OrgAccount | LegacyOrgAccount>;
    return Array.isArray(parsed) ? parsed.map(normalizeAccount) : [];
  } catch {
    return [];
  }
}

function saveOrgAccounts(accounts: OrgAccount[]): void {
  fs.writeFileSync(ORG_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

export function saveOrgAccount(account: StandaloneOrgAccount | LegacyOrgAccount): void {
  const normalized = normalizeAccount(account);
  if (normalized.kind !== "standalone") return;
  const accounts = loadOrgAccounts();
  if (accounts.some((a) => a.handle === normalized.handle || a.did === normalized.did)) return;
  accounts.push(normalized);
  saveOrgAccounts(accounts);
}

export function saveSharedOrgAccount(account: SharedOrgAccount): void {
  const accounts = loadOrgAccounts();
  const index = accounts.findIndex((a) => a.handle === account.handle || a.did === account.did);
  if (index >= 0) {
    accounts[index] = { ...accounts[index], ...account, kind: "group" } as SharedOrgAccount;
  } else {
    accounts.push(account);
  }
  saveOrgAccounts(accounts);
}

// Returns the primary standalone org account (first entry), or undefined if none saved yet.
// Kept for backwards compatibility with the existing direct-publishing paradigm.
export function getPrimaryOrgAccount(): StandaloneOrgAccount | undefined {
  return loadOrgAccounts().find((account): account is StandaloneOrgAccount => account.kind === "standalone");
}

export function getSharedOrgAccounts(): SharedOrgAccount[] {
  return loadOrgAccounts().filter((account): account is SharedOrgAccount => account.kind === "group");
}
