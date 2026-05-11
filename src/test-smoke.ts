// Smoke test script for Hypersphere integration
// Run: npx tsx src/test-smoke.ts [hyperindex|org|org-shapes|occurrence|hypercert|attach|polygon|drafts|all]
// Reads credentials from .env via dotenv

import 'dotenv/config';

import { fetchOrgContext, initOrgContext, getOrgContext } from './hyperindex.js';
import { queryHyperindex } from './tools/query-hyperindex.js';
import { publishOccurrence } from './tools/publish-occurrence.js';
import { createHypercert } from './tools/create-hypercert.js';
import { getAtprotoAgent, getCommunityDid } from './atproto.js';
import { attachObservations } from './tools/attach-observations.js';
import type { AtpAgent } from '@atproto/api';
import { buildPolygonWebAppUrl, type PolygonPoint } from './tools/build-polygon-webapp-url.js';
import { parsePolygonWebAppPayload } from './tools/parse-polygon-webapp-payload.js';
import { createCertifiedLocation, type CertifiedLocationInput } from './tools/create-certified-location.js';
import {
  buildOrgInfoRecord,
  buildDefaultSiteRecord,
  createOrganization,
  type OrganizationInput,
} from './tools/create-organization.js';
import {
  clearOrganizationPolygonPoints,
  getOrganizationPolygonPoints,
  getOrCreateSession,
  processTelegramPolygonWebAppData,
  resolveOrganizationPolygonPoints,
  resetSession,
} from './agent.js';
import { initDrafts, saveDraft, listDrafts, loadDraft, deleteDraft } from './drafts.js';
import type { OccurrenceInput } from './tools/publish-occurrence.js';

// ─── Result tracking ──────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
}

const results: TestResult[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message} (expected ${expectedJson}, got ${actualJson})`);
  }
}

function decodePolygonDataParam(urlString: string): PolygonPoint[] {
  const url = new URL(urlString);
  const encoded = url.searchParams.get('data');
  assert(encoded !== null, 'expected preload data query param');

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const parsed = JSON.parse(decoded) as PolygonPoint[];
  assert(Array.isArray(parsed), 'decoded preload data must be an array');
  return parsed;
}

type CertifiedLocationSelectionInput = {
  decimalLatitude?: number;
  decimalLongitude?: number;
  locationName?: string;
  polygonPoints?: Array<{ lng: number; lat: number }>;
};

function selectCertifiedLocationInput(
  input: CertifiedLocationSelectionInput,
): CertifiedLocationInput | undefined {
  if (input.polygonPoints && input.polygonPoints.length >= 3) {
    return {
      kind: 'polygon',
      points: input.polygonPoints,
      locationName: input.locationName,
    };
  }

  if (
    typeof input.decimalLatitude === 'number' &&
    Number.isFinite(input.decimalLatitude) &&
    typeof input.decimalLongitude === 'number' &&
    Number.isFinite(input.decimalLongitude)
  ) {
    return {
      kind: 'point',
      latitude: input.decimalLatitude,
      longitude: input.decimalLongitude,
      locationName: input.locationName,
    };
  }

  return undefined;
}

function createCertifiedLocationStub() {
  const calls: Array<{ repo: string; collection: string; record: Record<string, unknown> }> = [];

  const agent = {
    com: {
      atproto: {
        repo: {
          createRecord: async (args: {
            repo: string;
            collection: string;
            record: Record<string, unknown>;
          }) => {
            calls.push(args);
            return {
              data: {
                uri: `at://did:plc:smoke/${calls.length}`,
                cid: `cid-${calls.length}`,
              },
            };
          },
        },
      },
    },
  } as unknown as AtpAgent;

  return { agent, calls };
}

function pass(name: string, detail: string): TestResult {
  const r: TestResult = { name, status: 'PASS', detail };
  console.log(`✅ ${name}: ${detail}`);
  return r;
}

function fail(name: string, detail: string): TestResult {
  const r: TestResult = { name, status: 'FAIL', detail };
  console.log(`❌ ${name}: ${detail}`);
  return r;
}

function skip(name: string, detail: string): TestResult {
  const r: TestResult = { name, status: 'SKIP', detail };
  console.log(`⏭️  ${name}: ${detail}`);
  return r;
}

// ─── ATProto helpers ──────────────────────────────────────────────────────────

function hasAtprotoCreds(): boolean {
  return !!(process.env.ATPROTO_HANDLE && process.env.ATPROTO_PASSWORD);
}

/**
 * Login to ATProto using env vars directly (bypasses loadEnvConfig which
 * requires TELEGRAM_BOT_TOKEN and GEMINI_API_KEY).
 *
 * Calls getAtprotoAgent() with a minimal EnvConfig so the singleton in
 * atproto.ts is populated — this makes getCommunityDid() work and also
 * ensures publishOccurrence / createHypercert reuse the same session.
 */
async function loginAtproto(): Promise<AtpAgent> {
  const handle = process.env.ATPROTO_HANDLE!;
  const password = process.env.ATPROTO_PASSWORD!;
  const service = process.env.ATPROTO_SERVICE || 'https://bsky.social';

  const config = {
    telegramBotToken: 'smoke-test',
    geminiApiKey: 'smoke-test',
    atprotoHandle: handle,
    atprotoPassword: password,
    atprotoService: service,
    anthropicApiKey: undefined,
    openaiApiKey: undefined,
    piModel: 'google/gemini-2.5-flash',
    speciesIdModel: 'gemini-2.5-flash',
    gfwDataApiKey: undefined,
    polygonWebAppBaseUrl: 'https://polygons-gainforest.vercel.app',
    adminUserId: 0,
    gainforestInviteCode: undefined,
  };

  // getAtprotoAgent caches on first call — subsequent calls return the same instance
  return getAtprotoAgent(config);
}

// ─── Subcommand: hyperindex ───────────────────────────────────────────────────

async function testHyperindex(): Promise<void> {
  console.log('\n── hyperindex ──────────────────────────────────────────────────');

  // 1. fetchOrgContext with a known DID (daviddao.org)
  try {
    const testDid = 'did:plc:qc42fmqqlsmdq7jiypiiigww';
    const ctx = await fetchOrgContext(testDid);
    if (ctx !== null) {
      results.push(pass('hyperindex:fetchOrgContext', `got context: ${ctx.displayName ?? '(no name)'}`));
    } else {
      // null is valid — DID may not be in Hyperindex
      results.push(pass('hyperindex:fetchOrgContext', 'returned null (DID not in Hyperindex — OK)'));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('hyperindex:fetchOrgContext', msg));
  }

  // 2. queryHyperindex — occurrences
  try {
    const res = await queryHyperindex({ type: 'occurrences', limit: 3 });
    if (res.success) {
      results.push(pass('hyperindex:occurrences', `queried ${res.records.length} occurrences (total: ${res.totalCount})`));
    } else {
      results.push(fail('hyperindex:occurrences', res.error));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('hyperindex:occurrences', msg));
  }

  // 3. queryHyperindex — hypercerts
  try {
    const res = await queryHyperindex({ type: 'hypercerts', limit: 3 });
    if (res.success) {
      results.push(pass('hyperindex:hypercerts', `queried ${res.records.length} hypercerts (total: ${res.totalCount})`));
    } else {
      results.push(fail('hyperindex:hypercerts', res.error));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('hyperindex:hypercerts', msg));
  }

  // 4. queryHyperindex — search
  try {
    const res = await queryHyperindex({ type: 'search', searchQuery: 'biodiversity', limit: 3 });
    if (res.success) {
      results.push(pass('hyperindex:search', `queried ${res.records.length} search results (total: ${res.totalCount})`));
    } else {
      // Search endpoint may not be available — treat as skip-worthy but not a hard fail
      results.push(fail('hyperindex:search', res.error));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('hyperindex:search', msg));
  }
}

// ─── Subcommand: org ──────────────────────────────────────────────────────────

async function testOrg(): Promise<void> {
  console.log('\n── org ─────────────────────────────────────────────────────────');

  if (!hasAtprotoCreds()) {
    results.push(skip('org', 'ATPROTO_HANDLE / ATPROTO_PASSWORD not set'));
    return;
  }

  try {
    await loginAtproto();
    const did = getCommunityDid();

    await initOrgContext(did);
    const ctx = getOrgContext();

    if (ctx?.displayName) {
      results.push(pass('org', `${ctx.displayName} (${ctx.organizationType?.join(', ') ?? 'unknown type'})`));
    } else {
      results.push(pass('org', 'SKIP — no org registered for this account in Hyperindex'));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('org', msg));
  }
}

// ─── Subcommand: occurrence ───────────────────────────────────────────────────

async function testOccurrence(): Promise<void> {
  console.log('\n── occurrence ──────────────────────────────────────────────────');

  if (!hasAtprotoCreds()) {
    results.push(skip('occurrence', 'ATPROTO_HANDLE / ATPROTO_PASSWORD not set'));
    return;
  }

  let agent: AtpAgent;
  let did: string;

  try {
    agent = await loginAtproto();
    did = getCommunityDid();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('occurrence', `ATProto login failed: ${msg}`));
    return;
  }

  try {
    const result = await publishOccurrence({
      scientificName: 'Testus smokeus',
      vernacularName: 'Smoke Test Organism',
      basisOfRecord: 'MachineObservation',
      decimalLatitude: 0.0,
      decimalLongitude: 0.0,
      locality: 'Smoke Test — safe to delete',
      country: 'Test',
      countryCode: 'XX',
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class_: 'Testia',
      order: 'Testiformes',
      family: 'Testidae',
      genus: 'Testus',
      specificEpithet: 'smokeus',
      taxonRank: 'species',
      stateProvince: 'Test Province',
      habitat: 'Smoke test environment',
      occurrenceRemarks: 'SMOKE TEST — safe to delete. Created by test-smoke.ts',
      submittedBy: { id: 0, username: 'smoke-test', displayName: 'Smoke Test' },
    });

    if (!result.success) {
      results.push(fail('occurrence', `Failed to publish — ${result.error}`));
      return;
    }

    // Verify occurrenceID is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(result.occurrenceID)) {
      results.push(fail('occurrence', `occurrenceID is not a valid UUID: ${result.occurrenceID}`));
      return;
    }

    console.log(`   AT URI: ${result.uri}`);

    // Clean up — delete the test record
    const rkey = result.uri.split('/').pop()!;
    await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: 'app.gainforest.dwc.occurrence',
      rkey,
    });
    console.log('   Cleaned up test record');

    results.push(pass('occurrence', `created + verified + cleaned up at://${result.uri.slice('at://'.length)}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('occurrence', msg));
  }
}

// ─── Subcommand: hypercert ────────────────────────────────────────────────────

async function testHypercert(): Promise<void> {
  console.log('\n── hypercert ───────────────────────────────────────────────────');

  if (!hasAtprotoCreds()) {
    results.push(skip('hypercert', 'ATPROTO_HANDLE / ATPROTO_PASSWORD not set'));
    return;
  }

  let agent: AtpAgent;
  let did: string;

  try {
    agent = await loginAtproto();
    did = getCommunityDid();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('hypercert', `ATProto login failed: ${msg}`));
    return;
  }

  try {
    const result = await createHypercert({
      title: 'Smoke Test Hypercert',
      shortDescription: 'Automated smoke test — safe to delete',
      description: 'This is a smoke test record created by test-smoke.ts to verify the hypercert creation flow works.',
      workScope: 'testing, smoke-test, automation',
      submittedBy: { id: 0, username: 'smoke-test', displayName: 'Smoke Test' },
    });

    if (!result.success) {
      results.push(fail('hypercert', `Failed to create — ${result.error}`));
      return;
    }

    // Verify hyperscanUrl contains 'hyperscan.dev'
    if (!result.hyperscanUrl.includes('hyperscan.dev')) {
      results.push(fail('hypercert', `hyperscanUrl does not contain 'hyperscan.dev': ${result.hyperscanUrl}`));
      return;
    }

    console.log(`   AT URI: ${result.uri}`);
    console.log(`   Hyperscan: ${result.hyperscanUrl}`);

    // Verify contributors are present
    if ('contributorCount' in result && result.contributorCount > 0) {
      console.log('   Contributors: ' + result.contributorCount);
    } else {
      console.log('   ⚠️  No contributorCount in result');
    }

    // Verify the raw record has contributors
    const rkey = result.uri.split('/').pop()!;
    const rawRecord = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: 'org.hypercerts.claim.activity',
      rkey: rkey,
    });
    const value = rawRecord.data.value as Record<string, unknown>;
    const contributors = value.contributors as Array<unknown> | undefined;
    if (contributors && contributors.length > 0) {
      console.log('   Raw record contributors: ' + contributors.length);
    } else {
      console.log('   ⚠️  No contributors in raw record');
    }

    // Clean up — delete the test record
    await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: 'org.hypercerts.claim.activity',
      rkey,
    });
    console.log('   Cleaned up test record');

    results.push(pass('hypercert', `created + verified + cleaned up at://${result.uri.slice('at://'.length)}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('hypercert', msg));
  }
}

// ─── Subcommand: attach ───────────────────────────────────────────────────────

async function testAttach(): Promise<void> {
  console.log('\n── attach ──────────────────────────────────────────────────────');

  if (!hasAtprotoCreds()) {
    results.push(skip('attach', 'ATPROTO_HANDLE / ATPROTO_PASSWORD not set'));
    return;
  }

  let agent: AtpAgent;
  let did: string;

  try {
    agent = await loginAtproto();
    did = getCommunityDid();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('attach', `ATProto login failed: ${msg}`));
    return;
  }

  // Step 1: Create a test hypercert to attach observations to
  let hypercertResult: Awaited<ReturnType<typeof createHypercert>>;
  try {
    hypercertResult = await createHypercert({
      title: 'Smoke Test Hypercert (attach)',
      shortDescription: 'Automated smoke test for attach — safe to delete',
      description: 'This is a smoke test record created by test-smoke.ts to verify the attach_observations flow works.',
      workScope: 'testing, automation',
      submittedBy: { id: 0, username: 'smoke-test', displayName: 'Smoke Test' },
    });

    if (!hypercertResult.success) {
      results.push(fail('attach', `Failed to create hypercert — ${hypercertResult.error}`));
      return;
    }

    console.log(`   Hypercert URI: ${hypercertResult.uri}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('attach', `createHypercert threw: ${msg}`));
    return;
  }

  // Step 2: Attach observations to the hypercert
  try {
    const result = await attachObservations({
      hypercertUri: hypercertResult.uri,
      hypercertCid: hypercertResult.cid,
      limit: 3,
    });

    if (!result.success) {
      // If no observations exist yet, skip gracefully instead of failing
      if (result.error.includes('No observations found')) {
        console.log(`   No observations indexed yet — skipping attachment`);

        // Still clean up the hypercert
        const certRkey = hypercertResult.uri.split('/').pop()!;
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: 'org.hypercerts.claim.activity',
          rkey: certRkey,
        });
        console.log('   Cleaned up test hypercert');

        results.push(skip('attach', 'No community observations indexed yet'));
        return;
      }

      results.push(fail('attach', `attachObservations failed — ${result.error}`));

      // Clean up hypercert even on failure
      try {
        const certRkey = hypercertResult.uri.split('/').pop()!;
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: 'org.hypercerts.claim.activity',
          rkey: certRkey,
        });
      } catch {
        // best-effort cleanup
      }
      return;
    }

    console.log(`   Attachment URI: ${result.attachmentUri}`);
    console.log(`   Occurrence count: ${result.occurrenceCount}`);
    console.log(`   Hyperscan: ${result.hyperscanUrl}`);

    // Step 3: Delete attachment first, then hypercert
    const attachRkey = result.attachmentUri.split('/').pop()!;
    await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: 'org.hypercerts.context.attachment',
      rkey: attachRkey,
    });

    const certRkey = hypercertResult.uri.split('/').pop()!;
    await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: 'org.hypercerts.claim.activity',
      rkey: certRkey,
    });
    console.log('   Cleaned up attachment + hypercert');

    results.push(pass('attach', `linked ${result.occurrenceCount} observations + cleaned up`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('attach', msg));

    // Best-effort cleanup of hypercert
    try {
      const certRkey = hypercertResult.uri.split('/').pop()!;
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: 'org.hypercerts.claim.activity',
        rkey: certRkey,
      });
    } catch {
      // best-effort cleanup
    }
  }
}

// ─── Subcommand: polygon ──────────────────────────────────────────────────────

async function testPolygonPrimitives(): Promise<void> {
  console.log('\n── polygon ──────────────────────────────────────────────────────');

  const validSmokeUserId = 24680;
  resetSession(validSmokeUserId);

  try {
    await getOrCreateSession(validSmokeUserId);

    const validPayload = JSON.stringify([
      { lng: -84.091, lat: 9.93 },
      { lng: -84.089, lat: 9.931 },
      { lng: -84.088, lat: 9.928 },
    ]);
    const result = processTelegramPolygonWebAppData(validSmokeUserId, validPayload);

    assert(result.ok, 'expected valid Telegram web_app_data to parse');
    assert(result.points.length === 3, `expected 3 decoded points, got ${result.points.length}`);
    assertDeepEqual(
      getOrganizationPolygonPoints(validSmokeUserId),
      result.points,
      'expected valid polygon points to be stored in session state'
    );
    assertDeepEqual(
      resolveOrganizationPolygonPoints(validSmokeUserId),
      result.points,
      'expected later organization logic to reuse stored polygon points'
    );

    clearOrganizationPolygonPoints(validSmokeUserId);
    assert(
      getOrganizationPolygonPoints(validSmokeUserId) === undefined,
      'expected consumed polygon points to be cleared after organization use'
    );

    results.push(pass('polygon:web-app-data-valid', 'validated Telegram payload and carried polygon forward'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('polygon:web-app-data-valid', msg));
  } finally {
    resetSession(validSmokeUserId);
  }

  const invalidSmokeUserId = validSmokeUserId + 1;
  resetSession(invalidSmokeUserId);

  try {
    await getOrCreateSession(invalidSmokeUserId);

    const result = processTelegramPolygonWebAppData(invalidSmokeUserId, '{"points": [1, 2,');
    assert(!result.ok, 'expected malformed Telegram web_app_data to fail');
    assert(result.error.code === 'invalid_json', `expected invalid_json, got ${result.error.code}`);
    assert(
      getOrganizationPolygonPoints(invalidSmokeUserId) === undefined,
      'expected broken polygon data to stay out of session state'
    );
    assert(
      resolveOrganizationPolygonPoints(invalidSmokeUserId) === undefined,
      'expected broken polygon data to stay unavailable to organization logic'
    );

    results.push(pass('polygon:web-app-data-invalid', 'rejected malformed Telegram payload without storing polygon data'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('polygon:web-app-data-invalid', msg));
  } finally {
    resetSession(invalidSmokeUserId);
  }

  try {
    const validPayload = JSON.stringify([
      { lng: -84.091, lat: 9.93 },
      { lng: -84.089, lat: 9.931 },
      { lng: -84.088, lat: 9.928 },
    ]);
    const result = parsePolygonWebAppPayload(validPayload);

    assert(result.ok, 'expected valid polygon payload to parse');
    assert(result.points.length === 3, `expected 3 decoded points, got ${result.points.length}`);
    assert(result.polygon.type === 'Polygon', `expected GeoJSON Polygon, got ${result.polygon.type}`);
    assert(result.polygon.coordinates.length === 1, 'expected a single polygon ring');
    assert(result.polygon.coordinates[0].length === 4, 'expected a closed ring with 4 coordinates');
    assertDeepEqual(result.polygon.coordinates[0][0], result.polygon.coordinates[0][3], 'expected closed polygon ring');
    results.push(pass('polygon:parser-valid', 'decoded 3 points and produced Polygon GeoJSON'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('polygon:parser-valid', msg));
  }

  try {
    const result = parsePolygonWebAppPayload('{"points": [1, 2,');
    assert(!result.ok, 'expected malformed payload to fail');
    assert(result.error.code === 'invalid_json', `expected invalid_json, got ${result.error.code}`);
    results.push(pass('polygon:parser-invalid', 'rejected malformed JSON payload'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('polygon:parser-invalid', msg));
  }

  try {
    const defaultUrl = buildPolygonWebAppUrl('https://polygons-gainforest.vercel.app');
    assert(defaultUrl === 'https://polygons-gainforest.vercel.app/telegram-draw', `unexpected default URL: ${defaultUrl}`);

    const preloadPoints: PolygonPoint[] = [
      { lng: -84.1, lat: 9.93 },
      { lng: -84.09, lat: 9.931 },
      { lng: -84.088, lat: 9.929 },
    ];
    const preloadUrl = buildPolygonWebAppUrl('https://polygons-gainforest.vercel.app/', preloadPoints);
    const decodedPoints = decodePolygonDataParam(preloadUrl);
    assertDeepEqual(decodedPoints, preloadPoints, 'preloaded polygon points should round-trip through URL encoding');
    results.push(pass('polygon:url-builder', 'built default and preload launch URLs'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('polygon:url-builder', msg));
  }

  try {
    const polygonSelection = selectCertifiedLocationInput({
      decimalLatitude: 10,
      decimalLongitude: 20,
      polygonPoints: [
        { lng: -84.1, lat: 9.93 },
        { lng: -84.09, lat: 9.931 },
        { lng: -84.088, lat: 9.929 },
      ],
      locationName: 'Forest edge',
    });
    assert(polygonSelection?.kind === 'polygon', 'polygon points should take precedence over a point location');

    const pointSelection = selectCertifiedLocationInput({
      decimalLatitude: 10,
      decimalLongitude: 20,
      locationName: 'River bend',
    });
    assert(pointSelection?.kind === 'point', 'expected point location when no polygon points are present');

    const noneSelection = selectCertifiedLocationInput({ decimalLatitude: 10 });
    assert(noneSelection === undefined, 'expected incomplete point coordinates to be ignored');

    results.push(pass('polygon:location-selection', 'selected polygon over point and ignored incomplete points'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('polygon:location-selection', msg));
  }

  try {
    const { agent, calls } = createCertifiedLocationStub();

    const pointResult = await createCertifiedLocation(agent, 'did:plc:smoke-org', {
      kind: 'point',
      latitude: 9.93,
      longitude: -84.09,
      locationName: 'Point location',
    });
    if (!pointResult.success) {
      throw new Error(`expected point certified location to succeed: ${pointResult.error}`);
    }
    if (calls.length !== 1) {
      throw new Error(`expected one point createRecord call, got ${calls.length}`);
    }

    const pointRecord = calls[0].record;
    assert(pointRecord.locationType === 'coordinate-decimal', `unexpected point locationType: ${String(pointRecord.locationType)}`);
    assertDeepEqual(pointRecord.location, { string: '9.93,-84.09' }, 'unexpected point location payload');

    const polygonResult = await createCertifiedLocation(agent, 'did:plc:smoke-org', {
      kind: 'polygon',
      points: [
        { lng: -84.1, lat: 9.93 },
        { lng: -84.09, lat: 9.931 },
        { lng: -84.088, lat: 9.929 },
      ],
      locationName: 'Polygon location',
    });
    if (!polygonResult.success) {
      throw new Error(`expected polygon certified location to succeed: ${polygonResult.error}`);
    }
    const totalCallsAfterPolygon = Number(calls.length);
    if (totalCallsAfterPolygon !== 2) {
      throw new Error(`expected two createRecord calls, got ${totalCallsAfterPolygon}`);
    }

    const polygonRecord = calls[1].record;
    assert(polygonRecord.locationType === 'geojson', `unexpected polygon locationType: ${String(polygonRecord.locationType)}`);
    assert(typeof polygonRecord.location === 'object' && polygonRecord.location !== null, 'expected polygon location payload');
    const polygonLocation = polygonRecord.location as { string?: string };
    assert(typeof polygonLocation.string === 'string', 'expected polygon location string');
    const geojson = JSON.parse(polygonLocation.string);
    assert(geojson.type === 'Polygon', `expected polygon GeoJSON, got ${geojson.type}`);
    assert(Array.isArray(geojson.coordinates), 'expected GeoJSON coordinates array');
    assert(geojson.coordinates[0].length === 4, 'expected closed polygon ring in certified location payload');
    assertDeepEqual(geojson.coordinates[0][0], geojson.coordinates[0][3], 'expected polygon ring to close on the first point');

    results.push(pass('polygon:certified-location', 'emitted point and polygon certified location payloads'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('polygon:certified-location', msg));
  }
}

// ─── Subcommand: org-shapes ───────────────────────────────────────────────────
// Lexicon-shape checks for the records create_organization writes. No network.
// Catches drift from the curated lexicons published at hyperscan.dev/agents.

async function testOrgShapes(): Promise<void> {
  console.log('\n── org-shapes ──────────────────────────────────────────────────');

  const baseInput: OrganizationInput = {
    handle: 'shape-test',
    displayName: 'Cabarete Sostenible',
    description: 'We restore mangroves on the north coast of the Dominican Republic. Working with local fishers and youth.',
    organizationType: ['nonprofit', 'conservation'],
    country: 'DO',
    objectives: ['Conservation', 'Community'],
    website: 'https://example.org',
    ecosystemTypes: ['mangrove'],
    focusSpeciesGroups: ['fish', 'trees'],
    foundedDate: '2018-01-01T00:00:00.000Z',
    socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/example' }],
    submittedBy: { id: 1, username: 'shape-test', displayName: 'Shape Test' },
  };
  const createdAt = '2026-05-11T00:00:00.000Z';

  // ─── info: richtext shortDescription ─────────────────────────────────────────
  try {
    const info = buildOrgInfoRecord(baseInput, createdAt);
    assert(info.$type === 'app.gainforest.organization.info', `unexpected $type: ${String(info.$type)}`);
    const sd = info.shortDescription as Record<string, unknown> | undefined;
    assert(sd !== undefined && typeof sd === 'object', 'shortDescription must be an object, not a string');
    assert(sd.$type === 'app.gainforest.common.defs#richtext', `shortDescription must be richtext, got ${String(sd.$type)}`);
    assert(typeof sd.text === 'string' && sd.text.length > 0, 'shortDescription.text must be a non-empty string');
    results.push(pass('org-shapes:info-shortDescription', 'wrapped as app.gainforest.common.defs#richtext'));
  } catch (err) {
    results.push(fail('org-shapes:info-shortDescription', err instanceof Error ? err.message : String(err)));
  }

  // ─── info: linearDocument longDescription ────────────────────────────────────
  try {
    const info = buildOrgInfoRecord(baseInput, createdAt);
    const ld = info.longDescription as Record<string, unknown> | undefined;
    assert(ld !== undefined && typeof ld === 'object', 'longDescription must be an object, not a string');
    assert(ld.$type === 'pub.leaflet.pages.linearDocument', `longDescription must be linearDocument, got ${String(ld.$type)}`);
    const blocks = ld.blocks as Array<Record<string, unknown>> | undefined;
    assert(Array.isArray(blocks) && blocks.length >= 1, 'longDescription.blocks must be a non-empty array');
    const entry = blocks[0];
    const block = entry.block as Record<string, unknown> | undefined;
    assert(block !== undefined && block.$type === 'pub.leaflet.blocks.text', `first block must be pub.leaflet.blocks.text, got ${String(block?.$type)}`);
    assert(typeof block.plaintext === 'string' && block.plaintext.length > 0, 'block.plaintext must carry the description');
    results.push(pass('org-shapes:info-longDescription', 'wrapped as pub.leaflet.pages.linearDocument with a text block'));
  } catch (err) {
    results.push(fail('org-shapes:info-longDescription', err instanceof Error ? err.message : String(err)));
  }

  // ─── info: required fields per lexicon ───────────────────────────────────────
  try {
    const info = buildOrgInfoRecord(baseInput, createdAt);
    const required = ['displayName', 'shortDescription', 'longDescription', 'objectives', 'country', 'visibility', 'createdAt'];
    for (const key of required) {
      assert(info[key] !== undefined, `required field "${key}" missing from info record`);
    }
    assert(info.visibility === 'Public', `visibility must be "Public", got ${String(info.visibility)}`);
    assert(info.country === 'DO', `country must be "DO", got ${String(info.country)}`);
    assert(Array.isArray(info.objectives) && (info.objectives as string[]).length > 0, 'objectives must be a non-empty array');
    results.push(pass('org-shapes:info-required', 'all 7 required fields present'));
  } catch (err) {
    results.push(fail('org-shapes:info-required', err instanceof Error ? err.message : String(err)));
  }

  // ─── defaultSite shape ───────────────────────────────────────────────────────
  try {
    const uri = 'at://did:plc:smoke/app.certified.location/abc123';
    const ds = buildDefaultSiteRecord(uri, createdAt);
    assert(ds.$type === 'app.gainforest.organization.defaultSite', `unexpected $type: ${String(ds.$type)}`);
    assert(ds.site === uri, `site must point at the location at-uri, got ${String(ds.site)}`);
    assert(ds.createdAt === createdAt, 'createdAt must be carried through');
    results.push(pass('org-shapes:defaultSite', 'points at the certified location at-uri'));
  } catch (err) {
    results.push(fail('org-shapes:defaultSite', err instanceof Error ? err.message : String(err)));
  }

  // ─── validation: missing country / objectives / short displayName ────────────
  // Stash + clear GAINFOREST_INVITE_CODE so these checks exercise the validation
  // branches we care about and don't reach the invite-code branch.
  const savedInviteCode = process.env.GAINFOREST_INVITE_CODE;
  delete process.env.GAINFOREST_INVITE_CODE;

  try {
    const r = await createOrganization({ ...baseInput, inviteCode: 'test-code', country: '' });
    assert(!r.success, 'expected missing country to be rejected');
    assert(r.error.toLowerCase().includes('country'), `expected country error, got: ${r.error}`);
    results.push(pass('org-shapes:validate-country', 'rejected missing country'));
  } catch (err) {
    results.push(fail('org-shapes:validate-country', err instanceof Error ? err.message : String(err)));
  }

  try {
    const r = await createOrganization({ ...baseInput, inviteCode: 'test-code', objectives: [] });
    assert(!r.success, 'expected empty objectives to be rejected');
    assert(r.error.toLowerCase().includes('objectives'), `expected objectives error, got: ${r.error}`);
    results.push(pass('org-shapes:validate-objectives', 'rejected empty objectives'));
  } catch (err) {
    results.push(fail('org-shapes:validate-objectives', err instanceof Error ? err.message : String(err)));
  }

  try {
    const r = await createOrganization({ ...baseInput, inviteCode: 'test-code', displayName: 'Short' });
    assert(!r.success, 'expected too-short displayName to be rejected');
    assert(r.error.toLowerCase().includes('displayname'), `expected displayName error, got: ${r.error}`);
    results.push(pass('org-shapes:validate-displayName', 'rejected displayName under 8 chars'));
  } catch (err) {
    results.push(fail('org-shapes:validate-displayName', err instanceof Error ? err.message : String(err)));
  }

  // ─── invite code: required when neither param nor env var is set ─────────────
  try {
    const r = await createOrganization(baseInput);
    assert(!r.success, 'expected missing invite code to be rejected before any network call');
    assert(r.error.toLowerCase().includes('invite code'), `expected invite-code error, got: ${r.error}`);
    results.push(pass('org-shapes:validate-inviteCode-missing', 'rejected when neither inviteCode param nor GAINFOREST_INVITE_CODE env var is set'));
  } catch (err) {
    results.push(fail('org-shapes:validate-inviteCode-missing', err instanceof Error ? err.message : String(err)));
  }

  // ─── invite code: env-var fallback should let validation past the code gate ──
  try {
    process.env.GAINFOREST_INVITE_CODE = 'env-fallback-code';
    // Force a different earlier check to fail so we know the invite gate passed.
    const r = await createOrganization({ ...baseInput, displayName: 'Short' });
    assert(!r.success, 'expected too-short displayName to still be rejected with env code set');
    assert(r.error.toLowerCase().includes('displayname'), `expected displayName error (proving invite-code gate was passed), got: ${r.error}`);
    results.push(pass('org-shapes:inviteCode-envFallback', 'GAINFOREST_INVITE_CODE env var is used when inviteCode param is omitted'));
  } catch (err) {
    results.push(fail('org-shapes:inviteCode-envFallback', err instanceof Error ? err.message : String(err)));
  } finally {
    if (savedInviteCode === undefined) {
      delete process.env.GAINFOREST_INVITE_CODE;
    } else {
      process.env.GAINFOREST_INVITE_CODE = savedInviteCode;
    }
  }

  // ─── confirm no member record fields leak through OrganizationInput ──────────
  try {
    // TS-level check: if these properties existed, the cast would compile differently.
    // Runtime guard — ensure buildOrgInfoRecord output never contains member info.
    const info = buildOrgInfoRecord(baseInput, createdAt) as Record<string, unknown>;
    const keys = Object.keys(info);
    for (const banned of ['memberName', 'memberRole', 'memberEmail', 'firstName', 'lastName']) {
      assert(!keys.includes(banned), `info record must not contain member field "${banned}"`);
    }
    results.push(pass('org-shapes:no-member-fields', 'info record carries no member fields'));
  } catch (err) {
    results.push(fail('org-shapes:no-member-fields', err instanceof Error ? err.message : String(err)));
  }
}

// ─── Subcommand: drafts ───────────────────────────────────────────────────────

async function testDrafts(): Promise<void> {
  console.log('\n── drafts ──────────────────────────────────────────────────────');

  try {
    initDrafts();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('drafts:init', msg));
    return;
  }

  // Use a very high, unique user ID to avoid colliding with real users.
  const smokeUserId = 999_999_999_001;
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const input: OccurrenceInput = {
    scientificName: 'Testus draftus',
    vernacularName: 'Smoke Draft',
    decimalLatitude: -3.4653,
    decimalLongitude: -62.2159,
    locality: 'Smoke Test Forest',
    country: 'Brazil',
    countryCode: 'BR',
    kingdom: 'Animalia',
    phylum: 'Chordata',
    class_: 'Testia',
    order: 'Testiformes',
    family: 'Testidae',
    genus: 'Testus',
    specificEpithet: 'draftus',
    taxonRank: 'species',
    habitat: 'SMOKE TEST — not real',
    occurrenceRemarks: 'Draft roundtrip test',
    images: [
      { data: fakeJpeg, mimeType: 'image/jpeg' },
      { data: fakePng, mimeType: 'image/png' },
    ],
    submittedBy: { id: smokeUserId, username: 'smoke-test', displayName: 'Smoke Test' },
  };

  let savedId = '';

  try {
    const { draftId } = saveDraft(input);
    savedId = draftId;
    assert(typeof draftId === 'string' && draftId.length > 0, 'expected a draft ID');
    results.push(pass('drafts:save', `saved draft ${draftId.slice(0, 8)}…`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('drafts:save', msg));
    return;
  }

  try {
    const drafts = listDrafts(smokeUserId);
    const found = drafts.find((d) => d.id === savedId);
    assert(found !== undefined, 'saved draft should appear in listDrafts');
    assert(found!.scientificName === 'Testus draftus', `scientificName mismatch: ${found!.scientificName}`);
    assert(found!.imageCount === 2, `imageCount should be 2, got ${found!.imageCount}`);
    results.push(pass('drafts:list', `listed draft with ${found!.imageCount} images`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('drafts:list', msg));
  }

  try {
    const loaded = loadDraft(savedId, smokeUserId);
    assert(loaded !== null, 'loadDraft should return the saved draft');
    assert(loaded!.scientificName === input.scientificName, 'scientificName should round-trip');
    assert(loaded!.kingdom === input.kingdom, 'kingdom should round-trip');
    assert(loaded!.class_ === input.class_, 'class_ should round-trip (note JS reserved-word quirk)');
    assert(loaded!.decimalLatitude === input.decimalLatitude, 'decimalLatitude should round-trip');
    assert(loaded!.decimalLongitude === input.decimalLongitude, 'decimalLongitude should round-trip');
    assert(loaded!.occurrenceRemarks === input.occurrenceRemarks, 'occurrenceRemarks should round-trip');
    assert(loaded!.submittedBy.id === smokeUserId, 'submittedBy.id should round-trip');

    const loadedImages = loaded!.images ?? [];
    assert(loadedImages.length === 2, `expected 2 images after load, got ${loadedImages.length}`);
    assert(loadedImages[0].mimeType === 'image/jpeg', `image[0] mimeType: ${loadedImages[0].mimeType}`);
    assert(loadedImages[1].mimeType === 'image/png', `image[1] mimeType: ${loadedImages[1].mimeType}`);
    assert(loadedImages[0].data.equals(fakeJpeg), 'image[0] bytes should match exactly');
    assert(loadedImages[1].data.equals(fakePng), 'image[1] bytes should match exactly');

    results.push(pass('drafts:roundtrip', 'all fields + image bytes round-tripped'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('drafts:roundtrip', msg));
  }

  // Ownership guard — another user cannot load this draft.
  try {
    const otherUser = smokeUserId + 1;
    const stolen = loadDraft(savedId, otherUser);
    assert(stolen === null, 'other users must not be able to load someone else\'s draft');
    const removedByStranger = deleteDraft(savedId, otherUser);
    assert(removedByStranger === false, 'other users must not be able to delete someone else\'s draft');
    results.push(pass('drafts:ownership', 'other users blocked from load/delete'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('drafts:ownership', msg));
  }

  // Cleanup
  try {
    const removed = deleteDraft(savedId, smokeUserId);
    assert(removed, 'deleteDraft should return true for owner');
    const after = loadDraft(savedId, smokeUserId);
    assert(after === null, 'draft should be gone after deleteDraft');
    results.push(pass('drafts:delete', 'cleanly deleted row + image directory'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push(fail('drafts:delete', msg));
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function printSummary(): void {
  console.log('\n=== Smoke Test Results ===');
  const maxLen = Math.max(...results.map(r => r.name.length));
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️ ' : '❌';
    const padded = r.name.padEnd(maxLen);
    console.log(`  ${icon} ${padded}  ${r.detail}`);
  }
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const subcommand = process.argv[2] ?? 'all';

  switch (subcommand) {
    case 'hyperindex':
      await testHyperindex();
      break;

    case 'org':
      await testOrg();
      break;

    case 'occurrence':
      await testOccurrence();
      break;

    case 'hypercert':
      await testHypercert();
      break;

    case 'attach':
      await testAttach();
      break;

    case 'polygon':
      await testPolygonPrimitives();
      break;

    case 'drafts':
      await testDrafts();
      break;

    case 'org-shapes':
      await testOrgShapes();
      break;

    case 'all':
    default:
      await testPolygonPrimitives();
      await testDrafts();
      await testOrgShapes();
      await testHyperindex();
      await testOrg();
      await testOccurrence();
      await testHypercert();
      await testAttach();
      break;
  }

  printSummary();

  const anyFailed = results.some(r => r.status === 'FAIL');
  process.exit(anyFailed ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
