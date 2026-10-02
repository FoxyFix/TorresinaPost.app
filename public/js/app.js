// Torresina, la bacheca del quartiere
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { leggiCondivisione } from './condividi.js';

const configurato = SUPABASE_URL && !SUPABASE_URL.includes('xxxx') && SUPABASE_ANON_KEY;
const sb = configurato ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ---------- Utilità ---------- */
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const hm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
const parseKey = (k) => { const [a, b, c] = k.split('-').map(Number); return new Date(a, b - 1, c); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const val = (id) => { const el = $(id); return el ? el.value.trim() : ''; };
const checked = (id) => !!$(id)?.checked;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const fDay = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const fWeekday = new Intl.DateTimeFormat('it-IT', { weekday: 'long' });
const fTime = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const fMon = new Intl.DateTimeFormat('it-IT', { month: 'short' });
const fMonthYear = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });

function when(p) {
  if (!p.start) return 'Data da completare';
  const s = new Date(p.start), e = p.end ? new Date(p.end) : null;
  return cap(fDay.format(s)) + ', ' + fTime.format(s) + (e ? '–' + fTime.format(e) : '');
}
function since(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 2) return 'adesso';
  if (m < 60) return m + ' minuti fa';
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "un'ora fa" : h + ' ore fa';
  const d = Math.round(h / 24);
  return d === 1 ? 'ieri' : d + ' giorni fa';
}
function placeQuery(p) {
  const q = [p.place, p.address].filter(Boolean).join(', ');
  return /roma/i.test(q) ? q : q + ', Torresina, Roma';
}
const mapsUrl = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);

const FONTI = { instagram: 'Instagram', facebook_pagina: 'Pagina Facebook', telegram: 'Telegram', condivisione: 'Condiviso dal telefono' };
const STATUS = { in_attesa: ['In attesa', ''], approvato: ['Pubblicato', 'ok'], rifiutato: ['Non approvato', 'no'] };

/* ---------- Stato ---------- */
const st = { session: null, profile: null, events: [], alerts: [], biz: [], mine: [], queue: [], users: [], ready: false, offline: false, loadedAt: 0 };
let view = 'home';
const t0 = new Date();
let cal = { y: t0.getFullYear(), m: t0.getMonth(), sel: null };
let form = { type: 'evento', v: {}, share: null };
let editing = null; // post in modifica (admin)
let mappa = null;

const isAdmin = () => st.profile?.ruolo === 'admin';
const isTrusted = () => isAdmin() || !!st.profile?.fidato;

function norm(r, tipo) {
  const t = r.tipo || tipo;
  return {
    id: r.id, type: t, title: r.titolo, desc: r.descrizione,
    start: t === 'evento' ? r.inizio : r.creato_il, end: r.fine || null,
    place: r.luogo, address: r.indirizzo, lat: r.lat, lng: r.lng, urgent: !!r.urgente,
    author: r.autore || null, fonte: r.fonte || 'app', fonteUrl: r.fonte_url || null,
    status: r.stato || 'approvato', motivo: r.motivo_rifiuto || null, ai: r.confidenza_ai,
    orig: r.testo_originale || null, created: r.creato_il,
  };
}

/* ---------- Dati ---------- */
const CACHE_KEY = 'torresina-cache-v1';

async function loadPublic() {
  try {
    const da = new Date(); da.setDate(da.getDate() - 120);
    const [ev, av, bz] = await Promise.all([
      sb.from('eventi_pubblici').select('*').gte('inizio', da.toISOString()).order('inizio'),
      sb.from('avvisi_pubblici').select('*').order('creato_il', { ascending: false }).limit(30),
      sb.from('attivita').select('*').eq('visibile', true).order('nome'),
    ]);
    for (const r of [ev, av, bz]) if (r.error) throw r.error;
    st.events = ev.data.map((r) => norm(r, 'evento'));
    st.alerts = av.data.map((r) => norm(r, 'avviso'));
    st.biz = bz.data;
    st.offline = false;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ events: st.events, alerts: st.alerts, biz: st.biz })); } catch {}
  } catch (e) {
    console.error(e);
    st.offline = true;
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c) { st.events = c.events; st.alerts = c.alerts; st.biz = c.biz; }
    } catch {}
  }
}

async function loadPrivate() {
  st.profile = null; st.mine = []; st.queue = []; st.users = [];
  const uid = st.session?.user?.id;
  if (!uid) return;
  try {
    const { data: p } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    st.profile = p;
    const { data: m } = await sb.from('posts').select('*').eq('autore_id', uid).order('creato_il', { ascending: false }).limit(50);
    st.mine = (m || []).map((r) => norm(r));
    if (isAdmin()) {
      const [q, u] = await Promise.all([
        sb.from('posts').select('*').eq('stato', 'in_attesa').order('creato_il'),
        sb.from('profiles').select('id,nome_visualizzato,ruolo,fidato').order('nome_visualizzato'),
      ]);
      st.queue = (q.data || []).map((r) => norm(r));
      st.users = u.data || [];
    }
  } catch (e) { console.error(e); }
}

async function refresh() {
  await Promise.all([loadPublic(), loadPrivate()]);
  st.ready = true; st.loadedAt = Date.now();
  render();
}

function findPost(id) {
  return [...st.events, ...st.alerts, ...st.mine, ...st.queue].find((p) => p.id === id);
}

async function geocode(address, place) {
  const tentativi = [address && address + ', Roma', place && place + ', Torresina, Roma'].filter(Boolean);
  for (const q of tentativi) {
    try {
      const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it'
        + '&viewbox=12.36,41.95,12.44,41.91&q=' + encodeURIComponent(q);
      const r = await fetch(u, { headers: { 'Accept-Language': 'it' } });
      const j = await r.json();
      if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon };
    } catch {}
  }
  return null;
}

function msgErrore(e) {
  const m = (e && e.message) || '';
  if (/regolamento/i.test(m)) return 'Accetta il regolamento prima di pubblicare.';
  if (/titolo/i.test(m)) return 'Il titolo deve avere almeno 3 caratteri.';
  if (/evento_ha_(data|luogo)/.test(m)) return 'Completa data e luogo prima di approvare.';
  if (/fetch|network/i.test(m)) return 'Sembra che tu sia offline. Riprova tra poco.';
  return 'Qualcosa non ha funzionato. Riprova.';
}

/* ---------- Viste ---------- */
const SKYLINE = `<svg class="skyline" viewBox="0 0 360 76" aria-hidden="true"><defs><pattern id="cortina" width="12" height="6" patternUnits="userSpaceOnUse"><rect width="12" height="6" class="k-brick"/><path class="k-mortar" d="M0 3H12M0 6H12M6 0V3M0 3V6M12 3V6"/></pattern></defs>${
  [[0, 26, 66, 50, 3], [88, 8, 62, 68, 4], [172, 30, 78, 46, 3], [280, 18, 58, 58, 4]].map(([x, y, w, h, f]) => {
    let o = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#cortina)"/>`;
    const step = (h - 8) / f;
    for (let i = 0; i < f; i++) {
      const fy = y + 4 + i * step;
      for (let wx = x + 5; wx < x + w - 6; wx += 11) o += `<rect class="k-win" x="${wx}" y="${(fy + 2).toFixed(1)}" width="5" height="${(step - 6).toFixed(1)}" rx="1"/>`;
      o += `<rect class="k-rail" x="${x - 1}" y="${(fy + step - 4).toFixed(1)}" width="${w + 2}" height="3"/>`;
    }
    return o + `<rect class="k-trav" x="${x}" y="${y + h - 6}" width="${w}" height="6"/>`;
  }).join('')
}${
  [[68, 20, 18, 56, 5], [152, 14, 18, 62, 6], [340, 24, 20, 52, 5]].map(([x, y, w, h, n]) => {
    const pts = []; for (let i = 0; i <= n; i++) pts.push(`${x + (i % 2 ? w : 0)},${(y + h - i * h / n).toFixed(1)}`);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="k-white" opacity=".35"/><polyline class="k-stair" points="${pts.join(' ')}"/><rect x="${x}" y="${y}" width="1.6" height="${h}" class="k-white"/><rect x="${x + w - 1.6}" y="${y}" width="1.6" height="${h}" class="k-white"/>`;
  }).join('')
}<circle class="k-tree" cx="264" cy="54" r="11"/><rect class="k-trav" x="262" y="62" width="4" height="14"/></svg>`;

const RULES = `<div class="rules"><p>Scrivi solo di cose che riguardano il quartiere.</p>
<p>Niente nomi, cognomi, targhe o foto di persone riconoscibili, anche negli avvisi.</p>
<p>Per le emergenze chiama il 112: l'app non sostituisce i soccorsi.</p>
<p>Niente pubblicità nei post: le attività hanno la loro sezione.</p>
<p>Gli admin possono modificare o rifiutare i post che non rispettano queste regole.</p></div>`;

function evCard(p) {
  const s = new Date(p.start);
  return `<button class="ev" data-action="open" data-id="${p.id}"><span class="datebox"><span class="d">${s.getDate()}</span><span class="m">${fMon.format(s).replace('.', '')}</span></span>
  <span><b>${esc(p.title)}</b><small>${cap(fWeekday.format(s))}, ${fTime.format(s)}</small><small>${esc(p.place || '')}</small></span></button>`;
}
function alertRow(p) {
  return `<button class="alert ${p.urgent ? '' : 'info'}" data-action="open" data-id="${p.id}"><span class="dot"></span>
  <span><b>${esc(p.title)}</b><small>${p.urgent ? 'Urgente, ' : ''}${since(p.start)}</small></span></button>`;
}
const offlineNote = () => (st.offline ? `<p class="offline">Sei offline: stai vedendo gli ultimi dati salvati.</p>` : '');

function loginBox(msg) {
  return `<div class="note"><p>${msg}</p>
  <label class="field"><span>La tua email</span><input id="l-email" type="email" autocomplete="email" inputmode="email" placeholder="nome@esempio.it"></label>
  <p class="err" id="l-err" role="alert"></p>
  <button class="btn primary block" data-action="login">Inviami il link di accesso</button>
  <p class="hint">Niente password: ti arriva un link, lo apri da questo telefono e sei dentro.</p></div>`;
}

function vHome() {
  const today = startOfToday();
  const up = st.events.filter((p) => new Date(p.end || p.start) >= today).slice(0, 3);
  const al = st.alerts.slice(0, 5);
  const pend = isAdmin() ? st.queue.length : 0;
  return `<header class="hero"><h1 class="wordmark">Torresina</h1><p>Avvisi, eventi e attività del quartiere, tutti in un posto.</p>${SKYLINE}</header>
  ${offlineNote()}
  ${pend ? `<button class="banner" data-action="go" data-view="profilo"><b>${pend === 1 ? '1 post da approvare' : pend + ' post da approvare'}</b><span>Apri</span></button>` : ''}
  <section class="section"><div class="section-head"><h2>Avvisi</h2></div>
  ${al.length ? `<div class="stack">${al.map(alertRow).join('')}</div>` : `<p class="note">Nessun avviso al momento.</p>`}</section>
  <section class="section"><div class="section-head"><h2>Prossimi eventi</h2><button class="link" data-action="go" data-view="eventi">Calendario</button></div>
  ${up.length ? `<div class="stack">${up.map(evCard).join('')}</div>` : `<p class="note">Nessun evento in programma. <button class="link" data-action="go" data-view="proponi">Proponi il primo</button></p>`}</section>`;
}

function vEventi() {
  const { y, m, sel } = cal;
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const byDay = {};
  st.events.forEach((p) => { const k = dayKey(new Date(p.start)); (byDay[k] = byDay[k] || []).push(p); });
  const todayK = dayKey(new Date());
  const today = startOfToday();
  const isThisMonth = y === today.getFullYear() && m === today.getMonth();
  let cells = ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d) => `<span class="wd" aria-hidden="true">${d}</span>`).join('');
  for (let i = 0; i < offset; i++) cells += '<span class="day out" aria-hidden="true"></span>';
  for (let d = 1; d <= days; d++) {
    const dt = new Date(y, m, d); const k = dayKey(dt); const n = (byDay[k] || []).length;
    const cls = ['day'];
    if (k === todayK) cls.push('today');
    if (k === sel) cls.push('sel');
    if (dt < today) cls.push('past');
    cells += `<button class="${cls.join(' ')}" data-action="day" data-day="${k}" aria-pressed="${k === sel}" aria-label="${fDay.format(dt)}${n ? ', ' + n + (n === 1 ? ' evento' : ' eventi') : ''}"><span>${d}</span><span class="dots">${'<i></i>'.repeat(Math.min(n, 3))}</span></button>`;
  }
  let list, title, empty;
  if (sel) {
    list = byDay[sel] || [];
    title = fDay.format(parseKey(sel));
    empty = `<div class="note"><p>Nessun evento in questo giorno.</p><button class="btn secondary block" data-action="go" data-view="proponi">Proponi un evento</button></div>`;
  } else {
    // Nel mese corrente mostro i prossimi eventi anche oltre fine mese
    list = isThisMonth
      ? st.events.filter((p) => new Date(p.end || p.start) >= today).slice(0, 12)
      : st.events.filter((p) => { const s = new Date(p.start); return s.getFullYear() === y && s.getMonth() === m; });
    title = isThisMonth ? 'Prossimi eventi' : 'Eventi di ' + fMonthYear.format(first);
    empty = `<p class="note">Nessun evento ${isThisMonth ? 'in programma' : 'in questo mese'}.</p>`;
  }
  const chev = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  return `<header class="pagehead"><h1>Eventi</h1><p class="sub">Tocca un giorno per vedere cosa succede.</p></header>
  ${offlineNote()}
  <div class="cal"><div class="cal-top"><h2>${fMonthYear.format(first)}</h2><div class="navs">
  ${isThisMonth ? '' : `<button class="link" data-action="today" style="margin-right:4px">Oggi</button>`}
  <button class="iconbtn" data-action="prev" aria-label="Mese precedente">${chev('M15 5l-7 7 7 7')}</button>
  <button class="iconbtn" data-action="next" aria-label="Mese successivo">${chev('M9 5l7 7-7 7')}</button></div></div>
  <div class="grid">${cells}</div></div>
  <div class="list-head"><h2>${title}</h2>${sel ? '<button class="link" data-action="clearday">Tutto il mese</button>' : ''}</div>
  ${list.length ? `<div class="stack">${list.map(evCard).join('')}</div>` : empty}`;
}

function vProponi() {
  if (!st.session) {
    return `<header class="pagehead"><h1>Proponi</h1></header>
    ${form.share ? `<p class="note" style="margin-bottom:14px">Hai condiviso un post: accedi e lo ritrovi qui già pronto.</p>` : ''}
    ${loginBox('Per proporre un evento o un avviso serve un account del quartiere. Per leggere invece non serve registrarsi.')}`;
  }
  const direct = isTrusted();
  const t = form.type;
  const today = dayKey(new Date());
  const serveNome = !st.profile || st.profile.nome_visualizzato === 'Residente';
  const sh = form.share;
  return `<header class="pagehead"><h1>Proponi</h1><p class="sub">${direct ? 'Il tuo post verrà pubblicato subito.' : 'Un admin lo controlla prima di pubblicarlo, di solito in giornata.'}</p></header>
  ${sh ? `<div class="box"><b>Dal post che hai condiviso</b><br><small class="hint">${sh.campi ? "Ho compilato i campi leggendo il post: controllali prima di inviare." : sh.soloLink ? "Facebook ha passato solo il link: scrivi due righe su cosa succede." : 'Controlla e completa i campi.'}</small></div>` : ''}
  <div class="seg" role="group" aria-label="Tipo di post"><button data-action="ftype" data-type="evento" aria-pressed="${t === 'evento'}">Evento</button><button data-action="ftype" data-type="avviso" aria-pressed="${t === 'avviso'}">Avviso</button></div>
  ${serveNome ? `<label class="field"><span>Il tuo nome sulla bacheca</span><input id="f-name" maxlength="40" autocomplete="nickname" placeholder="Es. Giulia R."></label>` : ''}
  <label class="field"><span>Titolo</span><input id="f-title" maxlength="80" autocomplete="off" placeholder="${t === 'evento' ? 'Es. Castagnata nel parco' : 'Es. Lampione spento sul vialetto'}"></label>
  ${t === 'evento' ? `<label class="field"><span>Giorno</span><input id="f-date" type="date" min="${today}"></label>
  <div class="row2"><label class="field"><span>Inizio</span><input id="f-start" type="time" value="17:00"></label><label class="field"><span>Fine <em>(facoltativa)</em></span><input id="f-end" type="time"></label></div>`
  : `<div class="box"><label class="check"><input id="f-urgent" type="checkbox"><span><b>Urgente</b><br><small>Solo per pericoli o problemi che riguardano tutti adesso.</small></span></label></div>`}
  <label class="field"><span>Dove${t === 'evento' ? '' : ' <em>(facoltativo)</em>'}</span><input id="f-place" autocomplete="off" placeholder="Es. Area verde di Torresina 2"></label>
  <label class="field"><span>Indirizzo per la mappa <em>(facoltativo)</em></span><input id="f-address" autocomplete="off" placeholder="Via e numero civico"></label>
  <label class="field"><span>Descrizione</span><textarea id="f-desc" maxlength="2000" placeholder="${t === 'evento' ? 'Cosa si fa, per chi è, cosa portare.' : 'Cosa succede e dove, senza nomi o targhe.'}"></textarea></label>
  <label class="check"><input id="f-rules" type="checkbox" ${st.profile?.regolamento_accettato_il ? 'checked' : ''}><span>Rispetto il regolamento: niente nomi, targhe o volti riconoscibili.</span></label>
  <button class="link" data-action="rules">Leggi il regolamento</button>
  <p class="err" id="f-err" role="alert"></p>
  <button class="btn primary block" data-action="submit">${direct ? 'Pubblica' : 'Invia per approvazione'}</button>`;
}

function vAttivita() {
  return `<header class="pagehead"><h1>Attività</h1><p class="sub">Negozi e servizi del quartiere.</p></header>
  ${st.biz.length ? `<div class="stack">${st.biz.map((b) => `<article class="card"><h3>${esc(b.nome)}</h3><div class="cat">${esc(b.categoria)}</div>
  ${b.descrizione ? `<p>${esc(b.descrizione)}</p>` : ''}${b.orari ? `<p class="hours">${esc(b.orari)}</p>` : ''}${b.offerta ? `<p class="offer">${esc(b.offerta)}</p>` : ''}
  <div class="btn-row ${b.telefono ? '' : 'one'}"><a class="btn secondary" href="${mapsUrl(b.indirizzo ? b.indirizzo + ', Roma' : b.nome + ', Torresina, Roma')}" target="_blank" rel="noopener">Portami lì</a>
  ${b.telefono ? `<a class="btn secondary" href="tel:${esc(b.telefono.replace(/\s/g, ''))}">Chiama</a>` : ''}</div></article>`).join('')}</div>`
  : `<p class="note">Le schede delle attività arrivano presto.</p>`}
  <p class="note" style="margin-top:16px"><b>Hai un'attività a Torresina?</b><br>Scrivi agli admin: aggiungeremo la tua scheda con orari, contatti e offerte per i residenti.</p>`;
}

function qCard(p) {
  return `<article class="card"><div class="card-top"><span class="tag ${p.type === 'avviso' ? 'alert' : ''}">${p.type === 'evento' ? 'Evento' : (p.urgent ? 'Avviso urgente' : 'Avviso')}</span><small>${p.fonte !== 'app' ? FONTI[p.fonte] : 'Dall\'app'}</small></div>
  ${p.fonte !== 'app' && p.fonte !== 'condivisione' ? `<p class="src"><span class="src-badge">${FONTI[p.fonte]}</span> Compilato dall'AI${p.ai != null && p.ai < 0.7 ? ': <b>controlla i dati</b>' : ''}</p>` : ''}
  <h3>${esc(p.title)}</h3>
  <p class="meta">${p.type === 'evento' ? when(p) + '<br>' + (p.place ? esc(p.place) : '<b class="miss">Luogo da completare</b>') : 'Inviato ' + since(p.created)}</p>
  <p>${esc(p.desc)}</p>
  ${p.fonteUrl ? `<p><a class="link" href="${esc(p.fonteUrl)}" target="_blank" rel="noopener">Apri il post originale</a></p>` : ''}
  <div class="btn-row"><button class="btn secondary" data-action="edit" data-id="${p.id}">Modifica</button><button class="btn primary" data-action="approve" data-id="${p.id}">Approva</button></div>
  <button class="btn ghost block" data-action="reject" data-id="${p.id}">Rifiuta</button></article>`;
}
function myRow(p) {
  const [l, c] = STATUS[p.status];
  return `<button class="mine" data-action="open" data-id="${p.id}"><span><b>${esc(p.title)}</b><small>${p.type === 'evento' ? when(p) : 'Avviso, ' + since(p.created)}</small>
  ${p.status === 'rifiutato' && p.motivo ? `<span class="motivo">${esc(p.motivo)}</span>` : ''}</span><span class="tag ${c}">${l}</span></button>`;
}

function vProfilo() {
  if (!st.session) {
    return `<header class="pagehead"><h1>Profilo</h1></header>${loginBox('Accedi per proporre eventi e avvisi e seguire i tuoi post.')}
    <section class="section"><div class="section-head"><h2>Regolamento</h2></div><div class="note">${RULES}</div></section>`;
  }
  const p = st.profile || {};
  const ruolo = isAdmin() ? 'Admin' : p.fidato ? 'Residente fidato' : 'Residente';
  return `<header class="pagehead"><h1>Profilo</h1><p class="sub">${esc(st.session.user.email)} · ${ruolo}</p></header>
  <div class="box"><label class="field" style="margin-bottom:10px"><span>Nome sulla bacheca</span><input id="p-name" maxlength="40" value="${esc(p.nome_visualizzato || '')}"></label>
  <button class="btn secondary block" data-action="save-name">Salva nome</button></div>
  ${isAdmin() ? `<section class="section"><div class="section-head"><h2>Da approvare</h2><span class="count">${st.queue.length}</span></div>
  ${st.queue.length ? `<div class="stack">${st.queue.map(qCard).join('')}</div>` : `<p class="note">Nessun post in attesa.</p>`}</section>` : ''}
  <section class="section"><div class="section-head"><h2>I miei post</h2></div>
  ${st.mine.length ? `<div class="stack">${st.mine.map(myRow).join('')}</div>` : `<p class="note">Non hai ancora proposto nulla. <button class="link" data-action="go" data-view="proponi">Proponi un evento</button></p>`}</section>
  ${isAdmin() ? `<section class="section"><div class="section-head"><h2>Utenti fidati</h2></div>
  <div class="card"><p class="hint" style="margin:0 0 6px">I fidati pubblicano senza attesa. Tu puoi sempre nascondere un post dopo.</p>
  ${st.users.filter((u) => u.ruolo !== 'admin').map((u) => `<label class="user-row"><span>${esc(u.nome_visualizzato)}<small>${u.fidato ? 'Pubblica subito' : 'Serve approvazione'}</small></span>
  <input type="checkbox" data-action="toggle-fidato" data-id="${u.id}" ${u.fidato ? 'checked' : ''} aria-label="Fidato: ${esc(u.nome_visualizzato)}"></label>`).join('') || '<p class="hint">Ancora nessun residente registrato.</p>'}</div></section>` : ''}
  <section class="section"><div class="section-head"><h2>Regolamento</h2></div><div class="note">${RULES}</div></section>
  <button class="btn secondary block" data-action="logout" style="margin-top:24px">Esci</button>`;
}

const VIEWS = { home: vHome, eventi: vEventi, proponi: vProponi, attivita: vAttivita, profilo: vProfilo };

function render() {
  if (!st.ready) return;
  const main = $('main');
  if (view === 'proponi') keepForm();
  main.innerHTML = VIEWS[view]();
  if (view === 'proponi') restoreForm();
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.view === view) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  const n = isAdmin() ? st.queue.length : 0;
  const b = $('badge'); b.hidden = !n; b.textContent = n;
}
function go(v) { view = v; render(); window.scrollTo(0, 0); }

/* ---------- Sheet ---------- */
const sheet = $('sheet'), scrim = $('scrim');
let lastFocus = null;
const closeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const sheetTop = (tag, cls = '') => `<div class="grab"></div><div class="sheet-top"><span class="tag ${cls}">${tag}</span><button class="iconbtn" data-action="close" aria-label="Chiudi">${closeIcon}</button></div>`;

function openSheet(html) {
  lastFocus = document.activeElement;
  sheet.innerHTML = html; sheet.scrollTop = 0;
  sheet.classList.add('open'); scrim.classList.add('open');
  sheet.querySelector('[data-action="close"]')?.focus();
}
function closeSheet() {
  if (mappa) { mappa.remove(); mappa = null; }
  editing = null;
  sheet.classList.remove('open'); scrim.classList.remove('open');
  lastFocus?.focus?.();
}

function mountMap(p) {
  const el = $('map');
  if (!el || !window.L || p.lat == null) return;
  mappa = L.map(el, { zoomControl: false, scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false }).setView([p.lat, p.lng], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mappa);
  L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [26, 26], iconAnchor: [13, 26] }) }).addTo(mappa);
  setTimeout(() => mappa && mappa.invalidateSize(), 320);
}

function openDetail(id) {
  const p = findPost(id);
  if (!p) return;
  const ev = p.type === 'evento';
  const hasPlace = !!(p.place || p.address);
  const past = ev && p.start && new Date(p.end || p.start) < new Date();
  const pub = p.status === 'approvato';
  const tag = ev ? (past ? 'Evento concluso' : 'Evento') : (p.urgent ? 'Avviso urgente' : 'Avviso');
  const bottoni = [
    hasPlace ? `<a class="btn primary" href="${mapsUrl(placeQuery(p))}" target="_blank" rel="noopener">Portami lì</a>` : '',
    ev && !past && p.start ? `<button class="btn secondary" data-action="ics" data-id="${p.id}">Aggiungi al calendario</button>` : '',
  ].filter(Boolean);
  const mio = st.mine.some((x) => x.id === p.id);
  openSheet(`${sheetTop(tag, ev ? '' : 'alert')}
  <h2 class="sheet-title" id="sheet-title">${esc(p.title)}</h2>
  <p class="meta"><b>${ev ? when(p) : 'Pubblicato ' + since(p.start || p.created)}</b>${p.author ? '<br>da ' + esc(p.author) : ''}</p>
  ${hasPlace ? `<div class="place">${p.lat != null ? '<div class="leaflet-map" id="map"></div>' : ''}<div class="place-txt"><b>${esc(p.place || p.address)}</b><span>${esc(p.address && p.place ? p.address : 'Torresina, Roma')}</span></div></div>` : ''}
  ${bottoni.length ? `<div class="btn-row ${bottoni.length === 1 ? 'one' : ''}">${bottoni.join('')}</div>` : '<div style="height:14px"></div>'}
  <p class="desc">${esc(p.desc)}</p>
  ${p.fonteUrl && pub ? `<p><a class="link" href="${esc(p.fonteUrl)}" target="_blank" rel="noopener">Vedi il post originale su ${FONTI[p.fonte] || 'social'}</a></p>` : ''}
  ${pub ? `<button class="btn secondary block" data-action="share" data-id="${p.id}">Condividi</button>`
    : `<p class="note">Stato: ${STATUS[p.status][0].toLowerCase()}. Solo tu e gli admin vedete questo post.</p>`}
  ${mio && p.status === 'in_attesa' ? `<button class="btn ghost block" data-action="withdraw" data-id="${p.id}">Ritira il post</button>` : ''}
  ${isAdmin() && pub ? `<button class="btn ghost block" data-action="hide" data-id="${p.id}">Nascondi dalla bacheca</button>` : ''}`);
  mountMap(p);
}

function openRules() {
  openSheet(`${sheetTop('Regolamento', 'ok')}<h2 class="sheet-title" id="sheet-title">Poche regole, per stare bene tutti</h2>${RULES}`);
}

function openEdit(id) {
  const p = st.queue.find((x) => x.id === id) || findPost(id);
  if (!p) return;
  editing = p;
  const s = p.start && p.type === 'evento' ? new Date(p.start) : null;
  const e = p.end ? new Date(p.end) : null;
  openSheet(`${sheetTop('Modifica prima di approvare')}
  <h2 class="sheet-title" id="sheet-title">Controlla i dati</h2>
  ${p.orig ? `<details class="orig"><summary>Testo originale${p.fonte !== 'app' ? ' da ' + FONTI[p.fonte] : ''}</summary><p>${esc(p.orig)}</p></details>` : ''}
  <div class="seg" role="group" aria-label="Tipo"><button data-action="etype" data-type="evento" aria-pressed="${p.type === 'evento'}">Evento</button><button data-action="etype" data-type="avviso" aria-pressed="${p.type === 'avviso'}">Avviso</button></div>
  <label class="field"><span>Titolo</span><input id="e-title" maxlength="80" value="${esc(p.title)}"></label>
  <div id="e-when" ${p.type === 'evento' ? '' : 'hidden'}>
    <label class="field"><span>Giorno</span><input id="e-date" type="date" value="${s ? dayKey(s) : ''}"></label>
    <div class="row2"><label class="field"><span>Inizio</span><input id="e-start" type="time" value="${s ? hm(s) : ''}"></label><label class="field"><span>Fine</span><input id="e-end" type="time" value="${e ? hm(e) : ''}"></label></div>
  </div>
  <div id="e-urg" class="box" ${p.type === 'avviso' ? '' : 'hidden'}><label class="check"><input id="e-urgent" type="checkbox" ${p.urgent ? 'checked' : ''}><span><b>Urgente</b></span></label></div>
  <label class="field"><span>Dove</span><input id="e-place" value="${esc(p.place || '')}"></label>
  <label class="field"><span>Indirizzo</span><input id="e-address" value="${esc(p.address || '')}"></label>
  <label class="field"><span>Descrizione</span><textarea id="e-desc" maxlength="2000">${esc(p.desc)}</textarea></label>
  <p class="err" id="e-err" role="alert"></p>
  <div class="btn-row"><button class="btn secondary" data-action="edit-save">Salva</button><button class="btn primary" data-action="edit-approve">Salva e approva</button></div>`);
}

function openReject(id) {
  openSheet(`${sheetTop('Rifiuta', 'no')}
  <h2 class="sheet-title" id="sheet-title">Perché non lo pubblichi?</h2>
  <p class="hint" style="margin-top:0">Chi l'ha scritto vede il motivo nei suoi post. Facoltativo.</p>
  <label class="field"><span>Motivo</span><textarea id="r-motivo" maxlength="300" placeholder="Es. Contiene il nome di una persona"></textarea></label>
  <button class="btn danger block" data-action="reject-confirm" data-id="${id}">Rifiuta il post</button>`);
}

/* ---------- Azioni ---------- */
function busy(btn, on, testo) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = testo || 'Un attimo…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

const FORM_IDS = ['f-name', 'f-title', 'f-date', 'f-start', 'f-end', 'f-place', 'f-address', 'f-desc'];
const CHECK_IDS = ['f-rules', 'f-urgent'];
function keepForm() {
  FORM_IDS.forEach((id) => { const el = $(id); if (el) form.v[id] = el.value; });
  CHECK_IDS.forEach((id) => { const el = $(id); if (el) form.v[id] = el.checked; });
}
function restoreForm() {
  Object.entries(form.v).forEach(([id, v]) => {
    const el = $(id);
    if (!el || v == null) return;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
}

// Imposta un nuovo modulo senza che render() lo sovrascriva con i campi ancora a schermo
function nuovoForm(f) { form = f; if (view === 'proponi') $('main').innerHTML = ''; }

function campiToForm(c) {
  const v = {};
  if (c.titolo) v['f-title'] = c.titolo;
  if (c.descrizione) v['f-desc'] = c.descrizione;
  if (c.luogo) v['f-place'] = c.luogo;
  if (c.indirizzo) v['f-address'] = c.indirizzo;
  const s = c.inizio && new Date(c.inizio);
  if (s && !isNaN(s)) { v['f-date'] = dayKey(s); v['f-start'] = hm(s); }
  const e = c.fine && new Date(c.fine);
  if (e && !isNaN(e)) v['f-end'] = hm(e);
  return v;
}

async function login(btn) {
  const email = val('l-email');
  const err = $('l-err');
  if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = "Controlla l'indirizzo email."; return; }
  busy(btn, true, 'Invio in corso…');
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + '/' } });
  busy(btn, false);
  if (error) { err.textContent = 'Invio non riuscito, riprova tra qualche minuto.'; return; }
  btn.closest('.note').innerHTML = `<p><b>Controlla la tua email.</b></p><p>Abbiamo mandato un link a ${esc(email)}. Aprilo da questo telefono per entrare.</p>`;
}

async function submit(btn) {
  const t = form.type;
  const title = val('f-title'), place = val('f-place'), address = val('f-address'), desc = val('f-desc');
  const err = (m) => { $('f-err').textContent = m; };
  const nameEl = $('f-name');
  const name = nameEl ? val('f-name') : '';
  if (nameEl && name.length < 2) return err('Scrivi il nome da mostrare, anche solo nome e iniziale.');
  if (title.length < 3) return err('Scrivi un titolo di almeno 3 caratteri.');
  let start = null, end = null;
  if (t === 'evento') {
    const d = val('f-date'), s = val('f-start'), e = val('f-end');
    if (!d) return err("Scegli il giorno dell'evento.");
    if (!s) return err("Indica l'ora di inizio.");
    if (!place) return err('Indica dove si svolge.');
    const sd = new Date(d + 'T' + s);
    if (e) { const ed = new Date(d + 'T' + e); if (ed <= sd) return err("L'ora di fine deve venire dopo l'inizio."); end = ed.toISOString(); }
    start = sd.toISOString();
  }
  if (!desc) return err('Aggiungi una breve descrizione.');
  if (!checked('f-rules')) return err('Conferma di rispettare il regolamento.');

  busy(btn, true, 'Invio in corso…');
  try {
    const upd = {};
    if (!st.profile?.regolamento_accettato_il) upd.regolamento_accettato_il = new Date().toISOString();
    if (name) upd.nome_visualizzato = name;
    if (Object.keys(upd).length) {
      const { error } = await sb.from('profiles').update(upd).eq('id', st.session.user.id);
      if (error) throw error;
      Object.assign(st.profile || (st.profile = {}), upd);
    }
    const pos = place || address ? await geocode(address, place) : null;
    const row = {
      tipo: t, titolo: title, descrizione: desc, urgente: t === 'avviso' && checked('f-urgent'),
      inizio: start, fine: end, luogo: place || null, indirizzo: address || null,
      lat: pos?.lat ?? null, lng: pos?.lng ?? null,
    };
    if (form.share) { row.fonte = 'condivisione'; row.fonte_url = form.share.url || null; }
    const { data, error } = await sb.from('posts').insert(row).select().single();
    if (error) throw error;
    nuovoForm({ type: t, v: {}, share: null });
    await refresh();
    if (data.stato === 'approvato') {
      toast('Pubblicato');
      if (t === 'evento') { const s = new Date(start); cal = { y: s.getFullYear(), m: s.getMonth(), sel: dayKey(s) }; go('eventi'); } else go('home');
    } else {
      toast('Inviato: lo trovi in Profilo finché non viene approvato');
      go('profilo');
    }
  } catch (e) {
    console.error(e);
    err(msgErrore(e));
  } finally { busy(btn, false); }
}

async function setStato(id, stato, motivo = null) {
  const { error } = await sb.from('posts').update({ stato, motivo_rifiuto: motivo }).eq('id', id);
  if (error) { console.error(error); toast(msgErrore(error)); return false; }
  await refresh();
  return true;
}

async function saveEdit(btn, approva) {
  const p = editing;
  if (!p) return;
  const tipo = sheet.querySelector('[data-action="etype"][aria-pressed="true"]')?.dataset.type || p.type;
  const err = (m) => { $('e-err').textContent = m; };
  const title = val('e-title'), place = val('e-place'), address = val('e-address'), desc = val('e-desc');
  if (title.length < 3) return err('Titolo troppo corto.');
  if (!desc) return err('Manca la descrizione.');
  let inizio = null, fine = null;
  if (tipo === 'evento') {
    const d = val('e-date'), s = val('e-start'), e = val('e-end');
    if (approva && (!d || !s)) return err('Per approvare un evento servono giorno e ora.');
    if (approva && !place) return err('Per approvare un evento serve il luogo.');
    if (d && s) {
      const sd = new Date(d + 'T' + s); inizio = sd.toISOString();
      if (e) { const ed = new Date(d + 'T' + e); if (ed > sd) fine = ed.toISOString(); }
    }
  }
  busy(btn, true);
  try {
    const cambiato = place !== (p.place || '') || address !== (p.address || '') || p.lat == null;
    const pos = cambiato && (place || address) ? await geocode(address, place) : null;
    const upd = {
      tipo, titolo: title, descrizione: desc, inizio, fine,
      urgente: tipo === 'avviso' && checked('e-urgent'), luogo: place || null, indirizzo: address || null,
    };
    if (pos) { upd.lat = pos.lat; upd.lng = pos.lng; }
    if (approva) { upd.stato = 'approvato'; upd.motivo_rifiuto = null; }
    const { error } = await sb.from('posts').update(upd).eq('id', p.id);
    if (error) throw error;
    closeSheet();
    await refresh();
    toast(approva ? 'Approvato e pubblicato' : 'Modifiche salvate');
  } catch (e) {
    console.error(e); err(msgErrore(e));
  } finally { busy(btn, false); }
}

function scaricaIcs(p) {
  const f = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const e = (s) => (s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
  const fine = p.end || new Date(new Date(p.start).getTime() + 3600000).toISOString();
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Torresina//Bacheca//IT', 'BEGIN:VEVENT',
    'UID:' + p.id + '@torresina', 'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(p.start), 'DTEND:' + f(fine),
    'SUMMARY:' + e(p.title), 'DESCRIPTION:' + e(p.desc), 'LOCATION:' + e(placeQuery(p)),
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'torresina-evento.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function share(p) {
  const url = location.origin + '/?p=' + p.id;
  const text = p.title + (p.type === 'evento' ? ' – ' + when(p) + (p.place ? ', ' + p.place : '') : '');
  try { if (navigator.share) { await navigator.share({ title: p.title, text, url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text + '\n' + url); toast('Link copiato: incollalo nel gruppo'); } catch { toast('Condivisione non disponibile'); }
}

async function analizza(testo) {
  try {
    const r = await fetch('/api/analizza', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + st.session.access_token },
      body: JSON.stringify({ testo }),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

let tt;
function toast(m) {
  const el = $('toast'); el.textContent = m; el.classList.add('show');
  clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------- Eventi dell'interfaccia ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !sb) return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  switch (a) {
    case 'go': closeSheet(); go(el.dataset.view); break;
    case 'open': openDetail(id); break;
    case 'close': closeSheet(); break;
    case 'prev': cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } cal.sel = null; render(); break;
    case 'next': cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } cal.sel = null; render(); break;
    case 'today': { const d = new Date(); cal = { y: d.getFullYear(), m: d.getMonth(), sel: dayKey(d) }; render(); break; }
    case 'day': cal.sel = cal.sel === el.dataset.day ? null : el.dataset.day; render(); break;
    case 'clearday': cal.sel = null; render(); break;
    case 'ftype': keepForm(); form.type = el.dataset.type; render(); break;
    case 'etype':
      sheet.querySelectorAll('[data-action="etype"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      $('e-when').hidden = el.dataset.type !== 'evento'; $('e-urg').hidden = el.dataset.type !== 'avviso';
      break;
    case 'submit': submit(el); break;
    case 'rules': openRules(); break;
    case 'login': login(el); break;
    case 'logout': await sb.auth.signOut(); toast('Sei uscito'); break;
    case 'save-name': {
      const n = val('p-name');
      if (n.length < 2) { toast('Il nome è troppo corto'); break; }
      busy(el, true);
      const { error } = await sb.from('profiles').update({ nome_visualizzato: n }).eq('id', st.session.user.id);
      busy(el, false);
      if (error) toast(msgErrore(error)); else { st.profile.nome_visualizzato = n; toast('Nome salvato'); }
      break;
    }
    case 'approve': {
      const p = st.queue.find((x) => x.id === id);
      if (p && p.type === 'evento' && (!p.start || !p.place)) { toast('Completa data e luogo prima di approvare'); openEdit(id); break; }
      busy(el, true);
      if (await setStato(id, 'approvato')) toast('Approvato e pubblicato'); else busy(el, false);
      break;
    }
    case 'edit': openEdit(id); break;
    case 'edit-save': saveEdit(el, false); break;
    case 'edit-approve': saveEdit(el, true); break;
    case 'reject': openReject(id); break;
    case 'reject-confirm': {
      busy(el, true);
      const motivo = val('r-motivo') || null;
      if (await setStato(id, 'rifiutato', motivo)) { closeSheet(); toast('Post rifiutato'); } else busy(el, false);
      break;
    }
    case 'hide':
      if (!confirm('Nascondere questo post dalla bacheca?')) break;
      if (await setStato(id, 'rifiutato', 'Rimosso da un admin')) { closeSheet(); toast('Post nascosto'); }
      break;
    case 'withdraw': {
      if (!confirm('Vuoi ritirare questo post?')) break;
      const { error } = await sb.from('posts').delete().eq('id', id);
      if (error) toast(msgErrore(error)); else { closeSheet(); await refresh(); toast('Post ritirato'); }
      break;
    }
    case 'toggle-fidato': {
      const { error } = await sb.from('profiles').update({ fidato: el.checked }).eq('id', id);
      if (error) { el.checked = !el.checked; toast(msgErrore(error)); }
      else { const u = st.users.find((x) => x.id === id); if (u) u.fidato = el.checked; toast(el.checked ? 'Ora pubblica senza attesa' : 'Ora passa dall\'approvazione'); render(); }
      break;
    }
    case 'ics': { const p = findPost(id); if (p) scaricaIcs(p); break; }
    case 'share': { const p = findPost(id); if (p) share(p); break; }
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && st.ready && Date.now() - st.loadedAt > 60000) refresh();
});

/* ---------- Avvio ---------- */
const SHARE_KEY = 'torresina-condivisione';

async function gestisciCondivisione() {
  let sh = null;
  if (location.pathname === '/condividi') {
    sh = await leggiCondivisione(st.session);
    if (sh && !st.session) { try { localStorage.setItem(SHARE_KEY, JSON.stringify(sh)); } catch {} }
  } else if (st.session) {
    try { sh = JSON.parse(localStorage.getItem(SHARE_KEY) || 'null'); localStorage.removeItem(SHARE_KEY); } catch {}
    if (sh && !sh.campi && sh.testo) sh.campi = await analizza(sh.testo);
  }
  if (!sh) return;
  const tipo = sh.campi?.tipo === 'avviso' ? 'avviso' : 'evento';
  nuovoForm({ type: tipo, v: sh.campi ? campiToForm(sh.campi) : {}, share: sh });
  if (!sh.campi && sh.testo) form.v['f-desc'] = sh.testo;
  if (!st.session) toast('Accedi per proporre il post condiviso');
  go('proponi');
}

async function apriDaLink() {
  const pid = new URLSearchParams(location.search).get('p');
  if (!pid) return;
  history.replaceState(null, '', '/');
  if (!findPost(pid)) {
    const { data } = await sb.from('posts').select('*').eq('id', pid).maybeSingle();
    if (data) {
      const p = norm(data);
      (p.type === 'evento' ? st.events : st.alerts).push(p);
    }
  }
  if (findPost(pid)) openDetail(pid); else toast('Questo post non è più disponibile');
}

async function init() {
  if (!sb) {
    $('main').innerHTML = `<div class="setup"><h1 class="wordmark">Torresina</h1>
    <p class="note" style="margin-top:20px"><b>Manca la configurazione.</b><br>Inserisci URL e chiave anon del progetto Supabase in <code>public/js/config.js</code>, poi ricarica.</p></div>`;
    return;
  }
  const { data } = await sb.auth.getSession();
  st.session = data.session;
  sb.auth.onAuthStateChange((_evento, session) => {
    const cambiato = (session?.user?.id || null) !== (st.session?.user?.id || null);
    st.session = session;
    if (cambiato && st.ready) setTimeout(async () => { await loadPrivate(); render(); await gestisciCondivisione(); }, 0);
  });
  await refresh();
  await gestisciCondivisione();
  await apriDaLink();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
