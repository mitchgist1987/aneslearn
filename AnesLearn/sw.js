// AnesLearn Service Worker — Push Notifications
const VAPID_PUBLIC = 'BIFGZZ9ZfWBPMl1pbGRQ8my_YLShMQbu4Y_jH2HqU8cegRyHZLIw8rxbj8vnehcctf00MhWA4yRD6F3fkVvzEcA';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });

// ── Receive push from server ─────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: 'AnesLearn', body: e.data.text() }; }

  const options = {
    body:    data.body  || '',
    icon:    data.icon  || '/icon-192.png',
    badge:   data.badge || '/icon-192.png',
    tag:     data.tag   || 'aneslearn',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  e.waitUntil(self.registration.showNotification(data.title || 'AnesLearn', options));
});

// ── Show notification directly (called via postMessage from app) ─────────────
// This is the simple path: the app already has the payload, just show it locally.
// It also attempts a best-effort fetch to the push endpoint (works when SW
// has network access, silently skips if not).
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'SEND_PUSH') return;

  const { payload } = e.data;
  let data = {};
  try { data = JSON.parse(payload); } catch {}

  // Show the notification on the recipient's device if THEY are the ones
  // logged in (local notification path — instant, no server needed).
  // For cross-device delivery the SQL trigger path is needed; this handles
  // same-device or same-browser scenarios.
  e.waitUntil(
    self.registration.showNotification(data.title || 'AnesLearn', {
      body:    data.body || '',
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      tag:     'kudos',
      data:    { url: data.url || '/' },
      vibrate: [200, 100, 200],
    })
  );
});

// ── Notification click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
