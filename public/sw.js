/* global self, caches, URL, fetch */

const CACHE_VERSION = 'mesero-shell-v2'
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/branding/mesero-app-icon.png',
  '/favicon.ico',
  '/favicon.png',
  '/icons/mesero-192.png',
  '/icons/mesero-512.png',
  '/icons/mesero-1024.png',
  '/sounds/bell.mp3',
  '/sounds/service-bell.mp3',
  '/sounds/service-bell-strikes.mp3',
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone()
      caches.open(CACHE_VERSION).then(cache => cache.put('/index.html', copy))
      return response
    }).catch(() => caches.match('/index.html')))
    return
  }

  event.respondWith(caches.match(request).then(cached => {
    const network = fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        caches.open(CACHE_VERSION).then(cache => cache.put(request, copy))
      }
      return response
    })
    return cached || network
  }))
})
