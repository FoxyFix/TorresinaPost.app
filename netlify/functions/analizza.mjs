// Usata da "Condividi" sul telefono: riceve il testo condiviso e restituisce
// i campi già compilati per il modulo Proponi. Solo per utenti registrati.
import { db } from '../lib/db.mjs';
import { estrai } from '../lib/estrai.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Metodo non ammesso', { status: 405 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ errore: 'Accesso richiesto' }, { status: 401 });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return Response.json({ errore: 'Accesso richiesto' }, { status: 401 });

  const { testo } = await req.json().catch(() => ({}));
  if (!testo || typeof testo !== 'string' || testo.trim().length < 10) {
    return Response.json({ errore: 'Testo troppo corto' }, { status: 400 });
  }

  try {
    return Response.json(await estrai(testo.slice(0, 6000)));
  } catch (e) {
    console.error('Analizza', e);
    return Response.json({ errore: 'Analisi non riuscita' }, { status: 502 });
  }
};

export const config = { path: '/api/analizza' };
