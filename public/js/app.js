// Torresina, la bacheca del quartiere
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { leggiCondivisione } from './condividi.js';

const configurato = SUPABASE_URL && !SUPABASE_URL.includes('xxxx') && SUPABASE_ANON_KEY && window.supabase;
const sb = configurato ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const BUCKET = 'foto-post';

/* =====================================================================
   Utilità
   ===================================================================== */
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
const oggiKey = () => dayKey(new Date());
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return dayKey(d) + 'T' + hm(d); };
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

const fDay = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const fDate = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' });
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
const telUrl = (t) => 'tel:' + t.replace(/[^\d+]/g, '');
const waUrl = (t) => { let n = t.replace(/\D/g, ''); if (n.startsWith('3') && n.length <= 10) n = '39' + n; return 'https://wa.me/' + n; };
const webUrl = (u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
const igUrl = (h) => (/^https?:/i.test(h) ? h : 'https://instagram.com/' + h.replace(/^@/, ''));

const FONTI = { instagram: 'Instagram', facebook_pagina: 'Pagina Facebook', telegram: 'Telegram', condivisione: 'Condiviso dal telefono' };
const STATUS = { in_attesa: ['In attesa', ''], approvato: ['Pubblicato', 'ok'], rifiutato: ['Non approvato', 'no'] };
const LIVELLI = { info: 'Informazione', importante: 'Importante', urgente: 'Urgente' };
const CATEGORIE = ['Alimentari', 'Bar e ristoranti', 'Salute', 'Bellezza', 'Casa e riparazioni', 'Sport', 'Scuola e bambini', 'Animali', 'Servizi pubblici', 'Trasporti'];

/* ---------- Immagini ---------- */
const urlFoto = (path, mini = false) => (path ? sb.storage.from(BUCKET).getPublicUrl(mini ? path.replace(/\.jpg$/, '_t.jpg') : path).data.publicUrl : null);

async function comprimi(file, lato, qualita) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); });
  }
  const w0 = img.width, h0 = img.height;
  const k = Math.min(1, lato / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', qualita));
  if (!blob) throw new Error('Immagine non leggibile');
  return { blob, w, h };
}

// Carica la foto in due misure: grande (1600 px) e miniatura (480 px)
async function caricaFoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Il file scelto non è una foto');
  const uid = st.session.user.id;
  const id = crypto.randomUUID();
  const grande = await comprimi(file, 1600, 0.82);
  const mini = await comprimi(file, 480, 0.74);
  const path = `${uid}/${id}.jpg`;
  const opz = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
  let r = await sb.storage.from(BUCKET).upload(path, grande.blob, opz);
  if (r.error) throw r.error;
  r = await sb.storage.from(BUCKET).upload(`${uid}/${id}_t.jpg`, mini.blob, opz);
  if (r.error) throw r.error;
  return { path, w: grande.w, h: grande.h };
}
async function rimuoviFile(path) {
  if (!path) return;
  try { await sb.storage.from(BUCKET).remove([path, path.replace(/\.jpg$/, '_t.jpg')]); } catch {}
}

/* =====================================================================
   Stato
   ===================================================================== */
const st = {
  session: null, profile: null,
  events: [], alerts: [], biz: [], promosAll: [], commsAll: [], gallery: [],
  mine: [], myPhotos: [], myBiz: [],
  queue: [], queueFoto: [], users: [], allBiz: [],
  ready: false, offline: false, loadedAt: 0,
};
let view = 'home';
let adminTab = 'coda';
let bizFilter = 'tutte';
let loginMode = 'password';
const t0 = new Date();
let cal = { y: t0.getFullYear(), m: t0.getMonth(), sel: null };
let form = { type: 'evento', v: {}, share: null };
const files = {}; // foto scelte nei moduli: files[chiave] = { file, url } oppure { rimuovi: true }
let editing = null;
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
    orig: r.testo_originale || null, created: r.creato_il, foto: r.foto_path || null,
  };
}

const promoAttiva = (p) => {
  const oggi = oggiKey();
  return p.attiva && p.valida_dal <= oggi && (!p.valida_fino || p.valida_fino >= oggi)
    && st.biz.some((b) => b.id === p.attivita_id);
};
const commAttiva = (c) => c.attiva && new Date(c.inizio) <= new Date() && (!c.fine || new Date(c.fine) > new Date());
const promos = () => st.promosAll.filter(promoAttiva);
const comms = () => st.commsAll.filter(commAttiva);
const inEvidenza = (b) => b.in_evidenza_fino && b.in_evidenza_fino >= oggiKey();

/* =====================================================================
   Dati
   ===================================================================== */
const CACHE_KEY = 'torresina-cache-v2';

async function loadPublic() {
  try {
    const da = new Date(); da.setDate(da.getDate() - 120);
    const [ev, av, bz, pr, cm, ga] = await Promise.all([
      sb.from('eventi_pubblici').select('*').gte('inizio', da.toISOString()).order('inizio'),
      sb.from('avvisi_pubblici').select('*').order('creato_il', { ascending: false }).limit(30),
      sb.from('attivita').select('*').eq('visibile', true).order('nome'),
      sb.from('promozioni').select('*').order('valida_dal', { ascending: false }),
      sb.from('comunicazioni').select('*').order('inizio', { ascending: false }),
      sb.from('galleria_pubblica').select('*').order('creato_il', { ascending: false }).limit(120),
    ]);
    for (const r of [ev, av, bz, pr, cm, ga]) if (r.error) throw r.error;
    st.events = ev.data.map((r) => norm(r, 'evento'));
    st.alerts = av.data.map((r) => norm(r, 'avviso'));
    st.biz = bz.data.sort((a, b) => (inEvidenza(b) ? 1 : 0) - (inEvidenza(a) ? 1 : 0) || a.nome.localeCompare(b.nome, 'it'));
    st.promosAll = pr.data;
    st.commsAll = cm.data;
    st.gallery = ga.data;
    st.offline = false;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        events: st.events, alerts: st.alerts, biz: st.biz, promosAll: st.promosAll.filter(promoAttiva),
        commsAll: st.commsAll.filter(commAttiva), gallery: st.gallery.slice(0, 30),
      }));
    } catch {}
  } catch (e) {
    console.error(e);
    st.offline = true;
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c) Object.assign(st, c);
    } catch {}
  }
}

async function loadPrivate() {
  Object.assign(st, { profile: null, mine: [], myPhotos: [], myBiz: [], queue: [], queueFoto: [], users: [], allBiz: [] });
  const uid = st.session?.user?.id;
  if (!uid) return;
  try {
    const [p, m, f, b] = await Promise.all([
      sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
      sb.from('posts').select('*').eq('autore_id', uid).order('creato_il', { ascending: false }).limit(50),
      sb.from('foto').select('*').eq('autore_id', uid).order('creato_il', { ascending: false }).limit(60),
      sb.from('attivita').select('*').eq('proprietario_id', uid).order('nome'),
    ]);
    st.profile = p.data;
    st.mine = (m.data || []).map((r) => norm(r));
    st.myPhotos = f.data || [];
    st.myBiz = b.data || [];
    if (isAdmin()) {
      const [q, qf, u, ab] = await Promise.all([
        sb.from('posts').select('*').eq('stato', 'in_attesa').order('creato_il'),
        sb.from('foto').select('*').eq('stato', 'in_attesa').order('creato_il'),
        sb.from('profiles').select('id,nome_visualizzato,ruolo,fidato').order('nome_visualizzato'),
        sb.from('attivita').select('*').order('nome'),
      ]);
      st.queue = (q.data || []).map((r) => norm(r));
      st.queueFoto = qf.data || [];
      st.users = u.data || [];
      st.allBiz = ab.data || [];
    }
  } catch (e) { console.error(e); }
}

async function refresh() {
  await Promise.all([loadPublic(), loadPrivate()]);
  st.ready = true; st.loadedAt = Date.now();
  render();
}

const findPost = (id) => [...st.events, ...st.alerts, ...st.mine, ...st.queue].find((p) => p.id === id);
const findBiz = (id) => [...st.biz, ...st.allBiz, ...st.myBiz].find((b) => b.id === id);
const nomeUtente = (id) => st.users.find((u) => u.id === id)?.nome_visualizzato || 'Residente';
const pendenti = () => st.queue.length + st.queueFoto.length;

async function geocode(address, place) {
  const tentativi = [address && address + ', Roma', place && place + ', Torresina, Roma'].filter(Boolean);
  for (const q of tentativi) {
    try {
      const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it'
        + '&viewbox=12.36,41.95,12.44,41.91&q=' + encodeURIComponent(q);
      const j = await (await fetch(u, { headers: { 'Accept-Language': 'it' } })).json();
      if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon };
    } catch {}
  }
  return null;
}

function msgErrore(e) {
  const m = (e && e.message) || String(e || '');
  if (/regolamento/i.test(m)) return 'Accetta il regolamento prima di pubblicare.';
  if (/titolo/i.test(m)) return 'Il titolo deve avere almeno 3 caratteri.';
  if (/evento_ha_(data|luogo)/.test(m)) return 'Completa data e luogo prima di approvare.';
  if (/payload too large|exceeded the maximum/i.test(m)) return 'La foto è troppo grande.';
  if (/non è una foto|non leggibile/i.test(m)) return m;
  if (/fetch|network/i.test(m)) return 'Sembra che tu sia offline. Riprova tra poco.';
  return 'Qualcosa non ha funzionato. Riprova.';
}
function msgAuth(e) {
  const m = (e && e.message) || '';
  if (/invalid login credentials/i.test(m)) return 'Email o password non corretti.';
  if (/email not confirmed/i.test(m)) return 'Prima conferma la tua email: apri il link che ti abbiamo mandato.';
  if (/rate limit/i.test(m)) return "Troppi tentativi: riprova tra un po'.";
  if (/password.*(6|8|characters|weak)/i.test(m)) return 'La password è troppo debole: usa almeno 8 caratteri, con lettere e numeri.';
  if (/not authorized/i.test(m)) return "Questo indirizzo non può ricevere email: va configurato l'invio (SMTP).";
  if (/signups? not allowed/i.test(m)) return 'Le nuove registrazioni sono disattivate.';
  if (/already registered/i.test(m)) return 'Questa email è già registrata: accedi o recupera la password.';
  return 'Operazione non riuscita: ' + m;
}

/* =====================================================================
   Pezzi di interfaccia
   ===================================================================== */
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

// Campi dei moduli
const inp = (id, label, v = '', extra = '') => `<label class="field"><span>${label}</span><input id="${id}" value="${esc(v ?? '')}" ${extra}></label>`;
const area = (id, label, v = '', extra = '') => `<label class="field"><span>${label}</span><textarea id="${id}" ${extra}>${esc(v ?? '')}</textarea></label>`;
const chk = (id, label, on, sub = '') => `<div class="box"><label class="check"><input id="${id}" type="checkbox" ${on ? 'checked' : ''}><span><b>${label}</b>${sub ? '<br><small>' + sub + '</small>' : ''}</span></label></div>`;
const seg = (name, opts, cur, label = '') => `<div class="seg" role="group" aria-label="${label}">${opts.map(([v, l]) => `<button type="button" data-action="seg" data-seg="${name}" data-val="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
const segVal = (name) => document.querySelector(`[data-seg="${name}"][aria-pressed="true"]`)?.dataset.val;

function picker(key, label, pathEsistente) {
  const f = files[key];
  const src = f?.url || (!f?.rimuovi && pathEsistente ? urlFoto(pathEsistente, true) : null);
  return `<div class="field"><span>${label}</span>
  <div class="picker" id="pk-${key}">${src ? `<img src="${esc(src)}" alt="">` : '<em>Nessuna foto</em>'}</div>
  <input type="file" accept="image/*" id="file-${key}" data-key="${key}" hidden>
  <div class="btn-row ${src ? '' : 'one'}"><button type="button" class="btn secondary" data-action="pick" data-key="${key}">${src ? 'Cambia foto' : 'Scegli foto'}</button>
  ${src ? `<button type="button" class="btn ghost" data-action="unpick" data-key="${key}">Rimuovi</button>` : ''}</div></div>`;
}
// Restituisce il nuovo path (carica se serve), null se rimossa, undefined se invariata
async function salvaPicker(key, pathVecchio) {
  const f = files[key];
  if (!f) return undefined;
  if (f.file) { const r = await caricaFoto(f.file); if (pathVecchio) rimuoviFile(pathVecchio); return r; }
  if (f.rimuovi) { if (pathVecchio) rimuoviFile(pathVecchio); return null; }
  return undefined;
}
function pulisciPicker(...keys) { keys.forEach((k) => { if (files[k]?.url) URL.revokeObjectURL(files[k].url); delete files[k]; }); }

function evCard(p) {
  const s = new Date(p.start);
  return `<button class="ev" data-action="open" data-id="${p.id}"><span class="datebox"><span class="d">${s.getDate()}</span><span class="m">${fMon.format(s).replace('.', '')}</span></span>
  <span class="ev-txt"><b>${esc(p.title)}</b><small>${cap(fWeekday.format(s))}, ${fTime.format(s)}</small><small>${esc(p.place || '')}</small></span>
  ${p.foto ? `<img class="ev-img" src="${esc(urlFoto(p.foto, true))}" alt="" loading="lazy">` : ''}</button>`;
}
function alertRow(p) {
  return `<button class="alert ${p.urgent ? '' : 'info'}" data-action="open" data-id="${p.id}"><span class="dot"></span>
  <span><b>${esc(p.title)}</b><small>${p.urgent ? 'Urgente, ' : ''}${since(p.start)}</small></span></button>`;
}
function promoCard(p) {
  const b = findBiz(p.attivita_id);
  const img = p.foto_path || b?.foto_path;
  return `<button class="promo" data-action="open-biz" data-id="${p.attivita_id}">
  ${img ? `<img src="${esc(urlFoto(img, true))}" alt="" loading="lazy">` : '<span class="promo-ph">%</span>'}
  <span><b>${esc(p.titolo)}</b><small>${esc(b?.nome || '')}</small>${p.valida_fino ? `<small>Fino al ${fDate.format(parseKey(p.valida_fino))}</small>` : ''}</span></button>`;
}
function bizCard(b) {
  const offerte = promos().filter((p) => p.attivita_id === b.id).length;
  return `<button class="biz" data-action="open-biz" data-id="${b.id}">
  ${b.foto_path ? `<img src="${esc(urlFoto(b.foto_path, true))}" alt="" loading="lazy">` : `<span class="biz-ph">${esc(b.nome.charAt(0))}</span>`}
  <span class="biz-txt"><b>${esc(b.nome)}</b><small>${esc(b.categoria)}${b.tipo === 'servizio' ? ' · Servizio' : ''}</small>
  ${b.orari ? `<small>${esc(b.orari)}</small>` : ''}
  <span class="badges">${inEvidenza(b) ? '<span class="tag">In evidenza</span>' : ''}${offerte ? `<span class="tag alert">${offerte === 1 ? '1 offerta' : offerte + ' offerte'}</span>` : ''}</span></span></button>`;
}
const thumb = (f) => `<button class="thumb" data-action="open-foto" data-id="${f.id}"><img src="${esc(urlFoto(f.path, true))}" alt="${esc(f.didascalia || 'Foto del quartiere')}" loading="lazy"></button>`;
const offlineNote = () => (st.offline ? `<p class="offline">Sei offline: stai vedendo gli ultimi dati salvati.</p>` : '');

/* ---------- Accesso ---------- */
function loginBox(msg) {
  const m = loginMode;
  const modi = [['password', 'Accedi'], ['registrati', 'Registrati'], ['link', 'Link via email']];
  let corpo = '';
  if (m === 'password') {
    corpo = `${inp('l-email', 'Email', '', 'type="email" autocomplete="email" inputmode="email"')}
    ${inp('l-pass', 'Password', '', 'type="password" autocomplete="current-password"')}
    <p class="err" id="l-err" role="alert"></p>
    <button class="btn primary block" data-action="login-pass">Accedi</button>
    <button class="link" data-action="login-mode" data-mode="reset">Password dimenticata?</button>`;
  } else if (m === 'registrati') {
    corpo = `${inp('l-name', 'Il tuo nome sulla bacheca', '', 'maxlength="40" autocomplete="nickname" placeholder="Es. Giulia R."')}
    ${inp('l-email', 'Email', '', 'type="email" autocomplete="email" inputmode="email"')}
    ${inp('l-pass', 'Password (almeno 8 caratteri)', '', 'type="password" autocomplete="new-password" minlength="8"')}
    <label class="check"><input id="l-privacy" type="checkbox"><span>Ho letto l'<a href="/privacy.html" target="_blank" rel="noopener">informativa privacy</a> e il regolamento.</span></label>
    <p class="err" id="l-err" role="alert"></p>
    <button class="btn primary block" data-action="signup">Crea l'account</button>`;
  } else if (m === 'link') {
    corpo = `${inp('l-email', 'Email', '', 'type="email" autocomplete="email" inputmode="email"')}
    <p class="err" id="l-err" role="alert"></p>
    <button class="btn primary block" data-action="login-link">Inviami il link di accesso</button>
    <p class="hint">Ti arriva un link: lo apri da questo telefono e sei dentro, senza password.</p>`;
  } else {
    corpo = `<p>Inserisci la tua email: ti mandiamo un link per scegliere una nuova password.</p>
    ${inp('l-email', 'Email', '', 'type="email" autocomplete="email" inputmode="email"')}
    <p class="err" id="l-err" role="alert"></p>
    <button class="btn primary block" data-action="reset-pass">Inviami il link</button>
    <button class="link" data-action="login-mode" data-mode="password">Torna all'accesso</button>`;
  }
  return `<div class="note login"><p>${msg}</p>
  ${m === 'reset' ? '' : `<div class="seg" role="group" aria-label="Modo di accesso">${modi.map(([k, l]) => `<button type="button" data-action="login-mode" data-mode="${k}" aria-pressed="${k === m}">${l}</button>`).join('')}</div>`}
  ${corpo}</div>`;
}

/* =====================================================================
   Viste
   ===================================================================== */
function vHome() {
  const today = startOfToday();
  const up = st.events.filter((p) => new Date(p.end || p.start) >= today).slice(0, 3);
  const al = st.alerts.slice(0, 5);
  const pr = promos().slice(0, 6);
  const ga = st.gallery.slice(0, 6);
  const cm = comms();
  const pend = isAdmin() ? pendenti() : 0;
  return `<header class="hero"><h1 class="wordmark">Torresina</h1><p>Avvisi, eventi e attività del quartiere, tutti in un posto.</p>${SKYLINE}</header>
  ${offlineNote()}
  ${cm.map((c) => `<button class="comm ${c.livello}" data-action="open-comm" data-id="${c.id}"><b>${esc(c.titolo)}</b><span>${LIVELLI[c.livello]}</span></button>`).join('')}
  ${pend ? `<button class="banner" data-action="go-admin" data-tab="coda"><b>${pend === 1 ? '1 contenuto da approvare' : pend + ' contenuti da approvare'}</b><span>Apri</span></button>` : ''}
  <section class="section"><div class="section-head"><h2>Avvisi</h2></div>
  ${al.length ? `<div class="stack">${al.map(alertRow).join('')}</div>` : `<p class="note">Nessun avviso al momento.</p>`}</section>
  <section class="section"><div class="section-head"><h2>Prossimi eventi</h2><button class="link" data-action="go" data-view="eventi">Calendario</button></div>
  ${up.length ? `<div class="stack">${up.map(evCard).join('')}</div>` : `<p class="note">Nessun evento in programma. <button class="link" data-action="go" data-view="proponi">Proponi il primo</button></p>`}</section>
  ${pr.length ? `<section class="section"><div class="section-head"><h2>Offerte del quartiere</h2><button class="link" data-action="go" data-view="attivita">Attività</button></div>
  <div class="rail">${pr.map(promoCard).join('')}</div></section>` : ''}
  <section class="section"><div class="section-head"><h2>Foto del quartiere</h2>${ga.length ? '<button class="link" data-action="go" data-view="galleria">Vedi tutte</button>' : ''}</div>
  ${ga.length ? `<div class="gallery">${ga.map(thumb).join('')}</div>` : `<p class="note">Ancora nessuna foto. <button class="link" data-action="add-foto">Aggiungi la prima</button></p>`}</section>`;
}

function vEventi() {
  const { y, m, sel } = cal;
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const byDay = {};
  st.events.forEach((p) => { const k = dayKey(new Date(p.start)); (byDay[k] = byDay[k] || []).push(p); });
  const todayK = oggiKey();
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
    ${loginBox('Per proporre eventi, avvisi e foto serve un account del quartiere. Per leggere invece non serve registrarsi.')}`;
  }
  const direct = isTrusted();
  const t = form.type;
  const today = oggiKey();
  const serveNome = !st.profile || st.profile.nome_visualizzato === 'Residente';
  const sh = form.share;
  const eventiRecenti = st.events.filter((p) => new Date(p.start) > new Date(Date.now() - 60 * 864e5)).slice(-30).reverse();
  let campi;
  if (t === 'foto') {
    campi = `${picker('proponi', 'Foto')}
    <label class="field"><span>Didascalia <em>(facoltativa)</em></span><input id="f-caption" maxlength="200" placeholder="Es. Tramonto dal parco"></label>
    <label class="field"><span>È di un evento? <em>(facoltativo)</em></span><select id="f-post"><option value="">Nessun evento</option>
    ${eventiRecenti.map((p) => `<option value="${p.id}">${esc(p.title)} – ${fDate.format(new Date(p.start))}</option>`).join('')}</select></label>
    <p class="hint">Niente volti riconoscibili di persone che non hanno dato il consenso, né targhe.</p>`;
  } else {
    campi = `<label class="field"><span>Titolo</span><input id="f-title" maxlength="80" autocomplete="off" placeholder="${t === 'evento' ? 'Es. Castagnata nel parco' : 'Es. Lampione spento sul vialetto'}"></label>
    ${t === 'evento' ? `<label class="field"><span>Giorno</span><input id="f-date" type="date" min="${today}"></label>
    <div class="row2"><label class="field"><span>Inizio</span><input id="f-start" type="time" value="17:00"></label><label class="field"><span>Fine <em>(facoltativa)</em></span><input id="f-end" type="time"></label></div>`
    : `<div class="box"><label class="check"><input id="f-urgent" type="checkbox"><span><b>Urgente</b><br><small>Solo per pericoli o problemi che riguardano tutti adesso.</small></span></label></div>`}
    <label class="field"><span>Dove${t === 'evento' ? '' : ' <em>(facoltativo)</em>'}</span><input id="f-place" autocomplete="off" placeholder="Es. Area verde di Torresina 2"></label>
    <label class="field"><span>Indirizzo per la mappa <em>(facoltativo)</em></span><input id="f-address" autocomplete="off" placeholder="Via e numero civico"></label>
    <label class="field"><span>Descrizione</span><textarea id="f-desc" maxlength="2000" placeholder="${t === 'evento' ? 'Cosa si fa, per chi è, cosa portare.' : 'Cosa succede e dove, senza nomi o targhe.'}"></textarea></label>
    ${picker('proponi', 'Foto <em>(facoltativa)</em>')}`;
  }
  return `<header class="pagehead"><h1>Proponi</h1><p class="sub">${direct ? 'Verrà pubblicato subito.' : 'Un admin lo controlla prima di pubblicarlo, di solito in giornata.'}</p></header>
  ${sh ? `<div class="box"><b>Dal post che hai condiviso</b><br><small class="hint">${sh.campi ? 'Ho compilato i campi leggendo il post: controllali prima di inviare.' : sh.soloLink ? 'Facebook ha passato solo il link: scrivi due righe su cosa succede.' : 'Controlla e completa i campi.'}</small></div>` : ''}
  <div class="seg" role="group" aria-label="Cosa vuoi proporre"><button data-action="ftype" data-type="evento" aria-pressed="${t === 'evento'}">Evento</button><button data-action="ftype" data-type="avviso" aria-pressed="${t === 'avviso'}">Avviso</button><button data-action="ftype" data-type="foto" aria-pressed="${t === 'foto'}">Foto</button></div>
  ${serveNome ? `<label class="field"><span>Il tuo nome sulla bacheca</span><input id="f-name" maxlength="40" autocomplete="nickname" placeholder="Es. Giulia R."></label>` : ''}
  ${campi}
  <label class="check"><input id="f-rules" type="checkbox" ${st.profile?.regolamento_accettato_il ? 'checked' : ''}><span>Rispetto il regolamento: niente nomi, targhe o volti riconoscibili.</span></label>
  <button class="link" data-action="rules">Leggi il regolamento</button>
  <p class="err" id="f-err" role="alert"></p>
  <button class="btn primary block" data-action="submit">${direct ? 'Pubblica' : 'Invia per approvazione'}</button>`;
}

function vAttivita() {
  const lista = st.biz.filter((b) => bizFilter === 'tutte' || b.tipo === bizFilter);
  const pr = promos();
  return `<header class="pagehead"><h1>Attività</h1><p class="sub">Negozi, servizi e offerte del quartiere.</p></header>
  ${offlineNote()}
  ${pr.length ? `<section class="section" style="margin-top:0"><div class="section-head"><h2>Offerte in corso</h2></div><div class="rail">${pr.map(promoCard).join('')}</div></section>` : ''}
  <div class="chips" role="group" aria-label="Filtro">${[['tutte', 'Tutte'], ['attivita', 'Negozi e attività'], ['servizio', 'Servizi']].map(([k, l]) => `<button class="chip" data-action="bizfilter" data-val="${k}" aria-pressed="${k === bizFilter}">${l}</button>`).join('')}</div>
  ${lista.length ? `<div class="stack">${lista.map(bizCard).join('')}</div>` : `<p class="note">Nessuna scheda ${bizFilter === 'servizio' ? 'di servizi' : ''} per ora.</p>`}
  <p class="note" style="margin-top:16px"><b>Hai un'attività a Torresina?</b><br>Scrivi agli admin: creiamo la tua scheda e potrai aggiornare orari e offerte da qui, dal tuo Profilo.</p>`;
}

function vGalleria() {
  return `<header class="pagehead"><h1>Foto del quartiere</h1><p class="sub">Scatti dei residenti, approvati dagli admin.</p></header>
  <button class="btn primary block" data-action="add-foto" style="margin-bottom:16px">Aggiungi una foto</button>
  ${st.gallery.length ? `<div class="gallery">${st.gallery.map(thumb).join('')}</div>` : '<p class="note">Ancora nessuna foto.</p>'}`;
}

function qCard(p) {
  return `<article class="card"><div class="card-top"><span class="tag ${p.type === 'avviso' ? 'alert' : ''}">${p.type === 'evento' ? 'Evento' : (p.urgent ? 'Avviso urgente' : 'Avviso')}</span><small>${p.fonte !== 'app' ? FONTI[p.fonte] : "Dall'app"}</small></div>
  ${p.fonte !== 'app' && p.fonte !== 'condivisione' ? `<p class="src"><span class="src-badge">${FONTI[p.fonte]}</span> Compilato dall'AI${p.ai != null && p.ai < 0.7 ? ': <b>controlla i dati</b>' : ''}</p>` : ''}
  ${p.foto ? `<img class="card-img" src="${esc(urlFoto(p.foto, true))}" alt="">` : ''}
  <h3>${esc(p.title)}</h3>
  <p class="meta">${p.type === 'evento' ? when(p) + '<br>' + (p.place ? esc(p.place) : '<b class="miss">Luogo da completare</b>') : 'Inviato ' + since(p.created)}</p>
  <p>${esc(p.desc)}</p>
  ${p.fonteUrl ? `<p><a class="link" href="${esc(p.fonteUrl)}" target="_blank" rel="noopener">Apri il post originale</a></p>` : ''}
  <div class="btn-row"><button class="btn secondary" data-action="edit" data-id="${p.id}">Modifica</button><button class="btn primary" data-action="approve" data-id="${p.id}">Approva</button></div>
  <button class="btn ghost block" data-action="reject" data-id="${p.id}">Rifiuta</button></article>`;
}
function qFoto(f) {
  return `<article class="card"><div class="card-top"><span class="tag ok">Foto</span><small>da ${esc(nomeUtente(f.autore_id))}</small></div>
  <img class="card-img big" src="${esc(urlFoto(f.path, true))}" alt="">
  ${f.didascalia ? `<p>${esc(f.didascalia)}</p>` : ''}
  <div class="btn-row"><button class="btn ghost" data-action="foto-reject" data-id="${f.id}">Rifiuta</button><button class="btn primary" data-action="foto-approve" data-id="${f.id}">Approva</button></div></article>`;
}

function vAdmin() {
  if (!isAdmin()) return `<p class="note" style="margin-top:30px">Questa sezione è solo per gli admin.</p>`;
  const tabs = [['coda', `Da approvare${pendenti() ? ' (' + pendenti() + ')' : ''}`], ['comunicazioni', 'Pop-up'], ['attivita', 'Attività'], ['utenti', 'Utenti']];
  let corpo = '';
  if (adminTab === 'coda') {
    corpo = pendenti() ? `<div class="stack">${st.queue.map(qCard).join('')}${st.queueFoto.map(qFoto).join('')}</div>` : '<p class="note">Niente da approvare.</p>';
  } else if (adminTab === 'comunicazioni') {
    const ora = new Date();
    const statoC = (c) => (!c.attiva ? 'Spenta' : new Date(c.inizio) > ora ? 'Programmata' : c.fine && new Date(c.fine) <= ora ? 'Scaduta' : 'Attiva');
    corpo = `<p class="hint" style="margin-top:0">Compaiono all'apertura dell'app e in cima alla Bacheca, per interruzioni e avvisi importanti.</p>
    <button class="btn primary block" data-action="comm-form" style="margin:12px 0 16px">Nuova comunicazione</button>
    ${st.commsAll.length ? `<div class="stack">${st.commsAll.map((c) => `<button class="mine" data-action="comm-form" data-id="${c.id}"><span><b>${esc(c.titolo)}</b><small>${LIVELLI[c.livello]} · dal ${fDate.format(new Date(c.inizio))}${c.fine ? ' al ' + fDate.format(new Date(c.fine)) : ''}</small></span><span class="tag ${statoC(c) === 'Attiva' ? 'ok' : ''}">${statoC(c)}</span></button>`).join('')}</div>` : '<p class="note">Nessuna comunicazione.</p>'}`;
  } else if (adminTab === 'attivita') {
    corpo = `<button class="btn primary block" data-action="biz-form" style="margin-bottom:16px">Nuova attività o servizio</button>
    ${st.allBiz.length ? `<div class="stack">${st.allBiz.map((b) => `<div class="card"><div class="card-top"><b>${esc(b.nome)}</b><span class="tag ${b.visibile ? 'ok' : ''}">${b.visibile ? 'Visibile' : 'Nascosta'}</span></div>
    <p class="meta">${esc(b.categoria)}${b.tipo === 'servizio' ? ' · Servizio' : ''}${b.proprietario_id ? ' · Titolare: ' + esc(nomeUtente(b.proprietario_id)) : ''}${inEvidenza(b) ? ' · In evidenza' : ''}</p>
    <div class="btn-row"><button class="btn secondary" data-action="biz-form" data-id="${b.id}">Modifica</button><button class="btn secondary" data-action="promo-list" data-id="${b.id}">Offerte (${st.promosAll.filter((p) => p.attivita_id === b.id).length})</button></div></div>`).join('')}</div>` : '<p class="note">Nessuna scheda.</p>'}`;
  } else {
    corpo = `<div class="card"><p class="hint" style="margin:0 0 6px">I fidati pubblicano senza attesa. Puoi sempre nascondere un post dopo.</p>
    ${st.users.filter((u) => u.ruolo !== 'admin').map((u) => `<label class="user-row"><span>${esc(u.nome_visualizzato)}<small>${u.fidato ? 'Pubblica subito' : 'Serve approvazione'}</small></span>
    <input type="checkbox" data-action="toggle-fidato" data-id="${u.id}" ${u.fidato ? 'checked' : ''} aria-label="Fidato: ${esc(u.nome_visualizzato)}"></label>`).join('') || '<p class="hint">Ancora nessun residente registrato.</p>'}</div>
    <p class="hint">Admin: ${st.users.filter((u) => u.ruolo === 'admin').map((u) => esc(u.nome_visualizzato)).join(', ')}. Gli admin si nominano dal database.</p>`;
  }
  return `<header class="pagehead"><button class="link" data-action="go" data-view="profilo">← Profilo</button><h1>Gestione</h1></header>
  <div class="chips" role="group" aria-label="Sezioni">${tabs.map(([k, l]) => `<button class="chip" data-action="admin-tab" data-tab="${k}" aria-pressed="${k === adminTab}">${l}</button>`).join('')}</div>
  ${corpo}`;
}

function myRow(p) {
  const [l, c] = STATUS[p.status];
  return `<button class="mine" data-action="open" data-id="${p.id}"><span><b>${esc(p.title)}</b><small>${p.type === 'evento' ? when(p) : 'Avviso, ' + since(p.created)}</small>
  ${p.status === 'rifiutato' && p.motivo ? `<span class="motivo">${esc(p.motivo)}</span>` : ''}</span><span class="tag ${c}">${l}</span></button>`;
}

function vProfilo() {
  if (!st.session) {
    return `<header class="pagehead"><h1>Profilo</h1></header>${loginBox('Accedi per proporre eventi, avvisi e foto e seguire i tuoi post.')}
    <p class="links"><a href="/privacy.html">Privacy, regolamento e termini</a></p>`;
  }
  const p = st.profile || {};
  const ruolo = isAdmin() ? 'Admin' : p.fidato ? 'Residente fidato' : 'Residente';
  return `<header class="pagehead"><h1>Profilo</h1><p class="sub">${esc(st.session.user.email)} · ${ruolo}</p></header>
  ${isAdmin() ? `<button class="banner" data-action="go-admin" data-tab="coda" style="margin-top:0"><b>Gestione${pendenti() ? ': ' + pendenti() + ' da approvare' : ''}</b><span>Apri</span></button>` : ''}
  <div class="box">${inp('p-name', 'Nome sulla bacheca', p.nome_visualizzato || '', 'maxlength="40"')}
  <button class="btn secondary block" data-action="save-name">Salva nome</button></div>
  ${st.myBiz.length ? `<section class="section"><div class="section-head"><h2>${st.myBiz.length === 1 ? 'La tua attività' : 'Le tue attività'}</h2></div>
  <div class="stack">${st.myBiz.map((b) => `<div class="card"><div class="card-top"><b>${esc(b.nome)}</b><span class="tag ${b.visibile ? 'ok' : ''}">${b.visibile ? 'Visibile' : 'In revisione'}</span></div>
  <div class="btn-row"><button class="btn secondary" data-action="biz-form" data-id="${b.id}">Modifica scheda</button><button class="btn secondary" data-action="promo-list" data-id="${b.id}">Offerte</button></div></div>`).join('')}</div></section>` : ''}
  <section class="section"><div class="section-head"><h2>I miei post</h2></div>
  ${st.mine.length ? `<div class="stack">${st.mine.map(myRow).join('')}</div>` : `<p class="note">Non hai ancora proposto nulla. <button class="link" data-action="go" data-view="proponi">Proponi un evento</button></p>`}</section>
  ${st.myPhotos.length ? `<section class="section"><div class="section-head"><h2>Le mie foto</h2></div>
  <div class="gallery">${st.myPhotos.map((f) => `<button class="thumb" data-action="open-foto" data-id="${f.id}"><img src="${esc(urlFoto(f.path, true))}" alt="" loading="lazy">${f.stato !== 'approvato' ? `<span class="tag ${STATUS[f.stato][1]}">${STATUS[f.stato][0]}</span>` : ''}</button>`).join('')}</div></section>` : ''}
  <section class="section"><div class="section-head"><h2>Account</h2></div>
  <div class="stack"><button class="mine" data-action="pass-form"><span><b>Imposta o cambia password</b><small>Per entrare anche senza link via email</small></span></button>
  <a class="mine" href="/privacy.html"><span><b>Privacy, regolamento e termini</b><small>Come usiamo i tuoi dati</small></span></a>
  <button class="mine" data-action="logout"><span><b>Esci</b></span></button>
  <button class="mine danger" data-action="delete-account"><span><b>Elimina il mio account</b><small>Cancella profilo, post e foto</small></span></button></div></section>`;
}

const VIEWS = { home: vHome, eventi: vEventi, proponi: vProponi, attivita: vAttivita, profilo: vProfilo, galleria: vGalleria, admin: vAdmin };
const TAB_DI = { galleria: 'home', admin: 'profilo' };

function render() {
  if (!st.ready) return;
  if (view === 'proponi') keepForm();
  $('main').innerHTML = VIEWS[view]();
  if (view === 'proponi') restoreForm();
  const tab = TAB_DI[view] || view;
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.view === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  const n = isAdmin() ? pendenti() : 0;
  const b = $('badge'); b.hidden = !n; b.textContent = n;
}
function go(v) { view = v; render(); window.scrollTo(0, 0); }

/* =====================================================================
   Pannello (sheet)
   ===================================================================== */
const sheet = $('sheet'), scrim = $('scrim');
let lastFocus = null;
let onClose = null;
const closeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const sheetTop = (tag, cls = '') => `<div class="grab"></div><div class="sheet-top"><span class="tag ${cls}">${tag}</span><button class="iconbtn" data-action="close" aria-label="Chiudi">${closeIcon}</button></div>`;

function openSheet(html, chiusura = null) {
  if (sheet.classList.contains('open')) { if (mappa) { mappa.remove(); mappa = null; } }
  else lastFocus = document.activeElement;
  onClose = chiusura;
  sheet.innerHTML = html; sheet.scrollTop = 0;
  sheet.classList.add('open'); scrim.classList.add('open');
  sheet.querySelector('[data-action="close"]')?.focus();
}
function closeSheet() {
  if (!sheet.classList.contains('open')) return;
  if (mappa) { mappa.remove(); mappa = null; }
  editing = null;
  const cb = onClose; onClose = null;
  sheet.classList.remove('open'); scrim.classList.remove('open');
  lastFocus?.focus?.();
  if (cb) cb();
}

function mountMap(lat, lng) {
  const el = $('map');
  if (!el || !window.L || lat == null) return;
  mappa = L.map(el, { zoomControl: false, scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false }).setView([lat, lng], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mappa);
  L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [26, 26], iconAnchor: [13, 26] }) }).addTo(mappa);
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
  const fotoEvento = st.gallery.filter((f) => f.post_id === p.id);
  const bottoni = [
    hasPlace ? `<a class="btn primary" href="${mapsUrl(placeQuery(p))}" target="_blank" rel="noopener">Portami lì</a>` : '',
    ev && !past && p.start ? `<button class="btn secondary" data-action="ics" data-id="${p.id}">Aggiungi al calendario</button>` : '',
  ].filter(Boolean);
  const mio = st.mine.some((x) => x.id === p.id);
  openSheet(`${sheetTop(tag, ev ? '' : 'alert')}
  ${p.foto ? `<img class="hero-img" src="${esc(urlFoto(p.foto))}" alt="">` : ''}
  <h2 class="sheet-title" id="sheet-title">${esc(p.title)}</h2>
  <p class="meta"><b>${ev ? when(p) : 'Pubblicato ' + since(p.start || p.created)}</b>${p.author ? '<br>da ' + esc(p.author) : ''}</p>
  ${hasPlace ? `<div class="place">${p.lat != null ? '<div class="leaflet-map" id="map"></div>' : ''}<div class="place-txt"><b>${esc(p.place || p.address)}</b><span>${esc(p.address && p.place ? p.address : 'Torresina, Roma')}</span></div></div>` : ''}
  ${bottoni.length ? `<div class="btn-row ${bottoni.length === 1 ? 'one' : ''}">${bottoni.join('')}</div>` : '<div style="height:14px"></div>'}
  <p class="desc">${esc(p.desc)}</p>
  ${ev && pub ? `<section class="section" style="margin-top:8px"><div class="section-head"><h2>Foto dell'evento</h2></div>
  ${fotoEvento.length ? `<div class="gallery">${fotoEvento.map(thumb).join('')}</div>` : ''}
  <button class="btn secondary block" data-action="add-foto" data-post="${p.id}" style="margin-top:10px">Aggiungi una foto</button></section>` : ''}
  ${p.fonteUrl && pub ? `<p><a class="link" href="${esc(p.fonteUrl)}" target="_blank" rel="noopener">Vedi il post originale su ${FONTI[p.fonte] || 'social'}</a></p>` : ''}
  ${pub ? `<button class="btn secondary block" data-action="share" data-id="${p.id}" style="margin-top:12px">Condividi</button>`
    : `<p class="note">Stato: ${STATUS[p.status][0].toLowerCase()}. Solo tu e gli admin vedete questo post.</p>`}
  ${mio && p.status === 'in_attesa' ? `<button class="btn ghost block" data-action="withdraw" data-id="${p.id}">Ritira il post</button>` : ''}
  ${isAdmin() && pub ? `<button class="btn ghost block" data-action="edit" data-id="${p.id}">Modifica</button><button class="btn ghost block" data-action="hide" data-id="${p.id}">Nascondi dalla bacheca</button>` : ''}`);
  mountMap(p.lat, p.lng);
}

function openBiz(id) {
  const b = findBiz(id);
  if (!b) return;
  const pr = (isAdmin() || b.proprietario_id === st.session?.user?.id ? st.promosAll : promos()).filter((p) => p.attivita_id === id);
  const contatti = [
    b.indirizzo || b.nome ? `<a class="btn primary" href="${mapsUrl(b.indirizzo ? b.indirizzo + ', Roma' : b.nome + ', Torresina, Roma')}" target="_blank" rel="noopener">Portami lì</a>` : '',
    b.telefono ? `<a class="btn secondary" href="${telUrl(b.telefono)}">Chiama</a>` : '',
    b.whatsapp ? `<a class="btn secondary" href="${waUrl(b.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : '',
    b.sito ? `<a class="btn secondary" href="${esc(webUrl(b.sito))}" target="_blank" rel="noopener">Sito web</a>` : '',
    b.instagram ? `<a class="btn secondary" href="${esc(igUrl(b.instagram))}" target="_blank" rel="noopener">Instagram</a>` : '',
    b.email ? `<a class="btn secondary" href="mailto:${esc(b.email)}">Email</a>` : '',
  ].filter(Boolean);
  const puoModificare = isAdmin() || b.proprietario_id === st.session?.user?.id;
  openSheet(`${sheetTop(b.tipo === 'servizio' ? 'Servizio' : 'Attività', 'ok')}
  ${b.foto_path ? `<img class="hero-img" src="${esc(urlFoto(b.foto_path))}" alt="">` : ''}
  <h2 class="sheet-title" id="sheet-title">${esc(b.nome)}</h2>
  <p class="meta"><b>${esc(b.categoria)}</b>${b.indirizzo ? '<br>' + esc(b.indirizzo) : ''}</p>
  ${b.orari ? `<p class="box"><b>Orari</b><br>${esc(b.orari)}</p>` : ''}
  ${b.descrizione ? `<p class="desc">${esc(b.descrizione)}</p>` : ''}
  ${pr.length ? `<section class="section" style="margin-top:8px"><div class="section-head"><h2>Offerte</h2></div><div class="stack">${pr.map((p) => `<div class="offer-card">
  ${p.foto_path ? `<img src="${esc(urlFoto(p.foto_path, true))}" alt="">` : ''}<div><b>${esc(p.titolo)}</b>${p.descrizione ? `<p>${esc(p.descrizione)}</p>` : ''}
  <small>${p.valida_fino ? 'Valida fino al ' + fDate.format(parseKey(p.valida_fino)) : 'Senza scadenza'}${promoAttiva(p) ? '' : ' · non visibile'}</small></div></div>`).join('')}</div></section>` : ''}
  ${b.lat != null ? '<div class="place" style="margin-top:16px"><div class="leaflet-map" id="map"></div></div>' : ''}
  <div class="contacts">${contatti.join('')}</div>
  ${puoModificare ? `<div class="btn-row"><button class="btn secondary" data-action="biz-form" data-id="${b.id}">Modifica scheda</button><button class="btn secondary" data-action="promo-list" data-id="${b.id}">Gestisci offerte</button></div>` : ''}`);
  mountMap(b.lat, b.lng);
}

function openFoto(id) {
  const f = st.gallery.find((x) => x.id === id) || st.myPhotos.find((x) => x.id === id);
  if (!f) return;
  const ev = f.post_id ? findPost(f.post_id) : null;
  const mia = f.autore_id ? f.autore_id === st.session?.user?.id : st.myPhotos.some((x) => x.id === id);
  openSheet(`${sheetTop('Foto', 'ok')}
  <img class="full-img" src="${esc(urlFoto(f.path))}" alt="${esc(f.didascalia || '')}">
  ${f.didascalia ? `<p class="desc" style="margin-top:12px">${esc(f.didascalia)}</p>` : ''}
  <p class="meta">${f.autore ? 'di ' + esc(f.autore) + ' · ' : ''}${since(f.creato_il)}</p>
  ${ev ? `<button class="btn secondary block" data-action="open" data-id="${ev.id}">Vai all'evento: ${esc(ev.title)}</button>` : ''}
  ${isAdmin() ? `<button class="btn ghost block" data-action="foto-reject" data-id="${f.id}">Nascondi dalla galleria</button>` : ''}
  ${mia ? `<button class="btn ghost block" data-action="foto-delete" data-id="${f.id}">Elimina la mia foto</button>` : ''}`);
}

function openComm(id) {
  const c = st.commsAll.find((x) => x.id === id);
  if (!c) return;
  openSheet(`${sheetTop(LIVELLI[c.livello], c.livello === 'info' ? 'ok' : 'alert')}
  <h2 class="sheet-title" id="sheet-title">${esc(c.titolo)}</h2>
  <p class="desc">${esc(c.testo)}</p>
  <p class="meta">${c.fine ? 'Fino a ' + fDay.format(new Date(c.fine)) + ', ' + fTime.format(new Date(c.fine)) : ''}</p>
  <button class="btn primary block" data-action="close">Ho capito</button>`, () => segnaVista(c));
}

function openRules() {
  openSheet(`${sheetTop('Regolamento', 'ok')}<h2 class="sheet-title" id="sheet-title">Poche regole, per stare bene tutti</h2>${RULES}
  <p><a class="link" href="/privacy.html">Leggi informativa privacy e termini</a></p>`);
}

/* ---------- Moduli degli admin ---------- */
function openEdit(id) {
  const p = st.queue.find((x) => x.id === id) || findPost(id);
  if (!p) return;
  editing = p;
  pulisciPicker('edit');
  const s = p.start && p.type === 'evento' ? new Date(p.start) : null;
  const e = p.end ? new Date(p.end) : null;
  openSheet(`${sheetTop(p.status === 'approvato' ? 'Modifica' : 'Modifica prima di approvare')}
  <h2 class="sheet-title" id="sheet-title">Controlla i dati</h2>
  ${p.orig ? `<details class="orig"><summary>Testo originale${p.fonte !== 'app' ? ' da ' + FONTI[p.fonte] : ''}</summary><p>${esc(p.orig)}</p></details>` : ''}
  ${seg('e-tipo', [['evento', 'Evento'], ['avviso', 'Avviso']], p.type, 'Tipo')}
  ${inp('e-title', 'Titolo', p.title, 'maxlength="80"')}
  <div data-show="e-tipo:evento" ${p.type === 'evento' ? '' : 'hidden'}>
    ${inp('e-date', 'Giorno', s ? dayKey(s) : '', 'type="date"')}
    <div class="row2">${inp('e-start', 'Inizio', s ? hm(s) : '', 'type="time"')}${inp('e-end', 'Fine', e ? hm(e) : '', 'type="time"')}</div>
  </div>
  <div data-show="e-tipo:avviso" ${p.type === 'avviso' ? '' : 'hidden'}>${chk('e-urgent', 'Urgente', p.urgent)}</div>
  ${inp('e-place', 'Dove', p.place)}
  ${inp('e-address', 'Indirizzo', p.address)}
  ${area('e-desc', 'Descrizione', p.desc, 'maxlength="2000"')}
  ${picker('edit', 'Foto', p.foto)}
  <p class="err" id="e-err" role="alert"></p>
  <div class="btn-row">${p.status === 'approvato' ? `<button class="btn primary" data-action="edit-save" style="grid-column:1/-1">Salva</button>`
    : `<button class="btn secondary" data-action="edit-save">Salva</button><button class="btn primary" data-action="edit-approve">Salva e approva</button>`}</div>`, () => pulisciPicker('edit'));
}

function openReject(id, tipo = 'post') {
  openSheet(`${sheetTop('Rifiuta', 'no')}
  <h2 class="sheet-title" id="sheet-title">Perché non lo pubblichi?</h2>
  <p class="hint" style="margin-top:0">Chi l'ha scritto vede il motivo nei suoi post. Facoltativo.</p>
  ${area('r-motivo', 'Motivo', '', 'maxlength="300" placeholder="Es. Contiene il nome di una persona"')}
  <button class="btn danger block" data-action="reject-confirm" data-id="${id}" data-tipo="${tipo}">Rifiuta</button>`);
}

function openCommForm(id) {
  const c = id ? st.commsAll.find((x) => x.id === id) : null;
  editing = c;
  openSheet(`${sheetTop(c ? 'Modifica comunicazione' : 'Nuova comunicazione', 'alert')}
  <h2 class="sheet-title" id="sheet-title">Pop-up all'avvio</h2>
  ${seg('c-livello', [['info', 'Info'], ['importante', 'Importante'], ['urgente', 'Urgente']], c?.livello || 'importante', 'Livello')}
  <p class="hint" style="margin-top:-6px">Le urgenti ricompaiono ogni 12 ore finché sono attive; le altre una volta sola.</p>
  ${inp('c-titolo', 'Titolo', c?.titolo, 'maxlength="80" placeholder="Es. Acqua sospesa martedì 8–14"')}
  ${area('c-testo', 'Testo', c?.testo, 'maxlength="1000"')}
  <div class="row2">${inp('c-inizio', 'Dal', toLocalInput(c?.inizio || new Date().toISOString()), 'type="datetime-local"')}${inp('c-fine', 'Al <em>(facoltativo)</em>', toLocalInput(c?.fine), 'type="datetime-local"')}</div>
  ${chk('c-attiva', 'Attiva', c ? c.attiva : true)}
  <p class="err" id="c-err" role="alert"></p>
  <button class="btn primary block" data-action="comm-save">Salva</button>
  ${c ? `<button class="btn ghost block" data-action="comm-delete" data-id="${c.id}">Elimina</button>` : ''}`);
}

function openBizForm(id) {
  const b = id ? findBiz(id) : null;
  editing = b;
  pulisciPicker('biz');
  const admin = isAdmin();
  openSheet(`${sheetTop(b ? 'Modifica scheda' : 'Nuova scheda', 'ok')}
  <h2 class="sheet-title" id="sheet-title">${b ? esc(b.nome) : 'Attività o servizio'}</h2>
  ${admin ? seg('b-tipo', [['attivita', 'Attività'], ['servizio', 'Servizio']], b?.tipo || 'attivita', 'Tipo') : ''}
  ${inp('b-nome', 'Nome', b?.nome, 'maxlength="80"')}
  ${inp('b-categoria', 'Categoria', b?.categoria, 'list="categorie" maxlength="40"')}
  <datalist id="categorie">${CATEGORIE.map((c) => `<option value="${c}">`).join('')}</datalist>
  ${area('b-descrizione', 'Descrizione', b?.descrizione, 'maxlength="800"')}
  ${inp('b-orari', 'Orari', b?.orari, 'placeholder="Es. Lun–sab 8:30–13 e 16–19:30"')}
  ${inp('b-indirizzo', 'Indirizzo', b?.indirizzo, 'placeholder="Via e numero civico"')}
  <div class="row2">${inp('b-telefono', 'Telefono', b?.telefono, 'type="tel"')}${inp('b-whatsapp', 'WhatsApp', b?.whatsapp, 'type="tel"')}</div>
  ${inp('b-sito', 'Sito web', b?.sito, 'inputmode="url"')}
  <div class="row2">${inp('b-instagram', 'Instagram', b?.instagram, 'placeholder="@nome"')}${inp('b-email', 'Email', b?.email, 'type="email"')}</div>
  ${picker('biz', 'Foto', b?.foto_path)}
  ${admin ? `${chk('b-visibile', 'Visibile nell\'app', b ? b.visibile : true)}
  ${inp('b-evidenza', 'In evidenza fino al <em>(facoltativo)</em>', b?.in_evidenza_fino, 'type="date"')}
  <label class="field"><span>Titolare <em>(può aggiornare scheda e offerte)</em></span><select id="b-titolare"><option value="">Nessuno</option>
  ${st.users.map((u) => `<option value="${u.id}" ${u.id === b?.proprietario_id ? 'selected' : ''}>${esc(u.nome_visualizzato)}</option>`).join('')}</select></label>` : ''}
  <p class="err" id="b-err" role="alert"></p>
  <button class="btn primary block" data-action="biz-save">Salva</button>
  ${b && admin ? `<button class="btn ghost block" data-action="biz-delete" data-id="${b.id}">Elimina la scheda</button>` : ''}`, () => pulisciPicker('biz'));
}

function openPromoList(bizId) {
  const b = findBiz(bizId);
  const lista = st.promosAll.filter((p) => p.attivita_id === bizId);
  openSheet(`${sheetTop('Offerte', 'alert')}
  <h2 class="sheet-title" id="sheet-title">${esc(b?.nome || '')}</h2>
  <button class="btn primary block" data-action="promo-form" data-biz="${bizId}" style="margin-bottom:14px">Nuova offerta</button>
  ${lista.length ? `<div class="stack">${lista.map((p) => `<button class="mine" data-action="promo-form" data-biz="${bizId}" data-id="${p.id}"><span><b>${esc(p.titolo)}</b>
  <small>${p.valida_fino ? 'Fino al ' + fDate.format(parseKey(p.valida_fino)) : 'Senza scadenza'}</small></span><span class="tag ${promoAttiva(p) ? 'ok' : ''}">${promoAttiva(p) ? 'Visibile' : p.attiva ? 'Non ancora / scaduta' : 'Spenta'}</span></button>`).join('')}</div>` : '<p class="note">Nessuna offerta.</p>'}`);
}

function openPromoForm(bizId, id) {
  const p = id ? st.promosAll.find((x) => x.id === id) : null;
  editing = { bizId, promo: p };
  pulisciPicker('promo');
  openSheet(`${sheetTop(p ? 'Modifica offerta' : 'Nuova offerta', 'alert')}
  <h2 class="sheet-title" id="sheet-title">${esc(findBiz(bizId)?.nome || 'Offerta')}</h2>
  ${inp('o-titolo', 'Titolo', p?.titolo, 'maxlength="80" placeholder="Es. 10% ai residenti con l\'app"')}
  ${area('o-descrizione', 'Dettagli', p?.descrizione, 'maxlength="600"')}
  <div class="row2">${inp('o-dal', 'Dal', p?.valida_dal || oggiKey(), 'type="date"')}${inp('o-al', 'Al <em>(facoltativo)</em>', p?.valida_fino, 'type="date"')}</div>
  ${picker('promo', 'Immagine <em>(facoltativa)</em>', p?.foto_path)}
  ${chk('o-attiva', 'Attiva', p ? p.attiva : true)}
  <p class="err" id="o-err" role="alert"></p>
  <button class="btn primary block" data-action="promo-save">Salva</button>
  ${p ? `<button class="btn ghost block" data-action="promo-delete" data-id="${p.id}">Elimina l'offerta</button>` : ''}`, () => pulisciPicker('promo'));
}

function openPassForm(recupero = false) {
  openSheet(`${sheetTop('Password', 'ok')}
  <h2 class="sheet-title" id="sheet-title">${recupero ? 'Scegli una nuova password' : 'Imposta la password'}</h2>
  ${inp('np-1', 'Nuova password (almeno 8 caratteri)', '', 'type="password" autocomplete="new-password"')}
  ${inp('np-2', 'Ripetila', '', 'type="password" autocomplete="new-password"')}
  <p class="err" id="np-err" role="alert"></p>
  <button class="btn primary block" data-action="pass-save">Salva password</button>`);
}

/* =====================================================================
   Azioni
   ===================================================================== */
function busy(btn, on, testo) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = testo || 'Un attimo…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

const FORM_IDS = ['f-name', 'f-title', 'f-date', 'f-start', 'f-end', 'f-place', 'f-address', 'f-desc', 'f-caption', 'f-post'];
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
function nuovoForm(f) { form = f; if (view === 'proponi') $('main').innerHTML = ''; pulisciPicker('proponi'); }

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

const emailValida = (e) => /^\S+@\S+\.\S+$/.test(e);

async function loginPass(btn) {
  const email = val('l-email'), pass = $('l-pass')?.value || '';
  const err = $('l-err');
  if (!emailValida(email) || !pass) { err.textContent = 'Inserisci email e password.'; return; }
  busy(btn, true, 'Accesso…');
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  busy(btn, false);
  if (error) { err.textContent = msgAuth(error); return; }
  toast('Bentornato!');
}
async function signup(btn) {
  const nome = val('l-name'), email = val('l-email'), pass = $('l-pass')?.value || '';
  const err = $('l-err');
  if (nome.length < 2) { err.textContent = 'Scrivi il nome da mostrare, anche solo nome e iniziale.'; return; }
  if (!emailValida(email)) { err.textContent = "Controlla l'indirizzo email."; return; }
  if (pass.length < 8) { err.textContent = 'La password deve avere almeno 8 caratteri.'; return; }
  if (!checked('l-privacy')) { err.textContent = "Per registrarti accetta l'informativa privacy."; return; }
  busy(btn, true, 'Creazione…');
  const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { name: nome }, emailRedirectTo: location.origin + '/' } });
  busy(btn, false);
  if (error) { err.textContent = msgAuth(error); return; }
  if (data.session) { toast('Account creato'); return; }
  btn.closest('.login').innerHTML = `<p><b>Controlla la tua email.</b></p><p>Abbiamo mandato un link di conferma a ${esc(email)}. Aprilo e poi accedi con la tua password.</p>`;
}
async function loginLink(btn) {
  const email = val('l-email');
  const err = $('l-err');
  if (!emailValida(email)) { err.textContent = "Controlla l'indirizzo email."; return; }
  busy(btn, true, 'Invio in corso…');
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + '/' } });
  busy(btn, false);
  if (error) { err.textContent = msgAuth(error); return; }
  btn.closest('.login').innerHTML = `<p><b>Controlla la tua email.</b></p><p>Abbiamo mandato un link a ${esc(email)}. Aprilo da questo telefono per entrare.</p>`;
}
async function resetPass(btn) {
  const email = val('l-email');
  const err = $('l-err');
  if (!emailValida(email)) { err.textContent = "Controlla l'indirizzo email."; return; }
  busy(btn, true, 'Invio in corso…');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' });
  busy(btn, false);
  if (error) { err.textContent = msgAuth(error); return; }
  btn.closest('.login').innerHTML = `<p><b>Controlla la tua email.</b></p><p>Se ${esc(email)} è registrata, ti arriva un link per scegliere una nuova password.</p>`;
}
async function salvaPassword(btn) {
  const a = $('np-1').value, b = $('np-2').value;
  const err = $('np-err');
  if (a.length < 8) { err.textContent = 'Almeno 8 caratteri.'; return; }
  if (a !== b) { err.textContent = 'Le due password non coincidono.'; return; }
  busy(btn, true);
  const { error } = await sb.auth.updateUser({ password: a });
  busy(btn, false);
  if (error) { err.textContent = msgAuth(error); return; }
  closeSheet(); toast('Password salvata');
}

async function aggiornaProfilo(nome) {
  const upd = {};
  if (!st.profile?.regolamento_accettato_il) upd.regolamento_accettato_il = new Date().toISOString();
  if (nome) upd.nome_visualizzato = nome;
  if (!Object.keys(upd).length) return;
  const { error } = await sb.from('profiles').update(upd).eq('id', st.session.user.id);
  if (error) throw error;
  Object.assign(st.profile || (st.profile = {}), upd);
}

async function submit(btn) {
  const t = form.type;
  const err = (m) => { $('f-err').textContent = m; };
  const name = $('f-name') ? val('f-name') : '';
  if ($('f-name') && name.length < 2) return err('Scrivi il nome da mostrare, anche solo nome e iniziale.');

  if (t === 'foto') {
    if (!files.proponi?.file) return err('Scegli una foto.');
    if (!checked('f-rules')) return err('Conferma di rispettare il regolamento.');
    busy(btn, true, 'Caricamento…');
    try {
      await aggiornaProfilo(name);
      const up = await caricaFoto(files.proponi.file);
      const { data, error } = await sb.from('foto').insert({ path: up.path, larghezza: up.w, altezza: up.h, didascalia: val('f-caption') || null, post_id: val('f-post') || null }).select().single();
      if (error) { rimuoviFile(up.path); throw error; }
      nuovoForm({ type: 'foto', v: {}, share: null });
      await refresh();
      toast(data.stato === 'approvato' ? 'Foto pubblicata' : 'Foto inviata: la vedi in Profilo finché non viene approvata');
      go(data.stato === 'approvato' ? 'galleria' : 'profilo');
    } catch (e) { console.error(e); err(msgErrore(e)); } finally { busy(btn, false); }
    return;
  }

  const title = val('f-title'), place = val('f-place'), address = val('f-address'), desc = val('f-desc');
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
    await aggiornaProfilo(name);
    const [pos, up] = await Promise.all([
      place || address ? geocode(address, place) : null,
      files.proponi?.file ? caricaFoto(files.proponi.file) : null,
    ]);
    const row = {
      tipo: t, titolo: title, descrizione: desc, urgente: t === 'avviso' && checked('f-urgent'),
      inizio: start, fine: end, luogo: place || null, indirizzo: address || null,
      lat: pos?.lat ?? null, lng: pos?.lng ?? null, foto_path: up?.path || null,
    };
    if (form.share) { row.fonte = 'condivisione'; row.fonte_url = form.share.url || null; }
    const { data, error } = await sb.from('posts').insert(row).select().single();
    if (error) { if (up) rimuoviFile(up.path); throw error; }
    nuovoForm({ type: t, v: {}, share: null });
    await refresh();
    if (data.stato === 'approvato') {
      toast('Pubblicato');
      if (t === 'evento') { const s = new Date(start); cal = { y: s.getFullYear(), m: s.getMonth(), sel: dayKey(s) }; go('eventi'); } else go('home');
    } else {
      toast('Inviato: lo trovi in Profilo finché non viene approvato');
      go('profilo');
    }
  } catch (e) { console.error(e); err(msgErrore(e)); } finally { busy(btn, false); }
}

async function setStato(tabella, id, stato, motivo) {
  const upd = tabella === 'posts' ? { stato, motivo_rifiuto: motivo ?? null } : { stato };
  const { error } = await sb.from(tabella).update(upd).eq('id', id);
  if (error) { console.error(error); toast(msgErrore(error)); return false; }
  await refresh();
  return true;
}

async function saveEdit(btn, approva) {
  const p = editing;
  if (!p) return;
  const tipo = segVal('e-tipo') || p.type;
  const err = (m) => { $('e-err').textContent = m; };
  const title = val('e-title'), place = val('e-place'), address = val('e-address'), desc = val('e-desc');
  if (title.length < 3) return err('Titolo troppo corto.');
  if (!desc) return err('Manca la descrizione.');
  let inizio = null, fine = null;
  if (tipo === 'evento') {
    const d = val('e-date'), s = val('e-start'), e = val('e-end');
    if ((approva || p.status === 'approvato') && (!d || !s)) return err('Per un evento pubblicato servono giorno e ora.');
    if ((approva || p.status === 'approvato') && !place) return err('Per un evento pubblicato serve il luogo.');
    if (d && s) {
      const sd = new Date(d + 'T' + s); inizio = sd.toISOString();
      if (e) { const ed = new Date(d + 'T' + e); if (ed > sd) fine = ed.toISOString(); }
    }
  }
  busy(btn, true);
  try {
    const cambiato = place !== (p.place || '') || address !== (p.address || '') || p.lat == null;
    const [pos, foto] = await Promise.all([cambiato && (place || address) ? geocode(address, place) : null, salvaPicker('edit', p.foto)]);
    const upd = {
      tipo, titolo: title, descrizione: desc, inizio, fine,
      urgente: tipo === 'avviso' && checked('e-urgent'), luogo: place || null, indirizzo: address || null,
    };
    if (pos) { upd.lat = pos.lat; upd.lng = pos.lng; }
    if (foto !== undefined) upd.foto_path = foto ? foto.path : null;
    if (approva) { upd.stato = 'approvato'; upd.motivo_rifiuto = null; }
    const { error } = await sb.from('posts').update(upd).eq('id', p.id);
    if (error) throw error;
    closeSheet();
    await refresh();
    toast(approva ? 'Approvato e pubblicato' : 'Modifiche salvate');
  } catch (e) { console.error(e); err(msgErrore(e)); } finally { busy(btn, false); }
}

async function saveComm(btn) {
  const err = (m) => { $('c-err').textContent = m; };
  const titolo = val('c-titolo'), testo = val('c-testo');
  if (titolo.length < 3) return err('Titolo troppo corto.');
  if (!testo) return err('Scrivi il testo.');
  const inizio = fromLocalInput(val('c-inizio')) || new Date().toISOString();
  const fine = fromLocalInput(val('c-fine'));
  if (fine && fine <= inizio) return err('La fine deve venire dopo l\'inizio.');
  const row = { titolo, testo, livello: segVal('c-livello') || 'info', inizio, fine, attiva: checked('c-attiva') };
  busy(btn, true);
  const q = editing ? sb.from('comunicazioni').update(row).eq('id', editing.id) : sb.from('comunicazioni').insert(row);
  const { error } = await q;
  busy(btn, false);
  if (error) return err(msgErrore(error));
  closeSheet(); await refresh(); toast('Comunicazione salvata');
}

async function saveBiz(btn) {
  const b = editing;
  const err = (m) => { $('b-err').textContent = m; };
  const nome = val('b-nome'), categoria = val('b-categoria');
  if (nome.length < 2) return err('Scrivi il nome.');
  if (!categoria) return err('Scegli o scrivi una categoria.');
  const row = {
    nome, categoria, descrizione: val('b-descrizione') || null, orari: val('b-orari') || null,
    indirizzo: val('b-indirizzo') || null, telefono: val('b-telefono') || null, whatsapp: val('b-whatsapp') || null,
    sito: val('b-sito') || null, instagram: val('b-instagram') || null, email: val('b-email') || null,
  };
  if (isAdmin()) {
    row.tipo = segVal('b-tipo') || 'attivita';
    row.visibile = checked('b-visibile');
    row.in_evidenza_fino = val('b-evidenza') || null;
    row.proprietario_id = val('b-titolare') || null;
  }
  busy(btn, true);
  try {
    if (row.indirizzo && (row.indirizzo !== b?.indirizzo || b?.lat == null)) {
      const pos = await geocode(row.indirizzo, null);
      if (pos) { row.lat = pos.lat; row.lng = pos.lng; }
    } else if (!row.indirizzo) { row.lat = null; row.lng = null; }
    const foto = await salvaPicker('biz', b?.foto_path);
    if (foto !== undefined) row.foto_path = foto ? foto.path : null;
    const { error } = b ? await sb.from('attivita').update(row).eq('id', b.id) : await sb.from('attivita').insert(row);
    if (error) throw error;
    closeSheet(); await refresh(); toast('Scheda salvata');
  } catch (e) { console.error(e); err(msgErrore(e)); } finally { busy(btn, false); }
}

async function savePromo(btn) {
  const { bizId, promo } = editing || {};
  const err = (m) => { $('o-err').textContent = m; };
  const titolo = val('o-titolo');
  if (titolo.length < 3) return err('Titolo troppo corto.');
  const dal = val('o-dal') || oggiKey(), al = val('o-al') || null;
  if (al && al < dal) return err('La data di fine viene prima dell\'inizio.');
  const row = { attivita_id: bizId, titolo, descrizione: val('o-descrizione') || null, valida_dal: dal, valida_fino: al, attiva: checked('o-attiva') };
  busy(btn, true);
  try {
    const foto = await salvaPicker('promo', promo?.foto_path);
    if (foto !== undefined) row.foto_path = foto ? foto.path : null;
    const { error } = promo ? await sb.from('promozioni').update(row).eq('id', promo.id) : await sb.from('promozioni').insert(row);
    if (error) throw error;
    await refresh(); toast('Offerta salvata'); openPromoList(bizId);
  } catch (e) { console.error(e); err(msgErrore(e)); } finally { busy(btn, false); }
}

async function eliminaAccount() {
  if (!confirm('Vuoi davvero eliminare il tuo account? Profilo, post e foto verranno cancellati e non si potranno recuperare.')) return;
  if (!confirm('Ultima conferma: eliminare definitivamente l\'account?')) return;
  try {
    const r = await fetch('/api/elimina-account', { method: 'POST', headers: { Authorization: 'Bearer ' + st.session.access_token } });
    if (!r.ok) throw new Error('Eliminazione non riuscita');
    await sb.auth.signOut();
    toast('Account eliminato');
    go('home');
  } catch (e) { console.error(e); toast("Non è stato possibile eliminare l'account. Scrivi agli admin."); }
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

/* ---------- Pop-up all'avvio ---------- */
const VISTE_KEY = 'torresina-popup-visti';
function vistiPopup() { try { return JSON.parse(localStorage.getItem(VISTE_KEY) || '{}'); } catch { return {}; } }
function segnaVista(c) {
  const v = vistiPopup(); v[c.id] = Date.now();
  try { localStorage.setItem(VISTE_KEY, JSON.stringify(v)); } catch {}
}
function mostraPopup() {
  const v = vistiPopup();
  const ordine = { urgente: 0, importante: 1, info: 2 };
  const daMostrare = comms()
    .filter((c) => !v[c.id] || (c.livello === 'urgente' && Date.now() - v[c.id] > 12 * 3600e3))
    .sort((a, b) => ordine[a.livello] - ordine[b.livello]);
  if (daMostrare.length) openComm(daMostrare[0].id);
}

/* =====================================================================
   Eventi dell'interfaccia
   ===================================================================== */
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.type === 'file' && el.dataset.key) {
    const f = el.files?.[0];
    if (!f) return;
    const key = el.dataset.key;
    pulisciPicker(key);
    files[key] = { file: f, url: URL.createObjectURL(f) };
    const box = $('pk-' + key);
    if (box) box.innerHTML = `<img src="${files[key].url}" alt="">`;
    const row = el.parentElement.querySelector('.btn-row');
    if (row) {
      row.classList.remove('one');
      row.innerHTML = `<button type="button" class="btn secondary" data-action="pick" data-key="${key}">Cambia foto</button>
      <button type="button" class="btn ghost" data-action="unpick" data-key="${key}">Rimuovi</button>`;
    }
  }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !sb) return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  switch (a) {
    case 'go': closeSheet(); go(el.dataset.view); break;
    case 'go-admin': closeSheet(); adminTab = el.dataset.tab || 'coda'; go('admin'); break;
    case 'admin-tab': adminTab = el.dataset.tab; render(); break;
    case 'open': openDetail(id); break;
    case 'open-biz': openBiz(id); break;
    case 'open-foto': openFoto(id); break;
    case 'open-comm': openComm(id); break;
    case 'close': closeSheet(); break;
    case 'prev': cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } cal.sel = null; render(); break;
    case 'next': cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } cal.sel = null; render(); break;
    case 'today': { const d = new Date(); cal = { y: d.getFullYear(), m: d.getMonth(), sel: dayKey(d) }; render(); break; }
    case 'day': cal.sel = cal.sel === el.dataset.day ? null : el.dataset.day; render(); break;
    case 'clearday': cal.sel = null; render(); break;
    case 'bizfilter': bizFilter = el.dataset.val; render(); break;
    case 'seg': {
      document.querySelectorAll(`[data-seg="${el.dataset.seg}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      document.querySelectorAll(`[data-show^="${el.dataset.seg}:"]`).forEach((s) => { s.hidden = s.dataset.show !== el.dataset.seg + ':' + el.dataset.val; });
      break;
    }
    case 'ftype': keepForm(); form.type = el.dataset.type; render(); break;
    case 'add-foto': {
      closeSheet();
      if (view === 'proponi') keepForm();
      form.type = 'foto';
      if (el.dataset.post) form.v['f-post'] = el.dataset.post;
      go('proponi');
      break;
    }
    case 'pick': $('file-' + el.dataset.key)?.click(); break;
    case 'unpick': {
      const key = el.dataset.key;
      pulisciPicker(key);
      files[key] = { rimuovi: true };
      const box = $('pk-' + key);
      if (box) box.innerHTML = '<em>Nessuna foto</em>';
      el.remove();
      break;
    }
    case 'submit': submit(el); break;
    case 'rules': openRules(); break;
    case 'login-mode': loginMode = el.dataset.mode; render(); break;
    case 'login-pass': loginPass(el); break;
    case 'login-link': loginLink(el); break;
    case 'signup': signup(el); break;
    case 'reset-pass': resetPass(el); break;
    case 'pass-form': openPassForm(); break;
    case 'pass-save': salvaPassword(el); break;
    case 'logout': await sb.auth.signOut(); toast('Sei uscito'); break;
    case 'delete-account': eliminaAccount(); break;
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
      if (await setStato('posts', id, 'approvato')) toast('Approvato e pubblicato'); else busy(el, false);
      break;
    }
    case 'edit': openEdit(id); break;
    case 'edit-save': saveEdit(el, false); break;
    case 'edit-approve': saveEdit(el, true); break;
    case 'reject': openReject(id, 'posts'); break;
    case 'reject-confirm': {
      busy(el, true);
      if (await setStato(el.dataset.tipo, id, 'rifiutato', val('r-motivo') || null)) { closeSheet(); toast('Rifiutato'); } else busy(el, false);
      break;
    }
    case 'hide':
      if (!confirm('Nascondere questo post dalla bacheca?')) break;
      if (await setStato('posts', id, 'rifiutato', 'Rimosso da un admin')) { closeSheet(); toast('Post nascosto'); }
      break;
    case 'withdraw': {
      if (!confirm('Vuoi ritirare questo post?')) break;
      const p = findPost(id);
      const { error } = await sb.from('posts').delete().eq('id', id);
      if (error) toast(msgErrore(error)); else { if (p?.foto) rimuoviFile(p.foto); closeSheet(); await refresh(); toast('Post ritirato'); }
      break;
    }
    case 'foto-approve': busy(el, true); if (await setStato('foto', id, 'approvato')) toast('Foto pubblicata'); else busy(el, false); break;
    case 'foto-reject':
      if (!confirm('Togliere questa foto dalla galleria?')) break;
      if (await setStato('foto', id, 'rifiutato')) { closeSheet(); toast('Foto rifiutata'); }
      break;
    case 'foto-delete': {
      if (!confirm('Eliminare questa foto?')) break;
      const f = st.myPhotos.find((x) => x.id === id) || st.gallery.find((x) => x.id === id);
      const { error } = await sb.from('foto').delete().eq('id', id);
      if (error) toast(msgErrore(error)); else { if (f) rimuoviFile(f.path); closeSheet(); await refresh(); toast('Foto eliminata'); }
      break;
    }
    case 'toggle-fidato': {
      const { error } = await sb.from('profiles').update({ fidato: el.checked }).eq('id', id);
      if (error) { el.checked = !el.checked; toast(msgErrore(error)); }
      else { const u = st.users.find((x) => x.id === id); if (u) u.fidato = el.checked; toast(el.checked ? 'Ora pubblica senza attesa' : "Ora passa dall'approvazione"); render(); }
      break;
    }
    case 'comm-form': openCommForm(id); break;
    case 'comm-save': saveComm(el); break;
    case 'comm-delete': {
      if (!confirm('Eliminare questa comunicazione?')) break;
      const { error } = await sb.from('comunicazioni').delete().eq('id', id);
      if (error) toast(msgErrore(error)); else { closeSheet(); await refresh(); toast('Eliminata'); }
      break;
    }
    case 'biz-form': openBizForm(id); break;
    case 'biz-save': saveBiz(el); break;
    case 'biz-delete': {
      if (!confirm('Eliminare la scheda e tutte le sue offerte?')) break;
      const b = findBiz(id);
      const { error } = await sb.from('attivita').delete().eq('id', id);
      if (error) toast(msgErrore(error)); else { if (b?.foto_path) rimuoviFile(b.foto_path); closeSheet(); await refresh(); toast('Scheda eliminata'); }
      break;
    }
    case 'promo-list': openPromoList(id); break;
    case 'promo-form': openPromoForm(el.dataset.biz, id); break;
    case 'promo-save': savePromo(el); break;
    case 'promo-delete': {
      if (!confirm('Eliminare questa offerta?')) break;
      const p = st.promosAll.find((x) => x.id === id);
      const { error } = await sb.from('promozioni').delete().eq('id', id);
      if (error) toast(msgErrore(error)); else { if (p?.foto_path) rimuoviFile(p.foto_path); await refresh(); toast('Offerta eliminata'); openPromoList(p.attivita_id); }
      break;
    }
    case 'ics': { const p = findPost(id); if (p) scaricaIcs(p); break; }
    case 'share': { const p = findPost(id); if (p) share(p); break; }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet();
  if (e.key === 'Enter' && e.target.matches('#l-pass, #l-email') && loginMode !== 'registrati') {
    e.preventDefault();
    document.querySelector('.login .btn.primary')?.click();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && st.ready && Date.now() - st.loadedAt > 60000) refresh();
});

/* =====================================================================
   Avvio
   ===================================================================== */
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
  if (!sh) return false;
  const tipo = sh.campi?.tipo === 'avviso' ? 'avviso' : 'evento';
  nuovoForm({ type: tipo, v: sh.campi ? campiToForm(sh.campi) : {}, share: sh });
  if (!sh.campi && sh.testo) form.v['f-desc'] = sh.testo;
  if (!st.session) toast('Accedi per proporre il post condiviso');
  go('proponi');
  return true;
}

async function apriDaLink() {
  const pid = new URLSearchParams(location.search).get('p');
  if (!pid) return false;
  history.replaceState(null, '', '/');
  if (!findPost(pid)) {
    const { data } = await sb.from('posts').select('*').eq('id', pid).maybeSingle();
    if (data) { const p = norm(data); (p.type === 'evento' ? st.events : st.alerts).push(p); }
  }
  if (findPost(pid)) openDetail(pid); else toast('Questo post non è più disponibile');
  return true;
}

async function init() {
  if (!sb) {
    $('main').innerHTML = `<div class="setup"><h1 class="wordmark">Torresina</h1>
    <p class="note" style="margin-top:20px"><b>Manca la configurazione.</b><br>Inserisci URL e chiave anon del progetto Supabase in <code>public/js/config.js</code>, poi ricarica.</p></div>`;
    return;
  }
  const { data } = await sb.auth.getSession();
  st.session = data.session;
  sb.auth.onAuthStateChange((evento, session) => {
    if (evento === 'PASSWORD_RECOVERY') setTimeout(() => openPassForm(true), 0);
    const cambiato = (session?.user?.id || null) !== (st.session?.user?.id || null);
    st.session = session;
    if (cambiato && st.ready) {
      setTimeout(async () => {
        await loadPrivate();
        if (session && view === 'profilo') loginMode = 'password';
        render();
        await gestisciCondivisione();
      }, 0);
    }
  });
  await refresh();
  const condivisione = await gestisciCondivisione();
  const link = await apriDaLink();
  if (!condivisione && !link) mostraPopup();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
