// Gestisce l'arrivo da "Condividi" (Android, app installata).
// Uso all'avvio dell'app:
//   const c = await leggiCondivisione(session);
//   if (c) apriProponi({ precompilati: c.campi, testo: c.testo, link: c.url, soloLink: c.soloLink });

export async function leggiCondivisione(session) {
  if (location.pathname !== '/condividi') return null;

  const p = new URLSearchParams(location.search);
  const url = p.get('url') || (p.get('text') || '').match(/https?:\/\/\S+/)?.[0] || null;
  const testo = [p.get('title'), p.get('text')]
    .filter(Boolean).join('\n').replace(url || '', '').trim();
  history.replaceState(null, '', '/');

  // Facebook spesso condivide solo il link: l'utente aggiunge due righe a mano
  if (!testo) return { testo: '', url, soloLink: true, campi: null };
  if (!session) return { testo, url, soloLink: false, campi: null };

  try {
    const r = await fetch('/api/analizza', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ testo }),
    });
    return { testo, url, soloLink: false, campi: r.ok ? await r.json() : null };
  } catch {
    return { testo, url, soloLink: false, campi: null };
  }
}
