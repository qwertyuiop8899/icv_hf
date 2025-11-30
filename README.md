# 🇮🇹 IlCorsaroViola - The Ultimate Italian Stremio Addon

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-Backend-green?style=for-the-badge)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-blue?style=for-the-badge)
![Real-Debrid](https://img.shields.io/badge/Real--Debrid-Supported-orange?style=for-the-badge)
![AllDebrid](https://img.shields.io/badge/AllDebrid-Supported-red?style=for-the-badge)
![TorBox](https://img.shields.io/badge/TorBox-Supported-blue?style=for-the-badge)
![Stremio](https://img.shields.io/badge/Stremio-Addon-purple?style=for-the-badge)

**Il motore di ricerca italiano per Stremio più avanzato e intelligente.**

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
*   **Multi-Provider:** Scansiona simultaneamente IlCorsaroNero, UIndex, Knaben e altri tracker.
*   **✨Supporto Jackett✨:** Integrazione completa con Jackett per utilizzare i propri indexer privati e personalizzati.
*   **Smart Matching:** Algoritmi avanzati per riconoscere titoli italiani, inglesi, range di episodi (es. `S01E01-10`) e pack completi.
*   **Enrichment:** Se un titolo non si trova in italiano, il sistema prova automaticamente a cercarlo con il titolo originale o inglese.

### ⚡ Performance & Debrid
*   **Supporto Debrid:** Integrazione nativa con Real-Debrid, AllDebrid e TorBox.
*   **✨MediaFlow Proxy✨:** Supporto integrato per MediaFlow Proxy per condividere l'account Real-Debrid in sicurezza senza rischi di ban.
*   **Smart Caching:** Verifica la disponibilità nella cache dei servizi Debrid per streaming istantaneo senza buffering.
*   **Cache TTL:** I risultati della cache Debrid vengono ricordati per **20 giorni**, riducendo le chiamate API e velocizzando le risposte.

### 🎯 Ordinamento Intelligente
I risultati vengono presentati nell'ordine perfetto per l'utente:
1.  ⚡ **Cached:** I file pronti per lo streaming immediato sono sempre in cima.
2.  📺 **Risoluzione:** 4K > 1080p > 720p > 480p.
3.  💾 **Dimensione:** A parità di risoluzione, vince il file con bitrate più alto (più grande).
4.  👥 **Seeders:** Per i torrent non in cache, vince chi ha più fonti.

---

## 📊 Consultazione Database

È possibile consultare lo stato del database e i contenuti indicizzati tramite il pannello di controllo pubblico:

*   **URL:** [https://db.corsaroviola.dpdns.org/](https://db.corsaroviola.dpdns.org/)
*   **Password:** `Aargh!`

Qui potrete vedere in tempo reale quali titoli sono stati aggiunti e lo stato della cache.

---

## 🤝 Contribuire
Il progetto è open source. Sentiti libero di aprire Issue o Pull Request per migliorare il supporto ai tracker italiani o ottimizzare l'algoritmo di matching.

<div align="center">
Made with ❤️ for the Italian Community
</div>
