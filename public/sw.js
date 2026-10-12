/* FBS Portal: phone and computer alerts (Away mode, the Job watcher). Only notifications: no page caching, so the
   portal always loads fresh. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let m = null;
    try { m = e.data ? e.data.json() : null; } catch (_) { m = null; }
    if (!m) m = { title: "FBS Portal", body: "Something needs you. Tap to see it.", url: "/shop/alerts" };
    const nav = self.navigator;
    try { if (nav && nav.setAppBadge) await nav.setAppBadge(); } catch (_) { /* no badge */ }
    await self.registration.showNotification(m.title || "FBS Portal", {
      body: m.body || "", tag: m.tag || undefined, renotify: !!m.tag,
      icon: "/icon-192.png", badge: "/icon-192.png", data: { url: m.url || "/shop" },
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/shop", self.location.origin).href;
  e.waitUntil((async () => {
    try { if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge(); } catch (_) { /* fine */ }
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if (new URL(c.url).origin === self.location.origin && "focus" in c) { await c.focus(); if ("navigate" in c) await c.navigate(url); return; } }
    await self.clients.openWindow(url);
  })());
});
