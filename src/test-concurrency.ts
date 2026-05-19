// Concurrency stress test for the P0 fix (@grammyjs/runner + sequentialize).
//
// What this proves:
//   - Different-chat updates run in parallel (was serialized pre-fix).
//   - Same-chat updates stay ordered (sequentialize keeps session state safe).
//
// How it works:
//   - Spins up an in-process grammY bot with a dummy token.
//   - Intercepts all outgoing Telegram API calls via an API transformer so
//     nothing leaves the machine.
//   - Installs the same sequentialize middleware production uses.
//   - Registers a message handler that calls the real sendToAgent.
//   - Injects fake Update objects via bot.handleUpdate(...) in parallel and
//     measures wall-clock vs sum-of-individual-handlers.
//
// Cost note: this runs real Gemini API calls via sendToAgent. Keep N small
// or set PI_MODEL=google/gemini-3-flash-preview before running.

import "dotenv/config";
import { promises as fs } from "fs";
import { Bot, type Context } from "grammy";
import { sequentialize } from "@grammyjs/runner";
import type { Update } from "grammy/types";
import { loadEnvConfig } from "./env.js";
import { sendToAgent, disposeAllSessions } from "./agent.js";
import { initWhitelist } from "./whitelist.js";
import { initDrafts } from "./drafts.js";
import type { IncomingMessage } from "./telegram.js";

const SAMPLE_PHOTO_PATH = "data/drafts/97fded9f-13f8-4da4-b1aa-c93aa5531603/image-1.jpg";

interface ScenarioResult {
  scenario: string;
  perUpdateMs: Map<number, { chatId: number; elapsedMs: number }>;
  wallClockMs: number;
}

function fmt(ms: number): string {
  return `${ms.toFixed(0).padStart(6)}ms`;
}

async function runScenario(
  label: string,
  bot: Bot,
  updates: Array<{ chatId: number; text: string; updateId: number; photo?: boolean }>
): Promise<ScenarioResult> {
  // Key timing maps on updateId so multiple messages from the same chat don't
  // overwrite each other.
  const startTimes = new Map<number, number>();
  const finishTimes = new Map<number, number>();
  // Side channel for photo updates: handler attaches photo bytes to
  // IncomingMessage when the update is flagged as a photo.
  const photoUpdates = new Set<number>();
  for (const u of updates) if (u.photo) photoUpdates.add(u.updateId);

  (bot as unknown as { __startTimes: Map<number, number> }).__startTimes = startTimes;
  (bot as unknown as { __finishTimes: Map<number, number> }).__finishTimes = finishTimes;
  (bot as unknown as { __photoUpdates: Set<number> }).__photoUpdates = photoUpdates;

  const t0 = performance.now();

  const fakeUpdates: Update[] = updates.map(({ chatId, text, updateId }) => ({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private", first_name: `User${chatId}` },
      from: { id: chatId, is_bot: false, first_name: `User${chatId}`, language_code: "en" },
      text,
    },
  }));

  await Promise.all(fakeUpdates.map((u) => bot.handleUpdate(u)));

  const wallClockMs = performance.now() - t0;
  const perUpdate = new Map<number, { chatId: number; elapsedMs: number }>();
  for (const u of updates) {
    const s = startTimes.get(u.updateId);
    const f = finishTimes.get(u.updateId);
    if (s !== undefined && f !== undefined) {
      perUpdate.set(u.updateId, { chatId: u.chatId, elapsedMs: f - s });
    }
  }

  console.log(`\n── ${label} ─────────────────────────────────────────`);
  for (const u of updates) {
    const r = perUpdate.get(u.updateId);
    console.log(`  update ${String(u.updateId).padStart(3)} chat ${u.chatId}: ${r ? fmt(r.elapsedMs) : "  (no result)"}`);
  }
  const sumOfHandlers = Array.from(perUpdate.values()).reduce((a, b) => a + b.elapsedMs, 0);
  console.log(`  wall clock:        ${fmt(wallClockMs)}`);
  console.log(`  sum of handlers:   ${fmt(sumOfHandlers)}`);
  console.log(`  parallelism ratio: ${(sumOfHandlers / wallClockMs).toFixed(2)}x  (>1 means concurrent)`);

  return { scenario: label, perUpdateMs: perUpdate, wallClockMs };
}

async function buildTestBot(photoBytes: Buffer): Promise<Bot> {
  const bot = new Bot("dummy-token-for-testing");
  (bot as unknown as { __photoBytes: Buffer }).__photoBytes = photoBytes;

  // Swallow all outgoing API calls so nothing reaches Telegram. The
  // transformer must answer the few methods grammY itself calls (e.g.
  // getMe via init), plus the handler's sendMessage / sendChatAction.
  bot.api.config.use(async (_prev, method, _payload) => {
    if (method === "getMe") {
      return {
        ok: true,
        result: { id: 1, is_bot: true, first_name: "TestBot", username: "test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false },
      } as never;
    }
    return { ok: true, result: true } as never;
  });

  // Same sequentialize middleware production installs.
  bot.use(
    sequentialize((ctx: Context): string | undefined =>
      ctx.chat?.id !== undefined ? String(ctx.chat.id) : undefined
    )
  );

  // Message handler: records start/finish times keyed by update_id (not
  // chat id, so we can measure each message even when several come from the
  // same chat) and delegates to the real sendToAgent so we exercise the
  // production code.
  bot.on("message", async (ctx) => {
    const msg = ctx.message;
    if (!msg || !msg.from) return;
    const startTimes = (bot as unknown as { __startTimes: Map<number, number> }).__startTimes;
    const finishTimes = (bot as unknown as { __finishTimes: Map<number, number> }).__finishTimes;
    startTimes.set(ctx.update.update_id, performance.now());

    const photoUpdates = (bot as unknown as { __photoUpdates: Set<number> }).__photoUpdates;
    const photoBytes = (bot as unknown as { __photoBytes: Buffer }).__photoBytes;
    const isPhoto = photoUpdates?.has(ctx.update.update_id) ?? false;

    const incoming: IncomingMessage = {
      chatId: msg.chat.id,
      messageId: msg.message_id,
      text: msg.text ?? undefined,
      photo: isPhoto && photoBytes
        ? { data: photoBytes, mimeType: "image/jpeg", fileId: `test-${ctx.update.update_id}` }
        : undefined,
      user: {
        id: msg.from.id,
        username: msg.from.username,
        displayName: msg.from.first_name,
      },
      languageCode: msg.from.language_code,
      isGroup: false,
      isMentioned: false,
      isAdmin: false,
    };

    try {
      await sendToAgent(incoming);
    } catch (err) {
      console.warn(`  chat ${msg.chat.id} sendToAgent error:`, err instanceof Error ? err.message : err);
    } finally {
      finishTimes.set(ctx.update.update_id, performance.now());
    }
  });

  await bot.init();
  return bot;
}

async function main() {
  let config;
  try {
    config = loadEnvConfig();
  } catch (err) {
    console.error("Env not ready:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
  void config;

  initWhitelist(0);
  initDrafts();

  let photoBytes: Buffer;
  try {
    photoBytes = await fs.readFile(SAMPLE_PHOTO_PATH);
  } catch (err) {
    console.error(`Sample photo not found at ${SAMPLE_PHOTO_PATH}.`, err instanceof Error ? err.message : err);
    console.error("Skipping photo scenarios.");
    photoBytes = Buffer.alloc(0);
  }

  console.log("🧪 Pi-Tainá concurrency stress test");
  console.log("   PI_MODEL:        ", process.env.PI_MODEL || "(default)");
  console.log("   SPECIES_ID_MODEL:", process.env.SPECIES_ID_MODEL || "(default)");
  console.log("   Photo bytes:     ", photoBytes.length ? `${photoBytes.length} B` : "(none — photo scenario disabled)");
  console.log("   Note: real Gemini calls are made — keep N small.");

  const bot = await buildTestBot(photoBytes);

  // Scenario A: three different chats, three concurrent text prompts.
  // Pre-fix wall clock ≈ sum of handlers. Post-fix wall clock ≈ max of handlers.
  await runScenario("A: 3 different chats, parallel text prompts", bot, [
    { chatId: 9001, text: "Hello! What can you do?", updateId: 1 },
    { chatId: 9002, text: "Hi there, what services do you offer?", updateId: 2 },
    { chatId: 9003, text: "Hola, ¿qué puedes hacer?", updateId: 3 },
  ]);

  // Scenario B: same chat, three sequential messages.
  // Sequentialize should serialize these — wall clock ≈ sum of handlers,
  // proving session state can't be raced.
  await runScenario("B: same chat, 3 messages (must serialize)", bot, [
    { chatId: 9100, text: "First message", updateId: 11 },
    { chatId: 9100, text: "Second message", updateId: 12 },
    { chatId: 9100, text: "Third message", updateId: 13 },
  ]);

  // Scenario C: mix — chat 9201 sends three slow-ish messages while chats
  // 9202 and 9203 each send one. Different chats should not wait for 9201.
  await runScenario("C: one slow chat alongside two fast chats", bot, [
    { chatId: 9201, text: "Tell me a long story about the rainforest", updateId: 21 },
    { chatId: 9201, text: "Continue please", updateId: 22 },
    { chatId: 9202, text: "Hi quick question", updateId: 23 },
    { chatId: 9203, text: "Hola rápido", updateId: 24 },
  ]);

  // Scenario D: 20 different chats hitting the bot at once. Simulates a
  // Parque das Tribos–scale community session. Wall clock should be close
  // to a single handler's time (limited by the slowest one + Gemini rate
  // limits), not 20× a single handler.
  const burst = Array.from({ length: 20 }, (_, i) => ({
    chatId: 9300 + i,
    text: `Hello from user ${i + 1}, what can you help me with today?`,
    updateId: 100 + i,
  }));
  await runScenario("D: 20 concurrent users (Parque das Tribos scale)", bot, burst);

  // Scenario E: 20 chats each sending a photo + caption — the actual
  // Parque das Tribos pattern. Each photo triggers the Gemini vision path
  // via identify_species. Wall clock should approximate the slowest single
  // vision call rather than the sum of all 20.
  if (photoBytes.length > 0) {
    const photoBurst = Array.from({ length: 20 }, (_, i) => ({
      chatId: 9400 + i,
      text: "What is this organism? Please identify it.",
      updateId: 200 + i,
      photo: true,
    }));
    await runScenario("E: 20 concurrent users with photos (vision path)", bot, photoBurst);
  } else {
    console.log("\nScenario E skipped (no sample photo).");
  }

  console.log("\n✅ Done. Cleaning up sessions…");
  await disposeAllSessions();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
