# Torresina, la bacheca del quartiere

PWA su Netlify + Supabase. I residenti propongono eventi, avvisi e foto, gli admin approvano.
I post taggati sui social arrivano da soli nella coda "Da approvare", già compilati da Claude.

## Struttura

```
public/                  la PWA (HTML, CSS e JavaScript senza build)
  index.html             struttura della pagina
  css/app.css            colori cortina e travertino, chiaro e scuro
  js/config.js           URL e chiave anon di Supabase (da compilare)
  js/app.js              tutta la logica: bacheca, calendario, proponi, approvazioni
  js/condividi.js        legge ciò che arriva da Condividi e precompila Proponi
  sw.js                  funziona anche offline con gli ultimi dati visti
  manifest.webmanifest   installazione e "share_target" per Condividi da Android
  icons/                 icone dell'app
  privacy.html           informativa privacy, regolamento, termini
  vendor/, fonts/        librerie e font ospitati sul sito
docs/prototipo.html      il prototipo con dati finti, utile per mostrare l'idea
docs/APK.md              come trasformare la PWA in app Android
netlify/functions/
  instagram-webhook.mjs  /api/instagram  menzioni di @account su Instagram
  facebook-pagina.mjs    ogni 30 min     post della Pagina con #tag e post che taggano la Pagina
  telegram-webhook.mjs   /api/telegram   messaggi con #tag o @bot nei gruppi autorizzati
  analizza.mjs           /api/analizza   testo condiviso → campi del modulo (solo utenti registrati)
  elimina-account.mjs    /api/elimina-account  cancella account, post e foto dell'utente
  tieni-attivo.mjs       ogni giorno     evita la pausa del database gratuito
netlify/lib/             codice condiviso: Supabase, estrazione con Claude, import
supabase/migrations/     001 schema base, 002 import dai social, 003 attività, offerte, pop-up, galleria,
                         004 modifica dei propri contenuti, 005 sicurezza dei campi "fonte"
```

## Regole comuni a tutti i canali

- Niente viene pubblicato in automatico: ogni import entra come `in_attesa`.
- Claude legge il testo e compila tipo, titolo, descrizione, data, luogo. Se un dato manca lascia vuoto, non inventa.
  Scarta spam e post non pertinenti.
- Ogni post si importa una sola volta (`fonte` + `fonte_id` unici).
- Il testo originale lo vede solo l'admin e viene cancellato quando il post è approvato.
- Da Telegram non si salvano i nomi di chi scrive.

## Setup

### 1. Supabase
Nel SQL Editor esegui in ordine `001_schema.sql` e `002_import_social.sql`.
Poi nominati admin con il comando in fondo a `001_schema.sql`.

### 2. Accesso con link via email (Supabase Auth)
- Authentication → URL Configuration: *Site URL* = il dominio Netlify
  (es. `https://torresina.netlify.app`) e aggiungilo anche tra i *Redirect URLs*.
- Authentication → Providers: lascia attivo Email ("Magic Link").
- Consigliato: traduci in italiano il modello dell'email in Authentication → Email Templates.
- Il servizio email di prova di Supabase ha limiti bassi: per l'uso reale collega un SMTP
  (Authentication → SMTP Settings), per esempio quello del tuo dominio.

### 3. L'app
In `public/js/config.js` inserisci URL e chiave **anon** (Project Settings → API).
La chiave anon può stare nel browser: i permessi li decidono le regole RLS del database.

### 4. Netlify
Collega il repository e copia le variabili di `.env.example` in
Site configuration → Environment variables. La chiave `SUPABASE_SERVICE_ROLE_KEY`
serve solo alle funzioni: non va mai nel codice del browser.

### 5. Instagram (menzioni)
1. Account Instagram del quartiere di tipo Professionale, collegato a una Pagina Facebook.
2. Su developers.facebook.com crea un'app di tipo Business e aggiungi il prodotto Instagram
   (configurazione con Facebook Login) e i Webhooks.
3. Webhook dell'oggetto Instagram: URL `https://TUO-SITO.netlify.app/api/instagram`,
   token di verifica = `META_VERIFY_TOKEN`, iscriviti al campo `mentions`.
4. Genera un token di lunga durata della Pagina con i permessi per Instagram base,
   commenti e lettura della Pagina, e mettilo in `META_PAGE_TOKEN`.
   `IG_USER_ID` è l'id dell'account Instagram professionale.
5. Per un'app che gestisce solo i propri account basta l'accesso standard.
   Controlla comunque nella dashboard Meta i permessi richiesti dalla versione attuale dell'API.

Da quel momento: chi scrive `@account` in una didascalia o in un commento manda il post in coda.

### 6. Pagina Facebook
`FB_PAGE_ID` = id della Pagina. La funzione programmata importa i post della Pagina con uno dei
tag di `TAG_IMPORT` e i post pubblici che taggano la Pagina (se Meta concede l'accesso a quell'elenco:
in caso contrario lo trovi nei log e il resto continua a funzionare).

### 7. Gruppo Facebook → Condividi dal telefono
Il gruppo non è leggibile da nessuna app dal 2024. Su Android, con l'app installata, l'utente
tocca Condividi su un post e sceglie Torresina: si apre Proponi già compilato.
Se Facebook passa solo il link, l'utente aggiunge due righe. Su iPhone si incolla link o testo.

### 8. Telegram
1. Crea il bot con @BotFather, salva token e username.
2. In BotFather: `/setprivacy` → Disable, così il bot legge i messaggi del gruppo
   (importa comunque solo quelli con un tag o con la menzione del bot).
3. Aggiungi il bot al gruppo e metti l'id del gruppo in `TELEGRAM_CHAT_IDS`.
4. Registra il webhook:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://TUO-SITO.netlify.app/api/telegram \
     -d secret_token=<TELEGRAM_SECRET> \
     -d 'allowed_updates=["message","channel_post"]'
   ```

## Aggiornamento alla versione 2
1. Supabase → SQL Editor: esegui `supabase/migrations/003_funzioni_v2.sql` (una sola volta).
2. Netlify → Environment variables: aggiungi almeno `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`
   (Supabase → Project Settings → API Keys → chiave *secret*). Servono a "Elimina account" e alla funzione
   che tiene sveglio il database.
3. Supabase → Authentication → Sign In / Providers → Email: lascia attivo **Confirm email** e imposta
   la lunghezza minima della password a 8.
4. Completa i campi evidenziati in `public/privacy.html` (titolare, email, regione dei server, data).

## Cosa fa l'app

- **Bacheca**: avvisi (gli urgenti in evidenza) e prossimi eventi. Leggere non richiede account.
- **Eventi**: calendario mensile, tocchi un giorno e vedi cosa succede. Ogni evento ha mappa
  (OpenStreetMap), "Portami lì", "Aggiungi al calendario" (.ics) e "Condividi" con link diretto.
- **Proponi**: evento o avviso. L'indirizzo viene trasformato in coordinate per la mappa.
  I residenti fidati e gli admin pubblicano subito, gli altri passano dall'approvazione.
- **Profilo**: nome sulla bacheca, i miei post con stato e motivo del rifiuto.
  Per gli admin: coda da approvare (anche i post dai social), modifica prima di approvare,
  rifiuto con motivo, gestione degli utenti fidati, "Nascondi dalla bacheca".
- **Accesso**: email e password (con recupero password), oppure link via email. Registrazione con
  accettazione dell'informativa. In Profilo: imposta/cambia password, elimina account.
- **Foto**: negli eventi e negli avvisi, e una **galleria** del quartiere (anche collegata agli eventi).
  Le foto vengono ridotte nel telefono prima del caricamento (1600 px + miniatura 480 px) per stare
  dentro lo spazio gratuito. Le foto dei residenti normali passano dall'approvazione.
- **Attività e servizi**: schede con foto, orari, contatti (telefono, WhatsApp, sito, Instagram, email),
  mappa, filtro Negozi/Servizi, "in evidenza" fino a una data.
- **Offerte**: ogni attività può avere offerte con date di validità, mostrate in Bacheca e in Attività.
  Gli admin possono assegnare un **titolare** a una scheda: il titolare aggiorna scheda e offerte
  dal suo Profilo, ma non può renderla visibile o metterla in evidenza.
- **Pop-up all'avvio**: comunicazioni per interruzioni e avvisi importanti (info, importante, urgente),
  con data di inizio e fine. Le urgenti ricompaiono ogni 12 ore finché sono attive.
- **Gestione** (Profilo → Gestione, solo admin): coda da approvare (post e foto), pop-up, attività
  e offerte, utenti fidati.
- **Privacy**: `privacy.html` con informativa, regolamento, termini ed eliminazione account.
  Font e librerie sono ospitati sul sito: nessuna richiesta a Google Fonts o CDN esterni.

## Sviluppo in locale
```
npm install
npx netlify dev
```
Apri http://localhost:8888. Le funzioni `/api/*` usano le variabili del file `.env`.

## Limiti del piano gratuito di Supabase
- 50.000 utenti attivi al mese, database da 500 MB, 1 GB per le foto, 5 GB di traffico al mese.
  Per un quartiere sono ampi; il punto da tenere d'occhio sono le foto (1 GB ≈ alcune migliaia di
  foto compresse) e il traffico della galleria, per questo l'app usa le miniature.
- I progetti gratuiti vengono messi in pausa dopo 7 giorni senza attività: la funzione
  `tieni-attivo` (una lettura al giorno) lo evita.
- Le email: con il servizio di prova di Supabase sono pochissime all'ora. Serve l'SMTP (Gmail o Brevo).
- Controlla i consumi in Supabase → Organization → Usage.

## Modifica dei propri contenuti (004)
Esegui una volta `supabase/migrations/004_modifiche_residenti.sql`. Da quel momento:
- ogni residente può **modificare ed eliminare** i propri eventi, avvisi e foto (didascalia ed evento
  collegato), da Profilo → I miei post o dal dettaglio del contenuto;
- se un residente normale modifica un contenuto già pubblicato, questo **torna in approvazione**
  (così non si può far approvare un testo e poi cambiarlo); i fidati e gli admin restano pubblicati;
- un contenuto rifiutato, una volta corretto, torna in coda da approvare;
- le regole sono applicate dal database, non solo dall'app.

## Testata e grafica (redesign 02)
- Palette tramonto: terracotta `#B84E2E`, prugna `#6E394E`, oliva `#68723F`, crema `#FFF8F1`.
  Tutti i colori passano dalle variabili in `public/css/app.css` (tema chiaro e scuro).
- La testata usa `public/img/torresina-hero.jpg`, ricavata dal mockup del redesign (1380×236 px).
  Se l'immagine non si carica compare l'illustrazione `public/img/torresina-hero.svg`.
- Sfondo con colline, foglie e palazzi (in `index.html`, classe `.decor`), illustrazioni nelle card
  degli eventi scelte dal titolo (festa, moto, grigliata, musica, sport, bambini, verde, incontro).
- Per usare una foto vera al posto di quella del mockup:
  mettila in `public/img/` (consigliato: 1600 px di larghezza, JPEG sotto i 300 KB) e scrivi il percorso
  in `HERO_FOTO`, in cima alla sezione "Pezzi di interfaccia" di `public/js/app.js`.
  Se la foto è di terzi, indica autore e licenza nella sezione Crediti di `privacy.html`.

## App Android
Vedi `docs/APK.md`.

## Costi
L'estrazione usa Claude Haiku: una chiamata breve per ogni post taggato.
Per un quartiere si parla di pochi centesimi al mese.

## Limiti da sapere
- Le funzioni Netlify sincrone hanno pochi secondi a disposizione: se un webhook va in timeout,
  Meta e Telegram riprovano e il controllo dei duplicati evita doppioni.
- Le foto dei social non vengono copiate: resta il link al post originale.

## Sicurezza (005 e header)
- Esegui una volta `supabase/migrations/005_sicurezza_fonti.sql`: `fonte_url` accetta solo indirizzi http/https e i campi
  `fonte_*` li scrive solo il server, non l'utente.
- In `netlify.toml` ci sono gli header di sicurezza, compresa la **Content-Security-Policy**: gli script possono arrivare
  solo dal sito stesso. Se aggiungi un servizio esterno (mappe, analytics, font) e smette di funzionare, controlla la console
  del browser: l'errore dice quale voce della CSP aggiornare (`connect-src` per le chiamate, `img-src` per le immagini).
- Nel codice, ogni link che viene dai dati passa da `safeUrl()` in `app.js`. Non scrivere `onclick=`/`onerror=` nei modelli HTML:
  la CSP li blocca, usa `addEventListener`.
