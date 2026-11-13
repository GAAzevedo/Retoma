// Guarda a "casca" do app pra abrir rápido e mostrar o aviso de sem internet.
// Os dados sempre vêm da nuvem (nunca do cache).
const CACHE = 'retoma-web-v1'
const SHELL = ['./', './index.html', './money.js', './config.js', './manifest.webmanifest', './icon-192.png']
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())) })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin) return   // API do Supabase: direto na rede
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))))
})
