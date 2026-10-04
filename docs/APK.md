# Da PWA ad app Android (APK)

L'app resta una sola: quella su Netlify. L'APK è un "guscio" (Trusted Web Activity) che la apre a schermo intero, con icona e nome nel telefono, senza barra del browser. Ogni aggiornamento pubblicato su Netlify arriva subito anche nell'app Android, senza ripubblicare l'APK.

## 1. Prima di iniziare
- L'app deve essere **pubblica** su Netlify (non "Private").
- Apri https://torresinapost.netlify.app su Chrome per Android e controlla che si installi ("Aggiungi a schermata Home"): se funziona, la PWA è pronta.

## 2. Generare il pacchetto con PWABuilder (senza installare nulla)
1. Vai su **pwabuilder.com**, incolla `https://torresinapost.netlify.app` e avvia l'analisi.
2. Scegli **Package for stores → Android**.
3. Opzioni consigliate:
   - Package ID: `app.torresinapost.twa` (non si può più cambiare dopo la pubblicazione)
   - App name: `Torresina` · Launcher name: `Torresina`
   - Theme color `#96462C` · Background `#EFE9DC`
   - Signing key: **Create new** (oppure usa una tua chiave esistente)
4. Scarica lo zip. Contiene:
   - un file **.apk** per provare l'app sul telefono;
   - un file **.aab** da caricare sul Play Store;
   - la **chiave di firma** (`signing.keystore`) e le sue password: **conservale in un posto sicuro**, senza quella non potrai più aggiornare l'app sullo Store;
   - il file **assetlinks.json**.

## 3. Togliere la barra del browser (assetlinks)
Senza questo passaggio l'app si apre con una barretta in alto con l'indirizzo.
1. Nel repository crea la cartella `public/.well-known/` e mettici il file `assetlinks.json` dello zip.
2. Commit & Push. Controlla che https://torresinapost.netlify.app/.well-known/assetlinks.json si apra.
3. Se pubblichi sul Play Store con "Firma delle app di Google Play", Google ri-firma l'app con una sua chiave: copia l'impronta **SHA-256** da Play Console → *Integrità app* e aggiungila nello stesso file, accanto a quella dello zip.

Esempio di struttura del file (i valori veri li dà PWABuilder):
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "app.torresinapost.twa",
    "sha256_cert_fingerprints": ["AA:BB:CC:..."]
  }
}]
```

## 4. Provare l'APK
Manda il file .apk al telefono, aprilo e consenti l'installazione da fonti sconosciute. Va bene per farla provare ad Alberto e a qualche vicino.

## 5. Pubblicare sul Play Store (facoltativo)
Requisiti principali (verifica quelli aggiornati in Play Console, cambiano spesso):
- Account sviluppatore Google Play, con quota una tantum.
- **Informativa privacy** raggiungibile da un link: `https://torresinapost.netlify.app/privacy.html` (completa prima i campi evidenziati).
- **Eliminazione dell'account** sia nell'app sia da web: in app c'è *Profilo → Elimina il mio account*, da web vale la sezione "Eliminare l'account" della pagina privacy.
- Modulo **Sicurezza dei dati**: dichiara email, nome, foto e contenuti pubblicati dagli utenti; nessuna condivisione per pubblicità.
- Per i nuovi account sviluppatore personali Google richiede un **test chiuso con un gruppo di tester per alcuni giorni** prima della pubblicazione: coinvolgi i vicini.

## Note
- "Condividi" verso l'app: nella versione installata da Chrome funziona già; nell'APK dipende dalle opzioni del pacchetto (PWABuilder lo legge dal manifest). Provalo dopo l'installazione.
- Se cambi dominio (es. `torresina.it`), va rigenerato il pacchetto e aggiornato `assetlinks.json`.
