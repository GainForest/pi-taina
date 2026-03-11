import "dotenv/config";
import { loadEnvConfig, isAtprotoConfigured } from "./env.js";
import { createTelegramBot } from "./telegram.js";
import { sendToAgent, disposeAllSessions } from "./agent.js";
import { getAtprotoAgent } from "./atproto.js";

async function main() {
  // 1. Validate required env vars and load typed config (fail fast)
  let config;
  try {
    config = loadEnvConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // 2. Initialize ATProto (optional — warn if not configured, don't crash)
  if (isAtprotoConfigured(config)) {
    try {
      await getAtprotoAgent(config);
      console.log("✅ ATProto community account connected");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("⚠️  ATProto login failed:", message);
      console.warn("   Observation publishing will be unavailable");
    }
  } else {
    console.warn("⚠️  ATProto not configured (ATPROTO_HANDLE / ATPROTO_PASSWORD missing)");
    console.warn("   Observation publishing will be unavailable");
  }

  // 3. Start Telegram bot
  console.log("🤖 Starting Tainá Telegram bot...");
  const bot = await createTelegramBot(async (msg) => {
    try {
      // Process message through Pi agent
      const response = await sendToAgent(msg);

      // Send response back to Telegram
      if (response && response.trim()) {
        await bot.reply(msg.chatId, response, {
          replyToMessageId: msg.isGroup ? msg.messageId : undefined,
        });
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
    bot.stop();
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
