const TELEGRAM_HTML_TAG_RE = /<(\/)?(b|i|code|pre|u|s|tg-spoiler)\b[^>]*>|<a\s+href="[^"]*">|<\/a>/gi;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Normalize assistant text for Telegram HTML mode.
 * - Preserves a small allowlist of Telegram-safe HTML tags already present in the text.
 * - Escapes all other raw HTML.
 * - Converts **bold** into Telegram HTML bold tags.
 */
export function formatTelegramHtml(text: string): string {
  const protectedTags: string[] = [];

  const withPlaceholders = text.replace(TELEGRAM_HTML_TAG_RE, (match) => {
    const token = `__TG_TAG_${protectedTags.length}__`;
    protectedTags.push(match);
    return token;
  });

  const escaped = escapeHtml(withPlaceholders);
  const bolded = escaped.replace(/\*\*([\s\S]+?)\*\*/g, "<b>$1</b>");

  return bolded.replace(/__TG_TAG_(\d+)__/g, (_, index: string) => {
    const tag = protectedTags[Number(index)];
    return tag ?? "";
  });
}
