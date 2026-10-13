const axios = require('axios');

const API_BASE_URL = 'https://hymnal.rindra.org/api';
const SDA_HYMNAL_CATEGORY_ID = 3;
const REQUEST_TIMEOUT_MS = 10000;
const CATALOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED_HYMNS = 100;

let catalogCache = null;
let catalogCacheExpiresAt = 0;
let catalogRequest = null;
const hymnCache = new Map();
const hymnRequests = new Map();

async function loadSdaHymnalCatalog() {
    if (catalogCache && Date.now() < catalogCacheExpiresAt) {
        return catalogCache;
    }

    if (catalogRequest) {
        return catalogRequest;
    }

    catalogRequest = axios.get(
        API_BASE_URL + '/categories/' + SDA_HYMNAL_CATEGORY_ID + '.json',
        { timeout: REQUEST_TIMEOUT_MS }
    ).then(response => {
        const catalog = Array.isArray(response.data) ? response.data : response.data?.hymns;
        if (!Array.isArray(catalog) || catalog.length === 0) {
            throw new Error('The hymnal API returned an invalid SDA catalog.');
        }

        catalogCache = catalog.filter(hymn =>
            hymn && Number.isFinite(Number(hymn.ID)) && hymn.Title
        );
        if (catalogCache.length === 0) {
            throw new Error('The hymnal API returned no usable SDA hymns.');
        }

        catalogCacheExpiresAt = Date.now() + CATALOG_CACHE_TTL_MS;
        return catalogCache;
    }).finally(() => {
        catalogRequest = null;
    });

    return catalogRequest;
}

async function loadSdaHymn(id) {
    if (hymnCache.has(id)) {
        return hymnCache.get(id);
    }

    if (hymnRequests.has(id)) {
        return hymnRequests.get(id);
    }

    const request = axios.get(
        API_BASE_URL + '/hymns/' + encodeURIComponent(id) + '.json',
        { timeout: REQUEST_TIMEOUT_MS }
    ).then(response => {
        const hymn = response.data;
        if (!hymn || !Array.isArray(hymn.Lyrics)) {
            throw new Error('The hymnal API returned invalid hymn lyrics.');
        }

        hymnCache.set(id, hymn);
        if (hymnCache.size > MAX_CACHED_HYMNS) {
            const oldestId = hymnCache.keys().next().value;
            hymnCache.delete(oldestId);
        }
        return hymn;
    }).finally(() => {
        hymnRequests.delete(id);
    });

    hymnRequests.set(id, request);
    return request;
}

function formatSdaHymn(hymn) {
    const number = hymn.Number ?? hymn.ID;
    const metadata = [];
    if (hymn.Author) metadata.push('✍️ ' + hymn.Author);
    if (hymn.Key) metadata.push('🎼 Key: ' + hymn.Key);

    const verses = hymn.Lyrics
        .filter(verse => verse && typeof verse.text === 'string' && verse.text.trim())
        .map((verse, index) => {
            const label = verse.label ? String(verse.label).trim() : 'Verse ' + (index + 1);
            return '*' + label + '*\n' + verse.text.trim();
        });

    return [
        '📖 *SDA HYMNAL*『' + number + '』',
        '🎵 *' + hymn.Title + '*',
        ...metadata,
        '━━━━━━━━━━━━━━━━━━',
        ...verses,
        '_Source: hymnal.rindra.org_'
    ].join('\n\n');
}

async function getEnglishHymn(query) {
    const cleanQuery = typeof query === 'string' ? query.trim() : '';
    if (!cleanQuery) {
        return {
            success: false,
            text: '📖 Send an English SDA hymn number or title.\n\nExamples: !hymn 1 or !hymn Praise to the Lord.'
        };
    }

    try {
        const catalog = await loadSdaHymnalCatalog();
        const normalizedQuery = cleanQuery.replace(/^#\s*/, '').toLocaleLowerCase();
        const numberQuery = /^\d+$/.test(normalizedQuery)
            ? Number(normalizedQuery)
            : null;

        let entry;
        if (numberQuery !== null) {
            entry = catalog.find(hymn => Number(hymn.Number) === numberQuery);
        } else {
            entry = catalog.find(hymn =>
                String(hymn.Title).trim().toLocaleLowerCase() === normalizedQuery
            ) || catalog.find(hymn =>
                String(hymn.Title).toLocaleLowerCase().includes(normalizedQuery)
            );
        }

        if (!entry) {
            return {
                success: false,
                text: '❌ No English SDA hymn found for "' + cleanQuery + '". Search by hymn number or title.'
            };
        }

        const hymn = await loadSdaHymn(entry.ID);
        return {
            success: true,
            song: hymn,
            text: formatSdaHymn(hymn)
        };
    } catch (error) {
        console.error('[ENGLISH HYMNAL] Could not load hymn:', error.message);
        return {
            success: false,
            text: '⚠️ The English hymnal is temporarily unavailable. Please try again shortly.'
        };
    }
}

module.exports = { getEnglishHymn };
