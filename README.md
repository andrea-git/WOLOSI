# Workout Logbook Cloud

Logbook mobile-first con sincronizzazione cloud tra dispositivi.

## Come funziona

- `workout.json` contiene la scheda ed è statico.
- I log (kg, reps, RIR, note) vengono salvati in un unico JSON privato su **Vercel Blob**.
- `localStorage` resta solo come cache/fallback e per migrare i dati già presenti da versioni precedenti.
- Se il Blob remoto è ancora vuoto e sul dispositivo esistono dati locali, al primo avvio vengono caricati automaticamente nel cloud.
- Mobile e desktop leggono quindi lo stesso storico.
- Le ultime due sessioni restano filtrate per stesso giorno G1/G2/etc., come nella versione precedente.

## Pubblicazione su Vercel

1. Pubblica questa cartella come progetto Vercel.
2. Nel progetto Vercel crea/collega uno **Blob Store privato**.
3. Il progetto usa `@vercel/blob` e le Functions Vercel; sui nuovi store Vercel usa OIDC automaticamente.
4. Consigliato: in `Settings > Environment Variables` aggiungi:

   `LOGBOOK_PIN=un-pin-scelto-da-te`

   Se imposti il PIN, al primo accesso da ogni dispositivo l'app lo chiede una volta e lo conserva solo nel localStorage di quel browser.
5. Esegui un nuovo deploy dopo aver collegato Blob / aggiunto le variabili.

## Migrazione dei dati già presenti sul telefono

Non serve importare manualmente se mantieni lo stesso dominio Vercel:

- apri la nuova versione **prima dal telefono che contiene già i log**;
- se il Blob è vuoto, l'app rileva i dati locali e li invia automaticamente nel cloud;
- quando compare `Cloud ✓`, apri il sito dal desktop: troverai gli stessi dati.

Per sicurezza è comunque consigliato fare prima un Export JSON dal telefono.

## Backup

- Freccia giù: esporta tutto il logbook in JSON.
- Freccia su: importa un backup; l'import viene sincronizzato anche sul Blob remoto.

## Avvio locale

La versione cloud richiede le API Vercel; `python -m http.server` non basta più.

Usa `start-logbook.bat` oppure:

```bash
npm install
npx vercel dev --listen 9000
```

Per testare Blob anche in locale, collega prima la cartella al progetto Vercel (`vercel link`) e recupera l'ambiente del progetto secondo la configurazione Vercel corrente.

## Modificare la scheda

Modifica `workout.json`. Mantieni stabile l'`id` degli esercizi se vuoi mantenere lo storico associato.


## v6.1 crisp
Rendering mobile ottimizzato: input 16px, microtesti >=10px, bordi 1px, niente optimizeLegibility/scaling.
