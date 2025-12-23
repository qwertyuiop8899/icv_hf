# 🇮🇹 IlCorsaroViola - The Ultimate Italian Stremio Addon

<div align="center">

![Version](https://img.shields.io/badge/Version-2.0.0-brightgreen?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-Backend-green?style=for-the-badge)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-blue?style=for-the-badge)
![Real-Debrid](https://img.shields.io/badge/Real--Debrid-Supported-orange?style=for-the-badge)
![AllDebrid](https://img.shields.io/badge/AllDebrid-Supported-red?style=for-the-badge)
![TorBox](https://img.shields.io/badge/TorBox-Supported-blue?style=for-the-badge)
![Stremio](https://img.shields.io/badge/Stremio-Addon-purple?style=for-the-badge)

**Il motore di ricerca italiano per Stremio più avanzato e intelligente.**

[📦 Installa Addon](https://ilcorsaroviola-icv.hf.space) • 
[📦 Installa Addon Secondo Link (beta version)](https://icv.stremio.dpdns.org) •
[📊 Database](https://db.corsaroviola.dpdns.org/) • [📝 Changelog](CHANGELOG.md)

</div>

---

## 🚀 Che cos'è IlCorsaroViola?

IlCorsaroViola è un addon per Stremio progettato specificamente per l'utenza italiana. Non è solo un semplice scraper: è un **ecosistema intelligente** che impara e migliora con l'uso.

### 🧠 Database Dinamico & Self-Filling
La caratteristica più potente di IlCorsaroViola è il suo database "vivo".
*   **Non serve un database pre-popolato:** Il sistema parte leggero.
*   **Popolamento automatico:** Ogni volta che un utente cerca un film o una serie TV, IlCorsaroViola scansiona decine di fonti.
*   **Salvataggio intelligente:** I risultati trovati vengono salvati nel database centrale.
*   **Cache condivisa:** La prossima volta che *qualsiasi* utente cercherà lo stesso titolo, il risultato sarà **istantaneo** (Tier 1).

> **Più lo usate, più diventa veloce e completo per tutti!** 🤝

---

## ✨ Funzionalità Principali

### 🔍 Ricerca Avanzata
*   **Multi-Provider:** Scansiona simultaneamente IlCorsaroNero, UIndex, Knaben, TorrentGalaxy, RARBG e altri tracker.
*   **✨ Supporto Jackett:** Integrazione completa con Jackett per utilizzare i propri indexer privati e personalizzati.
*   **Smart Matching:** Algoritmi avanzati per riconoscere titoli italiani, inglesi, range di episodi (es. `S01E01-10`) e pack completi.
*   **Enrichment:** Se un titolo non si trova in italiano, il sistema prova automaticamente a cercarlo con il titolo originale o inglese.

### ⚡ Performance & Debrid
*   **Supporto Debrid Multiplo:** Integrazione nativa con Real-Debrid 👑, AllDebrid 🅰️ e TorBox 📦.
*   **✨ MediaFlow/EasyProxy:** Supporto integrato per proxy (🕵️) per condividere l'account Real-Debrid in sicurezza senza rischi di ban.
*   **Smart Caching:** Verifica la disponibilità nella cache dei servizi Debrid per streaming istantaneo senza buffering.
*   **Cache TTL:** I risultati della cache Debrid vengono ricordati per **20 giorni**, riducendo le chiamate API e velocizzando le risposte.

### 🔄 Compatibilità AIOStreams (NEW in v2.0)
*   **Modalità AIOStreams:** Opzione nella configurazione per formattare gli stream in modo compatibile con AIOStreams.
*   **Formato Standard:** Gli stream mostrano `RD⚡`, `TB⏳`, `AD⚡`, `P2P` per un parsing corretto da AIOStreams.
*   **Icone Cache:** ⚡ per cached (streaming istantaneo), ⏳ per uncached (download in corso).

### 🎨 Nome Addon Dinamico (NEW in v2.0)
Il nome dell'addon in Stremio mostra le icone dei servizi configurati:
| Servizio | Icona |
|----------|-------|
| Real-Debrid | 👑 |
| Torbox | 📦 |
| AllDebrid | 🅰️ |
| P2P (nessun debrid) | 🧲 |
| Proxy attivo | 🕵️ |

**Esempio:** `🕵️ IlCorsaroViola 👑+📦` = Real-Debrid con proxy + Torbox attivi.

### 🎯 Ordinamento Intelligente
I risultati vengono presentati nell'ordine perfetto per l'utente:
1.  ⚡ **Cached:** I file pronti per lo streaming immediato sono sempre in cima.
2.  📺 **Risoluzione:** 4K > 1080p > 720p > 480p.
3.  💾 **Dimensione:** A parità di risoluzione, vince il file con bitrate più alto (più grande).
4.  👥 **Seeders:** Per i torrent non in cache, vince chi ha più fonti.

---

## 🛠️ Configurazione

### Opzioni Disponibili
| Opzione | Descrizione |
|---------|-------------|
| **Real-Debrid API Key** | Chiave API del tuo account Real-Debrid |
| **Torbox API Key** | Chiave API del tuo account Torbox |
| **AllDebrid API Key** | Chiave API del tuo account AllDebrid |
| **MediaFlow Proxy URL** | URL del proxy MediaFlow (opzionale) |
| **EasyProxy URL** | URL di EasyProxy (alternativa a MediaFlow) |
| **Jackett URL** | URL della tua istanza Jackett |
| **Jackett API Key** | Chiave API di Jackett |
| **Modalità AIOStreams** | Abilita formato compatibile con AIOStreams |

---

## 📊 Consultazione Database

È possibile consultare lo stato del database e i contenuti indicizzati tramite il pannello di controllo pubblico:

*   **URL:** [https://db.corsaroviola.dpdns.org/](https://db.corsaroviola.dpdns.org/)
*   **Password:** `Aargh!`

Qui potrete vedere in tempo reale quali titoli sono stati aggiunti e lo stato della cache.

---

## 📝 Changelog

Consulta il [CHANGELOG.md](CHANGELOG.md) per la lista completa delle modifiche.

### Ultime Novità (v2.0.0)
- ✨ Modalità compatibilità AIOStreams
- 🎨 Nome addon dinamico con icone servizi
- 🐛 Fix estrazione qualità per TorrentGalaxy e RARBG
- 📝 Logging migliorato per cache check Real-Debrid

---

## 🤝 Contribuire
Il progetto è open source. Sentiti libero di aprire Issue o Pull Request per migliorare il supporto ai tracker italiani o ottimizzare l'algoritmo di matching.

---

<div align="center">

Made with ❤️ for the Italian Community

**v2.0.0** • December 2025

</div>
