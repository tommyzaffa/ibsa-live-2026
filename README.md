# Sottotitoli live · IBSA Foundation Forum 2026

Forum «Artificial Intelligence in Biomedicine», Aula Polivalente, Campus Est USI-SUPSI, Lugano,
**venerdì 6 novembre 2026**. Il relatore parla in inglese, il pubblico legge l'italiano sul telefono.

## Le pagine

| Indirizzo | Cosa fa |
|---|---|
| `/` | Pagina del pubblico: quattro righe di sottotitoli. Le parole nuove compaiono con una dissolvenza in basso, le righe sopra scorrono in su e sfumano in alto. |
| `/?qr=1` | Slide 16:9 con il QR code da proiettare a inizio giornata e dopo le pause (si stampa anche su un A4). |
| `/?demo=1` | Anteprima senza diretta: l'abstract italiano di Guidoboni scorre come in sala. Serve a far vedere la pagina prima del 6 novembre. |
| `/?screen=1` | Testo grande, per un eventuale schermo in sala. |
| `/regia/` | Regia protetta da password: intervento in programma, lingua, ingresso audio, nomi e glossario, Avvia / Ferma. |

## Dove gira

- **Server:** la funzione `ibsa-live` nel progetto Supabase del Merge (`luciaehqndzdeszdktzp`),
  accanto a `live-captions`. Usa le stesse tabelle, ma solo la sua sala (`ibsa`), la sua
  password e una firma di sessione sua: le due regie non possono aprirsi a vicenda.
- **Soniox:** la stessa chiave del Merge (`SONIOX_API_KEY`, già impostata nel progetto). Il browser
  della regia riceve solo chiavi temporanee monouso da 60 secondi.
- **Password della regia:** nel segreto `IBSA_LIVE_PASSWORD`, con una copia in
  `~/.ibsa-live-password` (chmod 600, fuori dal progetto). Per leggerla: `cat ~/.ibsa-live-password`.
- **Glossario:** `assets/js/programme.js`. Contiene tutti i nomi e le traduzioni presi dal sito
  dell'evento nelle due lingue (`/en/...` e `/it/...`, tradotto da professionisti), intervento
  per intervento. Una lista comune viene aggiunta a ogni avvio.

## Anteprima in locale

```
python3 -m http.server 4323
```
Poi apri `http://localhost:4323/?demo=1`, `/?qr=1` e `/regia/`. Il server accetta richieste da
`localhost:4323`, quindi anche la regia funziona davvero in locale (microfono compreso).

## Pubblicare il sito

1. Pubblica la cartella su GitHub Pages. `_config.yml` esclude `supabase/` e questo file.
2. Autorizza il nuovo indirizzo sul server (separa più indirizzi con una virgola):
   ```
   printf 'IBSA_LIVE_ORIGINS=%s\n' "https://INDIRIZZO-DEL-SITO" > /tmp/ibsa.env
   supabase secrets set --env-file /tmp/ibsa.env --project-ref luciaehqndzdeszdktzp && rm /tmp/ibsa.env
   ```
   L'origine è solo schema + dominio, senza percorso (`https://tommyzaffa.github.io`, non `/ibsa-live`).

## Aggiornare la funzione

```
supabase functions deploy ibsa-live --project-ref luciaehqndzdeszdktzp --no-verify-jwt
```
Lancialo dalla cartella del progetto. Serve che la CLI sia collegata all'account Supabase che
possiede il progetto del Merge: `supabase projects list` deve elencare "Merge Film Festival".

## Il 6 novembre

1. Portatile collegato via cavo a internet e alla corrente, con un'interfaccia audio USB
   collegata all'uscita del mixer.
2. Apri `/regia/`, accedi, premi «Rileva ingressi» e scegli l'interfaccia del mixer.
3. Proietta `/?qr=1` a inizio giornata e dopo ogni pausa.
4. Per ogni intervento scegli la voce in «Intervento in programma», controlla il titolo e premi
   **Avvia**. A fine intervento premi **Ferma**: il pubblico torna in attesa del prossimo.
5. Presentazioni orali: aggiungi nomi e titoli dei selezionati nei campi prima di avviare.
6. Se il collegamento cade, la regia riprova tre volte da sola. Altrimenti premi Ferma e poi Avvia.

Costo Soniox: circa 0,18 $ l'ora, quindi meno di 2 $ per tutta la giornata.
