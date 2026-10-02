// Chiamate alla Graph API di Meta (Instagram e Pagina Facebook).
const VERSIONE = process.env.META_GRAPH_VERSION || 'v23.0';

export async function graph(percorso, parametri = {}) {
  const url = new URL(`https://graph.facebook.com/${VERSIONE}/${percorso}`);
  for (const [k, v] of Object.entries(parametri)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', process.env.META_PAGE_TOKEN);
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) throw new Error(`Graph API: ${j.error.message}`);
  return j;
}
