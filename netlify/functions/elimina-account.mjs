// Cancellazione dell'account dall'app (diritto all'oblio, richiesto anche dal Play Store).
// Elimina le foto caricate dall'utente e poi l'account: profilo, post e foto
// nel database spariscono a cascata.
import { db } from '../lib/db.mjs';

const BUCKET = 'foto-post';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Metodo non ammesso', { status: 405 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ errore: 'Accesso richiesto' }, { status: 401 });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return Response.json({ errore: 'Accesso richiesto' }, { status: 401 });
  const uid = data.user.id;

  try {
    // File nella cartella dell'utente (a gruppi di 100)
    for (;;) {
      const { data: files, error: e } = await db.storage.from(BUCKET).list(uid, { limit: 100 });
      if (e || !files?.length) break;
      await db.storage.from(BUCKET).remove(files.map((f) => `${uid}/${f.name}`));
      if (files.length < 100) break;
    }
    const { error: del } = await db.auth.admin.deleteUser(uid);
    if (del) throw del;
    return Response.json({ ok: true });
  } catch (e) {
    console.error('Elimina account', e);
    return Response.json({ errore: 'Eliminazione non riuscita' }, { status: 500 });
  }
};

export const config = { path: '/api/elimina-account' };
