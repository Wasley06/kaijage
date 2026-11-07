const CACHE = 'kaijage-pos-v2'
const ROOT = new URL('./', self.registration.scope)
const ASSETS = [ROOT.href, new URL('kaijage-logo.png', ROOT).href, new URL('manifest.webmanifest', ROOT).href]
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))))
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('kaijage-pos-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())))
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => { if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone())); return response }).catch(async () => await caches.match(event.request) || await caches.match(ROOT.href)))
    return
  }
  if (['script', 'style', 'font', 'image'].includes(event.request.destination) || new URL(event.request.url).pathname.startsWith('/_next/static/')) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone())); return response })))
  }
})
