// Telegram bot transport layer for Pi-Tainá
// Handles all Telegram-specific logic: receiving messages, downloading photos,
// extracting locations, and sending responses.
// Uses grammY for the Telegram Bot API.

import { Bot, InputFile } from "grammy";
import type { EnvConfig } from "./env.js";

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

      const chatType = msg.chat.type; // "private" | "group" | "supergroup" | "channel"
      const isGroup = chatType === "group" || chatType === "supergroup";

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

      // ── Group filtering ────────────────────────────────────────────────────
      // In groups, only forward if @mentioned, photo sent, or location sent
      if (isGroup && !isMentioned && !hasPhoto && !hasLocation) {
        return;
      }

      // ── Extract user info ──────────────────────────────────────────────────
      const from = msg.from;
      const displayName = `${from.first_name} ${from.last_name ?? ""}`.trim();
      const user = {
        id: from.id,
        username: from.username,
        displayName,
      };

      // ── Build IncomingMessage ──────────────────────────────────────────────
      const incoming: IncomingMessage = {
        chatId: msg.chat.id,
        messageId: msg.message_id,
        text: rawText || undefined,
        user,
        isGroup,
        isMentioned,
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
    const parseMode = options?.parseMode ?? "Markdown";
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
        // Markdown parsing failed — send as plain text
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

  const stop = (): void => {
    bot.stop();
  };

  return { reply, sendPhoto, stop };
}
