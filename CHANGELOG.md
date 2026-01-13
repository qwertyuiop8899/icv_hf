# Changelog

Tutte le modifiche importanti a IlCorsaroViola sono documentate in questo file.

---

## [5.0.0] - 2026-01-13

### 🎬 Binge Watch Intelligente
- **bingeGroup dinamico** basato su qualità/HDR/gruppo release
- Formato: `icv|servizio|qualità|hdr|gruppo` (es. `icv|rd|2160p|DV-HDR|FLUX`)
- Continuità automatica: finisci in 4K DV → prossimo episodio in 4K DV
- Supporto HDR profiles: DV, DV-HDR, HDR10+, HDR10, HDR, SDR

### 🔄 Cache Globale Condivisa
- **Cache PostgreSQL persistente** per risultati torrent
- TTL differenziato: Film 18h, Serie 10h (per episodio)
- Condivisione tra TUTTI gli utenti (chiavi debrid personali)
- Filtri `full_ita` applicati DOPO lettura cache

### 📅 Fresh Content Skip
- Contenuti usciti < **96 ore** (4 giorni) NON vengono cachati
- Risolve problema: cache salva 720p, poi escono versioni 4K
- Copre ritardo release Italia vs USA

### 📦 Pack Handler Completo
- **Selezione episodio automatica** da pack stagionali
- **Selezione film** da collection (es. Trilogia)
- Cache DB per file dei pack (`pack_files` table)
- Verifica RD/Torbox cache per pack

### 🧠 Database Self-Filling
- Ogni ricerca alimenta il database centrale
- Torrents italiani salvati automaticamente
- Enrichment webhook per arricchimento asincrono
- Sistema 3-Tier: Cache → DB → Live Scraping

### 🔧 Refactoring
- Codebase completamente riorganizzata
- Parser titoli migliorato (qualità, HDR, gruppo)
- Logging strutturato con emoji
- Fix bug provider checks

---

## [4.0.0] - 2025-12

### ✨ Nuove Funzionalità
- Supporto AllDebrid
- Integrazione addon esterni (Torrentio, MediaFusion, Comet)
- Provider toggle individuale
- Intro skip detection

---

## [3.0.0] - 2025-11

### ✨ Nuove Funzionalità
- Custom Formatter per template stream personalizzati
- AIOStreams compatibility mode
- Nome addon dinamico con icone servizi

---

## [2.0.0] - 2025-10

### ✨ Nuove Funzionalità
- Modalità AIOStreams
- MediaFlow/EasyProxy support
- Full ITA mode
- DB Only mode

### 🐛 Bug Fix
- Fix estrazione qualità TorrentGalaxy/RARBG
- Fix logging Real-Debrid cache check

---

## [1.0.0] - 2025-09

### 🚀 Release Iniziale
- Ricerca multi-provider (CorsaroNero, UIndex, Knaben, TorrentGalaxy, RARBG)
- Supporto Jackett
- Integrazione Real-Debrid, Torbox
- Database PostgreSQL self-filling
- Ordinamento intelligente
