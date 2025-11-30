// =====================================================
// DEBRID SERVICES - Real-Debrid, Torbox, AllDebrid
// =====================================================
// Gestisce la cache check e le operazioni con i servizi debrid
// Implementazione completa delle API per streaming ottimizzato

// ✅ Real-Debrid Service
class RealDebrid {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.real-debrid.com/rest/1.0';
    }

    /**
     * Verifica la disponibilità in cache di una lista di infoHash
     * @param {Array<string>} hashes - Array di infoHash (40 max per batch)
     * @returns {Object} Oggetto con hash come chiave e info cache come valore
     */
    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};
        
        const results = {};
        const batchSize = 40; // Limite API Real-Debrid
        
        for (let i = 0; i < hashes.length; i += batchSize) {
            const batch = hashes.slice(i, i + batchSize);
            const url = `${this.baseUrl}/torrents/instantAvailability/${batch.join('/')}`;

            try {
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`
                    }
                });
                const data = await response.json();

                if (response.ok) {
                    batch.forEach(hash => {
                        const hashLower = hash.toLowerCase();
                        const cacheInfo = data[hashLower];
                        
                        // ✅ LOGICA TORRENTIO: Considera cached se RD ha QUALSIASI variante disponibile
                        // Non verifica se TUTTI i file sono in cache, solo se esiste almeno 1 variante
                        const isCached = cacheInfo && cacheInfo.rd && cacheInfo.rd.length > 0;
                        
                        results[hashLower] = {
                            cached: isCached,
                            variants: cacheInfo?.rd || [],  // Array di varianti disponibili
                            downloadLink: null,  // Non necessario, /rd-stream gestisce l'unrestrict
                            service: 'Real-Debrid'
                        };
                    });
                } else {
                    console.error(`❌ RD Cache check failed: ${response.status}`);
                    // Segna tutti i batch come non cached
                    batch.forEach(hash => {
                        results[hash.toLowerCase()] = { 
                            cached: false, 
                            variants: [],
                            downloadLink: null, 
                            service: 'Real-Debrid' 
                        };
                    });
                }

                // Rate limiting: 500ms tra batch per evitare blocchi API
                if (i + batchSize < hashes.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error('❌ RD Cache check error:', error.message);
                batch.forEach(hash => {
                    results[hash.toLowerCase()] = { 
                        cached: false, 
                        variants: [],
                        downloadLink: null, 
                        service: 'Real-Debrid' 
                    };
                });
            }
        }

        return results;
    }

    /**
     * Aggiunge un magnet link all'account Real-Debrid
     * @param {string} magnetLink - Link magnet del torrent
     * @returns {Object} Informazioni sul torrent aggiunto
     */
    async addMagnet(magnetLink) {
        const formData = new FormData();
        formData.append('magnet', magnetLink);

        const response = await fetch(`${this.baseUrl}/torrents/addMagnet`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Real-Debrid addMagnet error: ${response.status} - ${errorData.error || 'Unknown'}`);
        }

        return await response.json();
    }

    /**
     * Ottiene la lista di tutti i torrents nell'account
     * @returns {Array} Lista dei torrents
     */
    async getTorrents() {
        const response = await fetch(`${this.baseUrl}/torrents`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to get torrents list from Real-Debrid: ${response.status}`);
        }
        
        return await response.json();
    }

    /**
     * Elimina un torrent dall'account
     * @param {string} torrentId - ID del torrent da eliminare
     */
    async deleteTorrent(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/delete/${torrentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });

        if (response.status !== 204) {
            console.error(`❌ Failed to delete torrent ${torrentId} from Real-Debrid.`);
        }
    }

    /**
     * Seleziona i file da scaricare per un torrent
     * @param {string} torrentId - ID del torrent
     * @param {string} fileIds - IDs dei file da selezionare (default: 'all')
     */
    async selectFiles(torrentId, fileIds = 'all') {
        const formData = new FormData();
        formData.append('files', fileIds);

        const response = await fetch(`${this.baseUrl}/torrents/selectFiles/${torrentId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            body: formData
        });

        if (response.status !== 204) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Failed to select files on Real-Debrid: ${response.status} - ${errorData.error || 'Unknown'}`);
        }
    }

    /**
     * Ottiene informazioni dettagliate su un torrent
     * @param {string} torrentId - ID del torrent
     * @returns {Object} Informazioni complete sul torrent
     */
    async getTorrentInfo(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/info/${torrentId}`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });

        if (!response.ok) {
            throw new Error(`Failed to get torrent info from Real-Debrid: ${response.status}`);
        }
        
        return await response.json();
    }

    /**
     * Unrestrict un link per ottenere l'URL diretto di download
     * @param {string} link - Link da sbloccare
     * @returns {Object} Informazioni con download link
     */
    async unrestrictLink(link) {
        const formData = new FormData();
        formData.append('link', link);

        const response = await fetch(`${this.baseUrl}/unrestrict/link`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Real-Debrid unrestrict error: ${response.status} - ${errorData.error || 'Unknown'}`);
        }

        return await response.json();
    }

    /**
     * Verifica lo stato dell'account
     * @returns {Object} Informazioni sull'account
     */
    async getUser() {
        const response = await fetch(`${this.baseUrl}/user`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });

        if (!response.ok) {
            throw new Error(`Failed to get user info: ${response.status}`);
        }

        return await response.json();
    }
}

// ✅ Torbox Service
class Torbox {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.torbox.app/v1/api';
    }

    /**
     * Verifica la disponibilità in cache di una lista di infoHash
     * @param {Array<string>} hashes - Array di infoHash
     * @returns {Object} Oggetto con hash come chiave e info cache come valore
     */
    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};
        
        const results = {};
        
        try {
            const response = await fetch(`${this.baseUrl}/torrents/checkcached`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    hashes: hashes,
                    format: 'object',
                    list_files: true
                })
            });

            if (!response.ok) {
                throw new Error(`Torbox API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success && data.data) {
                hashes.forEach(hash => {
                    const hashLower = hash.toLowerCase();
                    const cacheInfo = data.data[hashLower];
                    
                    // ✅ LOGICA TORBOX: Se l'hash è presente nella risposta, è in cache
                    // L'API ritorna l'entry SOLO se è cached, altrimenti non compare
                    const isCached = !!cacheInfo;
                    
                    results[hashLower] = {
                        cached: isCached,
                        files: cacheInfo?.files || [],
                        downloadLink: null,
                        service: 'Torbox'
                    };
                });
            }
        } catch (error) {
            console.error('❌ Torbox cache check error:', error.message);
            hashes.forEach(hash => {
                results[hash.toLowerCase()] = { 
                    cached: false, 
                    files: [],
                    downloadLink: null, 
                    service: 'Torbox' 
                };
            });
        }
        
        return results;
    }

    /**
     * Ottiene la lista di tutti i torrents nell'account
     * @returns {Array} Lista dei torrents
     */
    async getTorrents() {
        const response = await fetch(`${this.baseUrl}/torrents/mylist`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to get torrents list from Torbox: ${response.status}`);
        }
        
        const data = await response.json();
        return data.data || [];
    }

    /**
     * Aggiunge un magnet link all'account Torbox
     * @param {string} magnetLink - Link magnet del torrent
     * @returns {Object} Informazioni sul torrent aggiunto
     */
    async addMagnet(magnetLink) {
        const response = await fetch(`${this.baseUrl}/torrents/createtorrent`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                magnet: magnetLink
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Torbox addMagnet error: ${response.status} - ${errorData.error || 'Unknown'}`);
        }

        return await response.json();
    }
}

// ✅ AllDebrid Service
class AllDebrid {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.alldebrid.com/v4';
    }

    /**
     * Verifica la disponibilità in cache di una lista di infoHash
     * @param {Array<string>} hashes - Array di infoHash
     * @returns {Object} Oggetto con hash come chiave e info cache come valore
     */
    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};
        
        const results = {};
        
        try {
            // AllDebrid supporta una lista di magnets separati da pipe
            const magnetList = hashes.map(h => `magnet:?xt=urn:btih:${h}`).join('|');
            
            const response = await fetch(`${this.baseUrl}/magnet/instant?agent=stremizio&apikey=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `magnets[]=${encodeURIComponent(magnetList)}`
            });

            if (!response.ok) {
                throw new Error(`AllDebrid API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.status === 'success' && data.data && data.data.magnets) {
                data.data.magnets.forEach((magnet, index) => {
                    const hash = hashes[index].toLowerCase();
                    
                    // ✅ LOGICA ALLDEBRID: instant = true significa che è in cache
                    const isCached = magnet.instant === true;
                    
                    results[hash] = {
                        cached: isCached,
                        files: magnet.files || [],
                        downloadLink: null,
                        service: 'AllDebrid'
                    };
                });
            }
        } catch (error) {
            console.error('❌ AllDebrid cache check error:', error.message);
            hashes.forEach(hash => {
                results[hash.toLowerCase()] = { 
                    cached: false, 
                    files: [],
                    downloadLink: null, 
                    service: 'AllDebrid' 
                };
            });
        }
        
        return results;
    }

    /**
     * Aggiunge un magnet link all'account AllDebrid
     * @param {string} magnetLink - Link magnet del torrent
     * @returns {Object} Informazioni sul torrent aggiunto
     */
    async addMagnet(magnetLink) {
        const response = await fetch(`${this.baseUrl}/magnet/upload?agent=stremizio&apikey=${this.apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `magnets[]=${encodeURIComponent(magnetLink)}`
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`AllDebrid addMagnet error: ${response.status} - ${errorData.detail || 'Unknown'}`);
        }

        return await response.json();
    }

    /**
     * Unrestrict un link per ottenere l'URL diretto di download
     * @param {string} link - Link da sbloccare
     * @returns {Object} Informazioni con download link
     */
    async unrestrictLink(link) {
        const response = await fetch(`${this.baseUrl}/link/unlock?agent=stremizio&apikey=${this.apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `link=${encodeURIComponent(link)}`
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`AllDebrid unrestrict error: ${response.status} - ${errorData.detail || 'Unknown'}`);
        }

        return await response.json();
    }
}

// ✅ Factory per creare i servizi debrid
function createDebridServices(config) {
    const services = {
        realdebrid: null,
        torbox: null,
        alldebrid: null,
        useRealDebrid: false,
        useTorbox: false,
        useAllDebrid: false
    };
    
    // Real-Debrid
    if (config.use_rd && config.rd_key && config.rd_key.length > 5) {
        console.log('🔵 Real-Debrid enabled');
        services.realdebrid = new RealDebrid(config.rd_key);
        services.useRealDebrid = true;
    }
    
    // Torbox
    if (config.use_torbox && config.torbox_key && config.torbox_key.length > 5) {
        console.log('📦 Torbox enabled');
        services.torbox = new Torbox(config.torbox_key);
        services.useTorbox = true;
    }
    
    // AllDebrid
    if (config.use_alldebrid && config.alldebrid_key && config.alldebrid_key.length > 5) {
        console.log('🅰️ AllDebrid enabled');
        services.alldebrid = new AllDebrid(config.alldebrid_key);
        services.useAllDebrid = true;
    }
    
    if (!services.useRealDebrid && !services.useTorbox && !services.useAllDebrid) {
        console.log('⚪ No debrid service enabled - P2P mode only');
    }
    
    return services;
}

// ✅ Funzione helper per verificare cache in parallelo
async function checkAllDebridCaches(hashes, services) {
    const { realdebrid, torbox, alldebrid, useRealDebrid, useTorbox, useAllDebrid } = services;
    
    const cacheResults = {
        realdebrid: {},
        torbox: {},
        alldebrid: {}
    };
    
    const checks = [];
    
    if (useRealDebrid && realdebrid) {
        console.log('🔵 Checking Real-Debrid cache...');
        checks.push(
            realdebrid.checkCache(hashes)
                .then(result => { cacheResults.realdebrid = result; })
                .catch(err => console.error('❌ RD cache check failed:', err.message))
        );
    }
    
    if (useTorbox && torbox) {
        console.log('📦 Checking Torbox cache...');
        checks.push(
            torbox.checkCache(hashes)
                .then(result => { cacheResults.torbox = result; })
                .catch(err => console.error('❌ Torbox cache check failed:', err.message))
        );
    }
    
    if (useAllDebrid && alldebrid) {
        console.log('🅰️ Checking AllDebrid cache...');
        checks.push(
            alldebrid.checkCache(hashes)
                .then(result => { cacheResults.alldebrid = result; })
                .catch(err => console.error('❌ AllDebrid cache check failed:', err.message))
        );
    }
    
    await Promise.all(checks);
    
    return cacheResults;
}

// Export per Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        RealDebrid,
        Torbox,
        AllDebrid,
        createDebridServices,
        checkAllDebridCaches
    };
}
