// Service worker: cacheia os arquivos do app para ele abrir mesmo sem sinal.
// Isso é separado da persistência de DADOS (que o Firestore já cuida sozinho) —
// aqui é só o "esqueleto" do app (HTML/CSS/JS) que precisa estar disponível offline.

const CACHE_NAME = 'sst-ccg-v16';
const ARQUIVOS_PARA_CACHE = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_PARA_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes.filter((nome) => nome !== CACHE_NAME).map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Só intercepta pedidos do próprio app (GET); deixa o Firebase (Firestore/Auth/Storage)
  // seguir seu próprio fluxo de rede normalmente.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((respostaCache) => {
      return respostaCache || fetch(event.request).then((respostaRede) => {
        // guarda uma cópia no cache para a próxima vez que estiver offline
        const copia = respostaRede.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return respostaRede;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
