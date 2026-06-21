import type { AtpAgent } from "@atproto/api";

export type OrganizationRole = "member" | "admin" | "owner";

export interface CgsConfig {
  serviceUrl: string;
  serviceDid: string;
}

export interface CgsGroupMembership {
  groupDid: string;
  role: OrganizationRole;
  joinedAt?: string;
}

export interface CgsMember {
  did: string;
  role: OrganizationRole;
  addedBy?: string;
  addedAt?: string;
}

export interface CgsRegisterInput {
  handle: string;
  ownerDid: string;
  email?: string;
}

export interface CgsRegisterResult {
  groupDid: string;
  handle: string;
  accountPassword?: string;
}

export class CgsError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "CgsError";
    this.status = status;
    this.code = code;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildXrpcUrl(serviceUrl: string, nsid: string, query?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`/xrpc/${nsid}`, `${trimTrailingSlash(serviceUrl)}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function getServiceAuthToken(agent: AtpAgent, serviceDid: string, nsid: string): Promise<string> {
  const result = await agent.com.atproto.server.getServiceAuth({
    aud: serviceDid,
    lxm: nsid,
  });
  return result.data.token;
}

async function parseXrpcResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const body = parsed as { error?: string; message?: string } | string | undefined;
    const code = typeof body === "object" && body ? body.error : undefined;
    const message =
      typeof body === "object" && body
        ? body.message ?? body.error ?? `HTTP ${response.status}`
        : typeof body === "string" && body.trim()
          ? body
          : `HTTP ${response.status}`;
    throw new CgsError(message, response.status, code);
  }

  return (parsed ?? {}) as T;
}

export class CgsClient {
  constructor(
    private readonly agent: AtpAgent,
    private readonly config: CgsConfig,
  ) {}

  private async request<T>(nsid: string, init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {}): Promise<T> {
    const token = await getServiceAuthToken(this.agent, this.config.serviceDid, nsid);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(buildXrpcUrl(this.config.serviceUrl, nsid, init.query), {
      ...init,
      headers,
    });

    if (response.headers.get("Deprecation") === "true") {
      console.warn(`[shared-org] deprecated targeting observed for ${nsid}; check service DID + repo usage`);
    }

    return parseXrpcResponse<T>(response);
  }

  async listMemberships(limit = 100): Promise<CgsGroupMembership[]> {
    const groups: CgsGroupMembership[] = [];
    let cursor: string | undefined;
    do {
      const data = await this.request<{ groups?: CgsGroupMembership[]; cursor?: string }>(
        "app.certified.groups.membership.list",
        { method: "GET", query: { limit, cursor } },
      );
      groups.push(...(data.groups ?? []));
      cursor = data.cursor;
    } while (cursor);
    return groups;
  }

  async registerGroup(input: CgsRegisterInput): Promise<CgsRegisterResult> {
    return this.request<CgsRegisterResult>("app.certified.group.register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  async createRecord(args: {
    repo: string;
    collection: string;
    record: Record<string, unknown>;
    rkey?: string;
  }): Promise<{ uri: string; cid: string }> {
    return this.request<{ uri: string; cid: string }>("app.certified.group.repo.createRecord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  }

  async putRecord(args: {
    repo: string;
    collection: string;
    rkey: string;
    record: Record<string, unknown>;
  }): Promise<{ uri: string; cid: string }> {
    return this.request<{ uri: string; cid: string }>("app.certified.group.repo.putRecord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  }

  async deleteRecord(args: { repo: string; collection: string; rkey: string }): Promise<Record<string, never>> {
    return this.request<Record<string, never>>("app.certified.group.repo.deleteRecord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  }

  async uploadBlob(repo: string, data: Buffer | Uint8Array, mimeType: string): Promise<{ blob: unknown }> {
    return this.request<{ blob: unknown }>("app.certified.group.repo.uploadBlob", {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(data.byteLength),
      },
      query: { repo },
      body: data,
    });
  }

  async listMembers(repo: string, limit = 100): Promise<CgsMember[]> {
    const members: CgsMember[] = [];
    let cursor: string | undefined;
    do {
      const data = await this.request<{ members?: CgsMember[]; cursor?: string }>(
        "app.certified.group.member.list",
        { method: "GET", query: { repo, limit, cursor } },
      );
      members.push(...(data.members ?? []));
      cursor = data.cursor;
    } while (cursor);
    return members;
  }

  async addMember(repo: string, memberDid: string, role: Exclude<OrganizationRole, "owner"> = "member"): Promise<CgsMember> {
    return this.request<CgsMember>("app.certified.group.member.add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, memberDid, role }),
    });
  }

  async removeMember(repo: string, memberDid: string): Promise<{ memberDid: string }> {
    return this.request<{ memberDid: string }>("app.certified.group.member.remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, memberDid }),
    });
  }

  async setRole(repo: string, memberDid: string, role: Exclude<OrganizationRole, "owner">): Promise<{ memberDid: string; role: OrganizationRole }> {
    return this.request<{ memberDid: string; role: OrganizationRole }>("app.certified.group.role.set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, memberDid, role }),
    });
  }
}
