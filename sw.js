// Service worker: habilita instalação (PWA) e serve o "casco" do app.
// Estratégia: o HTML é NETWORK-FIRST (sempre pega a versão nova; cache só offline),
// para que atualizações apareçam sozinhas. Demais arquivos: cache-first.
// Nunca cacheia /api/ nem Supabase (dados sensíveis/dinâmicos).
const CACHE = "preop-shell-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/") || url.hostname.includes("supabase")) return;
  if (e.request.method !== "GET") return;

  const isHTML = e.request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith("/index.html");
  if (isHTML) {
    // network-first
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html")))
    );
  } else {
    // cache-first para assets estáticos
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
  }
});
