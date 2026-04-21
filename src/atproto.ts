// ATProto community account client for Pi-Tainá
// Manages a singleton authenticated AtpAgent for the community account
// and a publishing agent that prefers the primary org account when available.

import { AtpAgent } from "@atproto/api";
import type { EnvConfig } from "./env.js";
import { getPrimaryOrgAccount } from "./org-accounts.js";

// Module-level singleton state
let _agent: AtpAgent | null = null;
let _did: string | null = null;
let _handle: string | null = null;

/**
 * Initialize and login to the community ATProto account.
 * Reads credentials from the provided EnvConfig.
 * Throws if credentials are missing or login fails.
 * Caches the agent singleton — subsequent calls return the same instance.
 */
export async function getAtprotoAgent(config: EnvConfig): Promise<AtpAgent> {
  if (_agent !== null) {
    return _agent;
  }

  const { atprotoHandle, atprotoPassword, atprotoService } = config;

  if (!atprotoHandle || !atprotoPassword) {
    throw new Error("Missing ATPROTO_HANDLE or ATPROTO_PASSWORD in environment");
  }

  const agent = new AtpAgent({ service: atprotoService });

  let loginResult;
  try {
    loginResult = await agent.login({
      identifier: atprotoHandle,
      password: atprotoPassword,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ATProto login failed: ${message}`);
  }

  _agent = agent;
  _did = loginResult.data.did;
  _handle = loginResult.data.handle;

  console.log(`ATProto: logged in as @${_handle} (${_did})`);

  return _agent;
}

/**
 * Get the community DID (available after login).
 * Throws if getAtprotoAgent() has not been called yet.
 */
export function getCommunityDid(): string {
  if (_did === null) {
    throw new Error("ATProto agent not initialized — call getAtprotoAgent() first");
  }
  return _did;
}

/**
 * Get the community handle (available after login).
 * Throws if getAtprotoAgent() has not been called yet.
 */
export function getCommunityHandle(): string {
  if (_handle === null) {
    throw new Error("ATProto agent not initialized — call getAtprotoAgent() first");
  }
  return _handle;
}

// Publishing agent — uses primary org account if one is saved, falls back to community.
// Cached by org handle so a newly created org takes effect on the next call automatically.
let _pubAgent: AtpAgent | null = null;
let _pubDid: string | null = null;
let _pubHandle: string | null = null;
let _pubOrgHandle: string | null = null; // which org the cache was built for

export async function getPublishingAgent(config: EnvConfig): Promise<AtpAgent> {
  const org = getPrimaryOrgAccount();
  if (org) {
    if (_pubAgent && _pubOrgHandle === org.handle) return _pubAgent;
    const agent = new AtpAgent({ service: "https://gainforest.id" });
    const result = await agent.login({ identifier: org.handle, password: org.password });
    _pubAgent = agent;
    _pubDid = result.data.did;
    _pubHandle = result.data.handle;
    _pubOrgHandle = org.handle;
    console.log(`ATProto: publishing as org @${_pubHandle} (${_pubDid})`);
    return agent;
  }
  return getAtprotoAgent(config);
}

export function getPublishingDid(): string {
  const org = getPrimaryOrgAccount();
  if (org && _pubDid && _pubOrgHandle === org.handle) return _pubDid;
  return getCommunityDid();
}

export function getPublishingHandle(): string {
  const org = getPrimaryOrgAccount();
  if (org && _pubHandle && _pubOrgHandle === org.handle) return _pubHandle;
  return getCommunityHandle();
}
