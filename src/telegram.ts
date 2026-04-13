// Telegram bot transport layer for Pi-Tainá
// Handles all Telegram-specific logic: receiving messages, downloading photos,
// extracting locations, and sending responses.
// Uses grammY for the Telegram Bot API.

import { Bot, InputFile, InlineKeyboard } from "grammy";
import type { EnvConfig } from "./env.js";
import { formatTelegramHtml } from "./telegram-format.js";
import { ensurePreferredLanguage, getPreferredLanguage } from "./user-language.js";
import {
  getTelegramLocaleBundle,
  resolveSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./i18n.js";
import { 
  isAuthorized, isAdmin, 
  addJoinRequest, approveRequest, denyRequest,
  getPendingRequests, addMember, removeMember, getMembers, getAdmins 
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
  // Telegram language metadata for seeding preferences
  languageCode?: string;
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

function parseTelegramCommand(text: string): string | undefined {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[\w_]+)?(?:\s|$)/i);
  return match?.[1].toLowerCase();
}

async function registerTelegramCommands(bot: Bot): Promise<void> {
  try {
    const commandCalls = SUPPORTED_LOCALES.flatMap((locale) => {
      const bundle = getTelegramLocaleBundle(locale);
      return [
        bot.api.setMyCommands(bundle.commands.member, { scope: { type: "all_private_chats" }, language_code: locale }),
        bot.api.setMyCommands(bundle.commands.member, { scope: { type: "all_group_chats" }, language_code: locale }),
        bot.api.setMyCommands(bundle.commands.admin, { scope: { type: "all_chat_administrators" }, language_code: locale }),
      ];
    });

    await Promise.all([
      ...commandCalls,
      bot.api.setMyCommands(getTelegramLocaleBundle("en").commands.member, { scope: { type: "all_private_chats" } }),
      bot.api.setMyCommands(getTelegramLocaleBundle("en").commands.member, { scope: { type: "all_group_chats" } }),
      bot.api.setMyCommands(getTelegramLocaleBundle("en").commands.admin, { scope: { type: "all_chat_administrators" } }),
    ]);
  } catch (err) {
    console.warn("[telegram] Scoped commands unavailable, falling back to a shared menu:", err);
    await bot.api.setMyCommands(getTelegramLocaleBundle("en").commands.member);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildJoinRequestKeyboard(locale: SupportedLocale, userId: number): InlineKeyboard {
  const texts = getTelegramLocaleBundle(locale).texts;
  return new InlineKeyboard()
    .text(texts.joinApprove, `admin:approve:${userId}`)
    .text(texts.joinDeny, `admin:deny:${userId}`);
}

function buildJoinRequestMessage(locale: SupportedLocale, displayName: string, username?: string, userId?: number): string {
  const texts = getTelegramLocaleBundle(locale).texts;
  const lines = [
    texts.joinRequestTitle,
    "",
    `${texts.joinRequestNameLabel} ${escapeHtml(displayName)}`,
    `${texts.joinRequestUsernameLabel} ${username ? `@${escapeHtml(username)}` : "—"}`,
  ];

  if (userId !== undefined) {
    lines.push(`${texts.joinRequestUserIdLabel} <code>${userId}</code>`);
  }

  return lines.join("\n");
}

async function notifyAdminsOfJoinRequest(
  bot: Bot,
  request: { userId: number; displayName: string; username?: string }
): Promise<void> {
  const admins = getAdmins();
  if (admins.length === 0) return;

  for (const admin of admins) {
    const locale = resolveSupportedLocale(getPreferredLanguage(admin.userId));
    const message = buildJoinRequestMessage(locale, request.displayName, request.username, request.userId);
    const keyboard = buildJoinRequestKeyboard(locale, request.userId);

    try {
      await bot.api.sendMessage(admin.userId, message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } catch (err) {
      console.warn(`[telegram] Failed to notify admin ${admin.userId} about join request from ${request.userId}:`, err);
    }
  }
}

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

function buildStartKeyboard(locale: SupportedLocale, isAuthorizedUser: boolean): InlineKeyboard {
  const texts = getTelegramLocaleBundle(locale).texts;
  return isAuthorizedUser
    ? new InlineKeyboard().text(texts.openCommands, 'action:menu')
    : new InlineKeyboard().text(texts.requestAccess, 'action:join');
}

function buildStartMessage(locale: SupportedLocale, isAuthorizedUser: boolean): string {
  const texts = getTelegramLocaleBundle(locale).texts;
  if (isAuthorizedUser) {
    return `${texts.startWelcome}\n\n${texts.startAuthorizedHint}`;
  }

  return `${texts.startWelcome}\n\n${texts.startUnauthorizedHint}`;
}

type StartReply = (
  text: string,
  options?: { parse_mode?: "HTML"; reply_markup?: InlineKeyboard }
) => Promise<unknown>;

async function sendStartScreen(reply: StartReply, locale: SupportedLocale, isAuthorizedUser: boolean): Promise<void> {
  await reply(buildStartMessage(locale, isAuthorizedUser), {
    parse_mode: "HTML",
    reply_markup: buildStartKeyboard(locale, isAuthorizedUser),
  });
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

  // Register Telegram menu commands for the bot menu.
  await registerTelegramCommands(bot);

  // ─── Message handler ───────────────────────────────────────────────────────

  bot.on("message", async (ctx) => {
    let locale: SupportedLocale = "en";
    try {
      const msg = ctx.message;
      if (!msg || !msg.from) return;

      // ── Extract user info ──────────────────────────────────────────────────
      const from = msg.from;
      const displayName = `${from.first_name} ${from.last_name ?? ""}`.trim();
      const languageCode = from.language_code;
      const user = {
        id: from.id,
        username: from.username,
        displayName,
      };

      const preferredLanguage = ensurePreferredLanguage(user.id, languageCode);
      locale = resolveSupportedLocale(preferredLanguage, languageCode);

      const chatType = msg.chat.type; // "private" | "group" | "supergroup" | "channel"
      const isGroup = chatType === "group" || chatType === "supergroup";
      const rawTextForCommand = msg.text ?? msg.caption ?? '';
      const commandName = rawTextForCommand.trim().startsWith("/")
        ? parseTelegramCommand(rawTextForCommand)
        : undefined;

      // ── Check for /start BEFORE the access gate (works for all users) ──
      if (commandName === "start" || commandName === "help" || commandName === "menu") {
        await sendStartScreen((text, options) => ctx.reply(text, options), locale, isAuthorized(user.id));
        return;
      }

      if (commandName === "restart") {
        resetSession(user.id);
        await sendStartScreen((text, options) => ctx.reply(text, options), locale, isAuthorized(user.id));
        return;
      }

      if (commandName === "identify") {
        if (!isAuthorized(user.id)) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.needJoin);
          return;
        }
        const incoming: IncomingMessage = {
          chatId: msg.chat.id,
          messageId: msg.message_id,
          text: `The user tapped the "🌿 Identify" quick-action button. They want to identify a species from a photo. Guide them on what to provide next (photo, location, etc).`,
          user,
          languageCode,
          isGroup,
          isMentioned: false,
          isAdmin: isAdmin(user.id),
        };
        await onMessage(incoming);
        return;
      }
      if (commandName === "forest") {
        if (!isAuthorized(user.id)) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.needJoin);
          return;
        }
        const incoming: IncomingMessage = {
          chatId: msg.chat.id,
          messageId: msg.message_id,
          text: `The user tapped the "🌳 Forest" quick-action button. They want to get a forest health report for a location. Guide them on what to provide next (photo, location, etc).`,
          user,
          languageCode,
          isGroup,
          isMentioned: false,
          isAdmin: isAdmin(user.id),
        };
        await onMessage(incoming);
        return;
      }
      if (commandName === "audiomoth") {
        if (!isAuthorized(user.id)) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.needJoin);
          return;
        }
        const incoming: IncomingMessage = {
          chatId: msg.chat.id,
          messageId: msg.message_id,
          text: `The user tapped the "🎙️ AudioMoth" quick-action button. They want to set up an AudioMoth bioacoustic recorder. Guide them on what to provide next (photo, location, etc).`,
          user,
          languageCode,
          isGroup,
          isMentioned: false,
          isAdmin: isAdmin(user.id),
        };
        await onMessage(incoming);
        return;
      }
      if (commandName === "weather") {
        if (!isAuthorized(user.id)) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.needJoin);
          return;
        }
        const incoming: IncomingMessage = {
          chatId: msg.chat.id,
          messageId: msg.message_id,
          text: `The user tapped the "🌤️ Weather" quick-action button. They want to check the weather forecast for a location. Guide them on what to provide next (photo, location, etc).`,
          user,
          languageCode,
          isGroup,
          isMentioned: false,
          isAdmin: isAdmin(user.id),
        };
        await onMessage(incoming);
        return;
      }

      // ── Check for /join BEFORE the access gate (unauthorized users can use this) ──
      if (commandName === "join") {
        if (isAuthorized(user.id)) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.alreadyMember);
        } else {
          const added = addJoinRequest(user.id, user.displayName, user.username);
          if (added) {
            await ctx.reply(getTelegramLocaleBundle(locale).texts.joinRequested);
            await notifyAdminsOfJoinRequest(bot, { userId: user.id, displayName: user.displayName, username: user.username });
          } else {
            await ctx.reply(getTelegramLocaleBundle(locale).texts.pendingRequest);
          }
        }
        return;
      }

      // ── Access control ──────────────────────────────────────────────────
      if (!isAuthorized(user.id)) {
        // Don't spam groups — only reply in DMs
        if (!isGroup) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.notRecognized);
        }
        return;
      }

      // ── Admin commands ─────────────────────────────────────────────────────
      if (commandName === "approve") {
        if (!isAdmin(user.id)) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.onlyAdminsApprove);
          return;
        }
        const targetId = parseInt(rawTextForCommand.trim().split(/\s+/)[1], 10);
        if (isNaN(targetId)) {
          // No ID provided — auto-approve if exactly 1 pending request
          const requests = getPendingRequests();
          if (requests.length === 1) {
            const req = requests[0];
            const approved = approveRequest(req.userId, user.id);
            if (approved) {
              const name = req.displayName + (req.username ? ` (@${req.username})` : "");
              await ctx.reply(getTelegramLocaleBundle(locale).texts.approvedUser(name));
              try {
                const userLocale = resolveSupportedLocale(getPreferredLanguage(req.userId));
                await bot.api.sendMessage(req.userId, getTelegramLocaleBundle(userLocale).texts.welcomeApproved);
              } catch { /* user may not have started DM with bot */ }
            }
          } else if (requests.length === 0) {
            await ctx.reply(getTelegramLocaleBundle(locale).texts.noPendingToApprove);
          } else {
            await ctx.reply(getTelegramLocaleBundle(locale).texts.multiplePendingToApprove(requests.length));
          }
          return;
        }
        const approved = approveRequest(targetId, user.id);
        if (approved) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.approvedUserId(targetId));
          // Try to notify the approved user
          try {
            const userLocale = resolveSupportedLocale(getPreferredLanguage(targetId));
            await bot.api.sendMessage(targetId, getTelegramLocaleBundle(userLocale).texts.welcomeApproved);
          } catch { /* user may not have started DM with bot */ }
        } else {
          // Maybe they're not in pending — try direct add
          const added = addMember(targetId, user.id);
          if (added) {
            await ctx.reply(getTelegramLocaleBundle(locale).texts.userAdded(targetId));
          } else {
            await ctx.reply(getTelegramLocaleBundle(locale).texts.alreadyMemberId(targetId));
          }
        }
        return;
      }

      if (commandName === "remove") {
        if (!isAdmin(user.id)) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.onlyAdminsRemove);
          return;
        }
        const targetId = parseInt(rawTextForCommand.trim().split(/\s+/)[1], 10);
        if (isNaN(targetId)) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.removeUsage);
          return;
        }
        const removed = removeMember(targetId);
        if (removed) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.removedUser(targetId));
        } else {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.couldNotRemoveUser(targetId));
        }
        return;
      }

      if (commandName === "pending") {
        if (!isAdmin(user.id)) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.onlyAdminsViewPending);
          return;
        }
        const requests = getPendingRequests();
        if (requests.length === 0) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.noPendingRequests);
        } else {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.pendingRequestsHeader(requests.length), { parse_mode: "HTML" });
          for (const r of requests) {
            const name = r.displayName + (r.username ? ` (@${r.username})` : "");
            const keyboard = buildJoinRequestKeyboard(locale, r.userId);
            await ctx.reply(name, { reply_markup: keyboard });
          }
        }
        return;
      }

      if (commandName === "members") {
        if (!isAdmin(user.id)) {
          await ctx.reply(getTelegramLocaleBundle(locale).texts.onlyAdminsViewMembers);
          return;
        }
        const members = getMembers();
        const lines = members.map(m =>
          `• ${m.displayName ?? 'Unknown'} (${m.role}) — ID: ${m.userId}`
        );
        await ctx.reply(`${getTelegramLocaleBundle(locale).texts.communityMembersHeader}\n${lines.join('\n')}`);
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
        languageCode,
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
        await ctx.reply(getTelegramLocaleBundle(locale).texts.callbackSomethingWentWrong);
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
      const languageCode = from.language_code;
      const authorized = isAuthorized(userId);

      const preferredLanguage = ensurePreferredLanguage(userId, languageCode);
      const locale = resolveSupportedLocale(preferredLanguage, languageCode);

      // Always acknowledge the callback to remove the loading spinner
      await ctx.answerCallbackQuery();

        switch (data) {
        case "action:identify": {
          if (!authorized) {
            await bot.api.sendMessage(chatId, getTelegramLocaleBundle(locale).texts.needJoin);
            return;
          }
          const displayName = `${from.first_name} ${from.last_name ?? ""}`.trim();
          const incoming: IncomingMessage = {
            chatId,
            messageId: ctx.callbackQuery.message?.message_id ?? 0,
            text: `The user tapped the "🌿 Identify Species" quick-action button. They want to identify a species from a photo. Guide them on what to provide next.`,
            user: { id: userId, username: from.username, displayName },
            languageCode,
            isGroup: false,
            isMentioned: false,
            isAdmin: isAdmin(userId),
          };
          await onMessage(incoming);
          break;
        }

        case "action:forest": {
          if (!authorized) {
            await bot.api.sendMessage(chatId, getTelegramLocaleBundle(locale).texts.needJoin);
            return;
          }
          const displayName = `${from.first_name} ${from.last_name ?? ""}`.trim();
          const incoming: IncomingMessage = {
            chatId,
            messageId: ctx.callbackQuery.message?.message_id ?? 0,
            text: `The user tapped the "🌳 Forest Report" quick-action button. They want to get a forest health report for a location. Guide them on what to provide next.`,
            user: { id: userId, username: from.username, displayName },
            languageCode,
            isGroup: false,
            isMentioned: false,
            isAdmin: isAdmin(userId),
          };
          await onMessage(incoming);
          break;
        }

        case 'action:audiomoth': {
          if (!authorized) {
            await bot.api.sendMessage(chatId, getTelegramLocaleBundle(locale).texts.needJoin);
            return;
          }
          const displayName = `${from.first_name} ${from.last_name ?? ""}`.trim();
          const incoming: IncomingMessage = {
            chatId,
            messageId: ctx.callbackQuery.message?.message_id ?? 0,
            text: `The user tapped the "🎙️ AudioMoth Setup" quick-action button. They want to set up an AudioMoth bioacoustic recorder. Guide them on what to provide next.`,
            user: { id: userId, username: from.username, displayName },
            languageCode,
            isGroup: false,
            isMentioned: false,
            isAdmin: isAdmin(userId),
          };
          await onMessage(incoming);
          break;
        }

        case 'action:weather': {
          if (!authorized) {
            await bot.api.sendMessage(chatId, getTelegramLocaleBundle(locale).texts.needJoin);
            return;
          }
          const displayName = `${from.first_name} ${from.last_name ?? ""}`.trim();
          const incoming: IncomingMessage = {
            chatId,
            messageId: ctx.callbackQuery.message?.message_id ?? 0,
            text: `The user tapped the "🌤️ Weather" quick-action button. They want to check the weather forecast for a location. Guide them on what to provide next.`,
            user: { id: userId, username: from.username, displayName },
            languageCode,
            isGroup: false,
            isMentioned: false,
            isAdmin: isAdmin(userId),
          };
          await onMessage(incoming);
          break;
        }

        case 'action:menu': {
          if (!authorized) {
            await bot.api.sendMessage(chatId, getTelegramLocaleBundle(locale).texts.needJoin);
            return;
          }
          await bot.api.sendMessage(
            chatId,
            getTelegramLocaleBundle(locale).texts.menuGuidance
          );
          break;
        }

        case "action:join":
          if (authorized) {
            await bot.api.sendMessage(chatId, getTelegramLocaleBundle(locale).texts.alreadyMember);
          } else {
            const displayName = `${from.first_name} ${from.last_name ?? ""}`.trim();
            const added = addJoinRequest(userId, displayName, from.username);
            if (added) {
              await bot.api.sendMessage(chatId, getTelegramLocaleBundle(locale).texts.joinRequested);
              await notifyAdminsOfJoinRequest(bot, { userId, displayName, username: from.username });
            } else {
              await bot.api.sendMessage(chatId, getTelegramLocaleBundle(locale).texts.pendingRequest);
            }
          }
          break;

        case "action:restart":
          resetSession(userId);
          await bot.api.sendMessage(chatId, buildStartMessage(locale, authorized), {
            parse_mode: "HTML",
            reply_markup: buildStartKeyboard(locale, authorized),
          });
          break;

        default: {
          // Handle admin:approve:<userId> and admin:deny:<userId> callbacks
          if (data.startsWith("admin:approve:") || data.startsWith("admin:deny:")) {
            if (!isAdmin(userId)) {
              await ctx.answerCallbackQuery({ text: getTelegramLocaleBundle(locale).texts.callbackOnlyAdmins });
              return;
            }
            const parts = data.split(":");
            const action = parts[1]; // "approve" or "deny"
            const targetId = parseInt(parts[2], 10);
            if (isNaN(targetId)) break;

            if (action === "approve") {
              const approved = approveRequest(targetId, userId);
              if (approved) {
                // Edit the original message to show it was approved
                try {
                  await ctx.editMessageText(getTelegramLocaleBundle(locale).texts.callbackApproved, { reply_markup: undefined });
                } catch { /* message may be too old to edit */ }
                try {
                  const userLocale = resolveSupportedLocale(getPreferredLanguage(targetId));
                  await bot.api.sendMessage(targetId, getTelegramLocaleBundle(userLocale).texts.welcomeApproved);
                } catch { /* user may not have started DM with bot */ }
              } else {
                // Not in pending — try direct add
                const added = addMember(targetId, userId);
                if (added) {
                  try {
                    await ctx.editMessageText(getTelegramLocaleBundle(locale).texts.callbackAdded, { reply_markup: undefined });
                  } catch { /* ignore */ }
                } else {
                  await ctx.answerCallbackQuery({ text: getTelegramLocaleBundle(locale).texts.callbackAlreadyMember });
                }
              }
            } else if (action === "deny") {
              const denied = denyRequest(targetId);
              if (denied) {
                try {
                  await ctx.editMessageText(getTelegramLocaleBundle(locale).texts.callbackDenied, { reply_markup: undefined });
                } catch { /* ignore */ }
              } else {
                await ctx.answerCallbackQuery({ text: getTelegramLocaleBundle(locale).texts.callbackRequestNotFound });
              }
            }
            return;
          }
          break;
        }
      }
    } catch (err) {
      console.error("Error in callback_query handler:", err);
      try {
        const locale = resolveSupportedLocale(getPreferredLanguage(ctx.callbackQuery.from.id), ctx.callbackQuery.from.language_code);
        await ctx.answerCallbackQuery({ text: getTelegramLocaleBundle(locale).texts.callbackSomethingWentWrong });
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
      const chunk = chunks[i];
      try {
        await bot.api.sendMessage(chatId, parseMode === "HTML" ? formatTelegramHtml(chunk) : chunk, {
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
        await bot.api.sendMessage(chatId, chunk, {
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
