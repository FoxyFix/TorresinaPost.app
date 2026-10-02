# Torresina, la bacheca del quartiere

PWA su Netlify + Supabase. I residenti propongono eventi e avvisi, gli admin approvano.
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
docs/prototipo.html      il prototipo con dati finti, utile per mostrare l'idea
netlify/functions/
  instagram-webhook.mjs  /api/instagram  menzioni di @account su Instagram
  facebook-pagina.mjs    ogni 30 min     post della Pagina con #tag e post che taggano la Pagina
  telegram-webhook.mjs   /api/telegram   messaggi con #tag o @bot nei gruppi autorizzati
  analizza.mjs           /api/analizza   testo condiviso → campi del modulo (solo utenti registrati)
netlify/lib/             codice condiviso: Supabase, estrazione con Claude, import
supabase/migrations/     001 schema base, 002 import dai social
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

## Cosa fa l'app

- **Bacheca**: avvisi (gli urgenti in evidenza) e prossimi eventi. Leggere non richiede account.
- **Eventi**: calendario mensile, tocchi un giorno e vedi cosa succede. Ogni evento ha mappa
  (OpenStreetMap), "Portami lì", "Aggiungi al calendario" (.ics) e "Condividi" con link diretto.
- **Proponi**: evento o avviso. L'indirizzo viene trasformato in coordinate per la mappa.
  I residenti fidati e gli admin pubblicano subito, gli altri passano dall'approvazione.
- **Profilo**: nome sulla bacheca, i miei post con stato e motivo del rifiuto.
  Per gli admin: coda da approvare (anche i post dai social), modifica prima di approvare,
  rifiuto con motivo, gestione degli utenti fidati, "Nascondi dalla bacheca".
- **Attività**: schede dalla tabella `attivita` (le inserisci dal pannello di Supabase,
  con `visibile = true`).

## Sviluppo in locale
```
npm install
npx netlify dev
```
Apri http://localhost:8888. Le funzioni `/api/*` usano le variabili del file `.env`.

## Costi
L'estrazione usa Claude Haiku: una chiamata breve per ogni post taggato.
Per un quartiere si parla di pochi centesimi al mese.

## Limiti da sapere
- Le funzioni Netlify sincrone hanno pochi secondi a disposizione: se un webhook va in timeout,
  Meta e Telegram riprovano e il controllo dei duplicati evita doppioni.
- Le foto dei social non vengono copiate: resta il link al post originale.
