---
title: Il Corsaro Viola
emoji: 🏴‍☠️
colorFrom: purple
colorTo: indigo
sdk: docker
pinned: false
license: mit
---

# 🏴‍☠️ Il Corsaro Viola - Stremio Addon

Addon Stremio per ricerca torrent italiani con supporto Real-Debrid, Torbox e AllDebrid.

## 🔧 Configurazione

### Variabili d'ambiente richieste (HuggingFace Secrets):

| Variabile | Descrizione | Obbligatorio |
|-----------|-------------|--------------|
| `DATABASE_URL` | URL PostgreSQL (Supabase/Neon) | ✅ Sì |
| `TMDB_API_KEY` | API key di TheMovieDB | ✅ Sì |
| `ENRICHMENT_SERVER_URL` | URL server VPS enrichment | ❌ Opzionale |
| `ENRICHMENT_API_KEY` | API key per enrichment | ❌ Opzionale |

### Come configurare su Stremio:

1. Vai su `https://YOUR-SPACE.hf.space/configure`
2. Inserisci le tue API key (Real-Debrid, Torbox, etc.)
3. Clicca "Installa su Stremio"

## 📝 Note

- Lo Space potrebbe andare in sleep dopo inattività
- Il cold start richiede ~30 secondi
- Il database PostgreSQL deve essere esterno (Supabase, Neon, etc.)
