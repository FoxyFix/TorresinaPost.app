// Bot Telegram: nei gruppi o canali autorizzati importa i messaggi
// che contengono un tag (es. #torresina) o che menzionano il bot.
import { importaPost, taggato } from '../lib/importa.mjs';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export default async (req) => {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== process.env.TELEGRAM_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  const update = await req.json();
  const msg = update.message || update.channel_post;
  if (!msg) return new Response('ok');

  const chatAmmesse = (process.env.TELEGRAM_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!chatAmmesse.includes(String(msg.chat.id))) return new Response('ok');

  const testo = msg.text || msg.caption;
  const bot = process.env.TELEGRAM_BOT_USERNAME ? '@' + process.env.TELEGRAM_BOT_USERNAME : null;
  if (!testo || !taggato(testo, [bot])) return new Response('ok');

  try {
    const r = await importaPost({
      fonte: 'telegram',
      fonteId: `${msg.chat.id}_${msg.message_id}`,
      url: msg.chat.username ? `https://t.me/${msg.chat.username}/${msg.message_id}` : null,
      testo: bot ? testo.replaceAll(bot, '').trim() : testo, // solo il testo, nessun nome di privati
      data: new Date(msg.date * 1000).toISOString(),
    });
    if (r.esito === 'importato' && msg.chat.type !== 'channel') {
      await rispondi(msg.chat.id, msg.message_id,
        'Ricevuto! Lo trovate sulla bacheca di Torresina appena un admin lo approva.');
    }
  } catch (e) {
    console.error('Telegram', e);
  }
  return new Response('ok');
};

async function rispondi(chatId, messageId, testo) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: testo,
      reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
      disable_notification: true,
    }),
  });
}

export const config = { path: '/api/telegram' };
