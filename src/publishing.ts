import { AtpAgent } from "@atproto/api";
import type { EnvConfig } from "./env.js";
import { getAtprotoAgent, getPublishingAgent } from "./atproto.js";
import { CgsClient, type OrganizationRole } from "./cgs.js";
import {
  OrganizationRequired,
  OrganizationSelectionRequired,
  resolveActiveOrganization,
  type OrganizationOption,
} from "./organizations.js";

export type PublishingMode = "standalone" | "group";

export interface RecordWriteResult {
  uri: string;
  cid: string;
}

export interface BlobUploadResult {
  blob: unknown;
}

export interface PublishingClient {
  mode: PublishingMode;
  did: string;
  handle: string;
  displayName?: string;
  role?: OrganizationRole;
  organization: OrganizationOption;
  createRecord(args: { collection: string; record: Record<string, unknown>; rkey?: string }): Promise<RecordWriteResult>;
  putRecord(args: { collection: string; rkey: string; record: Record<string, unknown> }): Promise<RecordWriteResult>;
  deleteRecord(args: { collection: string; rkey: string }): Promise<void>;
  uploadBlob(data: Buffer | Uint8Array, mimeType: string): Promise<BlobUploadResult>;
  getRecord(args: { collection: string; rkey: string }): Promise<{ uri: string; cid?: string; value: unknown }>;
  listRecords(args: { collection: string; limit?: number; cursor?: string }): Promise<{ records: Array<{ uri: string; cid: string; value: unknown }>; cursor?: string }>;
}

function selectionErrorMessage(error: OrganizationSelectionRequired): string {
  const options = error.options.map((option, index) => `${index + 1}. ${option.displayName ?? option.handle}`).join("; ");
  return `Please choose an organization for this session first. Options: ${options}`;
}

export function normalizePublishingError(err: unknown): string {
  if (err instanceof OrganizationSelectionRequired) return selectionErrorMessage(err);
  if (err instanceof OrganizationRequired) return "No organization is available yet. Create an organization first, then try again.";
  return err instanceof Error ? err.message : String(err);
}

export async function getPublishingClient(config: EnvConfig, telegramUserId?: number): Promise<PublishingClient> {
  const organization = await resolveActiveOrganization(config, telegramUserId);

  if (organization.kind === "group") {
    if (!organization.serviceUrl || !organization.serviceDid) {
      throw new OrganizationRequired("Selected organization is missing service configuration");
    }
    const agent = await getAtprotoAgent(config);
    const cgs = new CgsClient(agent, {
      serviceUrl: organization.serviceUrl,
      serviceDid: organization.serviceDid,
    });
    const readAgent = new AtpAgent({ service: config.cgsGroupPdsUrl ?? "https://gainforest.id" });

    return {
      mode: "group",
      did: organization.did,
      handle: organization.handle,
      displayName: organization.displayName,
      role: organization.role,
      organization,
      async createRecord(args) {
        return cgs.createRecord({ repo: organization.did, ...args });
      },
      async putRecord(args) {
        return cgs.putRecord({ repo: organization.did, ...args });
      },
      async deleteRecord(args) {
        await cgs.deleteRecord({ repo: organization.did, ...args });
      },
      async uploadBlob(data, mimeType) {
        return cgs.uploadBlob(organization.did, data, mimeType);
      },
      async getRecord(args) {
        const result = await readAgent.com.atproto.repo.getRecord({
          repo: organization.did,
          collection: args.collection,
          rkey: args.rkey,
        });
        return {
          uri: result.data.uri,
          cid: result.data.cid,
          value: result.data.value,
        };
      },
      async listRecords(args) {
        const result = await readAgent.com.atproto.repo.listRecords({
          repo: organization.did,
          collection: args.collection,
          limit: args.limit,
          cursor: args.cursor,
        });
        return {
          records: result.data.records.map((record) => ({
            uri: record.uri,
            cid: record.cid,
            value: record.value,
          })),
          cursor: result.data.cursor,
        };
      },
    };
  }

  const agent = await getPublishingAgent(config);
  return {
    mode: "standalone",
    did: organization.did,
    handle: organization.handle,
    displayName: organization.displayName,
    organization,
    async createRecord(args) {
      const result = await agent.com.atproto.repo.createRecord({
        repo: organization.did,
        collection: args.collection,
        record: args.record,
        rkey: args.rkey,
      });
      return { uri: result.data.uri, cid: result.data.cid };
    },
    async putRecord(args) {
      const result = await agent.com.atproto.repo.putRecord({
        repo: organization.did,
        collection: args.collection,
        rkey: args.rkey,
        record: args.record,
      });
      return { uri: result.data.uri, cid: result.data.cid };
    },
    async deleteRecord(args) {
      await agent.com.atproto.repo.deleteRecord({
        repo: organization.did,
        collection: args.collection,
        rkey: args.rkey,
      });
    },
    async uploadBlob(data, mimeType) {
      const result = await agent.uploadBlob(data, { encoding: mimeType });
      return { blob: result.data.blob };
    },
    async getRecord(args) {
      const result = await agent.com.atproto.repo.getRecord({
        repo: organization.did,
        collection: args.collection,
        rkey: args.rkey,
      });
      return {
        uri: result.data.uri,
        cid: result.data.cid,
        value: result.data.value,
      };
    },
    async listRecords(args) {
      const result = await agent.com.atproto.repo.listRecords({
        repo: organization.did,
        collection: args.collection,
        limit: args.limit,
        cursor: args.cursor,
      });
      return {
        records: result.data.records.map((record) => ({
          uri: record.uri,
          cid: record.cid,
          value: record.value,
        })),
        cursor: result.data.cursor,
      };
    },
  };
}
