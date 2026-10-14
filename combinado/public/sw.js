// Service worker do app da ORBYTA (escopo /app/): deixa o painel instalável, abre mais rápido e recebe as notificações.
// Segurança: só guarda em cache arquivos públicos do próprio site (a página do painel e os scripts com hash no nome).
// Dados de pacientes, conversas e qualquer resposta do Supabase nunca passam por aqui nem ficam guardados no aparelho.
const VERSION = 'v1';
const SHELL = `orbyta-shell-${VERSION}`;
const ASSETS = `orbyta-assets-${VERSION}`;
const MAX_ASSETS = 150;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.allSettled(['/app/', '/manifest.webmanifest', '/icon-192.png', '/favicon.svg', '/tema.js'].map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('orbyta-') && k !== SHELL && k !== ASSETS) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(k);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Supabase, Meta, verificação anti-robô: sempre direto na rede
  if (url.origin !== self.location.origin) return;

  // a página do painel: sempre a versão nova quando há internet; sem internet, a última guardada
  if (req.mode === 'navigate') {
    if (!url.pathname.startsWith('/app')) return;
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          event.waitUntil(caches.open(SHELL).then((c) => c.put('/app/', copy)));
        }
        return res;
      } catch {
        return (await caches.match('/app/')) || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ORBYTA</title><body style="font-family:system-ui;background:#050A1A;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center"><div><h1 style="font-size:20px">Sem internet</h1><p style="opacity:.8">A ORBYTA volta assim que a conexão voltar.</p></div>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // scripts, estilos e imagens do painel: o nome muda a cada versão (hash), então o que está guardado nunca fica velho
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') event.waitUntil(cache.put(req, res.clone()).then(() => trim(cache)));
      return res;
    })());
  }
});

/* ---------- notificações ---------- */
async function isApplePush() {
  try { const s = await self.registration.pushManager.getSubscription(); return !!s && /push\.apple\.com/.test(s.endpoint); } catch { return false; }
}

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'ORBYTA', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // painel aberto e na frente: o aviso já aparece no sino. O Safari exige mostrar sempre, então lá mostra.
    const inFront = wins.some((w) => w.focused && w.visibilityState === 'visible');
    if (inFront && !d.always && !(await isApplePush())) {
      for (const w of wins) w.postMessage({ type: 'orbyta-push', kind: d.kind });
      return;
    }
    await self.registration.showNotification(d.title || 'ORBYTA', {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      lang: 'pt-BR',
      timestamp: d.at ? Date.parse(d.at) : Date.now(),
      data: { link: typeof d.link === 'string' && d.link.startsWith('#/') ? d.link : '#/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '#/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = wins.find((w) => new URL(w.url).pathname.startsWith('/app'));
    if (app) {
      app.postMessage({ type: 'orbyta-open', link });
      return app.focus();
    }
    return self.clients.openWindow(`/app/${link}`);
  })());
});
