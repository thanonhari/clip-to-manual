/**
 * Telegram Notification & Remote Control Service for ClipToManual
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export function getTelegramConfig(): TelegramConfig | null {
  const botToken = process.env['TELEGRAM_BOT_TOKEN'] || '7600773142:AAHgHtKsUAbZktcoaEdEBaj1s_-mKQw8cDk';
  const chatId = process.env['TELEGRAM_CHAT_ID'] || '-4651343086';

  if (!botToken || !chatId) {
    return null;
  }
  return { botToken, chatId };
}

export async function sendTelegramMessage(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<boolean> {
  const config = getTelegramConfig();
  if (!config) return false;

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: false
      })
    });
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch (err) {
    console.warn('Failed to send Telegram message:', err);
    return false;
  }
}

export async function sendTelegramNotification(options: {
  event: 'START' | 'SUCCESS' | 'ERROR' | 'TEST_REPORT';
  title: string;
  details?: Record<string, string | number | boolean>;
  message?: string;
}): Promise<boolean> {
  const icons: Record<string, string> = {
    START: '⏳',
    SUCCESS: '🎉',
    ERROR: '🚨',
    TEST_REPORT: '📊'
  };

  const icon = icons[options.event] || '🔔';
  let text = `<b>${icon} ClipToManual: ${escapeHtml(options.title)}</b>\n`;
  text += `⏱️ <i>เวลา: ${new Date().toLocaleTimeString('th-TH')}</i>\n\n`;

  if (options.message) {
    text += `${escapeHtml(options.message)}\n\n`;
  }

  if (options.details) {
    text += `<b>รายละเอียด:</b>\n`;
    for (const [k, v] of Object.entries(options.details)) {
      text += `• <b>${escapeHtml(k)}:</b> <code>${escapeHtml(String(v))}</code>\n`;
    }
  }

  return sendTelegramMessage(text, 'HTML');
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
