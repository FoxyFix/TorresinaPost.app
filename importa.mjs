// Salva un post social nella coda "Da approvare". Non pubblica mai direttamente.
import { db } from './db.mjs';
import { estrai } from './estrai.mjs';

const taglia = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || null);
const dataValida = (s) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null);

// Parole che fanno scattare l'import (Pagina Facebook e Telegram).
export function taggato(testo, extra = []) {
  const tag = (process.env.TAG_IMPORT || '#torresina')
    .split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    .concat(extra.filter(Boolean).map((t) => t.toLowerCase()));
  const t = (testo || '').toLowerCase();
  return tag.some((x) => t.includes(x));
}

export async function importaPost({ fonte, fonteId, url, autore, testo, data }) {
  if (!testo || !testo.trim()) return { esito: 'vuoto' };

  const { data: esiste } = await db.from('posts').select('id')
    .eq('fonte', fonte).eq('fonte_id', fonteId).maybeSingle();
  if (esiste) return { esito: 'duplicato' };

  const x = await estrai(testo, { dataPost: data });
  if (!x.pertinente) return { esito: 'non pertinente' };

  const inizio = dataValida(x.inizio);
  let fine = dataValida(x.fine);
  if (fine && inizio && fine <= inizio) fine = null;

  const { error } = await db.from('posts').insert({
    fonte,
    fonte_id: fonteId,
    fonte_url: url || null,
    fonte_autore: autore || null,
    testo_originale: taglia(testo, 5000),
    tipo: x.tipo,
    stato: 'in_attesa',
    titolo: taglia(x.titolo, 80) || 'Post dai social',
    descrizione: taglia(x.descrizione, 2000) || taglia(testo, 2000),
    urgente: x.tipo === 'avviso' && !!x.urgente,
    inizio,
    fine,
    luogo: taglia(x.luogo, 120),
    indirizzo: taglia(x.indirizzo, 160),
    confidenza_ai: typeof x.confidenza === 'number' ? x.confidenza : null,
  });

  if (error?.code === '23505') return { esito: 'duplicato' };
  if (error) throw error;
  return { esito: 'importato', tipo: x.tipo };
}
