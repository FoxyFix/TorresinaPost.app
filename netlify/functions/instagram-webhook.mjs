// Riceve da Meta le menzioni di @account-del-quartiere su Instagram
// (in didascalie e commenti) e le mette in coda di approvazione.
import crypto from 'node:crypto';
import { graph } from '../lib/meta.mjs';
import { importaPost } from '../lib/importa.mjs';

export default async (req) => {
  const url = new URL(req.url);

  // Verifica iniziale quando registri il webhook nella dashboard Meta
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === process.env.META_VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get('hub.challenge')) : new Response('Forbidden', { status: 403 });
  }

  const grezzo = await req.text();
  if (!firmaValida(grezzo, req.headers.get('x-hub-signature-256'))) {
    return new Response('Firma non valida', { status: 401 });
  }

  const corpo = JSON.parse(grezzo);
  const lavori = [];
  for (const entry of corpo.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field === 'mentions') lavori.push(gestisci(ch.value).catch((e) => console.error('Instagram', e)));
    }
  }
  await Promise.all(lavori);
  return new Response('ok');
};

function firmaValida(grezzo, intestazione) {
  if (!intestazione) return false;
  const atteso = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(grezzo).digest('hex');
  const a = Buffer.from(intestazione);
  const b = Buffer.from(atteso);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function gestisci({ media_id, comment_id }) {
  const ig = process.env.IG_USER_ID;

  if (comment_id) {
    const r = await graph(ig, { fields: `mentioned_comment.comment_id(${comment_id}){id,text,timestamp,media{id,permalink}}` });
    const c = r.mentioned_comment;
    if (!c?.text) return;
    return importaPost({ fonte: 'instagram', fonteId: `c_${c.id}`, url: c.media?.permalink, testo: c.text, data: c.timestamp });
  }

  if (media_id) {
    const r = await graph(ig, { fields: `mentioned_media.media_id(${media_id}){id,caption,permalink,timestamp,username}` });
    const m = r.mentioned_media;
    if (!m?.caption) return;
    return importaPost({
      fonte: 'instagram', fonteId: `m_${m.id}`, url: m.permalink,
      autore: m.username ? `@${m.username}` : null, testo: m.caption, data: m.timestamp,
    });
  }
}

export const config = { path: '/api/instagram' };
