# Changelog

Tutte le modifiche importanti a IlCorsaroViola saranno documentate in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/),
e questo progetto aderisce a [Semantic Versioning](https://semver.org/lang/it/).

---

## [2.0.0] - 2025-12-23

### ✨ Nuove Funzionalità

#### 🔄 Modalità AIOStreams
- **Nuova checkbox "Modalità AIOStreams"** nella pagina di configurazione
- Formatta i nomi degli stream in modo compatibile con l'addon AIOStreams
- Simboli standard: `RD⚡` (Real-Debrid cached), `TB⏳` (Torbox uncached), `AD⚡` (AllDebrid cached), `P2P`
- Permette ad AIOStreams di parsare correttamente servizio debrid e stato cache

#### 🎨 Nome Addon Dinamico con Icone
- Il nome dell'addon in Stremio ora mostra icone per i servizi configurati:
  - 👑 Real-Debrid
  - 📦 Torbox
  - 🅰️ AllDebrid
  - 🧲 P2P (nessun debrid)
  - 🕵️ Proxy attivo (MediaFlow/EasyProxy)
- Esempio: `🕵️ IlCorsaroViola 👑+📦` (RD con proxy + Torbox)

### 🐛 Bug Fix

#### 🔍 Correzione Estrazione Qualità
- Risolto bug dove TorrentGalaxy e RARBG mostravano "Unknown" per la qualità
- Regex migliorata per rilevare risoluzioni:
  - Accetta risoluzioni senza `p` (es. `1080` oltre a `1080p`)
  - Accetta risoluzioni seguite da codec (es. `1080ph264`)
  - Matching flessibile ovunque nel titolo
- Normalizzazione output: `2160p`, `4k`, `uhd` → `4K`; `1080` → `1080p`, ecc.

### 🔧 Miglioramenti Tecnici

#### 📝 Logging Real-Debrid Cache Check
- Aggiunto logging esplicito per operazioni di delete torrent
- Conferma che i torrent aggiunti per cache check vengono sempre eliminati

### 📁 File Modificati
- `api/index.js` - Logica AIOStreams, nome dinamico, fix qualità
- `aiostreams-formatter.cjs` - **NUOVO** modulo per formattazione AIOStreams
- `template.html` - Checkbox "Modalità AIOStreams"
- `rarbg.cjs` - Funzione `extractQuality` migliorata
- `rd-cache-checker.cjs` - Logging delete operations
- `package.json` - Versione 2.0.0

---

## [1.0.0] - 2025-12-XX

### 🚀 Release Iniziale
- Ricerca multi-provider (IlCorsaroNero, UIndex, Knaben, TorrentGalaxy, RARBG)
- Supporto Jackett per indexer privati
- Integrazione Real-Debrid, Torbox, AllDebrid
- MediaFlow Proxy per condivisione account sicura
- Database PostgreSQL self-filling
- Cache TTL 20 giorni per risultati debrid
- Ordinamento intelligente (cached → risoluzione → dimensione → seeders)
