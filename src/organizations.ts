import type { AtpAgent } from "@atproto/api";
import { CgsClient, type CgsConfig, type OrganizationRole } from "./cgs.js";
import type { EnvConfig } from "./env.js";
import { getAtprotoAgent, getCommunityDid, getCommunityHandle } from "./atproto.js";
import { getPrimaryOrgAccount, getSharedOrgAccounts, saveSharedOrgAccount, type SharedOrgAccount } from "./org-accounts.js";

export type OrganizationKind = "standalone" | "group";

export interface OrganizationOption {
  id: string;
  kind: OrganizationKind;
  did: string;
  handle: string;
  displayName?: string;
  role?: OrganizationRole;
  serviceDid?: string;
  serviceUrl?: string;
}

export class OrganizationSelectionRequired extends Error {
  readonly options: OrganizationOption[];

  constructor(options: OrganizationOption[]) {
    super("Organization selection required");
    this.name = "OrganizationSelectionRequired";
    this.options = options;
  }
}

export class OrganizationRequired extends Error {
  constructor(message = "No organization is available") {
    super(message);
    this.name = "OrganizationRequired";
  }
}

const activeByTelegramUser = new Map<number, string>();

function normalizeServiceUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function isSharedOrganizationConfigured(config: EnvConfig): boolean {
  return Boolean(config.cgsServiceUrl && config.cgsServiceDid);
}

export function getCgsConfig(config: EnvConfig): CgsConfig | null {
  if (!config.cgsServiceUrl || !config.cgsServiceDid) return null;
  return {
    serviceUrl: normalizeServiceUrl(config.cgsServiceUrl),
    serviceDid: config.cgsServiceDid,
  };
}

export async function getCgsClient(config: EnvConfig, agent?: AtpAgent): Promise<CgsClient> {
  const cgs = getCgsConfig(config);
  if (!cgs) {
    throw new OrganizationRequired("Shared organizations are not configured");
  }
  return new CgsClient(agent ?? await getAtprotoAgent(config), cgs);
}

interface DidDocument {
  alsoKnownAs?: string[];
  service?: Array<{ id?: string; type?: string; serviceEndpoint?: string | Record<string, unknown> }>;
}

async function fetchDidDocument(did: string): Promise<DidDocument | null> {
  try {
    let url: string | undefined;
    if (did.startsWith("did:plc:")) {
      url = `https://plc.directory/${encodeURIComponent(did)}`;
    } else if (did.startsWith("did:web:")) {
      const host = did.slice("did:web:".length).replace(/:/g, "/");
      url = `https://${host}/.well-known/did.json`;
    }
    if (!url) return null;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json() as DidDocument;
  } catch {
    return null;
  }
}

function handleFromDidDocument(doc: DidDocument | null): string | undefined {
  const aka = doc?.alsoKnownAs?.find((value) => value.startsWith("at://"));
  return aka?.slice("at://".length);
}

function pdsFromDidDocument(doc: DidDocument | null): string | undefined {
  const service = doc?.service?.find((entry) => entry.id === "#atproto_pds" || entry.type === "AtprotoPersonalDataServer");
  return typeof service?.serviceEndpoint === "string" ? service.serviceEndpoint : undefined;
}

async function fetchRecordValue(pdsUrl: string, repo: string, collection: string, rkey = "self"): Promise<Record<string, unknown> | null> {
  try {
    const url = new URL("/xrpc/com.atproto.repo.getRecord", normalizeServiceUrl(pdsUrl));
    url.searchParams.set("repo", repo);
    url.searchParams.set("collection", collection);
    url.searchParams.set("rkey", rkey);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json() as { value?: Record<string, unknown> };
    return data.value ?? null;
  } catch {
    return null;
  }
}

async function displayNameForOrg(config: EnvConfig, did: string, fallbackHandle: string): Promise<string> {
  const doc = await fetchDidDocument(did);
  const pds = pdsFromDidDocument(doc) ?? config.cgsGroupPdsUrl ?? "https://gainforest.id";
  const profile = await fetchRecordValue(pds, did, "app.certified.actor.profile");
  if (typeof profile?.displayName === "string" && profile.displayName.trim()) return profile.displayName;
  const info = await fetchRecordValue(pds, did, "app.gainforest.organization.info");
  if (typeof info?.displayName === "string" && info.displayName.trim()) return info.displayName;
  return fallbackHandle;
}

export async function resolveDidIdentity(config: EnvConfig, did: string): Promise<{ did: string; handle: string; pdsUrl?: string }> {
  const doc = await fetchDidDocument(did);
  return {
    did,
    handle: handleFromDidDocument(doc) ?? did,
    pdsUrl: pdsFromDidDocument(doc) ?? config.cgsGroupPdsUrl ?? "https://gainforest.id",
  };
}

export async function discoverOrganizationOptions(config: EnvConfig): Promise<OrganizationOption[]> {
  const options: OrganizationOption[] = [];

  const standalone = getPrimaryOrgAccount();
  if (standalone) {
    options.push({
      id: `standalone:${standalone.did}`,
      kind: "standalone",
      did: standalone.did,
      handle: standalone.handle,
      displayName: standalone.handle,
    });
  }

  const cgsConfig = getCgsConfig(config);
  if (cgsConfig) {
    const agent = await getAtprotoAgent(config);
    const client = new CgsClient(agent, cgsConfig);
    const memberships = await client.listMemberships();
    const savedGroups = getSharedOrgAccounts();
    const byDid = new Map<string, SharedOrgAccount>(savedGroups.map((group) => [group.did, group]));

    const seenGroupDids = new Set<string>();
    for (const membership of memberships) {
      seenGroupDids.add(membership.groupDid);
      const saved = byDid.get(membership.groupDid);
      const identity = saved
        ? { did: saved.did, handle: saved.handle }
        : await resolveDidIdentity(config, membership.groupDid);
      const displayName = await displayNameForOrg(config, membership.groupDid, identity.handle);
      options.push({
        id: `group:${membership.groupDid}`,
        kind: "group",
        did: membership.groupDid,
        handle: identity.handle,
        displayName,
        role: membership.role,
        serviceDid: cgsConfig.serviceDid,
        serviceUrl: cgsConfig.serviceUrl,
      });
    }

    // Keep newly-created organizations available immediately even if the
    // membership endpoint is briefly stale after registration.
    for (const saved of savedGroups) {
      if (seenGroupDids.has(saved.did)) continue;
      options.push({
        id: `group:${saved.did}`,
        kind: "group",
        did: saved.did,
        handle: saved.handle,
        displayName: saved.handle,
        role: saved.role,
        serviceDid: saved.serviceDid ?? cgsConfig.serviceDid,
        serviceUrl: cgsConfig.serviceUrl,
      });
    }
  }

  // If shared orgs are not configured and no saved standalone org exists, keep
  // the current community-account publishing behavior as a legacy fallback.
  if (options.length === 0 && !cgsConfig) {
    try {
      await getAtprotoAgent(config);
      options.push({
        id: `standalone:${getCommunityDid()}`,
        kind: "standalone",
        did: getCommunityDid(),
        handle: getCommunityHandle(),
        displayName: getCommunityHandle(),
      });
    } catch {
      // Publishing will fail later with the normal ATProto config error.
    }
  }

  return options;
}

export async function resolveActiveOrganization(config: EnvConfig, telegramUserId?: number): Promise<OrganizationOption> {
  const options = await discoverOrganizationOptions(config);

  if (telegramUserId !== undefined) {
    const selectedId = activeByTelegramUser.get(telegramUserId);
    const selected = selectedId ? options.find((option) => option.id === selectedId) : undefined;
    if (selected) return selected;
  }

  if (options.length === 1) {
    if (telegramUserId !== undefined) activeByTelegramUser.set(telegramUserId, options[0].id);
    return options[0];
  }

  if (options.length > 1) {
    throw new OrganizationSelectionRequired(options);
  }

  throw new OrganizationRequired("No organization is available yet");
}

export async function selectOrganization(config: EnvConfig, telegramUserId: number, selector: string): Promise<OrganizationOption> {
  const options = await discoverOrganizationOptions(config);
  const normalized = selector.trim().toLowerCase();
  const option = options.find((candidate, index) =>
    String(index + 1) === normalized ||
    candidate.id.toLowerCase() === normalized ||
    candidate.did.toLowerCase() === normalized ||
    candidate.handle.toLowerCase() === normalized ||
    candidate.displayName?.toLowerCase() === normalized
  );

  if (!option) {
    throw new OrganizationSelectionRequired(options);
  }

  activeByTelegramUser.set(telegramUserId, option.id);
  return option;
}

export function setActiveOrganization(telegramUserId: number, option: OrganizationOption): void {
  activeByTelegramUser.set(telegramUserId, option.id);
}

export function roleAllows(role: OrganizationRole | undefined, action: "publish" | "manageMembers" | "setRoles" | "editProfile"): boolean {
  if (action === "publish") return role === "member" || role === "admin" || role === "owner";
  if (action === "manageMembers" || action === "editProfile") return role === "admin" || role === "owner";
  if (action === "setRoles") return role === "owner";
  return false;
}

export async function buildOrganizationPromptContext(config: EnvConfig, telegramUserId: number): Promise<string> {
  try {
    const options = await discoverOrganizationOptions(config);
    const selectedId = activeByTelegramUser.get(telegramUserId);
    const selected = selectedId ? options.find((option) => option.id === selectedId) : undefined;

    if (selected) {
      const roleText = selected.kind === "group" && selected.role ? ` The user's role is ${selected.role}.` : "";
      const restrictions = selected.kind === "group" && selected.role === "member"
        ? " Do not offer member management, role changes, organization profile edits, or editing/deleting other people's records."
        : selected.kind === "group" && selected.role === "admin"
          ? " Do not offer owner-only controls such as role changes or deleting the organization."
          : "";
      return `\nCurrent organization for this session: ${selected.displayName ?? selected.handle}.${roleText}${restrictions} User-facing wording must say "organization" only; do not mention protocol internals.`;
    }

    if (options.length > 1) {
      const list = options.map((option, index) => `${index + 1}. ${option.displayName ?? option.handle}${option.kind === "group" && option.role ? ` (${option.role})` : ""}`).join("; ");
      return `\nBefore publishing or changing organization records, ask the user which organization to use for this session. Available organizations: ${list}. After the user chooses, call select_organization. User-facing wording must say "organization" only; do not mention protocol internals.`;
    }

    if (options.length === 0 && isSharedOrganizationConfigured(config)) {
      return "\nNo organization is available for this account yet. If the user wants to publish as an organization, offer to create one. User-facing wording must say \"organization\" only; do not mention protocol internals.";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `\nOrganization lookup is temporarily unavailable (${message}). If organization-specific publishing fails, apologize briefly and ask the user to try again.`;
  }

  return "";
}

export function rememberSharedOrganization(input: {
  handle: string;
  did: string;
  role?: OrganizationRole;
  serviceDid?: string;
  createdAt: string;
  recoveryPassword?: string;
}): SharedOrgAccount {
  const account: SharedOrgAccount = {
    kind: "group",
    handle: input.handle,
    did: input.did,
    role: input.role,
    serviceDid: input.serviceDid,
    createdAt: input.createdAt,
    recoveryPassword: input.recoveryPassword,
  };
  saveSharedOrgAccount(account);
  return account;
}
