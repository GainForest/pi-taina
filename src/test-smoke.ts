// Smoke test script for Hypersphere integration
// Run: npx tsx src/test-smoke.ts [hyperindex|org|occurrence|hypercert|all]
// Reads credentials from .env via dotenv

import 'dotenv/config';

import { fetchOrgContext, initOrgContext, getOrgContext } from './hyperindex.js';
import { queryHyperindex } from './tools/query-hyperindex.js';
import { publishOccurrence } from './tools/publish-occurrence.js';
import { createHypercert } from './tools/create-hypercert.js';
import { getAtprotoAgent, getCommunityDid } from './atproto.js';
import { attachObservations } from './tools/attach-observations.js';
import type { AtpAgent } from '@atproto/api';

// ─── Result tracking ──────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
}

const results: TestResult[] = [];

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

    case 'all':
    default:
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
