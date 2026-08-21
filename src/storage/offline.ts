import type { AppCache, OfflineOperation, Session } from '../types'

const LEGACY_CACHE_KEY = 'restapp.web.cache.v1'
const LEGACY_ADMIN_KEY = 'restapp.web.admin.v1'
const LEGACY_PIN_KEY = 'restapp.web.pin.v1'
const CACHE_PREFIX = 'restapp.web.cache.v2.'
const ADMIN_PREFIX = 'restapp.web.admin.v2.'
const PIN_PREFIX = 'restapp.web.pin.v2.'
const DEVICE_KEY = 'restapp.web.device-id.v1'
const ACTIVE_SCOPE_KEY = 'restapp.web.active-scope.v1'
const memoryStorage = new Map<string, string>()
function storageGet(key: string) { return typeof localStorage === 'undefined' ? memoryStorage.get(key) || null : localStorage.getItem(key) }
function storageSet(key: string, value: string) { if (typeof localStorage === 'undefined') memoryStorage.set(key, value); else localStorage.setItem(key, value) }
function storageRemove(key: string) { if (typeof localStorage === 'undefined') memoryStorage.delete(key); else localStorage.removeItem(key) }

let activeScope = storageGet(ACTIVE_SCOPE_KEY) || 'unconfigured'

function safeScope(scope: string) {
  return encodeURIComponent(scope || 'unconfigured')
}

export function getStorageScope() { return activeScope }

export function setStorageScope(scope: string) {
  activeScope = scope || 'unconfigured'
  storageSet(ACTIVE_SCOPE_KEY, activeScope)
}

function scopedKey(prefix: string, scope = activeScope) { return `${prefix}${safeScope(scope)}` }

export function getDeviceId() {
  let value = storageGet(DEVICE_KEY)
  if (!value) { value = `web-${crypto.randomUUID()}`; storageSet(DEVICE_KEY, value) }
  return value
}

export function saveCache(cache: AppCache, scope = activeScope) {
  const current = readCache(scope)
  storageSet(scopedKey(CACHE_PREFIX, scope), JSON.stringify({ ...current, ...cache, scopeKey: scope }))
}

export function readCache(scope = activeScope): AppCache {
  try {
    const scoped = storageGet(scopedKey(CACHE_PREFIX, scope))
    if (scoped) return JSON.parse(scoped)
    // One-time compatibility for the previous single-tenant build. It is only
    // read before a tenant scope exists; the first scoped write separates it.
    if (scope === 'unconfigured') return JSON.parse(storageGet(LEGACY_CACHE_KEY) || '{}')
    return {}
  } catch { return {} }
}

export function saveSession(session: Session, scope = activeScope) {
  const key = session.kind === 'admin' ? scopedKey(ADMIN_PREFIX, scope) : scopedKey(PIN_PREFIX, scope)
  storageSet(key, JSON.stringify({ ...session, scopeKey: scope }))
  if (session.kind === 'pin') setStorageScope(scope)
}

export function readSession(kind: 'admin' | 'pin', scope = activeScope): Session | null {
  try {
    const key = kind === 'admin' ? scopedKey(ADMIN_PREFIX, scope) : scopedKey(PIN_PREFIX, scope)
    const value = storageGet(key) || (scope === 'unconfigured' ? storageGet(kind === 'admin' ? LEGACY_ADMIN_KEY : LEGACY_PIN_KEY) : null)
    return value ? JSON.parse(value) : null
  } catch { return null }
}

export function clearSession(kind: 'admin' | 'pin', scope = activeScope) {
  storageRemove(scopedKey(kind === 'admin' ? ADMIN_PREFIX : PIN_PREFIX, scope))
  if (scope === 'unconfigured') storageRemove(kind === 'admin' ? LEGACY_ADMIN_KEY : LEGACY_PIN_KEY)
}

let dbPromise: Promise<IDBDatabase> | null = null
function db() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB no disponible'))
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('restapp-offline', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('outbox', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

export async function enqueue(operation: OfflineOperation) {
  const database = await db(); const value = { ...operation, scope: operation.scope || activeScope }
  await new Promise<void>((resolve, reject) => { const tx = database.transaction('outbox', 'readwrite'); tx.objectStore('outbox').put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
}

export async function updateOutbox(operation: OfflineOperation) {
  return enqueue(operation)
}

export async function listOutbox(scope = activeScope): Promise<OfflineOperation[]> {
  const database = await db(); return new Promise((resolve, reject) => { const request = database.transaction('outbox').objectStore('outbox').getAll(); request.onsuccess = () => resolve((request.result as OfflineOperation[]).filter(operation => operation.scope === scope)); request.onerror = () => reject(request.error) })
}

export async function removeOutbox(id: string) {
  const database = await db(); await new Promise<void>((resolve, reject) => { const tx = database.transaction('outbox', 'readwrite'); tx.objectStore('outbox').delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
}

export function newIdempotencyKey() { return crypto.randomUUID() }
