"use strict";

const SHELL_CACHE = "claude-archive-shell-v3";
const SCOPE_URL = self.registration.scope;
const SHELL_FILES = [
  SCOPE_URL,
  new URL("styles.css", SCOPE_URL).href,
  new URL("cloud-config.js", SCOPE_URL).href,
  new URL("cloud-data-source.js", SCOPE_URL).href,
  new URL("claude-api-chat.js", SCOPE_URL).href,
  new URL("app.js", SCOPE_URL).href,
  new URL("manifest.webmanifest", SCOPE_URL).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith(new URL("api/", SCOPE_URL).pathname)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match(SCOPE_URL))),
  );
});
