// Persistent org account store — written to orgs.json on disk.
// Read dynamically so new orgs take effect without a restart.

import fs from "fs";
import path from "path";

const ORG_ACCOUNTS_FILE = path.join(process.cwd(), "orgs.json");

export interface OrgAccount {
  handle: string;   // full handle e.g. "cabarete-sostenible.gainforest.id"
  did: string;
  password: string;
  createdAt: string;
}

export function loadOrgAccounts(): OrgAccount[] {
  if (!fs.existsSync(ORG_ACCOUNTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(ORG_ACCOUNTS_FILE, "utf-8")) as OrgAccount[];
  } catch {
    return [];
  }
}

export function saveOrgAccount(account: OrgAccount): void {
  const accounts = loadOrgAccounts();
  if (accounts.some((a) => a.handle === account.handle)) return; // already stored
  accounts.push(account);
  fs.writeFileSync(ORG_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

// Returns the primary org account (first entry), or undefined if none saved yet.
export function getPrimaryOrgAccount(): OrgAccount | undefined {
  return loadOrgAccounts()[0];
}
