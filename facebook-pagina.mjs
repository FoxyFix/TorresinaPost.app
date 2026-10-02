// Ogni 30 minuti legge la Pagina Facebook del quartiere:
// - i post della Pagina che contengono un tag (es. #torresina)
// - i post pubblici in cui la Pagina è stata taggata
import { graph } from '../lib/meta.mjs';
import { importaPost, taggato } from '../lib/importa.mjs';

const MAX_PER_GIRO = 6; // resta nei tempi delle funzioni programmate

export default async () => {
  const pagina = process.env.FB_PAGE_ID;
  const campi = 'id,message,created_time,permalink_url,from';
  const candidati = [];

  try {
    const feed = await graph(`${pagina}/feed`, { fields: campi, limit: '15' });
    for (const p of feed.data || []) if (taggato(p.message)) candidati.push(p);
  } catch (e) { console.error('Feed Pagina', e); }

  try {
    const tag = await graph(`${pagina}/tagged`, { fields: campi, limit: '15' });
    for (const p of tag.data || []) candidati.push(p);
  } catch (e) { console.error('Post con la Pagina taggata', e); }

  let fatti = 0;
  for (const p of candidati) {
    if (fatti >= MAX_PER_GIRO) break;
    if (!p.message) continue;
    try {
      const r = await importaPost({
        fonte: 'facebook_pagina', fonteId: p.id, url: p.permalink_url,
        autore: p.from?.name, testo: p.message, data: p.created_time,
      });
      if (r.esito === 'importato' || r.esito === 'non pertinente') fatti++;
    } catch (e) { console.error('Import post', p.id, e); }
  }
  console.log(`Pagina Facebook: ${candidati.length} candidati, ${fatti} analizzati`);
};

export const config = { schedule: '*/30 * * * *' };
