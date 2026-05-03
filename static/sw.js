// sw.js

// BUMPED VERSION: This forces the browser to wipe the old cache and grab the new JS files
const CACHE_NAME = 'energy-static-v8'; 
const DATA_CACHE_NAME = 'energy-data-v1';

const ASSETS = [
    '/',
    '/history',
    '/statistics',
    '/consumption',
    '/static/style.css',
    '/static/index.js',
    '/static/history.js',
    '/static/statistics.js',
    '/static/consumption.js',
    '/static/common.js',
    '/static/dayjs.min.js',
    '/static/icon-192.png',
    'https://cdn.jsdelivr.net/npm/chart.js' 
];

// 1. Install Event: Cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// 2. Activate Event: Clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName.startsWith('energy-static-') && cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 3. Fetch Event
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // ==========================================
    // STRATEGY A: API (Network First, Fallback to Cache)
    // ==========================================
    if (url.pathname.startsWith('/api/')) {
        if (url.pathname.includes('/sync/') || url.pathname.includes('/export_db')) {
            return;
        }

        event.respondWith(
            (async () => {
                try {
                    const networkResponse = await fetch(event.request);
                    const cache = await caches.open(DATA_CACHE_NAME);
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                } catch (error) {
                    console.warn(`[Offline] Serving cached API data for: ${url.pathname}${url.search}`);
                    const cachedResponse = await caches.match(event.request);
                    if (cachedResponse) return cachedResponse;

                    return new Response(JSON.stringify([]), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            })()
        );
        return;
    }

    // ==========================================
    // STRATEGY B: Navigation (Network First, Fallback to App Shell)
    // ==========================================
    if (event.request.mode === 'navigate') {
        event.respondWith(
            (async () => {
                try {
                    const networkResponse = await fetch(event.request);
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                } catch (e) {
                    const cachedResponse = await caches.match(event.request);
                    if (cachedResponse) return cachedResponse;
                    
                    return await caches.match('/'); 
                }
            })()
        );
        return;
    }

    // ==========================================
    // 🆕 STRATEGY C: Static Assets (Stale-While-Revalidate)
    // ==========================================
    if (url.pathname.startsWith('/static/') || url.origin === 'https://cdn.jsdelivr.net') {
        event.respondWith(
            (async () => {
                // 1. Immediately return the fast cached version if we have it
                const cachedResponse = await caches.match(event.request);
                
                // 2. BUT quietly fetch the newest version from the server in the background
                const fetchPromise = fetch(event.request).then(async networkResponse => {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                }).catch(e => console.error("Failed to update static asset:", e));

                // 3. Serve cache if it exists, otherwise wait for the network request
                return cachedResponse || await fetchPromise;
            })()
        );
        return;
    }

    // ==========================================
    // STRATEGY D: Fallback
    // ==========================================
    event.respondWith(
        (async () => {
            try {
                return await fetch(event.request);
            } catch (e) {
                return await caches.match(event.request);
            }
        })()
    );
});