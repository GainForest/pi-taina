// Telegram bot transport layer for Pi-Tainá
// Handles all Telegram-specific logic: receiving messages, downloading photos,
// extracting locations, and sending responses.
// Uses grammY for the Telegram Bot API.

import { Bot, InputFile, InlineKeyboard, Keyboard } from "grammy";
import type { EnvConfig } from "./env.js";
import { 
  isAuthorized, isAdmin, 
  addJoinRequest, approveRequest, 
  getPendingRequests, addMember, removeMember, getMembers 
} from './whitelist.js';
import { resetSession } from "./agent.js";

// ─── Exported Types ──────────────────────────────────────────────────────────

export interface IncomingMessage {
  chatId: number;
  messageId: number;
  text?: string;
  // Photo data (if user sent a photo)
  photo?: {
    data: Buffer;
    mimeType: string; // always "image/jpeg" from Telegram
    fileId: string;
  };
  // Voice note data (if user sent a voice message)
  voice?: {
    data: Buffer;
    mimeType: string;  // "audio/ogg" for Telegram voice notes
    duration: number;  // duration in seconds
    fileId: string;
  };
  // Location (if user sent a Telegram location)
  location?: {
    latitude: number;
    longitude: number;
  };
  // Telegram user info
  user: {
    id: number;
    username?: string;
    displayName: string; // first_name + (last_name || "") trimmed
  };
  // Whether this is a group chat
  isGroup: boolean;
  // Whether the bot was mentioned (in groups)
  isMentioned: boolean;
  // User's access role
  isAdmin: boolean;
}

// Callback for processing messages
export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

// ─── Constants ───────────────────────────────────────────────────────────────

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Split a long text into chunks that fit within Telegram's message length limit.
 */
function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE_LENGTH);
    if (splitAt <= 0) {
      splitAt = TELEGRAM_MAX_MESSAGE_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

/**
 * Download a Telegram file by file_id and return it as a Buffer.
 */
async function downloadTelegramFile(
  bot: Bot,
  fileId: string,
  token: string
): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error(`Telegram file has no file_path (file_id: ${fileId})`);
  }
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download Telegram file: ${response.status} ${response.statusText}`
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Start Screen ─────────────────────────────────────────────────────────────

const START_WELCOME_TEXT =
  `🌿 <b>Hey! I'm Tainá</b> — your community biodiversity assistant.\n\n` +
  `I can identify species from photos, check forest health, get weather forecasts, ` +
  `and even configure your AudioMoth recorder.\n\n` +
  `Tap a button below to get started 👇`;

function buildStartKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🌿 Identify Species', 'action:identify')
    .text('🌳 Forest Report', 'action:forest')
    .row()
    .text('🎙️ AudioMoth Setup', 'action:audiomoth')
    .text('🌤️ Weather', 'action:weather')
    .row()
    .text('🔑 Request Access', 'action:join')
    .text('🔄 Restart Chat', 'action:restart');
}

function buildPersistentKeyboard(): Keyboard {
  return new Keyboard()
    .text('🌿 Identify').text('🌳 Forest')
    .row()
    .text('🎙️ AudioMoth').text('🌤️ Weather')
    .row()
    .text('📋 Menu').text('🔄 Restart')
    .resized()
    .persistent();
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Create and start the Telegram bot.
 *
 * @param onMessage  Callback invoked for each relevant incoming message.
 * @param config     EnvConfig from src/env.ts (must contain telegramBotToken).
 * @returns          Object with reply, sendPhoto, and stop functions.
 */
export async function createTelegramBot(
  onMessage: MessageHandler,
  config: EnvConfig
): Promise<{
  reply: (
    chatId: number,
    text: string,
    options?: {
      replyToMessageId?: number;
      parseMode?: "HTML" | "Markdown" | "MarkdownV2";
    }
  ) => Promise<void>;
  sendPhoto: (chatId: number, photo: Buffer, caption?: string) => Promise<void>;
  sendAudio: (chatId: number, audio: Buffer, filename: string, caption?: string) => Promise<void>;
  sendTyping: (chatId: number) => Promise<void>;
  stop: () => void;
}> {
  const token = config.telegramBotToken;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing from config");
  }

  const bot = new Bot(token);

  // Fetch bot info once so we know our own username for mention detection
  const botInfo = await bot.api.getMe();
  const botUsername = botInfo.username?.toLowerCase() ?? "";

  // ─── Message handler ───────────────────────────────────────────────────────

  bot.on("message", async (ctx) => {
    try {
      const msg = ctx.message;
      if (!msg || !msg.from) return;

      // ── Extract user info ──────────────────────────────────────────────────
      const from = msg.from;
      const displayName = `${from.first_name} ${from.last_name ?? ""}`.trim();
      const user = {
        id: from.id,
        username: from.username,
        displayName,
      };

      const chatType = msg.chat.type; // "private" | "group" | "supergroup" | "channel"
      const isGroup = chatType === "group" || chatType === "supergroup";

      // ── Check for /start BEFORE the access gate (works for all users) ──
      const rawTextForCommand = msg.text ?? msg.caption ?? '';
      if (rawTextForCommand.trim().startsWith("/start")) {
        // Send welcome with inline buttons
        await ctx.reply(START_WELCOME_TEXT, {
          parse_mode: "HTML",
          reply_markup: buildStartKeyboard(),
        });
        // Set persistent bottom keyboard
        await ctx.reply("⌨️ Quick actions are always available below 👇", {
          reply_markup: buildPersistentKeyboard(),
        });
        return;
      }

      // ── Persistent keyboard shortcuts ──
      const persistentAction = rawTextForCommand.trim();
      if (persistentAction === "📋 Menu") {
        await ctx.reply(START_WELCOME_TEXT, {
          parse_mode: "HTML",
          reply_markup: buildStartKeyboard(),
        });
        return;
      }
      if (persistentAction === "🔄 Restart") {
        resetSession(user.id);
        await ctx.reply(START_WELCOME_TEXT, {
          parse_mode: "HTML",
          reply_markup: buildStartKeyboard(),
        });
        return;
      }
      if (persistentAction === "🌿 Identify") {
        if (!isAuthorized(user.id)) {
          await ctx.reply("You need to join the community first! Send /join to request access 🌱");
          return;
        }
        await ctx.reply("📸 Send me a photo of a plant, animal, or fungus and I'll try to identify it!");
        return;
      }
      if (persistentAction === "🌳 Forest") {
        if (!isAuthorized(user.id)) {
          await ctx.reply("You need to join the community first! Send /join to request access 🌱");
          return;
        }
        await ctx.reply("🌳 Tell me a place name or share your location, and I'll check the forest health for that area!");
        return;
      }
      if (persistentAction === '🎙️ AudioMoth') {
        if (!isAuthorized(user.id)) {
          await ctx.reply('You need to join the community first! Send /join to request access 🌱');
          return;
        }
        await ctx.reply('🎙️ Let\'s set up your AudioMoth! Share your deployment location or tell me the place name.');
        return;
      }
      if (persistentAction === '🌤️ Weather') {
        if (!isAuthorized(user.id)) {
          await ctx.reply('You need to join the community first! Send /join to request access 🌱');
          return;
        }
        await ctx.reply('🌤️ Where do you want to check the weather? Share your location or tell me the place name.');
        return;
      }

      // ── Check for /join BEFORE the access gate (unauthorized users can use this) ──
      if (rawTextForCommand.trim().startsWith('/join')) {
        if (isAuthorized(user.id)) {
          await ctx.reply('You\'re already part of the community! 🌿');
        } else {
          const added = addJoinRequest(user.id, user.displayName, user.username);
          if (added) {
            await ctx.reply('Got it! I\'ll let the admins know you want to join 🙌');
          } else {
            await ctx.reply('You already have a pending request. Hang tight! ⏳');
          }
        }
        return;
      }

      // ── Access control ──────────────────────────────────────────────────
      if (!isAuthorized(user.id)) {
        // Don't spam groups — only reply in DMs
        if (!isGroup) {
          await ctx.reply(
            'Hey! 👋 I don\'t recognize you yet. Ask a community admin to add you, or send /join to request access.'
          );
        }
        return;
      }

      // ── Admin commands ─────────────────────────────────────────────────────
      if (rawTextForCommand.trim().startsWith('/approve')) {
        if (!isAdmin(user.id)) {
          await ctx.reply('Only admins can approve members.');
          return;
        }
        const targetId = parseInt(rawTextForCommand.trim().split(/\s+/)[1], 10);
        if (isNaN(targetId)) {
          await ctx.reply('Usage: /approve <user_id>\nCheck /pending for pending requests.');
          return;
        }
        const approved = approveRequest(targetId, user.id);
        if (approved) {
          await ctx.reply(`✅ User ${targetId} approved! They can now use the bot.`);
          // Try to notify the approved user
          try {
            await bot.api.sendMessage(targetId, 'Welcome to the community! You can now talk to me 🌿🎉');
          } catch { /* user may not have started DM with bot */ }
        } else {
          // Maybe they're not in pending — try direct add
          const added = addMember(targetId, user.id);
          if (added) {
            await ctx.reply(`✅ User ${targetId} added as member.`);
          } else {
            await ctx.reply(`User ${targetId} is already a member.`);
          }
        }
        return;
      }

      if (rawTextForCommand.trim().startsWith('/remove')) {
        if (!isAdmin(user.id)) {
          await ctx.reply('Only admins can remove members.');
          return;
        }
        const targetId = parseInt(rawTextForCommand.trim().split(/\s+/)[1], 10);
        if (isNaN(targetId)) {
          await ctx.reply('Usage: /remove <user_id>');
          return;
        }
        const removed = removeMember(targetId);
        if (removed) {
          await ctx.reply(`Removed user ${targetId}.`);
        } else {
          await ctx.reply(`Could not remove user ${targetId}. They may be an admin or not a member.`);
        }
        return;
      }

      if (rawTextForCommand.trim().startsWith('/pending')) {
        if (!isAdmin(user.id)) {
          await ctx.reply('Only admins can view pending requests.');
          return;
        }
        const requests = getPendingRequests();
        if (requests.length === 0) {
          await ctx.reply('No pending requests 👍');
        } else {
          const lines = requests.map(r => 
            `• ${r.displayName}${r.username ? ` (@${r.username})` : ''} — ID: ${r.userId}`
          );
          await ctx.reply(`Pending requests:\n${lines.join('\n')}\n\nUse /approve <user_id> to approve.`);
        }
        return;
      }

      if (rawTextForCommand.trim().startsWith('/members')) {
        if (!isAdmin(user.id)) {
          await ctx.reply('Only admins can view the member list.');
          return;
        }
        const members = getMembers();
        const lines = members.map(m =>
          `• ${m.displayName ?? 'Unknown'} (${m.role}) — ID: ${m.userId}`
        );
        await ctx.reply(`Community members:\n${lines.join('\n')}`);
        return;
      }

      // ── Determine if bot is mentioned ──────────────────────────────────────
      let rawText: string | undefined =
        msg.text ?? msg.caption ?? undefined;

      let isMentioned = false;
      if (isGroup && rawText) {
        const lowerText = rawText.toLowerCase();
        const mentionPattern = `@${botUsername}`;
        if (lowerText.includes(mentionPattern)) {
          isMentioned = true;
          // Strip the @botname mention from text
          rawText = rawText
            .replace(new RegExp(`@${botUsername}`, "gi"), "")
            .trim();
        }
      }

      const hasPhoto = !!(msg.photo && msg.photo.length > 0);
      const hasLocation = !!(msg.location || msg.venue);
      const hasVoice = !!(msg.voice);

      // ── Group filtering ────────────────────────────────────────────────────
      // In groups, only forward if @mentioned, photo sent, location sent, or voice sent
      if (isGroup && !isMentioned && !hasPhoto && !hasLocation && !hasVoice) {
        return;
      }

      // ── Build IncomingMessage ──────────────────────────────────────────────
      const incoming: IncomingMessage = {
        chatId: msg.chat.id,
        messageId: msg.message_id,
        text: rawText || undefined,
        user,
        isGroup,
        isMentioned,
        isAdmin: isAdmin(user.id),
      };

      // ── Photo handling ─────────────────────────────────────────────────────
      if (hasPhoto && msg.photo) {
        // Pick the largest photo (last in the array)
        const largestPhoto = msg.photo[msg.photo.length - 1];
        try {
          const photoData = await downloadTelegramFile(
            bot,
            largestPhoto.file_id,
            token
          );
          incoming.photo = {
            data: photoData,
            mimeType: "image/jpeg",
            fileId: largestPhoto.file_id,
          };
        } catch (err) {
          console.error("Failed to download photo:", err);
          // Continue without photo data — don't block the message
        }
      }

      // ── Voice handling ───────────────────────────────────────────────────
      if (hasVoice && msg.voice) {
        try {
          const voiceData = await downloadTelegramFile(
            bot,
            msg.voice.file_id,
            token
          );
          incoming.voice = {
            data: voiceData,
            mimeType: "audio/ogg",
            duration: msg.voice.duration,
            fileId: msg.voice.file_id,
          };
        } catch (err) {
          console.error("Failed to download voice note:", err);
          // Continue without voice data
        }
      }

      // ── Location handling ──────────────────────────────────────────────────
      if (msg.location) {
        incoming.location = {
          latitude: msg.location.latitude,
          longitude: msg.location.longitude,
        };
      } else if (msg.venue) {
        // Venue messages include a location
        incoming.location = {
          latitude: msg.venue.location.latitude,
          longitude: msg.venue.location.longitude,
        };
      }

      // ── Dispatch to handler ────────────────────────────────────────────────
      await onMessage(incoming);
    } catch (err) {
      console.error("Error in message handler:", err);
      try {
        await ctx.reply("Sorry, something went wrong. Please try again. 🙏");
      } catch (replyErr) {
        console.error("Failed to send error reply:", replyErr);
      }
    }
  });

  // ─── Callback query handler ────────────────────────────────────────────────
  bot.on("callback_query:data", async (ctx) => {
    try {
      const data = ctx.callbackQuery.data;
      const from = ctx.callbackQuery.from;
      const chatId = ctx.callbackQuery.message?.chat.id;
      if (!chatId) {
        await ctx.answerCallbackQuery();
        return;
      }

      const userId = from.id;
      const authorized = isAuthorized(userId);

      // Always acknowledge the callback to remove the loading spinner
      await ctx.answerCallbackQuery();

      switch (data) {
        case "action:identify":
          if (!authorized) {
            await bot.api.sendMessage(chatId, "You need to join the community first! Send /join to request access 🌱");
            return;
          }
          await bot.api.sendMessage(chatId, "📸 Send me a photo of a plant, animal, or fungus and I'll try to identify it!");
          break;

        case "action:forest":
          if (!authorized) {
            await bot.api.sendMessage(chatId, "You need to join the community first! Send /join to request access 🌱");
            return;
          }
          await bot.api.sendMessage(chatId, "🌳 Tell me a place name or share your location, and I'll check the forest health for that area!");
          break;

        case 'action:audiomoth':
          if (!authorized) {
            await bot.api.sendMessage(chatId, 'You need to join the community first! Send /join to request access 🌱');
            return;
          }
          await bot.api.sendMessage(chatId, '🎙️ Let\'s set up your AudioMoth! Share your deployment location or tell me the place name.');
          break;

        case 'action:weather':
          if (!authorized) {
            await bot.api.sendMessage(chatId, 'You need to join the community first! Send /join to request access 🌱');
            return;
          }
          await bot.api.sendMessage(chatId, '🌤️ Where do you want to check the weather? Share your location or tell me the place name.');
          break;

        case "action:join":
          if (authorized) {
            await bot.api.sendMessage(chatId, "You're already part of the community! 🌿");
          } else {
            const displayName = `${from.first_name} ${from.last_name ?? ""}`.trim();
            const added = addJoinRequest(userId, displayName, from.username);
            if (added) {
              await bot.api.sendMessage(chatId, "Got it! I'll let the admins know you want to join 🙌");
            } else {
              await bot.api.sendMessage(chatId, "You already have a pending request. Hang tight! ⏳");
            }
          }
          break;

        case "action:restart":
          resetSession(userId);
          await ctx.reply(START_WELCOME_TEXT, {
            parse_mode: "HTML",
            reply_markup: buildStartKeyboard(),
          });
          await bot.api.sendMessage(chatId, "⌨️ Quick actions are always available below 👇", {
            reply_markup: buildPersistentKeyboard(),
          });
          break;

        default:
          break;
      }
    } catch (err) {
      console.error("Error in callback_query handler:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Something went wrong 🙏" });
      } catch { /* ignore */ }
    }
  });

  // ─── Global error handler ──────────────────────────────────────────────────
  bot.catch((err) => {
    console.error("grammY bot error:", err);
  });

  // ─── Start long polling ────────────────────────────────────────────────────
  // bot.start() is non-blocking when called without await in some setups,
  // but we call it without await so the function returns the API object
  // while polling runs in the background.
  bot.start();

  // ─── Return API ────────────────────────────────────────────────────────────

  const reply = async (
    chatId: number,
    text: string,
    options?: {
      replyToMessageId?: number;
      parseMode?: "HTML" | "Markdown" | "MarkdownV2";
    }
  ): Promise<void> => {
    const parseMode = options?.parseMode ?? "HTML";
    const chunks = splitMessage(text);
    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      try {
        await bot.api.sendMessage(chatId, chunks[i], {
          parse_mode: parseMode,
          reply_parameters:
            isFirst && options?.replyToMessageId !== undefined
              ? { message_id: options.replyToMessageId }
              : undefined,
        });
      } catch (err) {
        // HTML/Markdown parsing failed — send as plain text
        console.warn(
          "Failed to send with parse_mode, retrying as plain text:",
          err instanceof Error ? err.message : err
        );
        await bot.api.sendMessage(chatId, chunks[i], {
          reply_parameters:
            isFirst && options?.replyToMessageId !== undefined
              ? { message_id: options.replyToMessageId }
              : undefined,
        });
      }
    }
  };

  const sendPhoto = async (
    chatId: number,
    photo: Buffer,
    caption?: string
  ): Promise<void> => {
    await bot.api.sendPhoto(chatId, new InputFile(photo, "photo.jpg"), {
      caption,
    });
  };

  const sendAudio = async (
    chatId: number,
    audio: Buffer,
    filename: string,
    caption?: string
  ): Promise<void> => {
    await bot.api.sendAudio(chatId, new InputFile(audio, filename), {
      caption,
    });
  };

  const sendTyping = async (chatId: number): Promise<void> => {
    try {
      await bot.api.sendChatAction(chatId, "typing");
    } catch {
      // Silently ignore — typing indicator is best-effort
    }
  };

  const stop = (): void => {
    bot.stop();
  };

  return { reply, sendPhoto, sendAudio, sendTyping, stop };
}
