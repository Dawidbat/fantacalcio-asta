# Fantacalcio Asta Live — V2

## Incluso
- Multiplayer realtime con Socket.IO
- Creazione stanza + codice
- Link condivisibile
- Nome utente
- Amministratore della lega
- Budget configurabile
- Turni automatici
- Timer configurabile (default 15 s)
- Rilancio +1 / +2 / +5 / +10 / +15
- Ogni offerta resetta il timer
- Acquisto automatico allo scadere
- Budget scalato automaticamente
- Giocatore rimosso dalla lista comune
- Rosa personale visibile a tutti
- Limite rosa per ruolo configurabile nel server
- Ricerca e filtri P/D/C/A
- Cronologia
- Annullamento dell'ultimo acquisto da parte dell'admin
- Modalità TV/proiettore
- Persistenza delle leghe nel file rooms.json

## Avvio
1. Installa Node.js
2. Apri il terminale nella cartella
3. `npm install`
4. `npm start`
5. Apri `http://localhost:3000`

Per giocare davvero da telefoni diversi, pubblica il progetto su un hosting Node.js. Il link pubblico può poi essere condiviso con tutti.

## Nota sui giocatori
`players.json` è volutamente separato dal motore dell'asta, così la lista può essere sostituita con un database aggiornato della stagione scelta senza toccare la logica dell'app.
