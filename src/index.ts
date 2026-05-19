import "dotenv/config";
import { loadEnvConfig, isAtprotoConfigured, isGfwConfigured } from "./env.js";
import { createTelegramBot, type TelegramBotApi } from "./telegram.js";
import { sendToAgent, disposeAllSessions, getPendingChart, getPendingAudio, getPendingPolygonWebApp } from "./agent.js";
import { getAtprotoAgent, getCommunityDid } from "./atproto.js";
import { initOrgContext } from "./hyperindex.js";
import { initWhitelist } from './whitelist.js';
import { initDrafts } from './drafts.js';
import { initPersistentLogger } from "./utils/persistent-logger.js";

async function main() {
  // Tee stdout/stderr to data/logs/taina-YYYY-MM-DD.log before anything else
  // logs, so we have a durable record across journald rotations.
  await initPersistentLogger();

  // 1. Validate required env vars and load typed config (fail fast)
  let config;
  try {
    config = loadEnvConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // 1b. Initialize access control whitelist
  initWhitelist(config.adminUserId);
  console.log('✅ Whitelist initialized');

  // 1c. Initialize local draft observation queue
  initDrafts();
  console.log('✅ Drafts DB initialized');

  // 2. Initialize ATProto (optional — warn if not configured, don't crash)
  if (isAtprotoConfigured(config)) {
    try {
      await getAtprotoAgent(config);
      console.log("✅ ATProto community account connected");
      await initOrgContext(getCommunityDid());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("⚠️  ATProto login failed:", message);
      console.warn("   Observation publishing will be unavailable");
    }
  } else {
    console.warn("⚠️  ATProto not configured (ATPROTO_HANDLE / ATPROTO_PASSWORD missing)");
    console.warn("   Observation publishing will be unavailable");
  }

  // 2b. Check GFW Data API (optional — warn if not configured)
  if (isGfwConfigured(config)) {
    console.log("✅ GFW Data API configured — forest monitoring enabled");
  } else {
    console.warn("⚠️  GFW Data API not configured (GFW_DATA_API_KEY missing)");
    console.warn("   Forest monitoring features will be unavailable");
  }

  // 3. Start Telegram bot
  console.log("🤖 Starting Tainá Telegram bot...");

  // Dedup: prevent double-processing the same Telegram message_id (e.g. two
  // instances running simultaneously, or Telegram retrying a slow update).
  const recentMessageIds = new Set<number>();

  const bot: TelegramBotApi = await createTelegramBot(async (msg) => {
    if (recentMessageIds.has(msg.messageId)) {
      console.warn(`[dedup] Skipping already-processed message_id ${msg.messageId}`);
      return;
    }
    recentMessageIds.add(msg.messageId);
    setTimeout(() => recentMessageIds.delete(msg.messageId), 60_000);

    try {
      // Show typing indicator while processing
      await bot.sendTyping(msg.chatId);
      const typingInterval = setInterval(() => {
        bot.sendTyping(msg.chatId).catch(() => {});
      }, 4000);

      try {
        const response = await sendToAgent(msg);
        if (response && response.trim()) {
          await bot.reply(msg.chatId, response, {
            replyToMessageId: msg.isGroup ? msg.messageId : undefined,
          });
        }

        // Send pending polygon Web App button if available (best-effort)
        const pendingPolygonWebApp = getPendingPolygonWebApp(msg.user.id);
        if (pendingPolygonWebApp) {
          await bot.sendWebAppButton(
            msg.chatId,
            pendingPolygonWebApp.launchMessageText,
            pendingPolygonWebApp.buttonLabel,
            pendingPolygonWebApp.webAppUrl,
            msg.isGroup ? msg.messageId : undefined,
          );


        }

        // Send pending chart photo if available (best-effort)
        const pendingChart = getPendingChart(msg.user.id);
        if (pendingChart) {
          await bot.sendPhoto(msg.chatId, pendingChart, "📊 Tree Cover Loss — Data: Global Forest Watch");
        }

        // Send pending audio file if available (best-effort)
        const pendingAudio = getPendingAudio(msg.user.id);
        if (pendingAudio) {
          await bot.sendAudio(msg.chatId, pendingAudio.data, pendingAudio.filename, pendingAudio.caption);
        }
      } finally {
        clearInterval(typingInterval);
      }
    } catch (err) {
      console.error("Error processing message:", err);
      await bot.reply(msg.chatId, "Sorry, I encountered an error. Please try again. 🙏");
    }
  }, config);

  console.log("✅ Tainá is running! Press Ctrl+C to stop.");

  // 4. Graceful shutdown
  const shutdown = async () => {
    console.log("\n🛑 Shutting down...");
    await bot.stop();
    await disposeAllSessions();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
