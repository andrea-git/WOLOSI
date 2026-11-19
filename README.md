# Workout Logbook

App statica mobile-first, senza backend e senza dipendenze.

## Cosa fa

- carica la scheda da `workout.json`
- tab G1-G5
- registra **kg, reps e RIR per ogni serie**
- note libere per esercizio
- autosave in `localStorage` dopo 300 ms
- mostra le ultime 2 sessioni dello stesso giorno/esercizio nel formato `kg × reps RIR`
- pulsante **Copia ultimo** per ogni esercizio: copia kg, reps e RIR dell'ultima sessione nella data corrente
- export/import backup JSON
- compatibile con i dati già salvati nella versione precedente: i vecchi carichi restano validi e reps/RIR partono vuoti

## Avvio locale

Dalla root del progetto:

```bash
python -m http.server 9000
```

Poi apri `http://localhost:9000`.

## Vercel

Carica la cartella/repository su Vercel come progetto statico.
Non ci sono build command né dipendenze.

## Modificare la scheda

Modifica `workout.json`. Mantieni stabile l'`id` di un esercizio se vuoi conservare lo storico associato.
