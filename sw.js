// Service worker: cacheia os arquivos do app para ele abrir mesmo sem sinal.
// Isso é separado da persistência de DADOS (que o Firestore já cuida sozinho) —
// aqui é só o "esqueleto" do app (HTML/CSS/JS) que precisa estar disponível offline.
//
// IMPORTANTE: sempre que você publicar uma versão nova do index.html,
// aumente o número em CACHE_NAME (v23 -> v24 -> ...). Isso faz o celular
// descartar o cache antigo. Mesmo assim, o index.html agora é buscado na
// rede primeiro (veja abaixo), então atualizações aparecem sozinhas.

// ---------------------------------------------------------------------
// NOTIFICAÇÕES (Firebase Cloud Messaging): com o app fechado, é este
// arquivo que recebe o aviso e mostra na barra do celular.
// Se as bibliotecas não carregarem (sem internet na atualização), o resto
// do service worker continua funcionando normalmente.
// ---------------------------------------------------------------------
try {
  importScripts(
    'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js'
  );
  firebase.initializeApp({
    apiKey: "AIzaSyB7J_vxFOeZ_cKJ025tqMAT_iG00FTyNIY",
    authDomain: "app-seguranca-trabalho.firebaseapp.com",
    projectId: "app-seguranca-trabalho",
    storageBucket: "app-seguranca-trabalho.firebasestorage.app",
    messagingSenderId: "165998983951",
    appId: "1:165998983951:web:62034ac9b422da13b01c7a"
  });
  firebase.messaging().onBackgroundMessage((payload) => {
    const d = payload.data || {};
    return self.registration.showNotification(d.titulo || 'Segurança do Trabalho CCG', {
      body: d.corpo || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: d.tag || undefined,          // mesmo assunto substitui o aviso anterior
      data: { abrir: d.abrir || '' }
    });
  });
} catch (e) {
  // sem notificações nesta instalação; tenta de novo na próxima atualização
}

// tocou na notificação: abre (ou traz pra frente) o app na tela certa
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const abrir = (event.notification.data && event.notification.data.abrir) || '';
  const base = self.registration.scope;
  event.waitUntil((async () => {
    const janelas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aberta = janelas.find((c) => c.url.startsWith(base));
    if (aberta) {
      await aberta.focus();
      aberta.postMessage({ tipo: 'abrir-notificacao', abrir });
      return;
    }
    await clients.openWindow(base + (abrir ? '?abrir=' + encodeURIComponent(abrir) : ''));
  })());
});

const CACHE_NAME = 'sst-ccg-v99';
const ARQUIVOS_PARA_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png'   // ícone da tela de abertura (aparece mesmo offline)
];

// Bibliotecas do Firebase: sem elas o app nem começa, então já guardamos
// na instalação (antes elas só entravam no cache "se" fossem baixadas
// depois, e às vezes o celular abria offline sem elas).
const FIREBASE_SCRIPTS = [
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js'
];

// Arquivos extras do app (não travam a instalação se faltarem no servidor):
// jsqr.js = leitor de QR code dos crachás (Treinamentos), usado quando o
// celular não tem o leitor nativo (iPhone, por exemplo).
const ARQUIVOS_OPCIONAIS = ['./jsqr.js'];

// Quanto tempo esperar a rede antes de abrir a cópia guardada (sinal ruim no campo)
const TEMPO_LIMITE_REDE_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // cache: 'reload' ignora o cache HTTP do navegador e baixa a versão nova de verdade
      await cache.addAll(ARQUIVOS_PARA_CACHE.map((url) => new Request(url, { cache: 'reload' })));
      await Promise.all(ARQUIVOS_OPCIONAIS.map(async (url) => {
        try{ const r = await fetch(new Request(url, { cache: 'reload' })); if (r.ok) await cache.put(url, r); }catch(e){}
      }));
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

  // IMPORTANTE: não mexe em NADA de outros sites além das bibliotecas do
  // Firebase. Antes o service worker guardava (e às vezes devolvia velhas,
  // ou devolvia o index.html no lugar) as chamadas de login e do banco de
  // dados — o que podia derrubar a sessão ao reabrir o app.
  const ehBibliotecaFirebase =
    url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (url.origin !== self.location.origin && !ehBibliotecaFirebase) return;
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
      }).catch(async () => {
        // sem internet e sem cópia: só páginas recebem o index.html; scripts e imagens recebem erro
        // (antes um script que faltava recebia o index.html e o app achava que tinha carregado)
        if (event.request.destination === 'script' || /\.js$/.test(url.pathname)) return Response.error();
        return (await caches.match('./index.html')) || Response.error();
      });
    })
  );
});
