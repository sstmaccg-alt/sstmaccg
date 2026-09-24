// Service worker: cacheia os arquivos do app para ele abrir mesmo sem sinal.
// Isso é separado da persistência de DADOS (que o Firestore já cuida sozinho) —
// aqui é só o "esqueleto" do app (HTML/CSS/JS) que precisa estar disponível offline.
//
// IMPORTANTE: sempre que você publicar uma versão nova do index.html,
// aumente o número em CACHE_NAME (v23 -> v24 -> ...). Isso faz o celular
// descartar o cache antigo. Mesmo assim, o index.html agora é buscado na
// rede primeiro (veja abaixo), então atualizações aparecem sozinhas.

const CACHE_NAME = 'sst-ccg-v54';
const ARQUIVOS_PARA_CACHE = [
  './',
  './index.html',
  './manifest.json'
];

// Bibliotecas do Firebase: sem elas o app nem começa, então já guardamos
// na instalação (antes elas só entravam no cache "se" fossem baixadas
// depois, e às vezes o celular abria offline sem elas).
const FIREBASE_SCRIPTS = [
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js'
];

// Quanto tempo esperar a rede antes de abrir a cópia guardada (sinal ruim no campo)
const TEMPO_LIMITE_REDE_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // cache: 'reload' ignora o cache HTTP do navegador e baixa a versão nova de verdade
      await cache.addAll(ARQUIVOS_PARA_CACHE.map((url) => new Request(url, { cache: 'reload' })));
      // Firebase: um por um, sem derrubar a instalação se algum falhar
      await Promise.all(FIREBASE_SCRIPTS.map(async (url) => {
        try{
          const resp = await fetch(url, { mode: 'cors' });
          if (resp.ok) await cache.put(url, resp);
        }catch(e){ /* tenta de novo na próxima vez que o script for pedido */ }
      }));
    })
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

// Página do app (index.html): tenta a rede primeiro para pegar sempre a versão mais nova;
// se estiver offline ou o sinal estiver muito lento, abre a cópia guardada.
function paginaRedePrimeiro(request) {
  return new Promise((resolve) => {
    let resolvido = false;

    const usarCache = async () => {
      const guardado =
        (await caches.match(request, { ignoreSearch: true })) ||
        (await caches.match('./index.html'));
      return guardado || null;
    };

    const timer = setTimeout(async () => {
      const guardado = await usarCache();
      if (guardado && !resolvido) { resolvido = true; resolve(guardado); }
    }, TEMPO_LIMITE_REDE_MS);

    fetch(request)
      .then((resposta) => {
        clearTimeout(timer);
        if (resposta && resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copia));
        }
        if (!resolvido) { resolvido = true; resolve(resposta); }
      })
      .catch(async () => {
        clearTimeout(timer);
        const guardado = await usarCache();
        if (!resolvido) { resolvido = true; resolve(guardado || Response.error()); }
      });
  });
}

self.addEventListener('fetch', (event) => {
  // Só intercepta pedidos GET; deixa o Firebase (Firestore/Auth/Storage)
  // seguir seu próprio fluxo de rede normalmente.
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const ehPaginaDoApp =
    event.request.mode === 'navigate' ||
    (url.origin === self.location.origin &&
      (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')));

  if (ehPaginaDoApp) {
    event.respondWith(paginaRedePrimeiro(event.request));
    return;
  }

  // Demais arquivos (scripts do Firebase, imagens, manifest): cache primeiro
  event.respondWith(
    caches.match(event.request, { ignoreVary: true }).then((respostaCache) => {
      return respostaCache || fetch(event.request).then((respostaRede) => {
        // guarda uma cópia no cache para a próxima vez que estiver offline
        // (só respostas boas ou "opacas" de outro site — nunca erro 404/500)
        if (respostaRede && (respostaRede.ok || respostaRede.type === 'opaque')) {
          const copia = respostaRede.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return respostaRede;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
