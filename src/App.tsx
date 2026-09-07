import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, ApiError, API_BASE_URL, normalizeAttendance } from './api/client'
import type { AttendanceRecord, Branch, DeliveryExecutive, DeliverySettings, DeviceBinding, KitchenPlace, KitchenTicket, KitchenView, MenuItem, ModifierGroup, ModifierOption, NotificationSettings, OfflineOperation, OfflineStep, OfflineWorkflow, OrderDraft, OrderLine, OrderMode, PaymentMethodOption, RestaurantTable, Session, StaffRole, WaiterRequest } from './types'
import { clearSession, enqueue, getDeviceId, getStorageScope, listOutbox, newIdempotencyKey, readCache, readSession, removeOutbox, saveCache, saveSession, setStorageScope, updateOutbox } from './storage/offline'
import { CustomerModal } from './CustomerModal'
import { ArrowLeftFromLine, ArrowRightLeft, Bell, CalendarDays, Check, ChefHat, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, CloudOff, Clock, Coffee, ConciergeBell, CreditCard, Delete, Divide, Flower2 as Spa, Globe, Globe2, Lock, LogOut, Map, Martini, Menu, Minus, Moon, Plus, Printer, RefreshCw, Search, Sun, Truck, Unlock, UserCheck, UserCircle2, UserRound, UsersRound, UserX, Utensils, UtensilsCrossed, Wallet, Wine, Wifi, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Haptics } from '@capacitor/haptics'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Network } from '@capacitor/network'
import { normalizeReceiptSettings } from './receipt/profile'
import { buildReceiptDocumentViewModel } from './receipt/renderer'

type Screen = 'setup' | 'branches' | 'pin' | 'floor'
type LiveNotification = { id: string; type: string; title: string; message: string; createdAt?: string; unread: boolean }

const statusLabels: Record<RestaurantTable['status'], string> = { available: 'Libre', occupied: 'Ocupada · orden abierta', waiting_kitchen: 'En cocina', food_ready: 'Lista para entregar', bill_requested: 'Cuenta pendiente', locked: 'Bloqueada', unknown: 'Sin estado' }
const statusColors: Record<RestaurantTable['status'], string> = { available: 'table-available', occupied: 'table-occupied', waiting_kitchen: 'table-waiting', food_ready: 'table-ready', bill_requested: 'table-bill', locked: 'table-locked', unknown: 'table-unknown' }
function roleLabel(role?: StaffRole) { return role === 'cajero' ? 'cajero' : role === 'chef' ? 'cocina' : role === 'repartidor' ? 'repartidor' : role === 'head' ? 'encargado' : 'mesero' }
function notificationTypeLabel(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (normalized === 'food ready' || normalized === 'plato listo') return 'Plato listo'
  if (normalized === 'availability' || normalized === 'disponibilidad') return 'Disponibilidad'
  if (normalized === 'order' || normalized === 'pedido') return 'Pedido'
  return 'Aviso'
}
function orderNumberLabel(value: unknown, fallback: string) {
  const text = String(value || '').trim()
  if (!text) return fallback
  if (/^\d+$/.test(text)) return `Pedido n.º ${text}`
  return text.replace(/^order\s*#?/i, 'Pedido n.º ').replace(/^orden\s*#?/i, 'Pedido n.º ')
}
function kitchenTicketLabel(value: unknown, id: number) {
  const text = String(value || '').trim()
  if (!text) return `Comanda n.º ${id}`
  return /^kot\s*[-#]?/i.test(text) ? `Comanda n.º ${text.replace(/^kot\s*[-#]?/i, '')}` : text
}

function orderProgressLabel(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!normalized) return 'Estado no publicado'
  if (normalized.includes('food ready') || normalized.includes('ready for pickup') || normalized.includes('listo')) return 'Lista para entregar'
  if (normalized.includes('prepar') || normalized.includes('in kitchen') || normalized.includes('cocina')) return 'En preparación'
  if (normalized.includes('confirm')) return 'Confirmado'
  if (normalized.includes('served') || normalized.includes('servido')) return 'Servido'
  if (normalized.includes('completed') || normalized.includes('complet')) return 'Completado'
  if (normalized.includes('placed') || normalized.includes('pending') || normalized.includes('kot') || normalized.includes('enviado')) return 'Enviado a cocina'
  return String(value)
}

function orderStartedAt(payload: any) {
  return payload?.created_at || payload?.createdAt || payload?.order?.created_at || payload?.order?.createdAt || payload?.placed_at || payload?.order?.placed_at || null
}

function extractOrderItems(payload: any): any[] {
  const candidates = [payload?.items, payload?.order?.items, payload?.order_items, payload?.data?.items, payload?.data?.order?.items, payload?.data?.data?.items, payload?.data?.data?.order?.items]
  return candidates.find(value => Array.isArray(value)) || []
}

function useElapsedSince(value: unknown) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!value) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [value])
  if (!value) return ''
  const started = Date.parse(String(value))
  if (!Number.isFinite(started)) return ''
  const minutes = Math.max(0, Math.floor((now - started) / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function tenantScope(value: Partial<Session> & { restaurantHash?: string; restaurantId?: number; branchId?: number }) {
  const tenant = String(value.restaurantHash || value.restaurantId || 'tenant-unknown').trim().toLowerCase()
  return `${tenant}:branch:${value.branchId || 'all'}`
}

function isRetryableOffline(cause: unknown) { return !(cause instanceof ApiError) || cause.status >= 500 }

// The backend publishes the active restaurant currency in /platform/config.
// This fallback is only for the first offline paint; it is replaced after
// hydrate() receives the server configuration.
let activeCurrency = { symbol: 'RD$', code: 'DOP', decimals: 2 }
function formatMoney(value: number) { return `${activeCurrency.symbol} ${Number(value || 0).toFixed(activeCurrency.decimals)}` }

function responseData(value: any): any { return value?.data ?? value }

const defaultNotificationSettings: NotificationSettings = { sound: 'service-bell', vibration: true, volume: 0.85 }
const defaultPaymentMethods: PaymentMethodOption[] = [
  { code: 'cash', label: 'Efectivo', enabled: true },
  { code: 'card', label: 'Tarjeta', enabled: true },
  { code: 'bank_transfer', label: 'Transferencia bancaria', enabled: true },
]
const notificationSoundUrls: Record<Exclude<NotificationSettings['sound'], 'none'>, string> = {
  bell: '/sounds/bell.mp3',
  'service-bell': '/sounds/service-bell.mp3',
  'service-bell-strikes': '/sounds/service-bell-strikes.mp3',
}

async function playWaiterAlert(settings: NotificationSettings = defaultNotificationSettings, title = 'Llamada de mesa', body = 'Hay una llamada pendiente en sala.') {
  if (settings.sound !== 'none') {
    const audio = new Audio(notificationSoundUrls[settings.sound])
    audio.volume = Math.max(0, Math.min(1, Number(settings.volume ?? defaultNotificationSettings.volume)))
    void audio.play().catch(() => { /* el navegador puede exigir una interacción previa para reproducir audio */ })
  }
  if (settings.vibration && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate([180, 80, 180])
  if (!Capacitor.isNativePlatform()) return
  try {
    if (settings.vibration) await Haptics.vibrate({ duration: 360 })
    const permission = await LocalNotifications.checkPermissions()
    if (permission.display !== 'granted') return
    await LocalNotifications.schedule({ notifications: [{ id: Date.now() % 2147483647, title, body, channelId: 'waiter-calls', sound: settings.sound === 'none' ? undefined : 'service_bell.mp3' }] })
  } catch {
    // El sonido web y navigator.vibrate siguen siendo el respaldo en Android/web.
  }
}

async function prepareNativeFeatures() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await LocalNotifications.createChannel({ id: 'waiter-calls', name: 'Llamadas de mesa', description: 'Avisos de llamadas nuevas desde las mesas.', importance: 5, sound: 'service_bell.mp3', vibration: true, lights: true })
    const permissions = await LocalNotifications.checkPermissions()
    if (permissions.display === 'prompt') await LocalNotifications.requestPermissions()
  } catch {
    // Android/web sin el permiso aún conserva el flujo de sonido configurable.
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [adminSession, setAdminSession] = useState<Session | null>(null)
  const [pinSession, setPinSession] = useState<Session | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [activeBranch, setActiveBranch] = useState<Branch | null>(null)
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [kitchenPlaces, setKitchenPlaces] = useState<KitchenPlace[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>(defaultPaymentMethods)
  const [activeTable, setActiveTable] = useState<RestaurantTable | null>(null)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem('restapp:theme')
      return stored === 'dark' || stored === 'light' ? stored : 'light'
    } catch {
      return 'light'
    }
  })
  const [queueCount, setQueueCount] = useState(0)
  const [restaurantName, setRestaurantName] = useState('RestaPP')
  const [restaurantHash, setRestaurantHash] = useState('')
  const [staffRole, setStaffRole] = useState<StaffRole>('mesero')
  const [, setCurrencyVersion] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const deviceId = useMemo(() => getDeviceId(), [])
  const syncInFlight = useRef<Promise<void> | null>(null)
  const pinSessionRef = useRef<Session | null>(null)

  useEffect(() => { pinSessionRef.current = pinSession }, [pinSession])

  useEffect(() => {
    const online = () => { setOffline(false); void syncOutbox() }
    const offlineEvent = () => setOffline(true)
    let nativeNetworkListener: { remove: () => Promise<void> } | undefined
    window.addEventListener('online', online); window.addEventListener('offline', offlineEvent)
    void prepareNativeFeatures()
    if (Capacitor.isNativePlatform()) {
      void Network.addListener('networkStatusChange', status => { if (status.connected) online(); else offlineEvent() }).then(listener => { nativeNetworkListener = listener })
      void Network.getStatus().then(status => { if (status.connected) online(); else offlineEvent() }).catch(() => undefined)
    }
    void restore()
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offlineEvent); void nativeNetworkListener?.remove() }
    // The restore routine intentionally runs once at app boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('restapp:theme', theme) } catch { /* ignore */ }
  }, [theme])

  useEffect(() => {
    if (screen !== 'floor' || !pinSession || offline) return
    let cancelled = false
    const pollFloorTables = async () => {
      try {
        if (!pinSession.permissions['tables.view']) return
        const remoteTables = await api.tables('pin')
        if (cancelled || !Array.isArray(remoteTables)) return
        setTables(remoteTables)
        setActiveTable(current => current ? remoteTables.find(t => t.id === current.id) || current : current)
        saveCache({ tables: remoteTables, branchId: pinSession.branchId, scopeKey: pinSession.scopeKey || tenantScope(pinSession) })
      } catch {
        // Fallback silencioso en segundo plano sin interrumpir la interfaz
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void pollFloorTables()
    }
    const timer = window.setInterval(pollFloorTables, 3_000)
    window.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', pollFloorTables)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', pollFloorTables)
    }
  }, [screen, pinSession, offline])

  async function restore() {
    const cachedPin = readSession('pin')
    const cachedAdmin = readSession('admin')
    const restoredScope = cachedPin?.scopeKey || (cachedPin ? tenantScope(cachedPin) : cachedAdmin?.scopeKey || getStorageScope())
    setStorageScope(restoredScope)
    let cache = readCache(restoredScope)
    if (cachedPin && !cache.scopeKey) {
      const legacy = readCache('unconfigured')
      if (Object.keys(legacy).length) { saveCache({ ...legacy, scopeKey: restoredScope }, restoredScope); cache = readCache(restoredScope) }
    }
    if (cache.currency?.symbol || cache.currency?.code) {
      activeCurrency = { symbol: String(cache.currency.symbol || cache.currency.code), code: String(cache.currency.code || ''), decimals: Number(cache.currency.decimals ?? 2) }
      setCurrencyVersion(value => value + 1)
    }
    setBranches(cache.branches || [])
    setTables(cache.tables || [])
    setItems(cache.menuItems || [])
    setKitchenPlaces(cache.kotPlaces || [])
    if (Array.isArray(cache.paymentMethods) && cache.paymentMethods.length) setPaymentMethods(cache.paymentMethods)
    setRestaurantHash(cache.restaurantHash || '')
    setRestaurantName(cache.restaurantName || 'RestaPP')
    setQueueCount((await safeOutbox()).length)
    if (cachedPin) {
      const restored = { ...cachedPin, scopeKey: restoredScope, roleKey: cachedPin.roleKey || 'mesero' as StaffRole }
      api.setToken('pin', restored.token); setPinSession(restored); setStaffRole(restored.roleKey || 'mesero'); setActiveBranch((cache.branches || []).find(b => b.id === restored.branchId) || null); setScreen('floor'); void hydrate(restored)
    } else if (cachedAdmin) {
      api.setToken('admin', cachedAdmin.token); setAdminSession(cachedAdmin); setScreen('branches')
    } else if (cache.deviceBinding?.configured) {
      const binding = cache.deviceBinding
      const branch = binding.branchId ? { id: binding.branchId, name: binding.branchName || `Sucursal ${binding.branchId}`, restaurantId: binding.restaurantId, restaurantHash: binding.restaurantHash } : null
      setRestaurantHash(binding.restaurantHash || '')
      setRestaurantName(binding.restaurantName || 'RestaPP')
      setBranches(branch ? [branch] : [])
      setActiveBranch(branch)
      setNotice('Dispositivo reconocido. Solo falta el código personal.')
      setScreen('pin')
    } else if (navigator.onLine) {
      // Device resolution is public and read-only. Once the owner has claimed
      // this browser, recover the tenant and branch without repeating setup.
      try {
        const binding = await api.resolveDevice(deviceId)
        if (binding?.configured) {
          const branch = binding.branchId ? { id: binding.branchId, name: binding.branchName || `Sucursal ${binding.branchId}`, restaurantId: binding.restaurantId, restaurantHash: binding.restaurantHash } : null
          const nextScope = tenantScope({ restaurantHash: binding.restaurantHash, restaurantId: binding.restaurantId, branchId: binding.branchId })
          setStorageScope(nextScope)
          setRestaurantHash(binding.restaurantHash || '')
          setRestaurantName(binding.restaurantName || 'RestaPP')
          setBranches(branch ? [branch] : [])
          setActiveBranch(branch)
          saveCache({ deviceBinding: binding, restaurantHash: binding.restaurantHash, restaurantName: binding.restaurantName, branchId: binding.branchId, branches: branch ? [branch] : [], scopeKey: nextScope }, nextScope)
          setNotice('Dispositivo reconocido. Solo falta el código personal.')
          setScreen('pin')
        }
      } catch { /* the setup form remains available when the public resolver is unavailable */ }
    }
  }

  async function safeOutbox(): Promise<OfflineOperation[]> { try { return await listOutbox(getStorageScope()) } catch { return [] } }

  async function hydrate(session: Session) {
    if (!navigator.onLine) return
    try {
      // Cashiers and waiters may create orders even when the server does not
      // expose the legacy `menu.view` slug for their role. The catalog is a
      // read-only dependency of order creation, so load it for any role that
      // can create an order. Keep `null` on transport/auth failures so a
      // transient outage never erases a usable offline catalog.
      const canLoadCatalog = session.permissions['menu.view'] || session.permissions['orders.create']
      const [remoteTables, remoteItems, config, remoteOrders, remoteKots, remoteKitchenPlaces, remoteNotifications, remoteReceiptSettings, remotePrinters, remotePaymentMethods] = await Promise.all([
        session.permissions['tables.view'] ? api.tables('pin').catch(() => []) : Promise.resolve([]),
        canLoadCatalog ? api.menuItems('pin').catch(() => null) : Promise.resolve(null),
        api.config('pin').catch(() => null),
        session.permissions['payments.charge'] ? api.orders('pin').catch(() => null) : Promise.resolve(null),
        session.permissions['kitchen.manage'] ? api.kots('pin').catch(() => null) : Promise.resolve(null),
        session.permissions['kitchen.manage'] ? api.kotPlaces('pin').catch(() => null) : Promise.resolve(null),
        api.notifications('pin').catch(() => null),
        api.receiptSettings('pin').catch(() => null),
        api.printers('pin').catch(() => null),
        session.permissions['payments.charge'] ? api.paymentMethods('pin').catch(() => null) : Promise.resolve(null),
      ])
      const enrichedItems = Array.isArray(remoteItems)
        ? await Promise.all(remoteItems.map(async item => {
          if (item.modifiers !== undefined) return item
          try { return { ...item, modifiers: await api.modifierGroups('pin', item.id) } }
          catch { return item }
        }))
        : null
      const currency = config?.restaurant?.currency
      if (currency?.symbol || currency?.code) {
        activeCurrency = { symbol: String(currency.symbol || currency.code), code: String(currency.code || ''), decimals: Number(currency.decimals ?? 2) }
        setCurrencyVersion(value => value + 1)
      }
      const cachePatch: any = { tables: remoteTables, branchId: session.branchId, currency: activeCurrency, scopeKey: session.scopeKey || tenantScope(session) }
      if (enrichedItems) cachePatch.menuItems = enrichedItems
      if (remoteOrders) cachePatch.orders = remoteOrders
      if (remoteKots) cachePatch.kots = remoteKots
      if (remoteKitchenPlaces) { cachePatch.kotPlaces = remoteKitchenPlaces; setKitchenPlaces(remoteKitchenPlaces) }
      if (remoteNotifications) cachePatch.notifications = remoteNotifications
      if (remoteReceiptSettings) cachePatch.receiptSettings = remoteReceiptSettings
      if (remotePrinters) cachePatch.printers = remotePrinters
      if (Array.isArray(remotePaymentMethods)) {
        cachePatch.paymentMethods = remotePaymentMethods
        setPaymentMethods(remotePaymentMethods.length ? remotePaymentMethods : [])
      }
      if (Array.isArray(config?.modules)) cachePatch.modules = config.modules.map((module: unknown) => String(typeof module === 'string' ? module : (module as any)?.name || '')).filter(Boolean)
      if (config?.features && typeof config.features === 'object') cachePatch.features = config.features
      setTables(remoteTables); setActiveTable(current => current ? remoteTables.find(table => table.id === current.id) || current : current); if (enrichedItems) setItems(enrichedItems); saveCache(cachePatch)
    } catch (cause) {
      if (!tables.length && !items.length) setError(cause instanceof Error ? cause.message : 'No se pudo cargar el catálogo.')
    }
  }

  async function handleAdminLogin(email: string, password: string) {
    setLoading(true); setError('')
    try {
      const session = await api.loginAdmin(email, password)
      const me = await api.me('admin').catch(() => ({}))
      const config = await api.config('admin').catch(() => ({}))
      const user = me?.user || me?.data?.user || me || {}
      const hash = session.restaurantHash || user.restaurant?.hash || config.restaurant?.hash || ''
      const name = user.restaurant?.name || user.restaurant?.restaurant_name || config.restaurant?.name || session.userName
      const next = { ...session, restaurantHash: hash, restaurantId: user.restaurant_id || session.restaurantId, scopeKey: tenantScope({ ...session, restaurantHash: hash, restaurantId: user.restaurant_id || session.restaurantId }) }
      setStorageScope(next.scopeKey); setActiveTable(null); setTables([]); setItems([]); setAdminSession(next); setRestaurantHash(hash); setRestaurantName(name); saveSession(next, next.scopeKey); saveCache({ restaurantHash: hash, restaurantName: name, scopeKey: next.scopeKey }, next.scopeKey)
      const nextBranches = await api.branches('admin')
      setBranches(nextBranches); saveCache({ branches: nextBranches }, next.scopeKey); setScreen('branches')
    } catch (cause) { setError(normalizeError(cause, 'No se pudo iniciar sesión administrativa.')) }
    finally { setLoading(false) }
  }

  async function chooseBranch(branch: Branch) {
    setLoading(true); setError('')
    try {
      if (!adminSession) throw new Error('La sesión administrativa expiró.')
      if (!offline) {
        await api.switchBranch('admin', branch.id)
        const registration = await api.registerDevice({ ...adminSession, branchId: branch.id }, deviceId, branch.id)
        const registrationData = (registration as any)?.data ?? registration
        const binding: DeviceBinding = { deviceId, deviceName: registrationData?.device_name || 'RestaPP Mesero Web', restaurantId: nextAdminRestaurantId(adminSession), restaurantHash: adminSession.restaurantHash, restaurantName, branchId: branch.id, branchName: branch.name, claimedAt: new Date().toISOString(), configured: true }
        saveCache({ deviceBinding: binding }, tenantScope({ ...adminSession, branchId: branch.id }))
      }
      const nextAdmin = { ...adminSession, branchId: branch.id }
      const branchScope = tenantScope(nextAdmin)
      setStorageScope(branchScope); setActiveTable(null); setTables([]); setItems([]); setActiveBranch(branch); setAdminSession({ ...nextAdmin, scopeKey: branchScope }); saveCache({ branchId: branch.id, scopeKey: branchScope }, branchScope);
      if (!offline) { await api.logout('admin'); clearSession('admin', adminSession.scopeKey || tenantScope(adminSession)) }
      setRestaurantHash(nextAdmin.restaurantHash || readCache(branchScope).restaurantHash || ''); setScreen('pin'); setNotice(offline ? 'Sin conexión: utilice una sesión de sala validada previamente.' : 'Dispositivo autorizado. Ya puede ingresar con su código personal.')
    } catch (cause) { setError(normalizeError(cause, 'No se pudo vincular la sucursal.')) }
    finally { setLoading(false) }
  }

  async function handlePin(pin: string) {
    setLoading(true); setError('')
    try {
      if (offline) {
        const cached = readSession('pin')
        if (!cached) throw new Error('No hay una sesión local guardada para trabajar sin conexión.')
        const scoped = { ...cached, scopeKey: cached.scopeKey || tenantScope(cached) }
        setStorageScope(scoped.scopeKey); setActiveTable(null); api.setToken('pin', scoped.token); setPinSession(scoped); setScreen('floor'); await hydrate(scoped); return
      }
      const session = await api.loginPin(pin, restaurantHash || readCache().restaurantHash || '', deviceId, staffRole)
      let permissionMap = session.permissions
      try {
        const permissionPayload = await api.permissions('pin')
        if (permissionPayload?.permission_map && typeof permissionPayload.permission_map === 'object') permissionMap = permissionPayload.permission_map
      } catch { /* el mapa devuelto por el acceso sigue siendo la fuente válida */ }
      const next = { ...session, permissions: permissionMap, branchId: activeBranch?.id || session.branchId }
      const scoped = { ...next, scopeKey: tenantScope(next) }
      setStorageScope(scoped.scopeKey); setActiveTable(null); setPinSession(scoped); saveSession(scoped, scoped.scopeKey); setScreen('floor'); setNotice(`Sesión ${roleLabel(scoped.roleKey)} activa.`); await hydrate(scoped)
    } catch (cause) { setError(normalizeError(cause, 'Código personal no válido o dispositivo no autorizado.')) }
    finally { setLoading(false) }
  }

  async function handleDirectPin(pin: string, hash: string, linkedDeviceId: string, role: StaffRole) {
    setLoading(true); setError('')
    try {
      if (offline) throw new Error('Sin conexión: el acceso con código personal requiere una validación previa con conexión.')
      const session = await api.loginPin(pin, hash.trim(), linkedDeviceId.trim(), role)
      let permissionMap = session.permissions
      try {
        const permissionPayload = await api.permissions('pin')
        if (permissionPayload?.permission_map && typeof permissionPayload.permission_map === 'object') permissionMap = permissionPayload.permission_map
      } catch { /* el mapa devuelto por el acceso sigue siendo la fuente válida */ }
      const next = { ...session, permissions: permissionMap, branchId: session.branchId }
      const scoped = { ...next, restaurantHash: hash.trim(), scopeKey: tenantScope({ ...next, restaurantHash: hash.trim() }) }
      setStorageScope(scoped.scopeKey); setActiveTable(null); setStaffRole(role); setPinSession(scoped); saveSession(scoped, scoped.scopeKey); setRestaurantHash(hash.trim())
      let branch = next.branchId ? { id: next.branchId, name: `Sucursal ${next.branchId}` } as Branch : null
      try { branch = (await api.branches('pin')).find(value => value.id === next.branchId) || branch } catch { /* branch label is optional */ }
      setActiveBranch(branch); saveCache({ restaurantHash: hash.trim(), restaurantName: restaurantName || 'RestaPP', branchId: scoped.branchId, branches: branch ? [branch] : [], scopeKey: scoped.scopeKey }, scoped.scopeKey); setScreen('floor'); setNotice(`Código personal validado. Sesión de ${roleLabel(scoped.roleKey)} activa.`); await hydrate(scoped)
    } catch (cause) { setError(normalizeError(cause, 'Código personal no válido, identificador incorrecto o dispositivo no autorizado.')) }
    finally { setLoading(false) }
  }

  function updateTableLocally(tableId: number, updater: (table: RestaurantTable) => RestaurantTable) {
    const nextTables = tables.map(table => table.id === tableId ? updater(table) : table)
    setTables(nextTables)
    setActiveTable(current => current?.id === tableId ? updater(current) : current)
    saveCache({ tables: nextTables, branchId: pinSession?.branchId, scopeKey: pinSession?.scopeKey || getStorageScope() })
  }

  function makeStep(method: OfflineStep['method'], path: string, body: unknown, idempotencyKey: string = newIdempotencyKey()): OfflineStep { return { method, path, body, idempotencyKey } }

  function makeWorkflow(steps: OfflineStep[], options: Partial<OfflineWorkflow> = {}): OfflineOperation {
    const first = steps[0]
    return { id: crypto.randomUUID(), scope: pinSession?.scopeKey || getStorageScope(), method: first.method, path: first.path, body: first.body, idempotencyKey: first.idempotencyKey, createdAt: new Date().toISOString(), workflow: { type: 'sequence', stage: 0, steps, ...options } }
  }

  async function executeWorkflow(operation: OfflineOperation): Promise<{ remoteOrderId?: number; firstResponse?: unknown }> {
    if (!operation.workflow) {
      try {
        const response = await api.request(operation.path, { method: operation.method, tokenKind: 'pin', headers: { 'Idempotency-Key': operation.idempotencyKey }, body: JSON.stringify(operation.body) })
        await removeOutbox(operation.id)
        return { firstResponse: response }
      } catch (cause) {
        if (cause instanceof ApiError && cause.status < 500) await removeOutbox(operation.id)
        throw cause
      }
    }
    let workflow: OfflineWorkflow = { ...operation.workflow, steps: operation.workflow.steps.map(step => ({ ...step })) }
    let firstResponse: unknown
    while (workflow.stage < workflow.steps.length) {
      const step = workflow.steps[workflow.stage]
      if (step.path.includes('{{orderId}}') && workflow.remoteOrderId == null) throw new ApiError('La operación sin conexión no tiene una orden válida en el servidor.', 422)
      const path = step.path.replace(/\{\{orderId\}\}/g, workflow.remoteOrderId == null ? '' : String(workflow.remoteOrderId))
      if (!path) throw new ApiError('La operación sin conexión no tiene una ruta válida.', 422)
      let response: unknown
      try {
        response = await api.request(path, { method: step.method, tokenKind: 'pin', headers: { 'Idempotency-Key': step.idempotencyKey }, body: JSON.stringify(step.body) })
      } catch (cause) {
        if (cause instanceof ApiError && cause.status < 500) await removeOutbox(operation.id)
        else await updateOutbox({ ...operation, scope: operation.scope || getStorageScope(), workflow })
        throw cause
      }
      if (workflow.stage === 0) firstResponse = response
      if (workflow.remoteOrderId == null && step.path === '/pos/orders') {
        const data = responseData(response)
        const remoteOrderId = Number(data?.id || data?.order_id || data?.order?.id || data?.data?.id)
        if (!remoteOrderId) { await removeOutbox(operation.id); throw new ApiError('El servicio creó la orden, pero no devolvió su identificador.', 422) }
        workflow = { ...workflow, remoteOrderId }
      }
      workflow = { ...workflow, stage: workflow.stage + 1 }
      await updateOutbox({ ...operation, scope: operation.scope || getStorageScope(), workflow })
    }
    await removeOutbox(operation.id)
    return { remoteOrderId: workflow.remoteOrderId, firstResponse }
  }

  async function queueAndRun(operation: OfflineOperation) {
    await enqueue(operation)
    setQueueCount((await safeOutbox()).length)
    if (navigator.onLine && api.getToken('pin')) return executeWorkflow(operation)
    return { remoteOrderId: operation.workflow?.remoteOrderId }
  }

  async function appendToPendingLocalOrder(localOrderId: number, itemPayload: unknown[]) {
    const operation = (await safeOutbox()).find(value => value.workflow?.localOrderId === localOrderId && value.workflow.stage === 0 && value.workflow.steps[0]?.path === '/pos/orders')
    if (!operation?.workflow) return false
    const first = operation.workflow.steps[0]
    const body = (first.body && typeof first.body === 'object' ? first.body : {}) as Record<string, unknown>
    first.body = { ...body, items: [...(Array.isArray(body.items) ? body.items : []), ...itemPayload] }
    operation.body = first.body
    await updateOutbox(operation)
    return true
  }

  async function syncOutbox() {
    if (syncInFlight.current) return syncInFlight.current
    const run = (async () => {
      if (!navigator.onLine || !api.getToken('pin')) return
      setIsSyncing(true)
      try {
        const operations = await safeOutbox(); setQueueCount(operations.length)
        let processed = 0
        for (const operation of operations) {
          try { await executeWorkflow(operation); processed++ }
          catch { break }
        }
        const remaining = await safeOutbox(); setQueueCount(remaining.length)
        const currentSession = pinSessionRef.current
        if (processed > 0 && currentSession && navigator.onLine) {
          await hydrate(currentSession)
          setNotice(`${processed} movimiento${processed === 1 ? '' : 's'} actualizado${processed === 1 ? '' : 's'} en el sistema.`)
        }
      } finally {
        setIsSyncing(false)
      }
    })()
    syncInFlight.current = run
    try { await run } finally { syncInFlight.current = null }
  }

  async function submitOrder(lines: OrderLine[], table: RestaurantTable | null, draft: OrderDraft) {
    if (!pinSession || !lines.length) return
    // Production accepts the order reliably when the initial create is kept to
    // its minimal contract. Table/waiter/KOT state is applied in the update
    // step below; sending all of it in the create request currently triggers a
    // generic 500 in the upstream controller.
    const itemPayload = lines.map(line => ({ id: line.itemId, menu_item_id: line.itemId, quantity: line.quantity, price: line.price, note: [seatLabel(line.seatNumber), line.note].filter(Boolean).join(' · ') || undefined, seat_number: typeof line.seatNumber === 'number' ? line.seatNumber : undefined, modifiers: line.modifiers.map(m => ({ id: m.id, name: m.name, price: m.price })) }))
    const customerPayload = draft.customerName || draft.customerPhone || draft.customerEmail || draft.rncCedula || draft.fiscalName ? {
      name: draft.customerName,
      phone: draft.customerPhone,
      email: draft.customerEmail,
      rnc_cedula: draft.rncCedula,
      fiscal_name: draft.fiscalName,
    } : undefined
    const body = { uuid: newIdempotencyKey(), order_type: draft.mode === 'delivery' ? 'Delivery' : draft.mode === 'pickup' ? 'Pickup' : 'Dine In', items: itemPayload, customer: customerPayload, customer_id: draft.customerId || undefined, delivery_address: draft.deliveryAddress || undefined, delivery_time: draft.deliveryTime ? new Date(draft.deliveryTime).toISOString() : undefined, delivery_fee: draft.deliveryFee !== undefined ? draft.deliveryFee : undefined, delivery_executive_id: draft.deliveryExecutiveId !== undefined ? draft.deliveryExecutiveId : undefined }
    if (draft.existingOrderId) {
      if (draft.existingOrderId < 0) {
        const appended = await appendToPendingLocalOrder(draft.existingOrderId, itemPayload)
        if (!appended) throw new Error('La orden local está pendiente de sincronización; espere a que se restablezca la conexión.')
        const delta = lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0)
        updateTableLocally(table?.id || 0, current => ({ ...current, status: 'waiting_kitchen', currentOrderTotal: Number(current.currentOrderTotal || 0) + delta, currentOrderDue: Number(current.currentOrderDue || 0) + delta, customerName: draft.customerName || current.customerName, customerId: draft.customerId || current.customerId }))
        setQueueCount((await safeOutbox()).length); setNotice('Artículos agregados a la orden local; se enviarán juntos a cocina al restablecerse la conexión.')
        return
      }
      const steps: OfflineStep[] = [makeStep('PUT', `/pos/orders/${draft.existingOrderId}/items`, { items: itemPayload, recalculate_totals: true })]
      if (draft.customerName?.trim()) {
        const orderUpdate: Record<string, unknown> = { customer_id: draft.customerId || table?.customerId, customer: customerPayload }
        if (draft.rncCedula) orderUpdate.rnc_cedula = draft.rncCedula
        if (draft.fiscalName) orderUpdate.fiscal_name = draft.fiscalName
        steps.push(makeStep('PUT', `/pos/orders/${draft.existingOrderId}`, orderUpdate))
      }
      // The backend selects only order_items not already linked to a KOT, so a
      // repeated sync cannot print the previous KOT a second time.
      steps.push(makeStep('POST', `/pos/orders/${draft.existingOrderId}/kot`, { note: 'Artículos adicionales desde RestaPP Mesero' }))
      const operation = makeWorkflow(steps, { remoteOrderId: draft.existingOrderId, label: 'append-order' })
      try {
        await queueAndRun(operation)
        updateTableLocally(table?.id || 0, current => ({ ...current, status: 'waiting_kitchen', currentOrderTotal: Number(current.currentOrderTotal || 0) + lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0), currentOrderDue: Number(current.currentOrderDue || 0) + lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0), customerName: draft.customerName?.trim() || current.customerName, customerId: draft.customerId || current.customerId }))
        setNotice(navigator.onLine ? `Artículos agregados a la orden n.º ${table?.currentOrderNumber || draft.existingOrderId} y enviados a cocina.` : `Artículos guardados para la orden n.º ${table?.currentOrderNumber || draft.existingOrderId}; se enviarán a cocina al restablecerse la conexión.`)
      } catch (cause) {
        if (isRetryableOffline(cause)) setNotice(`Artículos guardados para la orden n.º ${table?.currentOrderNumber || draft.existingOrderId}; se reintentará al restablecerse la conexión.`)
        else throw cause
      }
      return
    }

    const localOrderId = table && draft.mode === 'dine_in' ? -Date.now() : undefined
    const update: Record<string, unknown> = { waiter_id: pinSession.userId, actions: ['kot'] }
    if (draft.mode === 'dine_in' && table) update.table_id = table.id
    const operation = makeWorkflow([
      makeStep('POST', '/pos/orders', body),
      makeStep('PUT', '/pos/orders/{{orderId}}', update),
      makeStep('POST', '/pos/orders/{{orderId}}/kot', { note: 'Enviado desde RestaPP Mesero' }),
    ], { localOrderId, label: 'create-order' })
    try {
      const result = await queueAndRun(operation)
      if (!navigator.onLine || !result.remoteOrderId) {
        if (table && localOrderId) updateTableLocally(table.id, current => ({ ...current, status: 'waiting_kitchen', currentOrderId: localOrderId, currentOrderNumber: `P-${Math.abs(localOrderId) % 100000}`, currentOrderTotal: lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0), currentOrderDue: lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0), customerName: draft.customerName || current.customerName }))
        setNotice('Orden guardada localmente; la mesa y la comanda se sincronizarán al restablecerse la conexión.')
      } else {
        const data = responseData(result.firstResponse)
        setNotice(`${draft.mode === 'delivery' ? 'Entrega a domicilio' : draft.mode === 'pickup' ? 'Retiro en el local' : 'Comanda'} n.º ${result.remoteOrderId} enviada a cocina.${formatFiscalSummary(data)}`)
      }
    } catch (cause) {
      if (!isRetryableOffline(cause)) throw cause
      if (table && localOrderId) updateTableLocally(table.id, current => ({ ...current, status: 'waiting_kitchen', currentOrderId: localOrderId, currentOrderNumber: `P-${Math.abs(localOrderId) % 100000}`, currentOrderTotal: lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0), currentOrderDue: lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0), customerName: draft.customerName || current.customerName }))
      setQueueCount((await safeOutbox()).length); setNotice('Orden guardada localmente; se enviará a cocina al restablecerse la conexión.')
    }
  }

  async function saveTableCustomer(table: RestaurantTable, name: string, customerId?: number, rncCedula?: string, fiscalName?: string) {
    if (!pinSession || !table.currentOrderId || !name.trim()) return
    const customerPayload: Record<string, unknown> = { name: name.trim() }
    if (rncCedula) customerPayload.rnc_cedula = rncCedula
    if (fiscalName) customerPayload.fiscal_name = fiscalName
    if (table.currentOrderId < 0) {
      const operation = (await safeOutbox()).find(value => value.workflow?.localOrderId === table.currentOrderId && value.workflow?.stage === 0)
      if (!operation?.workflow) throw new Error('La orden local está pendiente de sincronización; espere a que se restablezca la conexión.')
      const first = operation.workflow.steps[0]
      const body = (first.body && typeof first.body === 'object' ? first.body : {}) as Record<string, unknown>
      first.body = { ...body, customer: { ...((body.customer && typeof body.customer === 'object' ? body.customer : {}) as Record<string, unknown>), ...customerPayload }, customer_id: customerId || table.customerId }
      operation.body = first.body
      await updateOutbox(operation)
      updateTableLocally(table.id, current => ({ ...current, customerName: name.trim(), customerId: customerId || current.customerId }))
      setQueueCount((await safeOutbox()).length); setNotice(`Cliente ${name.trim()} guardado localmente; se sincronizará al restablecerse la conexión.`)
      return
    }
    const updateBody: Record<string, unknown> = { customer_id: customerId || table.customerId, customer: customerPayload }
    if (rncCedula) updateBody.rnc_cedula = rncCedula
    if (fiscalName) updateBody.fiscal_name = fiscalName
    const operation = makeWorkflow([makeStep('PUT', `/pos/orders/${table.currentOrderId}`, updateBody)], { remoteOrderId: table.currentOrderId, label: 'customer-name' })
    try {
      await queueAndRun(operation)
      updateTableLocally(table.id, current => ({ ...current, customerName: name.trim(), customerId: customerId || current.customerId }))
      setNotice(navigator.onLine ? `Cliente ${name.trim()} guardado en la mesa ${table.number}.` : `Cliente ${name.trim()} guardado localmente; se sincronizará al restablecerse la conexión.`)
      if (navigator.onLine) await hydrate(pinSession)
    } catch (cause) {
      if (!isRetryableOffline(cause)) throw cause
      updateTableLocally(table.id, current => ({ ...current, customerName: name.trim(), customerId: customerId || current.customerId }))
      setQueueCount((await safeOutbox()).length); setNotice(`Cliente ${name.trim()} guardado localmente; se sincronizará al restablecerse la conexión.`)
    }
  }

  async function removeOrderItem(orderId: number, orderItemId: number, itemName: string) {
    if (orderId < 0) throw new Error('La orden local todavía no tiene una confirmación en el sistema.')
    const operation = makeWorkflow([
      makeStep('PUT', `/pos/orders/${orderId}/items`, { items: [{ action: 'remove', order_item_id: orderItemId }], recalculate_totals: true }, newIdempotencyKey()),
    ], { remoteOrderId: orderId, label: `remove-order-item:${itemName}` })
    try {
      const result = await queueAndRun(operation)
      if (navigator.onLine && result.firstResponse && pinSessionRef.current) await hydrate(pinSessionRef.current)
      const message = !navigator.onLine ? 'Artículo retirado localmente; se sincronizará al recuperar la conexión.' : `Artículo retirado de la orden n.º ${orderId}.`
      setNotice(message)
      return { queued: !navigator.onLine || !result.firstResponse, message }
    } catch (cause) {
      if (!isRetryableOffline(cause)) throw cause
      setQueueCount((await safeOutbox()).length)
      const message = 'Artículo retirado localmente; se sincronizará al recuperar la conexión.'
      setNotice(message)
      return { queued: true, message }
    }
  }

  async function printPreBill(orderId: number, idempotencyKey: string) {
    if (orderId < 0) {
      const pending = (await safeOutbox()).find(value => value.workflow?.localOrderId === orderId && value.workflow.stage === 0)
      if (!pending?.workflow) return { queued: true, message: 'La precuenta se imprimirá al confirmar la orden con el sistema.' }
      pending.workflow.steps.push(makeStep('POST', '/pos/orders/{{orderId}}/print', { document: 'prebill' }, idempotencyKey))
      await updateOutbox(pending); setQueueCount((await safeOutbox()).length)
      return { queued: true, message: 'Precuenta guardada; se imprimirá al sincronizar la orden cuando se restablezca la conexión.' }
    }
    const operation = makeWorkflow([makeStep('POST', `/pos/orders/${orderId}/print`, { document: 'prebill' }, idempotencyKey)], { remoteOrderId: orderId, label: 'prebill-print' })
    try {
      const result = await queueAndRun(operation)
      return { queued: !navigator.onLine || !result.firstResponse, message: !navigator.onLine ? 'Precuenta guardada; se enviará a la impresora al restablecerse la conexión.' : 'Precuenta enviada a la impresora de la sucursal.' }
    } catch (cause) {
      if (!isRetryableOffline(cause)) throw cause
      setQueueCount((await safeOutbox()).length)
      return { queued: true, message: 'Precuenta guardada; se enviará a la impresora al restablecerse la conexión.' }
    }
  }

  async function payOrder(orderId: number, amount: number, method: string, idempotencyKey: string) {
    const operation = makeWorkflow([makeStep('POST', `/pos/orders/${orderId}/pay`, { amount, method }, idempotencyKey)], { remoteOrderId: orderId, label: 'payment' })
    try {
      const result = await queueAndRun(operation)
      // The production POS contract releases a dine-in table only after the
      // payment response has been accepted. Refresh the floor from the API so
      // the card turns green from the server's state, never from a local guess.
      if (navigator.onLine && result.firstResponse && pinSessionRef.current) await hydrate(pinSessionRef.current)
      return { queued: !navigator.onLine || !result.firstResponse, message: !navigator.onLine ? 'Cobro guardado como pendiente; se validará al restablecerse la conexión.' : 'Cobro registrado exitosamente.' }
    } catch (cause) {
      if (!isRetryableOffline(cause)) throw cause
      setQueueCount((await safeOutbox()).length)
      return { queued: true, message: 'Cobro guardado como pendiente; se validará al restablecerse la conexión.' }
    }
  }

  async function transferTableOrder(fromTable: RestaurantTable, targetTable: RestaurantTable) {
    if (!fromTable.currentOrderId) return { queued: false, message: 'La mesa no tiene una orden activa.' }
    const orderId = fromTable.currentOrderId
    const targetTableId = targetTable.id
    if (orderId < 0) {
      // Local offline order reassignment
      updateTableLocally(fromTable.id, current => ({ ...current, status: 'available', currentOrderId: undefined, currentOrderNumber: undefined, currentOrderTotal: undefined, currentOrderDue: undefined, customerName: undefined, customerId: undefined }))
      updateTableLocally(targetTable.id, current => ({ ...current, status: fromTable.status, currentOrderId: orderId, currentOrderNumber: fromTable.currentOrderNumber, currentOrderTotal: fromTable.currentOrderTotal, currentOrderDue: fromTable.currentOrderDue, customerName: fromTable.customerName, customerId: fromTable.customerId }))
      setNotice(`Orden movida localmente a Mesa ${targetTable.number}.`)
      return { queued: true, message: `Orden movida localmente a Mesa ${targetTable.number}.` }
    }
    const operation = makeWorkflow([makeStep('PUT', `/pos/orders/${orderId}`, { table_id: targetTableId }, newIdempotencyKey())], { remoteOrderId: orderId, label: 'transfer-table' })
    try {
      const result = await queueAndRun(operation)
      updateTableLocally(fromTable.id, current => ({ ...current, status: 'available', currentOrderId: undefined, currentOrderNumber: undefined, currentOrderTotal: undefined, currentOrderDue: undefined, customerName: undefined, customerId: undefined }))
      updateTableLocally(targetTable.id, current => ({ ...current, status: fromTable.status, currentOrderId: orderId, currentOrderNumber: fromTable.currentOrderNumber, currentOrderTotal: fromTable.currentOrderTotal, currentOrderDue: fromTable.currentOrderDue, customerName: fromTable.customerName, customerId: fromTable.customerId }))
      if (navigator.onLine && result.firstResponse && pinSessionRef.current) await hydrate(pinSessionRef.current)
      const msg = navigator.onLine ? `Orden transferida con éxito a Mesa ${targetTable.number}.` : `Cambio a Mesa ${targetTable.number} guardado localmente.`
      setNotice(msg)
      return { queued: !navigator.onLine || !result.firstResponse, message: msg }
    } catch (cause) {
      if (!isRetryableOffline(cause)) throw cause
      updateTableLocally(fromTable.id, current => ({ ...current, status: 'available', currentOrderId: undefined, currentOrderNumber: undefined, currentOrderTotal: undefined, currentOrderDue: undefined, customerName: undefined, customerId: undefined }))
      updateTableLocally(targetTable.id, current => ({ ...current, status: fromTable.status, currentOrderId: orderId, currentOrderNumber: fromTable.currentOrderNumber, currentOrderTotal: fromTable.currentOrderTotal, currentOrderDue: fromTable.currentOrderDue, customerName: fromTable.customerName, customerId: fromTable.customerId }))
      setQueueCount((await safeOutbox()).length)
      const msg = `Cambio a Mesa ${targetTable.number} guardado localmente; se sincronizará al volver la conexión.`
      setNotice(msg)
      return { queued: true, message: msg }
    }
  }

  async function cashAction(method: OfflineStep['method'], path: string, body: unknown, idempotencyKey: string, successMessage: string) {
    const operation = makeWorkflow([makeStep(method, path, body, idempotencyKey)], { label: 'cash-register' })
    try {
      const result = await queueAndRun(operation)
      return { queued: !navigator.onLine || !result.firstResponse, message: !navigator.onLine ? 'Operación de caja guardada; se validará al restablecerse la conexión.' : successMessage, data: responseData(result.firstResponse) }
    } catch (cause) {
      if (!isRetryableOffline(cause)) throw cause
      setQueueCount((await safeOutbox()).length)
      return { queued: true, message: 'Operación de caja guardada; se validará al restablecerse la conexión.', data: undefined }
    }
  }

  async function openCashSession(registerId: number, openingFloat: number, note: string, idempotencyKey: string) {
    return cashAction('POST', '/pos/cash-register/sessions/open', { cash_register_id: registerId, opening_float: openingFloat || undefined, note: note.trim() || undefined }, idempotencyKey, 'Turno de caja abierto con éxito.')
  }

  async function closeCashSession(sessionId: number, countedCash: number, expectedCash: number | undefined, note: string, sendForApproval: boolean, idempotencyKey: string) {
    return cashAction('POST', `/pos/cash-register/sessions/${sessionId}/close`, { counted_cash: countedCash, expected_cash: expectedCash, closing_note: note.trim() || undefined, send_for_approval: sendForApproval, require_approval_on_discrepancy: true }, idempotencyKey, sendForApproval ? 'Cierre enviado para aprobación.' : 'Turno de caja cerrado con éxito.')
  }

  async function approveCashSession(sessionId: number, idempotencyKey: string) {
    return cashAction('POST', `/pos/cash-register/sessions/${sessionId}/approve`, {}, idempotencyKey, 'Cierre de caja aprobado.')
  }

  async function rejectCashSession(sessionId: number, note: string, idempotencyKey: string) {
    return cashAction('POST', `/pos/cash-register/sessions/${sessionId}/reject`, { manager_note: note.trim() || undefined }, idempotencyKey, 'Cierre de caja devuelto para revisión.')
  }

  async function reopenCashSession(sessionId: number, idempotencyKey: string) {
    return cashAction('POST', `/pos/cash-register/sessions/${sessionId}/reopen`, {}, idempotencyKey, 'Turno de caja reabierto.')
  }

  async function cashMovement(movement: 'cash-in' | 'cash-out' | 'safe-drop', _sessionId: number, amount: number, note: string, idempotencyKey: string) {
    return cashAction('POST', `/pos/cash-register/transactions/${movement}`, { amount, reason: note.trim() || undefined }, idempotencyKey, movement === 'cash-in' ? 'Entrada de efectivo registrada.' : movement === 'cash-out' ? 'Salida de efectivo registrada.' : 'Retiro a caja fuerte registrado.')
  }

  async function clockInAttendance(idempotencyKey: string) {
    if (!pinSession) throw new Error('La sesión personal expiró.')
    const operation = makeWorkflow([makeStep('POST', '/staff/attendance/clock-in', { device_id: deviceId }, idempotencyKey)], { label: 'attendance-clock-in' })
    const result = await queueAndRun(operation)
    const data = responseData(result.firstResponse)
    const remote = data?.attendance || data?.current || data?.data || data
    const local: AttendanceRecord = remote?.id ? normalizeAttendance(remote) : { id: -Date.now(), userId: pinSession.userId || 0, userName: pinSession.userName, branchId: pinSession.branchId, clockInAt: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', status: 'active', source: 'offline', deviceId }
    saveCache({ currentAttendance: local })
    return { queued: !result.firstResponse, message: result.firstResponse ? 'Entrada registrada con éxito.' : 'Entrada guardada localmente; se sincronizará al recuperar la conexión.', attendance: local }
  }

  async function clockOutAttendance(idempotencyKey: string) {
    if (!pinSession) throw new Error('La sesión personal expiró.')
    const operation = makeWorkflow([makeStep('POST', '/staff/attendance/clock-out', {}, idempotencyKey)], { label: 'attendance-clock-out' })
    const result = await queueAndRun(operation)
    const data = responseData(result.firstResponse)
    const remote = data?.attendance || data?.current || data?.data || data
    const current = readCache().currentAttendance
    const local: AttendanceRecord = remote?.id ? normalizeAttendance(remote) : current ? { ...current, clockOutAt: new Date().toISOString(), status: 'closed' } : { id: -Date.now(), userId: pinSession.userId || 0, userName: pinSession.userName, branchId: pinSession.branchId, clockInAt: new Date().toISOString(), clockOutAt: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', status: 'closed', source: 'offline', deviceId }
    saveCache({ currentAttendance: local })
    return { queued: !result.firstResponse, message: result.firstResponse ? 'Salida registrada con éxito.' : 'Salida guardada localmente; se sincronizará al recuperar la conexión.', attendance: local }
  }

  async function updateKotStatus(kotId: number, status: string, idempotencyKey: string) {
    const operation = makeWorkflow([makeStep('PUT', `/pos/kots/${kotId}/status`, { status }, idempotencyKey)], { label: 'kot-status' })
    try {
      const result = await queueAndRun(operation)
      return { queued: !navigator.onLine || !result.firstResponse, message: !navigator.onLine ? 'Estado guardado localmente; cocina lo sincronizará al restablecerse la conexión.' : 'Estado de cocina actualizado.' }
    } catch (cause) {
      if (!isRetryableOffline(cause)) throw cause
      setQueueCount((await safeOutbox()).length)
      return { queued: true, message: 'Estado guardado localmente; se sincronizará al restablecerse la conexión.' }
    }
  }

  async function logout() {
    try { if (pinSession && api.getToken('pin')) await api.logout('pin') } catch { /* session is cleared locally below */ }
    clearSession('pin'); setPinSession(null); setActiveTable(null); setTables([]); setItems([])
    // Device provisioning is independent from the employee session. Keep the
    // tenant/branch binding and return to PIN instead of forcing setup again.
    setScreen('pin'); setNotice('Sesión cerrada. Introduzca el código del siguiente empleado.')
  }

  if (screen === 'setup') return <SetupScreen loading={loading} error={error} defaultDeviceId={deviceId} onSubmit={handleAdminLogin} onDirectPin={handleDirectPin} />
  if (screen === 'branches') return <BranchScreen branches={branches} loading={loading} error={error} offline={offline} onSelect={chooseBranch} onBack={() => { clearSession('admin'); setScreen('setup') }} />
  if (screen === 'pin') return <PinScreen brand={restaurantName} branch={activeBranch?.name || ''} role={staffRole} onRoleChange={setStaffRole} offline={offline} loading={loading} error={error} notice={notice} onSubmit={handlePin} canChangeBranch={Boolean(adminSession)} onBack={() => setScreen('branches')} theme={theme} onTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
  return <FloorScreen brand={restaurantName} branch={activeBranch?.name || ''} roleKey={pinSession?.roleKey || staffRole} userId={pinSession?.userId} deviceId={deviceId} permissions={pinSession?.permissions || {}} tables={tables} items={items} kitchenPlaces={kitchenPlaces} paymentMethods={paymentMethods} offline={offline} queueCount={queueCount} isSyncing={isSyncing} notice={notice} error={error} theme={theme} onTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')} onLogout={logout} onRefresh={() => pinSession && hydrate(pinSession)} onSubmitOrder={submitOrder} onSaveCustomer={saveTableCustomer} onRemoveOrderItem={removeOrderItem} onPrintPreBill={printPreBill} onPayOrder={payOrder} onTransferTable={transferTableOrder} onOpenCashSession={openCashSession} onCloseCashSession={closeCashSession} onApproveCashSession={approveCashSession} onRejectCashSession={rejectCashSession} onReopenCashSession={reopenCashSession} onCashMovement={cashMovement} onClockIn={clockInAttendance} onClockOut={clockOutAttendance} onUpdateKotStatus={updateKotStatus} onSelectTable={setActiveTable} activeTable={activeTable} />
}

function nextAdminRestaurantId(session: Session) { return session.restaurantId }

function SetupScreen({ loading, error, defaultDeviceId, onSubmit, onDirectPin }: { loading: boolean; error: string; defaultDeviceId: string; onSubmit: (email: string, password: string) => void; onDirectPin: (pin: string, hash: string, deviceId: string, role: StaffRole) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [hash, setHash] = useState(''); const [linkedDeviceId, setLinkedDeviceId] = useState(defaultDeviceId); const [pin, setPin] = useState(''); const [role, setRole] = useState<StaffRole>('mesero')
  return <main className="auth-shell"><section className="auth-card"><div className="brand-mark"><img src="/branding/mesero-app-icon.png" alt="RestaPP" /></div><p className="eyebrow">RESTAURANTE · SALA Y CAJA</p><h1>Configurar terminal</h1><p className="muted">El administrador autoriza esta terminal una sola vez. Después, cada empleado ingresa con su código personal y perfil asignado.</p><form onSubmit={e => { e.preventDefault(); onSubmit(email, password) }}><label>Correo del administrador<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="dueno@restaurante.com" autoComplete="username" /></label><label>Contraseña<input required type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label><button className="button primary full" disabled={loading}>{loading ? 'Conectando…' : 'Iniciar sesión'}</button></form><div className="setup-divider"><span>o</span></div><details className="direct-entry"><summary>Ya tengo una terminal autorizada</summary><p className="muted">Indique el código del restaurante, el nombre de la terminal, su código personal y su rol en sala o cocina.</p><form onSubmit={e => { e.preventDefault(); onDirectPin(pin, hash, linkedDeviceId, role) }}><label>Perfil<select value={role} onChange={e => setRole(e.target.value as StaffRole)}><option value="mesero">Mesero</option><option value="chef">Cocina</option><option value="cajero">Cajero</option><option value="head">Encargado</option><option value="repartidor">Repartidor</option></select></label><label>Código del restaurante<input required value={hash} onChange={e => setHash(e.target.value)} placeholder="kebab" autoComplete="off" /></label><label>Identificador de terminal<input required value={linkedDeviceId} onChange={e => setLinkedDeviceId(e.target.value)} autoComplete="off" /></label><label>Código personal (PIN)<input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" autoComplete="one-time-code" /><small>El código personal nunca se guarda de forma insegura.</small></label><button className="button outline full" disabled={loading || pin.length !== 4}>{loading ? 'Validando…' : `Ingresar como ${roleLabel(role)}`}</button></form></details>{error && <Alert>{error}</Alert>}<p className="tiny">Conectado a la plataforma de gestión</p></section></main>
}

function BranchScreen({ branches, loading, error, offline, onSelect, onBack }: { branches: Branch[]; loading: boolean; error: string; offline: boolean; onSelect: (branch: Branch) => void; onBack: () => void }) {
  return <main className="page padded"><header className="simple-header"><button className="icon-button" onClick={onBack}><ChevronLeft /></button><div><p className="eyebrow">AUTORIZACIÓN DEL DISPOSITIVO</p><h1>Seleccione la sucursal</h1></div>{offline && <CloudOff className="warning-icon" />}</header><div className="branch-grid">{branches.length ? branches.map(branch => <button className="branch-card" key={branch.id} onClick={() => onSelect(branch)} disabled={loading}><Map size={24} /><span>{branch.name}</span><small>Identificador {branch.id}</small></button>) : <div className="empty"><p>No hay sucursales disponibles.</p><button className="button outline" onClick={onBack}>Volver a configurar</button></div>}</div>{error && <Alert>{error}</Alert>}</main>
}

function RestaurantMark() {
  return (
    <div className="brand-mark brand-mark--restaurant" aria-hidden="true">
      <Utensils size={31} strokeWidth={1.3} />
    </div>
  )
}

function HotelMark() {
  return (
    <div className="hotel-monogram" aria-hidden="true">
      <span className="hotel-leaf">♧</span>
      <span className="hotel-h">H</span>
    </div>
  )
}

function FooterCategories({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`categories ${dark ? 'categories--dark' : ''}`}>
      {!dark ? (
        <>
          <div><Utensils /><span>RESTAURANTES</span></div>
          <i />
          <div><Coffee /><span>CAFETERÍAS</span></div>
          <i />
          <div><Martini /><span>BARES</span></div>
        </>
      ) : (
        <>
          <div><ConciergeBell /><span>HOTELES</span></div>
          <i />
          <div><Spa /><span>SPA</span></div>
          <i />
          <div><UsersRound /><span>EVENTOS</span></div>
        </>
      )}
    </div>
  )
}

function PinScreen({ brand, branch, role, onRoleChange, offline, loading, error, notice, onSubmit, canChangeBranch, onBack, theme, onTheme }: { brand: string; branch: string; role: StaffRole; onRoleChange: (role: StaffRole) => void; offline: boolean; loading: boolean; error: string; notice: string; onSubmit: (pin: string) => void; canChangeBranch: boolean; onBack: () => void; theme?: 'light' | 'dark'; onTheme?: () => void }) {
  const [pin, setPin] = useState('')
  const press = (key: string) => {
    if (loading) return
    if (key === 'backspace') return setPin(p => p.slice(0, -1))
    if (pin.length < 4) {
      const next = pin + key
      setPin(next)
      if (next.length === 4) window.setTimeout(() => onSubmit(next), 120)
    }
  }
  const clearPin = () => setPin('')
  const isDark = theme === 'dark'

  const roleDisplayMap: Record<StaffRole, string> = {
    cajero: 'Cajero',
    mesero: 'Mesero',
    chef: 'Chef',
    head: 'Gerente',
    repartidor: 'Repartidor',
  }
  const roleValueMap: Record<string, StaffRole> = {
    'Cajero': 'cajero',
    'Mesero': 'mesero',
    'Chef': 'chef',
    'Gerente': 'head',
    'Repartidor': 'repartidor',
    'Recepción': 'cajero',
    'Conserjería': 'mesero',
    'Caja': 'cajero',
  }

  const options = isDark
    ? ['Recepción', 'Gerente', 'Conserjería', 'Caja']
    : ['Cajero', 'Mesero', 'Chef', 'Gerente']

  const keys = ['1','2','3','4','5','6','7','8','9','0','backspace']

  return (
    <main className="hospitality-shell">
      {/* Top Floating Controls */}
      <div className="hospitality-top-bar">
        {canChangeBranch ? (
          <button type="button" className="hospitality-pill-btn" onClick={onBack}>
            <ChevronLeft size={16} /> Cambiar de sucursal
          </button>
        ) : <span />}
        {onTheme && (
          <button type="button" className="hospitality-pill-btn" onClick={onTheme} title={`Cambiar a modo ${isDark ? 'claro' : 'oscuro'}`} aria-label="Cambiar tema">
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
            <span>{isDark ? 'Modo claro' : 'Modo oscuro'}</span>
          </button>
        )}
      </div>

      <section className={`half ${isDark ? 'half--dark' : 'half--light'}`}>
        <div className={`background-image ${isDark ? 'hotel-image' : 'restaurant-image'}`} />
        
        {!isDark ? (
          <div className="side-copy side-copy--left">
            <h1>Buena<br/>comida<br/>mejores<br/>historias</h1>
            <span className="copy-rule"/>
            <p>LA HOSPITALIDAD<br/>TAMBIÉN<br/>SE SIRVE</p>
          </div>
        ) : (
          <div className="center-tag">
            <span>HOSPITALIDAD</span>
            <span>QUE INSPIRA</span>
            <i/>
          </div>
        )}

        <div className={`login-card ${isDark ? 'login-card--dark' : 'login-card--light'}`}>
          <div className="card-language">
            <Globe2 size={15} />
            <span>ES</span>
            <ChevronDown size={15} />
          </div>

          <div className="brand-zone">
            {isDark ? <HotelMark /> : <RestaurantMark />}
            <div className={`brand-name ${isDark ? 'hotel-name' : ''}`}>
              {brand ? brand.toUpperCase() : (isDark ? 'BELLAVISTA' : 'LA TAVOLA')}
            </div>
            <div className="brand-subtitle">{branch ? branch.toUpperCase() : (isDark ? 'HOTEL & SPA' : 'RESTAURANTE')}</div>
          </div>

          <div className="short-rule" />
          <h2>Portal de acceso</h2>
          <p className="card-kicker">{isDark ? 'Un gran servicio comienza aquí' : 'Nuestro equipo hace la diferencia'}</p>

          <label className="profile-select">
            <UserRound size={25} strokeWidth={1.7} />
            <span className="profile-copy">
              <small>Seleccionar perfil</small>
              <select
                value={roleDisplayMap[role] || (isDark ? 'Recepción' : 'Cajero')}
                disabled={offline || loading}
                onChange={e => {
                  clearPin()
                  const selectedRole = roleValueMap[e.target.value] || 'mesero'
                  onRoleChange(selectedRole)
                }}
              >
                {options.map(o => <option key={o}>{o}</option>)}
              </select>
            </span>
            <ChevronDown size={20} className="select-chevron" />
          </label>

          <div className={`pin-dots ${error ? 'has-error' : ''} ${notice ? 'has-success' : ''}`} aria-label={`${pin.length} de 4 dígitos ingresados`}>
            {[0, 1, 2, 3].map(i => <span key={i} className={i < pin.length ? 'active' : ''} />)}
          </div>

          <div className="keypad">
            {keys.map(key => (
              <button
                type="button"
                key={key}
                disabled={loading}
                className={`pin-key ${key === '0' ? 'pin-key--zero' : ''} ${key === 'backspace' ? 'pin-key--back' : ''}`}
                onClick={() => press(key)}
                aria-label={key === 'backspace' ? 'Borrar' : `Número ${key}`}
              >
                {key === 'backspace' ? <ArrowLeftFromLine size={22} strokeWidth={1.9} /> : key}
              </button>
            ))}
          </div>

          <div className="card-footer-rule" />
          <p className="session-title">Sesión cerrada.</p>
          <p className={`session-copy ${error ? 'error' : ''} ${notice ? 'success' : ''}`}>
            {loading ? 'Validando código personal…' : error ? 'Código incorrecto. Intente de nuevo.' : notice || (offline ? 'Sin conexión · sesión local' : 'Introduce el código del siguiente empleado.')}
          </p>
        </div>

        {isDark ? (
          <>
            <div className="side-copy side-copy--right">
              <h1>Personas<br/>que crean<br/>estancias<br/>inolvidables</h1>
              <span className="copy-rule"/>
              <p>HOTELERÍA<br/>ES ARTE<br/>EN CADA DETALLE</p>
            </div>
            <FooterCategories dark />
            <div className="bottom-claim">GRANDES<br/>EXPERIENCIAS<br/>SIEMPRE</div>
          </>
        ) : (
          <FooterCategories />
        )}
      </section>
    </main>
  )
}

function FloorScreen({ brand, branch, roleKey, userId, deviceId, permissions, tables, items, kitchenPlaces, paymentMethods, offline, queueCount, isSyncing, notice, error, theme, onTheme, onLogout, onRefresh, onSubmitOrder, onSaveCustomer, onRemoveOrderItem, onPrintPreBill, onPayOrder, onTransferTable, onOpenCashSession, onCloseCashSession, onApproveCashSession, onRejectCashSession, onReopenCashSession, onCashMovement, onClockIn, onClockOut, onUpdateKotStatus, onSelectTable, activeTable }: { brand: string; branch: string; roleKey: StaffRole; userId?: number; deviceId: string; permissions: Record<string, boolean>; tables: RestaurantTable[]; items: MenuItem[]; kitchenPlaces: KitchenPlace[]; paymentMethods: PaymentMethodOption[]; offline: boolean; queueCount: number; isSyncing?: boolean; notice: string; error: string; theme: 'light' | 'dark'; onTheme: () => void; onLogout: () => void; onRefresh: () => void; onSubmitOrder: (lines: OrderLine[], table: RestaurantTable | null, draft: OrderDraft) => Promise<void>; onSaveCustomer: (table: RestaurantTable, name: string) => Promise<void>; onRemoveOrderItem: (orderId: number, orderItemId: number, itemName: string) => Promise<{ queued: boolean; message: string }>; onPrintPreBill: (orderId: number, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>; onPayOrder: (orderId: number, amount: number, method: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>; onTransferTable?: (fromTable: RestaurantTable, targetTable: RestaurantTable) => Promise<{ queued: boolean; message: string }>; onOpenCashSession: (registerId: number, openingFloat: number, note: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onCloseCashSession: (sessionId: number, countedCash: number, expectedCash: number | undefined, note: string, sendForApproval: boolean, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onApproveCashSession: (sessionId: number, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onRejectCashSession: (sessionId: number, note: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onReopenCashSession: (sessionId: number, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onCashMovement: (movement: 'cash-in' | 'cash-out' | 'safe-drop', sessionId: number, amount: number, note: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onClockIn: (idempotencyKey: string) => Promise<{ queued: boolean; message: string; attendance: AttendanceRecord }>; onClockOut: (idempotencyKey: string) => Promise<{ queued: boolean; message: string; attendance: AttendanceRecord }>; onUpdateKotStatus: (kotId: number, status: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>; onSelectTable: (table: RestaurantTable | null) => void; activeTable: RestaurantTable | null }) {
  const [showMenu, setShowMenu] = useState(false); const [showQuick, setShowQuick] = useState(false); const [showOps, setShowOps] = useState(false); const [showKitchen, setShowKitchen] = useState(false); const [showCashier, setShowCashier] = useState(false); const [showAttendance, setShowAttendance] = useState(false); const [opsLoading, setOpsLoading] = useState(false); const [notifications, setNotifications] = useState<LiveNotification[]>([]); const [deliverySettings, setDeliverySettings] = useState<DeliverySettings | null>(null); const [deliveryExecutives, setDeliveryExecutives] = useState<DeliveryExecutive[]>([])
  const canCreate = permissions['orders.create'] === true
  const canDelivery = roleKey === 'cajero' && canCreate
  const canQuickSale = canDelivery
  const canCharge = permissions['payments.charge'] === true && paymentMethods.length > 0
  const canCashier = ['cash.view', 'cash.open', 'cash.close', 'cash.movement', 'cash.approve', 'payments.charge'].some(permission => permissions[permission] === true)
  const canKitchen = permissions['kitchen.manage'] === true
  const table = activeTable
  const [tableFilter, setTableFilter] = useState<'all' | 'available' | 'occupied' | 'prebill'>('all')
  const waiterSeenIds = useRef<Set<number> | null>(null)
  const seenNotificationIds = useRef<Set<string> | null>(null)
  const unreadNotifications = notifications.filter(notification => notification.unread).length
  async function markNotificationRead(notification: LiveNotification) {
    if (!notification.unread) return
    const next = notifications.map(value => value.id === notification.id ? { ...value, unread: false } : value)
    setNotifications(next)
    saveCache({ notifications: next })
    if (offline || !Number.isInteger(Number(notification.id))) return
    try { await api.markNotificationRead('pin', Number(notification.id)) } catch { /* el estado local se conserva hasta la siguiente sincronización */ }
  }
  useEffect(() => {
    if (offline) {
      const cached = readCache()
      // Offline hydration is a deliberate synchronization from the tenant cache.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotifications((cached.notifications || []).map(normalizeNotification).filter(Boolean) as LiveNotification[])
      setOpsLoading(false)
      return
    }
    let cancelled = false
    const load = async () => {
      setOpsLoading(true)
      try {
        const payload = await api.notifications('pin')
        saveCache({ notifications: payload })
        if (!cancelled) {
          const normalized = payload.map(normalizeNotification).filter(Boolean) as LiveNotification[]
          const currentIds = new Set(normalized.map(n => n.id))
          if (seenNotificationIds.current) {
            const newReady = normalized.find(n => !seenNotificationIds.current!.has(n.id) && (n.type.toLowerCase().includes('food') || n.type.toLowerCase().includes('ready') || n.title.toLowerCase().includes('listo') || n.message.toLowerCase().includes('listo')))
            if (newReady) {
              void playWaiterAlert(readCache().notificationSettings || defaultNotificationSettings, 'Plato Listo', `${newReady.title} · ${newReady.message}`)
            }
          }
          seenNotificationIds.current = currentIds
          setNotifications(normalized)
        }
      } catch { /* the floor remains usable if notifications are temporarily unavailable */ }
      finally { if (!cancelled) setOpsLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => void load(), 12_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [offline])
  useEffect(() => {
    if (!['mesero', 'cajero', 'head'].includes(roleKey)) return
    let cancelled = false
    const loadWaiterAlerts = async () => {
      if (offline) {
        const cached = readCache()
        waiterSeenIds.current = new Set((cached.waiterRequests || []).map(request => request.id))
        return
      }
      try {
        const rows = await api.waiterRequests('pin', 'pending')
        if (cancelled) return
        const nextIds = new Set(rows.map(request => request.id))
        const previousIds = waiterSeenIds.current
        if (previousIds && rows.some(request => !previousIds.has(request.id))) playWaiterAlert(readCache().notificationSettings || defaultNotificationSettings)
        waiterSeenIds.current = nextIds
        saveCache({ waiterRequests: rows })
      } catch { /* un perfil sin este permiso simplemente no recibe llamadas */ }
    }
    void loadWaiterAlerts()
    if (offline) return () => { cancelled = true }
    const timer = window.setInterval(() => void loadWaiterAlerts(), 5_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [offline, roleKey])
  useEffect(() => {
    if (!canDelivery) return
    if (offline) {
      const cached = readCache()
      // Offline hydration is a deliberate synchronization from the tenant cache.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeliverySettings(cached.deliverySettings ?? null)
      setDeliveryExecutives(cached.deliveryExecutives || [])
      return
    }
    let cancelled = false
    Promise.all([api.deliverySettings('pin'), api.deliveryExecutives('pin')]).then(([settings, executives]) => {
      if (cancelled) return
      setDeliverySettings(settings)
      setDeliveryExecutives(executives)
      saveCache({ deliverySettings: settings, deliveryExecutives: executives })
    }).catch(() => {
      if (!cancelled) { setDeliverySettings(null); setDeliveryExecutives([]) }
    })
    return () => { cancelled = true }
  }, [canDelivery, offline])
  useEffect(() => {
    const openWaiterAlerts = () => setShowOps(true)
    window.addEventListener('restapp:open-waiter-alerts', openWaiterAlerts)
    return () => window.removeEventListener('restapp:open-waiter-alerts', openWaiterAlerts)
  }, [])
  if (roleKey === 'chef') {
    return <main className="app-shell kitchen-only-app"><header className="app-header"><div className="brand-inline"><div className="brand-mini"><ChefHat size={19} /></div><div><strong>{brand}</strong><small>{branch} · cocina</small></div></div><div className="header-actions"><span className={offline ? 'status-pill offline' : 'status-pill'}>{offline ? <CloudOff size={15} /> : <Wifi size={15} />}{offline ? 'Sin conexión' : 'Con conexión'}</span>{isSyncing && <span className="syncing-pill"><RefreshCw size={14} className="spin-icon" /> Sincronizando…</span>}{queueCount > 0 && <span className="queue-pill">{queueCount} pendiente{queueCount > 1 ? 's' : ''}</span>}<button className="icon-button" onClick={onRefresh} title="Actualizar cocina"><Wifi size={19} /></button><button className="icon-button" onClick={onTheme} title="Cambiar tema">{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><button className="icon-button" onClick={onLogout} title="Cerrar sesión"><LogOut size={19} /></button></div></header>{(notice || error) && <div className="toast-stack">{notice && <div className="toast success"><Check size={16} />{notice}</div>}{error && <div className="toast error"><X size={16} />{error}</div>}</div>}<section className="kitchen-only-workspace"><div className="kitchen-only-heading"><div><p className="eyebrow">OPERACIÓN DE COCINA · {branch.toUpperCase()}</p><h1>Tablero de preparación</h1><p className="muted">Toque una comanda para avanzar su estado. Las nuevas órdenes avisan con sonido y vibración.</p></div><ChefHat size={36} /></div>{canKitchen ? <KitchenPanel offline={offline} places={kitchenPlaces} standalone allowAll={false} viewScope="chef" onClose={() => undefined} onUpdateStatus={onUpdateKotStatus} /> : <div className="kitchen-permission-block"><ChefHat size={34} /><h2>Acceso a cocina no asignado</h2><p>El código personal fue reconocido, pero este usuario aún no tiene asignado el permiso de gestión de cocina en esta sucursal. Solicite al encargado que habilite el acceso a cocina.</p></div>}</section></main>
  }
  return <main className="app-shell"><header className="app-header"><div className="brand-inline"><div className="brand-mini"><img src="/branding/mesero-app-icon.png" alt={brand || 'RestaPP'} /></div><div><strong>{brand}</strong><small>{branch} · {roleLabel(roleKey)}</small></div></div><div className="header-actions"><span className={offline ? 'status-pill offline' : 'status-pill'}>{offline ? <CloudOff size={15} /> : <Wifi size={15} />}{offline ? 'Sin conexión' : 'Con conexión'}</span>{isSyncing && <span className="syncing-pill"><RefreshCw size={14} className="spin-icon" /> Sincronizando…</span>}{queueCount > 0 && <span className="queue-pill">{queueCount} pendiente{queueCount > 1 ? 's' : ''}</span>}<button className="icon-button header-notification-button" onClick={() => setShowOps(true)} title="Avisos" aria-label={`Avisos${unreadNotifications ? ` (${unreadNotifications} sin leer)` : ''}`}><Bell size={19} />{unreadNotifications > 0 && <span className="notification-badge">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</button><button className="icon-button" onClick={onRefresh} title="Actualizar"><Wifi size={19} /></button><button className="icon-button" onClick={onTheme}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><button className="icon-button" onClick={onLogout}><LogOut size={19} /></button></div></header>{(notice || error) && <div className="toast-stack">{notice && <div className="toast success"><Check size={16} />{notice}</div>}{error && <div className="toast error"><X size={16} />{error}</div>}</div>}<section className="workspace"><div className="section-heading"><div><p className="eyebrow">OPERACIÓN DIARIA · {roleLabel(roleKey).toUpperCase()}</p><h1>Mapa de mesas</h1></div><div className="heading-actions"><div className="table-status-filter-pills" role="tablist" aria-label="Filtrar mesas"><button type="button" role="tab" aria-selected={tableFilter === 'all'} className={`table-filter-pill ${tableFilter === 'all' ? 'active' : ''}`} onClick={() => setTableFilter('all')}>Todas ({tables.length})</button><button type="button" role="tab" aria-selected={tableFilter === 'available'} className={`table-filter-pill green ${tableFilter === 'available' ? 'active' : ''}`} onClick={() => setTableFilter('available')}><i className="dot green" /> Libres ({tables.filter(t => t.status === 'available').length})</button><button type="button" role="tab" aria-selected={tableFilter === 'occupied'} className={`table-filter-pill red ${tableFilter === 'occupied' ? 'active' : ''}`} onClick={() => setTableFilter('occupied')}><i className="dot red" /> Ocupadas ({tables.filter(t => t.status === 'occupied' || t.status === 'waiting_kitchen' || t.status === 'food_ready').length})</button><button type="button" role="tab" aria-selected={tableFilter === 'prebill'} className={`table-filter-pill blue ${tableFilter === 'prebill' ? 'active' : ''}`} onClick={() => setTableFilter('prebill')}><i className="dot blue" /> En cuenta ({tables.filter(t => t.status === 'bill_requested').length})</button></div>{canQuickSale && <button className="button primary" onClick={() => setShowQuick(true)}><Plus size={17} /> Venta directa</button>}</div></div><div className="floor-grid">{(() => {
          const visibleTables = tables.filter(item => {
            if (tableFilter === 'available') return item.status === 'available';
            if (tableFilter === 'occupied') return item.status === 'occupied' || item.status === 'waiting_kitchen' || item.status === 'food_ready';
            if (tableFilter === 'prebill') return item.status === 'bill_requested';
            return true;
          });
          return visibleTables.length ? visibleTables.map(item => (
            <button key={item.id} className={`floor-table ${statusColors[item.status]}`} onClick={() => onSelectTable(item)}>
              <TableVisual table={item} />
              <span className="table-number">{item.number}</span>
              <strong>{statusLabels[item.status]}</strong>
              <small>{item.capacity} sillas{item.currentOrderNumber ? ` · n.º ${item.currentOrderNumber}` : ''}{item.customerName ? ` · ${item.customerName}` : ''}</small>
            </button>
          )) : (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              <ClipboardList size={40} />
              <p>{tableFilter === 'all' ? 'No hay mesas configuradas.' : 'No hay mesas con el estado seleccionado.'}</p>
            </div>
          );
        })()}</div><ActiveOrdersPanel tables={tables} onSelectTable={onSelectTable} /><div className="quick-panels"><button className="quick-panel" onClick={() => setShowMenu(true)}><Menu /><span><strong>Comandas</strong><small>{items.length} productos guardados</small></span></button>{canKitchen ? <button className="quick-panel" onClick={() => setShowKitchen(true)}><ChefHat /><span><strong>Cocina</strong><small>Pedidos activos y en preparación</small></span></button> : <button className="quick-panel" onClick={() => setShowOps(true)}><ChefHat /><span><strong>Cocina</strong><small>Estados y avisos de cocina</small></span></button>}<button className="quick-panel" onClick={() => setShowOps(true)}><Bell /><span><strong>Avisos</strong><small>{unreadNotifications ? `${unreadNotifications} sin leer` : notifications.length ? `${notifications.length} avisos disponibles` : 'Platos listos y disponibilidad'}</small></span></button><button className="quick-panel" onClick={() => setShowAttendance(true)}><Clock /><span><strong>Jornada</strong><small>Entrada, salida y horas trabajadas</small></span></button>{canCashier && <button className="quick-panel" onClick={() => setShowCashier(true)}><Wallet /><span><strong>Turno de caja</strong><small>Fondo inicial, movimientos y cierre</small></span></button>}</div></section>{(table || (showQuick && canQuickSale)) && <OrderPanel key={`${table?.id || 'quick'}-${table?.currentOrderId || 'new'}`} table={table} tables={tables} quick={showQuick} roleKey={roleKey} permissions={permissions} paymentMethods={paymentMethods} canCharge={canCharge} offline={offline} deliverySettings={deliverySettings} deliveryExecutives={deliveryExecutives} items={items} onClose={() => { onSelectTable(null); setShowQuick(false) }} onSubmit={onSubmitOrder} onSaveCustomer={onSaveCustomer} onRemoveOrderItem={onRemoveOrderItem} onPrintPreBill={onPrintPreBill} onPayOrder={onPayOrder} onTransferTable={onTransferTable} />}{showMenu && <MenuPanel items={items} onClose={() => setShowMenu(false)} />}{showOps && <OperationsPanel notifications={notifications} loading={opsLoading} offline={offline} permissions={permissions} roleKey={roleKey} onClose={() => setShowOps(false)} onMarkNotificationRead={markNotificationRead} />}{showKitchen && canKitchen && <KitchenPanel offline={offline} places={kitchenPlaces} viewScope="supervisor" onClose={() => setShowKitchen(false)} onUpdateStatus={onUpdateKotStatus} />}{showAttendance && <JornadaPanel offline={offline} userId={userId} deviceId={deviceId} onClose={() => setShowAttendance(false)} onClockIn={onClockIn} onClockOut={onClockOut} />}{showCashier && canCashier && <CashierPanel offline={offline} permissions={permissions} onClose={() => setShowCashier(false)} onOpenSession={onOpenCashSession} onCloseSession={onCloseCashSession} onApproveSession={onApproveCashSession} onRejectSession={onRejectCashSession} onReopenSession={onReopenCashSession} onCashMovement={onCashMovement} />}</main>
}

function JornadaPanel({ offline, userId, deviceId, onClose, onClockIn, onClockOut }: { offline: boolean; userId?: number; deviceId: string; onClose: () => void; onClockIn: (idempotencyKey: string) => Promise<{ queued: boolean; message: string; attendance: AttendanceRecord }>; onClockOut: (idempotencyKey: string) => Promise<{ queued: boolean; message: string; attendance: AttendanceRecord }> }) {
  const cached = readCache()
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(cached.currentAttendance || null)
  const [history, setHistory] = useState<AttendanceRecord[]>(cached.attendanceHistory || [])
  const [schedules, setSchedules] = useState<any[]>(cached.staffSchedules || [])
  const [loading, setLoading] = useState(!offline)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [featureAvailable, setFeatureAvailable] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  async function load() {
    if (offline) {
      const local = readCache(); setAttendance(local.currentAttendance || null); setHistory(local.attendanceHistory || []); setSchedules(local.staffSchedules || []); setLoading(false); return
    }
    setLoading(true); setError('')
    try {
      const [current, past, planned] = await Promise.all([api.currentAttendance('pin'), api.attendanceHistory('pin', { userId }), api.staffSchedules('pin', userId)])
      setAttendance(current); setHistory(past); setSchedules(planned); setFeatureAvailable(true); saveCache({ currentAttendance: current, attendanceHistory: past, staffSchedules: planned })
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) { setFeatureAvailable(false); setError('El registro de horarios y asistencia de personal no está habilitado actualmente en esta sucursal.') }
      else setError(normalizeError(cause, 'No se pudo consultar la jornada.'))
    } finally { setLoading(false) }
  }
  // The elapsed counter is local presentation only; timestamps come from the server when available.
  // The panel synchronizes with the external attendance API when it opens and
  // refreshes the elapsed-time presentation while it remains visible.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); void load(); return () => window.clearInterval(timer) }, [offline])
  async function toggle() {
    if (busy || !featureAvailable && !offline) return
    setBusy(true); setError('')
    try {
      const result = attendance && !attendance.clockOutAt ? await onClockOut(newIdempotencyKey()) : await onClockIn(newIdempotencyKey())
      setAttendance(result.attendance); saveCache({ currentAttendance: result.attendance }); if (!result.queued && !offline) await load()
    } catch (cause) { setError(normalizeError(cause, 'No se pudo registrar la jornada.')) }
    finally { setBusy(false) }
  }
  const active = Boolean(attendance && !attendance.clockOutAt && attendance.status !== 'closed')
  const elapsed = active && attendance?.clockInAt ? Math.max(0, now - new Date(attendance.clockInAt).getTime()) : 0
  const hours = Math.floor(elapsed / 3_600_000); const minutes = Math.floor((elapsed % 3_600_000) / 60_000)
  const formatDateTime = (value?: string) => value ? new Date(value).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—'
  return <div className="modal-backdrop"><section className="modal wide attendance-panel"><header><div><p className="eyebrow">CONTROL DE JORNADA</p><h2>Entrada y horas trabajadas</h2><small>El sistema conserva la zona horaria de la sucursal y el historial por empleado.</small></div><button className="icon-button" onClick={onClose}><X /></button></header>{offline && <Alert>Sin conexión: la entrada o salida se guarda localmente y se sincroniza al recuperar la conexión.</Alert>}{error && <Alert>{error}</Alert>}{loading ? <div className="empty compact"><p>Consultando jornada…</p></div> : <><section className={`attendance-current ${active ? 'is-active' : ''}`}><div className="attendance-current-icon">{active ? <UserCheck size={24} /> : <UserX size={24} />}</div><div><strong>{active ? 'Jornada activa' : 'Fuera de jornada'}</strong><small>{active ? `Entrada: ${formatDateTime(attendance?.clockInAt)} · ${hours} h ${minutes} min` : attendance?.clockOutAt ? `Última salida: ${formatDateTime(attendance.clockOutAt)}` : 'No hay una entrada abierta.'}</small><small>Terminal: {deviceId}</small></div><button className={`button ${active ? 'outline' : 'primary'}`} disabled={busy || (!featureAvailable && !offline)} onClick={() => void toggle()}>{busy ? 'Guardando…' : active ? 'Registrar salida' : 'Registrar entrada'}</button></section>{!featureAvailable && !offline && <p className="attendance-contract-note"><CalendarDays size={16} /> El modulo de control de asistencia se encuentra en proceso de configuracion para este local.</p>}<section className="attendance-schedule"><div className="attendance-section-heading"><div><p className="eyebrow">HORARIO ASIGNADO</p><strong>Turnos de este empleado</strong></div><Clock size={18} /></div>{schedules.length ? schedules.map(schedule => <div className="attendance-schedule-row" key={schedule.id}><span>{schedule.shiftName || 'Turno'}</span><b>{schedule.days.join(', ') || 'Todos los días'}</b><small>{schedule.startTime}–{schedule.endTime} · {schedule.timezone}</small></div>) : <p className="muted">No hay un turno asignado registrado en el sistema.</p>}</section><section className="attendance-history"><div className="attendance-section-heading"><div><p className="eyebrow">HISTORIAL</p><strong>Últimos registros</strong></div><button className="button outline" onClick={() => void load()} disabled={loading || offline}>Actualizar</button></div>{history.length ? history.slice(0, 12).map(row => <div className="attendance-history-row" key={row.id}><span>{row.localDate || new Date(row.clockInAt).toLocaleDateString('es-DO')}</span><b>{formatDateTime(row.clockInAt)} → {formatDateTime(row.clockOutAt)}</b><small>{row.timezone} · {row.status === 'active' ? 'Activa' : 'Cerrada'}</small></div>) : <p className="muted">No hay registros de jornada.</p>}</section></>}<footer className="modal-note">La jornada queda activa hasta registrar la salida. El PIN identifica al empleado; el dispositivo solo identifica la terminal autorizada y no sustituye el registro de asistencia.</footer></section></div>
}

function WaiterCallBanner() {
  const session = readSession('pin')
  const enabled = ['mesero', 'cajero', 'head'].includes(session?.roleKey || '')
  const [requests, setRequests] = useState<WaiterRequest[]>(() => readCache().waiterRequests || [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          if (!cancelled) setRequests(readCache().waiterRequests || [])
          return
        }
        const rows = await api.waiterRequests('pin', 'pending')
        if (cancelled) return
        setRequests(rows)
        saveCache({ waiterRequests: rows })
      } catch {
        if (!cancelled) setRequests(readCache().waiterRequests || [])
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [enabled])

  if (!enabled || !requests.length) return null
  const tables = requests.slice(0, 3).map(request => request.tableName).join(' · ')
  return <button type="button" className="waiter-call-banner" onClick={() => window.dispatchEvent(new Event('restapp:open-waiter-alerts'))} aria-live="assertive" aria-label="Abrir llamadas pendientes de mesa"><span className="waiter-call-icon" aria-hidden="true"><Bell size={22} /></span><span><strong>{requests.length === 1 ? 'Llamada de mesa pendiente' : `${requests.length} llamadas de mesa pendientes`}</strong><small>{tables} · Abrir avisos para atender</small></span><ChevronRight size={22} aria-hidden="true" /></button>
}

function TableStatusGuide() {
  return <section className="table-status-guide" aria-labelledby="table-status-guide-title"><div className="table-status-guide-copy"><p className="eyebrow">ESTADO DE LA SALA</p><h2 id="table-status-guide-title">Cómo leer y liberar una mesa</h2><p>El color indica el ciclo de la orden, no cuántas sillas están ocupadas. La capacidad de personas se define en la configuracion del salon.</p><p><strong>La mesa se libera automáticamente al completar el cobro total.</strong> Imprimir la precuenta, terminar la preparación o solicitar la cuenta no la libera. Mientras quede saldo pendiente, debe seguir ocupada.</p></div><div className="table-status-guide-grid"><span><i className="dot green" /> <strong>Libre</strong><small>Puede recibir una nueva orden.</small></span><span><i className="dot red" /> <strong>Ocupada</strong><small>Hay una orden abierta.</small></span><span><i className="dot yellow" /> <strong>En cocina</strong><small>La comanda está en preparación.</small></span><span><i className="dot teal" /> <strong>Lista</strong><small>Hay platos listos para entregar.</small></span><span><i className="dot blue" /> <strong>Cuenta pendiente</strong><small>Esperando el cobro total.</small></span></div></section>
}

function ActiveOrdersPanel({ tables, onSelectTable }: { tables: RestaurantTable[]; onSelectTable: (table: RestaurantTable | null) => void }) {
  const active = tables.filter(table => table.currentOrderId).sort((a, b) => Number(b.currentOrderDue ?? b.currentOrderTotal ?? 0) - Number(a.currentOrderDue ?? a.currentOrderTotal ?? 0))
  return <><WaiterCallBanner /><TableStatusGuide /><section className="active-orders-panel" aria-labelledby="active-orders-title"><div className="active-orders-header"><div><p className="eyebrow">SEGUIMIENTO EN SALA</p><h2 id="active-orders-title">Pedidos activos</h2><small>{active.length ? `${active.length} mesa${active.length === 1 ? '' : 's'} con pedido en curso` : 'No hay pedidos en curso'}</small></div><span className="active-orders-count">{active.length}</span></div>{active.length ? <div className="active-orders-list">{active.map(table => <button key={table.id} className="active-order-card" onClick={() => onSelectTable(table)}><span className={`active-order-status ${statusColors[table.status]}`} aria-hidden="true" /><span className="active-order-main"><strong>Mesa {table.number}</strong><small>{table.currentOrderNumber ? `Pedido n.º ${table.currentOrderNumber}` : `Pedido n.º ${table.currentOrderId}`}{table.customerName ? ` · ${table.customerName}` : ' · Cliente no identificado'}</small></span><span className="active-order-meta"><b>{formatMoney(table.currentOrderDue ?? table.currentOrderTotal ?? 0)}</b><small>{table.currentOrderDue && table.currentOrderDue > 0 ? 'Pendiente' : 'Total'}</small></span><ChevronRight size={18} /></button>)}</div> : <div className="active-orders-empty"><ClipboardList size={22} /><span>Los pedidos aparecerán aquí al abrir una mesa y enviar la comanda.</span></div>}</section></>
}

function PreBillPanel({ table, payload, items, onClose, onAddMore, onPrint, printing, printStatus }: { table: RestaurantTable; payload: any; items: Array<{ id: number; name: string; quantity: number; amount?: number }>; onClose: () => void; onAddMore: () => void; onPrint: () => Promise<void>; printing: boolean; printStatus: string }) {
  const summary = normalizePreBill(payload, table, items)
  const cached = readCache()
  const printer = (cached.printers || []).find(value => value.isActive !== false && (value.isDefault || (value.orders || []).length > 0)) || (cached.printers || []).find(value => value.isActive !== false)
  const receiptProfile = normalizeReceiptSettings(cached.receiptSettings, { restaurantName: cached.restaurantName, printer })
  const receipt = buildReceiptDocumentViewModel({ profile: receiptProfile, kind: 'prebill', customer: summary.customer, tableNumber: table.number, items, totals: summary })
  const receiptTitle = receipt.title
  const receiptFooter = receipt.footer
  return <section className="prebill-panel" aria-label={`Precuenta de la mesa ${table.number}`}><header><div><p className="eyebrow">VISTA PRELIMINAR · SIN COBRO</p><h3>Precuenta · Mesa {table.number}</h3><small>{summary.customer ? `Cliente: ${summary.customer}` : 'Cliente no identificado'}</small></div><button className="icon-button no-print" onClick={onClose} aria-label="Cerrar precuenta"><X size={18} /></button></header><div className="prebill-print-config"><strong>{receiptTitle}</strong><small>{printer ? `Impresora: ${printer.name}${printer.printFormat ? ` · ${printer.printFormat}` : ''}` : 'La impresión usa la configuración de la sucursal.'}</small></div>{items.length ? <div className="prebill-lines">{items.map(item => <div className="prebill-line" key={item.id}><span><strong>{item.quantity}× {item.name}</strong></span>{item.amount ? <b>{formatMoney(item.amount)}</b> : null}</div>)}</div> : <div className="prebill-empty">No hay detalle de articulos disponible para esta orden.</div>}<div className="prebill-totals"><div><span>Subtotal</span><b>{preBillMoney(summary.subtotal)}</b></div><div><span>Impuestos</span><b>{preBillMoney(summary.tax)}</b></div>{summary.tip !== null && summary.tip > 0 && <div><span>Propina legal</span><b>{formatMoney(summary.tip)}</b></div>}{summary.discount !== null && summary.discount > 0 && <div><span>Descuento</span><b>-{formatMoney(summary.discount)}</b></div>}<div className="prebill-total"><span>Total</span><strong>{formatMoney(summary.total)}</strong></div><div className="prebill-due"><span>{summary.due > 0 ? 'Pendiente de pago' : 'Estado de pago'}</span><strong>{summary.due > 0 ? formatMoney(summary.due) : 'Pagada'}</strong></div></div>{summary.breakdownMissing && <p className="prebill-warning">El desglose detallado de impuestos no esta disponible completo; se muestra el total confirmado de la comanda.</p>}{printStatus && <p className="prebill-print-status" role="status">{printStatus}</p>}<p className="prebill-note">Esta precuenta es informativa: no cobra, no cierra la mesa y permite agregar más artículos. Al imprimir, se envia directamente a la impresora asignada a la sucursal.</p>{receiptFooter && <small className="prebill-footer-note">{receiptFooter}</small>}<footer className="prebill-actions no-print"><button className="button outline" onClick={onClose}>Volver a la orden</button><button className="button outline" onClick={() => void onPrint()} disabled={printing}><Printer size={16} /> {printing ? 'Enviando…' : 'Imprimir precuenta'}</button><button className="button primary" onClick={onAddMore}>Agregar artículos</button></footer></section>
}

function TablePaymentPanel({ table, payload, items, paymentMethods, offline, onClose, onPay }: { table: RestaurantTable; payload: any; items: Array<{ amount?: number }>; paymentMethods: PaymentMethodOption[]; offline: boolean; onClose: () => void; onPay: (orderId: number, amount: number, method: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string }> }) {
  const summary = normalizePreBill(payload, table, items)
  const enabledMethods = paymentMethods.filter(value => value.enabled)
  const [method, setMethod] = useState(enabledMethods[0]?.code || 'cash')
  const [amount, setAmount] = useState(summary.due > 0 ? summary.due.toFixed(2) : '')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const selectedMethod = enabledMethods.some(value => value.code === method) ? method : enabledMethods[0]?.code || ''
  async function charge() {
    const numericAmount = Number(amount)
    if (!table.currentOrderId || summary.due <= 0) { setError('Esta mesa no tiene saldo pendiente de pago.'); return }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > summary.due + 0.01) { setError(`El monto debe estar entre ${formatMoney(0.01)} y ${formatMoney(summary.due)}.`); return }
    if (!enabledMethods.some(value => value.code === selectedMethod)) { setError('Este metodo de pago no esta habilitado para esta sucursal.'); return }
    setBusy(true); setError(''); setStatus('')
    try {
      const result = await onPay(table.currentOrderId, numericAmount, selectedMethod, newIdempotencyKey())
      setStatus(result.message)
      if (!result.queued) onClose()
    } catch (cause) {
      setError(normalizeError(cause, 'No se pudo procesar el cobro. Verifique la conexion o el monto e intente de nuevo.'))
    } finally { setBusy(false) }
  }
  return <section className="table-payment-panel" aria-label={`Cobro de la mesa ${table.number}`}><div className="table-payment-header"><div><p className="eyebrow">COBRO DE LA MESA</p><h3>Mesa {table.number}</h3><small>El turno y la caja chica se administran por separado desde “Turno de caja”.</small></div><button className="icon-button" onClick={onClose} aria-label="Cerrar cobro"><X size={18} /></button></div>{offline && <Alert>Sin conexión: el cobro queda pendiente y se validará automáticamente al recuperar internet.</Alert>}{error && <Alert>{error}</Alert>}{status && <p className="table-payment-status" role="status">{status}</p>}<div className="table-payment-due"><span>Saldo pendiente</span><strong>{formatMoney(summary.due)}</strong></div>{enabledMethods.length ? <div className="table-payment-form"><label>Método<select value={selectedMethod} onChange={event => setMethod(event.target.value)}>{enabledMethods.map(value => <option value={value.code} key={value.code}>{value.label}</option>)}</select></label><label>Monto<input type="number" min="0.01" max={summary.due.toFixed(2)} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label></div> : <Alert>No hay metodos de pago configurados en esta sucursal.</Alert>}<footer><button className="button outline" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || !enabledMethods.length || summary.due <= 0} onClick={() => void charge()}><CreditCard size={16} />{busy ? 'Registrando…' : 'Registrar cobro'}</button></footer></section>
}

function OrderPanel({ table, tables, quick, roleKey, permissions, paymentMethods, canCharge, offline, deliverySettings, deliveryExecutives, items, onClose, onSubmit, onSaveCustomer, onRemoveOrderItem, onPrintPreBill, onPayOrder, onTransferTable }: { table: RestaurantTable | null; tables?: RestaurantTable[]; quick: boolean; roleKey: StaffRole; permissions: Record<string, boolean>; paymentMethods: PaymentMethodOption[]; canCharge: boolean; offline: boolean; deliverySettings: DeliverySettings | null; deliveryExecutives: DeliveryExecutive[]; items: MenuItem[]; onClose: () => void; onSubmit: (lines: OrderLine[], table: RestaurantTable | null, draft: OrderDraft) => Promise<void>; onSaveCustomer: (table: RestaurantTable, name: string, customerId?: number, rncCedula?: string, fiscalName?: string) => Promise<void>; onRemoveOrderItem?: (orderId: number, orderItemId: number, itemName: string) => Promise<{ queued: boolean; message: string }>; onPrintPreBill: (orderId: number, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>; onPayOrder: (orderId: number, amount: number, method: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>; onTransferTable?: (fromTable: RestaurantTable, targetTable: RestaurantTable) => Promise<{ queued: boolean; message: string }> }) {
  const canDelivery = roleKey === 'cajero' && permissions['orders.create'] === true
  const [mode, setMode] = useState<OrderMode>(table ? 'dine_in' : canDelivery ? 'pickup' : 'dine_in')
  const [customerId, setCustomerId] = useState<number | undefined>(table?.customerId)
  const [customerName, setCustomerName] = useState(table?.customerName || '')
  const [customerPhone, setCustomerPhone] = useState(table?.customerPhone || '')
  const [customerEmail, setCustomerEmail] = useState('')
  const [rncCedula, setRncCedula] = useState('')
  const [fiscalName, setFiscalName] = useState('')
  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryTime, setDeliveryTime] = useState('')
  const [deliveryFee, setDeliveryFee] = useState('')
  const [deliveryExecutiveId, setDeliveryExecutiveId] = useState('')
  const [lines, setLines] = useState<OrderLine[]>([])
  const [existingItems, setExistingItems] = useState<Array<{ id: number; name: string; quantity: number; amount?: number }>>([])
  const [orderDetail, setOrderDetail] = useState<any>(null)
  const [latestKotStatus, setLatestKotStatus] = useState('')
  const [lastSentSummary, setLastSentSummary] = useState('')
  const [selected, setSelected] = useState<MenuItem | null>(null)
  const [showMenu, setShowMenu] = useState(true)
  const [preBillOpen, setPreBillOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [removingItemId, setRemovingItemId] = useState<number | null>(null)
  const [printing, setPrinting] = useState(false)
  const [printStatus, setPrintStatus] = useState('')
  const [printIdempotencyKey, setPrintIdempotencyKey] = useState('')
  const [splitOpen, setSplitOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [localError, setLocalError] = useState('')
  const [confirmKotOpen, setConfirmKotOpen] = useState(false)
  const [addedNotice, setAddedNotice] = useState('')
  const total = lines.reduce((sum, line) => sum + line.price * line.quantity + line.modifiers.reduce((s, m) => s + m.price, 0) * line.quantity, 0)
  const estimatedItbis = Math.round(total * 0.18 * 100) / 100
  const estimatedTip = mode === 'dine_in' ? Math.round(total * 0.10 * 100) / 100 : 0
  const grandEstimatedTotal = total + estimatedItbis + estimatedTip
  const deliveryReady = mode !== 'delivery' || (deliverySettings?.is_enabled === true && Boolean(customerName.trim() && customerPhone.trim() && deliveryAddress.trim()) && (deliveryFee.trim() !== '' || deliverySettings.fixed_fee != null))
  const tableReady = mode !== 'dine_in' || table !== null
  const activeElapsed = useElapsedSince(orderStartedAt(orderDetail))
  const activeOrderStatus = orderProgressLabel(latestKotStatus || orderDetail?.order_status || orderDetail?.status || orderDetail?.order?.status || table?.kitchenStatus || table?.currentOrderStatus)
  // Keep the field aligned with the server when the floor refreshes the active order.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setCustomerName(table?.customerName || '')
    setCustomerId(table?.customerId)
    if (table?.customerPhone) setCustomerPhone(table.customerPhone)
  }, [table?.id, table?.currentOrderId, table?.customerName, table?.customerId, table?.customerPhone])
  // Load the existing order read-only so the waiter can distinguish previous lines from the new KOT.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { let cancelled = false; setExistingItems([]); setOrderDetail(null); setPreBillOpen(false); setLastSentSummary(''); setPrintStatus(''); setPrintIdempotencyKey(''); setPrinting(false); if (!table?.currentOrderId) return () => { cancelled = true }; const cached = readCache(); const cachedDetail = cached.orderDetails?.[String(table.currentOrderId)]; const cachedKots = cached.orderKots?.[String(table.currentOrderId)] || []; if (!navigator.onLine) { if (cachedDetail) { const data = (cachedDetail as any)?.data ?? cachedDetail; setOrderDetail(data); const values = Array.isArray((data as any)?.items) ? (data as any).items : []; setExistingItems(values.map((item: any) => ({ id: Number(item.id), name: String(item.name || item.menu_item_name || 'Producto'), quantity: Math.max(1, Number(item.quantity || 1)), amount: Number(item.amount ?? item.total ?? item.price ?? 0) }))) } const latest = cachedKots.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]; if (latest) setLastSentSummary(`${latest.items.map(item => `${item.quantity}× ${item.name}`).join(' · ') || 'Artículos sin detalle'}${latest.createdAt ? ` · ${new Date(latest.createdAt).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}` : ''}`); return () => { cancelled = true } } Promise.all([api.getOrder('pin', table.currentOrderId), api.orderKots('pin', table.currentOrderId)]).then(([orderPayload, kots]) => { if (cancelled) return; const data = orderPayload?.data ?? orderPayload; saveCache({ orderDetails: { ...(readCache().orderDetails || {}), [String(table.currentOrderId)]: data }, orderKots: { ...(readCache().orderKots || {}), [String(table.currentOrderId)]: kots } }); setOrderDetail(data); const values = Array.isArray(data?.items) ? data.items : []; setExistingItems(values.map((item: any) => { const quantity = Math.max(1, Number(item.quantity || 1)); const amount = Number(item.amount ?? item.total ?? 0); return { id: Number(item.id), name: String(item.name || item.menu_item_name || 'Producto'), quantity, amount: amount || Number(item.price || 0) * quantity } })); const latest = kots.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]; if (latest) { const summary = latest.items.map(item => `${item.quantity}× ${item.name}`).join(' · '); setLastSentSummary(`${summary || 'Artículos sin detalle'}${latest.createdAt ? ` · ${new Date(latest.createdAt).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}` : ''}`) } }).catch(() => { if (!cancelled) { setExistingItems([]); setOrderDetail(null); setLastSentSummary('') } }); return () => { cancelled = true } }, [table?.currentOrderId])
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLatestKotStatus('')
    if (!table?.currentOrderId) return () => { cancelled = true }
    const applyLatest = (values: KitchenTicket[]) => {
      if (cancelled) return
      const latest = values.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]
      setLatestKotStatus(latest?.status || '')
    }
    const cachedKots = readCache().orderKots?.[String(table.currentOrderId)] || []
    if (cachedKots.length) applyLatest(cachedKots)
    if (navigator.onLine) void api.orderKots('pin', table.currentOrderId).then(applyLatest).catch(() => undefined)
    return () => { cancelled = true }
  }, [table?.currentOrderId])
  useEffect(() => {
    const values = extractOrderItems(orderDetail)
    if (!values.length) return
    // The order detail arrives asynchronously from the API and is normalized
    // into the drawer's read model here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExistingItems(values.map((item: any) => {
      const quantity = Math.max(1, Number(item.quantity || 1))
      const amount = Number(item.amount ?? item.total ?? item.price ?? 0)
      return { id: Number(item.id || item.order_item_id), name: String(item.name || item.menu_item_name || item.product_name || 'Producto'), quantity, amount: amount || Number(item.price || 0) * quantity }
    }).filter(item => Number.isInteger(item.id) && item.id > 0))
  }, [orderDetail])
  function triggerAddLine(line: OrderLine) {
    setLines(prev => [...prev, line])
    setAddedNotice(`+${line.quantity} ${line.name} agregado`)
    window.setTimeout(() => setAddedNotice(''), 2200)
  }
  function updateLineQuantity(clientId: string, delta: number) {
    setLines(prev => prev.map(l => {
      if (l.clientId !== clientId) return l
      const nextQ = l.quantity + delta
      return nextQ > 0 ? { ...l, quantity: nextQ } : null
    }).filter(Boolean) as OrderLine[])
  }
  function removeDraftLine(clientId: string) {
    setLines(prev => prev.filter(l => l.clientId !== clientId))
  }
  async function send() {
    if (!lines.length || !deliveryReady || !tableReady) return
    setSubmitting(true)
    setLocalError('')
    try {
      await onSubmit(lines, mode === 'dine_in' ? table : null, {
        mode,
        existingOrderId: mode === 'dine_in' ? table?.currentOrderId : undefined,
        customerId,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        rncCedula: rncCedula.trim() || undefined,
        fiscalName: fiscalName.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        deliveryTime: deliveryTime || undefined,
        deliveryFee: deliveryFee === '' ? deliverySettings?.fixed_fee ?? undefined : Number(deliveryFee),
        deliveryExecutiveId: deliveryExecutiveId ? Number(deliveryExecutiveId) : undefined,
      })
      setLines([])
      setConfirmKotOpen(false)
    } catch (cause) {
      setLocalError(normalizeError(cause, 'No se pudo enviar la comanda.'))
    } finally {
      setSubmitting(false)
    }
  }
  async function printPreBill() { if (!table?.currentOrderId || printing || (printStatus && printIdempotencyKey)) return; const key = printIdempotencyKey || newIdempotencyKey(); if (!printIdempotencyKey) setPrintIdempotencyKey(key); setPrinting(true); setPrintStatus(''); setLocalError(''); try { const result = await onPrintPreBill(table.currentOrderId, key); setPrintStatus(result.message); if (!result.queued) setPrintIdempotencyKey('') } catch (cause) { setLocalError(normalizeError(cause, 'No se pudo enviar la pre-cuenta a la impresora.')) } finally { setPrinting(false) } }
  async function removeItem(item: { id: number; name: string }) {
    if (!table?.currentOrderId || removingItemId !== null || !permissions['orders.update']) return
    if (!Number.isInteger(item.id) || item.id <= 0) { setLocalError('Este articulo todavia esta pendiente de confirmacion en la orden.'); return }
    if (!window.confirm(`¿Quitar ${item.name} de la orden activa?`)) return
    setRemovingItemId(item.id); setLocalError('')
    try {
      const result = onRemoveOrderItem
        ? await onRemoveOrderItem(table.currentOrderId, item.id, item.name)
        : await api.updateOrderItems('pin', table.currentOrderId, { items: [{ action: 'remove', order_item_id: item.id }], recalculate_totals: true }, newIdempotencyKey()).then(() => ({ queued: false, message: `Artículo retirado de la orden n.º ${table.currentOrderId}.` }))
      setExistingItems(current => current.filter(value => value.id !== item.id))
      if (result.queued) setPrintStatus(result.message)
    } catch (cause) { setLocalError(normalizeError(cause, 'No se pudo quitar el artículo de la orden.')) }
    finally { setRemovingItemId(null) }
  }
  return <div className="drawer-backdrop"><section className="order-drawer"><header className="drawer-header"><button className="icon-button" onClick={onClose}><X /></button><div><p className="eyebrow">{mode === 'delivery' ? 'ENTREGA A DOMICILIO' : mode === 'pickup' ? 'RETIRO EN EL LOCAL · SIN MESA' : `MESA ${table?.number}`}</p><h2>{table?.currentOrderId ? 'Agregar a la orden' : 'Comanda'}</h2>{table?.currentOrderId && <small>Pedido activo n.º {table.currentOrderNumber || table.currentOrderId}; los nuevos artículos se enviarán como una comanda adicional.</small>}</div><button className="icon-button" onClick={() => setShowMenu(!showMenu)}><Menu /></button></header><div className="order-body">{localError && <Alert>{localError}</Alert>}{mode === 'dine_in' && !table && <Alert>Seleccione una mesa antes de enviar la comanda.</Alert>}{table?.currentOrderId && <div className="active-order-note"><strong>Pedido activo</strong><span>Solo se enviarán los artículos nuevos; los envíos anteriores no se repetirán.</span><div className="active-order-meta"><span>Estado de preparación: {activeOrderStatus}</span><span>Tiempo activo: {activeElapsed || 'Recién tomada'}</span></div>{lastSentSummary && <small>Último envío a cocina: {lastSentSummary}</small>}</div>}{table?.currentOrderId && <div className="active-order-actions"><button className="button outline" onClick={() => { setPaymentOpen(false); setPreBillOpen(true) }}>Precuenta</button>{canCharge && <button className="button primary" onClick={() => { setPreBillOpen(false); setPaymentOpen(true) }}><CreditCard size={16} /> Cobrar</button>}<button className="button outline" onClick={() => { setPreBillOpen(false); setPaymentOpen(false); setShowMenu(true) }}>Agregar artículos</button>{mode === 'dine_in' && <button className="button outline" onClick={() => setTransferOpen(true)} title="Cambiar a otra mesa libre"><ArrowRightLeft size={16} /> Mover mesa</button>}</div>}{preBillOpen && table?.currentOrderId && <PreBillPanel table={table} payload={orderDetail} items={existingItems} onClose={() => setPreBillOpen(false)} onAddMore={() => { setPreBillOpen(false); setShowMenu(true) }} onPrint={printPreBill} printing={printing} printStatus={printStatus} />}{paymentOpen && table?.currentOrderId && canCharge && <TablePaymentPanel table={table} payload={orderDetail} items={existingItems} paymentMethods={paymentMethods} offline={offline} onClose={() => setPaymentOpen(false)} onPay={onPayOrder} />}{existingItems.length > 0 && <div className="active-order-lines"><strong>Artículos ya enviados</strong><ul>{existingItems.map(item => <li key={item.id}><span>{item.quantity}× {item.name}</span>{permissions['orders.update'] && <button className="icon-button" aria-label={`Quitar ${item.name}`} title="Quitar artículo" disabled={removingItemId !== null} onClick={() => void removeItem(item)}><X size={14} /></button>}</li>)}</ul></div>}<div className="order-mode"><label>Tipo de pedido<select aria-label="Tipo de pedido" value={mode} onChange={e => setMode(e.target.value as OrderMode)} disabled={!canDelivery}>{table && <option value="dine_in">Comer en mesa</option>}{!table && canDelivery && <option value="pickup">Retiro en el local · sin mesa</option>}{canDelivery && <option value="delivery">Entrega a domicilio</option>}{canDelivery && !table && <option value="dine_in">Comer en mesa</option>}{canDelivery && table && <option value="pickup">Retiro en el local · sin mesa</option>}</select></label><small className="muted">{quick ? 'La venta directa solo está disponible para el personal de caja autorizado.' : canDelivery ? 'El personal de caja puede elegir mesa, entrega a domicilio o retiro en el local.' : 'Personal de sala: seleccione una mesa para iniciar la comanda.'}</small></div>{/* Enhanced Customer Card with Quick Search and Modal Trigger */}<div className="customer-selector-card"><div className="customer-card-main"><div className="customer-card-avatar"><UserCheck size={18} /></div><div className="customer-card-meta"><div className="customer-card-name-row"><strong>{customerName.trim() || 'Cliente general'}</strong>{rncCedula && <span className="customer-card-badge">RNC: {rncCedula}</span>}</div><div className="customer-card-details">{fiscalName && <span>{fiscalName}</span>}{customerPhone && <span>Tel: {customerPhone}</span>}{!fiscalName && !customerPhone && !rncCedula && <span>Sin datos fiscales ni contacto</span>}</div></div></div><div className="customer-card-actions"><button type="button" className="button outline small" onClick={() => setCustomerModalOpen(true)}><Search size={14} /> {customerName.trim() ? 'Cambiar' : 'Buscar cliente'}</button>{customerName.trim() && <button type="button" className="icon-button" title="Limpiar cliente" onClick={() => { setCustomerId(undefined); setCustomerName(''); setCustomerPhone(''); setCustomerEmail(''); setRncCedula(''); setFiscalName('') }}><X size={14} /></button>}</div></div>{mode === 'dine_in' && table && table.currentOrderId && customerName.trim() && customerName.trim() !== (table.customerName || '') && <div style={{ marginBottom: 14 }}><button className="button outline small" disabled={savingCustomer} onClick={async () => { setSavingCustomer(true); setLocalError(''); try { await onSaveCustomer(table, customerName, customerId, rncCedula, fiscalName); } catch (cause) { setLocalError(normalizeError(cause, 'No se pudo guardar el cliente en la mesa.')) } finally { setSavingCustomer(false) } }}>{savingCustomer ? 'Guardando en mesa…' : 'Guardar cliente en mesa activa'}</button></div>}{mode === 'delivery' && <div className="delivery-form"><div className="delivery-heading"><Truck size={18} /><div><strong>Datos de entrega</strong><small>Configure dirección y repartidor para el despacho.</small></div></div>{deliverySettings === null && <Alert>La entrega a domicilio no está configurada en esta sucursal. Complete el formulario cuando el propietario active el servicio.</Alert>}{deliverySettings && deliverySettings.is_enabled !== true && <Alert>La entrega a domicilio está deshabilitada para esta sucursal.</Alert>}<label>Cliente<input required value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nombre completo" /></label><label>Teléfono<input required type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="809-555-0000" /></label><label>Dirección<textarea required value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder="Calle, número, sector y referencia" /></label><label>Horario de entrega<input type="datetime-local" value={deliveryTime} onChange={e => setDeliveryTime(e.target.value)} /></label><label>Costo de entrega<input type="number" min="0" step="0.01" value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)} placeholder={deliverySettings?.fixed_fee == null ? 'Configure el costo en la sucursal' : String(deliverySettings.fixed_fee)} /></label>{deliveryExecutives.length ? <label>Repartidor<select value={deliveryExecutiveId} onChange={e => setDeliveryExecutiveId(e.target.value)}><option value="">Asignar después</option>{deliveryExecutives.map(executive => <option key={executive.id} value={executive.id}>{executive.name}{executive.status ? ` · ${executive.status}` : ''}</option>)}</select></label> : <p className="muted delivery-note">No hay repartidores disponibles para esta sucursal; puede asignarlos después desde la operación.</p>}</div>}{showMenu && (
          <ProductPicker
            items={items}
            onSelect={setSelected}
            onQuickAdd={item => {
              triggerAddLine({
                clientId: crypto.randomUUID(),
                itemId: item.id,
                name: item.name,
                price: item.price,
                quantity: 1,
                modifiers: []
              });
            }}
          />
        )}{addedNotice && <div className="item-added-pill" role="status"><Check size={14} /> {addedNotice}</div>}{lines.length ? <div className="lines">{lines.map(line => <div className="order-line draft-line" key={line.clientId}><div><strong>{line.quantity}× {line.name}</strong><small>{seatLabel(line.seatNumber) || 'Sin asiento asignado'}{line.modifiers.length ? ` · ${line.modifiers.map(m => m.name).join(', ')}` : ''}</small></div><div className="order-line-actions"><div className="line-stepper"><button type="button" className="icon-button small" aria-label="Reducir cantidad" onClick={() => updateLineQuantity(line.clientId, -1)}><Minus size={13} /></button><span>{line.quantity}</span><button type="button" className="icon-button small" aria-label="Aumentar cantidad" onClick={() => updateLineQuantity(line.clientId, 1)}><Plus size={13} /></button></div><b>{formatMoney(line.price * line.quantity)}</b><button type="button" className="icon-button small remove-line-btn" aria-label="Eliminar ítem" onClick={() => removeDraftLine(line.clientId)} title="Quitar"><X size={13} /></button></div></div>)}</div> : <div className="empty compact"><ClipboardList size={32} /><p>Seleccione artículos para iniciar.</p></div>}</div><footer className="drawer-footer">
  {lines.length > 0 && (
    <div className="order-summary-breakdown" style={{ display: 'grid', gap: '4px', marginBottom: '12px', fontSize: '13px', color: 'var(--muted)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Subtotal estimado</span>
        <b>{formatMoney(total)}</b>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>ITBIS estimado (18%)</span>
        <b>{formatMoney(estimatedItbis)}</b>
      </div>
      {estimatedTip > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Propina legal (10%)</span>
          <b>{formatMoney(estimatedTip)}</b>
        </div>
      )}
    </div>
  )}
  <div className="total-row">
    <span>Total</span>
    <strong>{formatMoney(grandEstimatedTotal)}</strong>
  </div>
  <div className="drawer-actions">
    <button className="button outline" disabled={!lines.length || !table || mode !== 'dine_in'} onClick={() => setSplitOpen(true)}><Divide size={17} /> Dividir</button>
    <button className="button primary" disabled={!lines.length || submitting || !deliveryReady || !tableReady} onClick={() => setConfirmKotOpen(true)}><ChefHat size={17} />{submitting ? 'Enviando…' : mode === 'delivery' ? 'Enviar entrega' : table?.currentOrderId ? 'Agregar a cocina' : 'Enviar a cocina'}</button>
  </div>
</footer>{confirmKotOpen && (
    <div className="modal-backdrop">
      <section className="modal confirm-kot-modal">
        <header>
          <div>
            <p className="eyebrow">CONFIRMACIÓN DE COMANDA</p>
            <h2>¿Enviar a cocina?</h2>
          </div>
          <button className="icon-button" onClick={() => setConfirmKotOpen(false)}><X size={18} /></button>
        </header>
        <div className="modal-content" style={{ gap: '14px' }}>
          <div className="confirm-kot-summary">
            <div className="confirm-kot-target">
              <strong>{mode === 'delivery' ? 'Entrega a domicilio' : mode === 'pickup' ? 'Retiro en el local' : `Mesa ${table?.number}`}</strong>
              <small>{lines.reduce((s, l) => s + l.quantity, 0)} artículo(s) para preparar en cocina</small>
            </div>
            <div className="confirm-kot-items-preview">
              {lines.map(line => (
                <div key={line.clientId} className="confirm-kot-item-row">
                  <span><b>{line.quantity}×</b> {line.name}</span>
                  <small>{formatMoney(line.price * line.quantity)}</small>
                </div>
              ))}
            </div>
            <div className="confirm-kot-total">
              <span>Total estimado:</span>
              <strong>{formatMoney(grandEstimatedTotal)}</strong>
            </div>
          </div>
          <p className="confirm-kot-note">
            Al confirmar, se enviará la orden oficial a cocina (KOT) y a las impresoras de comandas.
          </p>
        </div>
        <footer style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '10px' }}>
          <button className="button outline" onClick={() => setConfirmKotOpen(false)} disabled={submitting}>
            Revisar comanda
          </button>
          <button className="button primary" onClick={send} disabled={submitting}>
            <ChefHat size={17} /> {submitting ? 'Enviando…' : 'Sí, enviar a cocina'}
          </button>
        </footer>
      </section>
    </div>
  )}{selected && <ModifierModal item={selected} seatCount={mode === 'dine_in' && table ? table.capacity : undefined} onClose={() => setSelected(null)} onAdd={line => { triggerAddLine(line); setSelected(null) }} />}{splitOpen && table && mode === 'dine_in' && <SplitBill lines={lines} table={table} onClose={() => setSplitOpen(false)} />}{transferOpen && table && mode === 'dine_in' && <TransferTableModal currentTable={table} tables={tables || []} onClose={() => setTransferOpen(false)} onTransfer={async targetTable => { if (!onTransferTable) return; setTransferring(true); try { const res = await onTransferTable(table, targetTable); setLocalError(res.message); setTransferOpen(false); onClose() } catch (err) { setLocalError(normalizeError(err, 'No se pudo mover la orden de mesa.')) } finally { setTransferring(false) } }} busy={transferring} />}{customerModalOpen && <CustomerModal currentCustomer={{ id: customerId, name: customerName, phone: customerPhone, email: customerEmail, rncCedula, fiscalName }} offline={offline} onClose={() => setCustomerModalOpen(false)} onSelect={customer => { setCustomerId(customer.id > 0 ? customer.id : undefined); setCustomerName(customer.name || ''); if (customer.phone) setCustomerPhone(customer.phone); if (customer.email) setCustomerEmail(customer.email); if (customer.deliveryAddress && !deliveryAddress) setDeliveryAddress(customer.deliveryAddress); if (customer.rncCedula) setRncCedula(customer.rncCedula); if (customer.fiscalName) setFiscalName(customer.fiscalName); setCustomerModalOpen(false); if (table?.currentOrderId) { void onSaveCustomer(table, customer.name, customer.id > 0 ? customer.id : undefined, customer.rncCedula, customer.fiscalName).catch(() => undefined) } }} />}</section></div>
}

function TransferTableModal({ currentTable, tables, onClose, onTransfer, busy }: { currentTable: RestaurantTable; tables: RestaurantTable[]; onClose: () => void; onTransfer: (targetTable: RestaurantTable) => void; busy?: boolean }) {
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null)
  const availableTables = useMemo(() => {
    return tables.filter(t => t.id !== currentTable.id && (t.status === 'available' || !t.currentOrderId))
  }, [tables, currentTable.id])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <header>
          <div>
            <p className="eyebrow">REASIGNAR MESA</p>
            <h2>Mover comanda</h2>
            <small>Trasladar la orden activa de Mesa {currentTable.number} a otra mesa libre.</small>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>

        <div className="modal-content">
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Seleccione la mesa de destino disponible:
          </p>

          {availableTables.length > 0 ? (
            <div className="transfer-table-grid">
              {availableTables.map(t => (
                <button
                  key={t.id}
                  type="button"
                  className={`transfer-table-card ${selectedTable?.id === t.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTable(t)}
                >
                  <TableVisual table={t} />
                  <strong>Mesa {t.number}</strong>
                  <small>{t.capacity} comensales</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty compact" style={{ padding: '24px 12px' }}>
              <p>No hay otras mesas libres en la sala en este momento.</p>
            </div>
          )}
        </div>

        <footer>
          <button type="button" className="button outline" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!selectedTable || busy}
            onClick={() => selectedTable && onTransfer(selectedTable)}
          >
            <ArrowRightLeft size={15} />
            {busy ? 'Moviendo…' : selectedTable ? `Mover a Mesa ${selectedTable.number}` : 'Seleccione mesa'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function ProductPhoto({ item, compact = false }: { item: MenuItem; compact?: boolean }) {
  const [failed, setFailed] = useState(false)
  return <div className={`product-photo ${compact ? 'compact' : ''}`} aria-label={`Imagen de ${item.name}`}>{item.imageUrl && !failed ? <img src={item.imageUrl} alt={`Fotografía de ${item.name}`} loading="lazy" onError={() => setFailed(true)} /> : <div className="product-photo-empty"><span>Sin fotografía publicada</span><small>{item.imageUrl ? 'No fue posible cargar la imagen' : 'El propietario debe cargarla en el catálogo'}</small></div>}</div>
}

function TableVisual({ table }: { table: RestaurantTable }) {
  const chairCount = Math.max(1, Math.min(Math.round(table.capacity) || 2, 12))
  return <div className="table-visual" aria-label={`${table.number}: ${statusLabels[table.status]} · ${chairCount} sillas`}>{Array.from({ length: chairCount }, (_, index) => <span className="table-chair" key={index} style={chairStyle(index, chairCount)} aria-hidden="true" />)}<span className="table-top" aria-hidden="true"><i /></span></div>
}

function chairStyle(index: number, count: number): CSSProperties {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2
  return { left: `${50 + Math.cos(angle) * 42}%`, top: `${50 + Math.sin(angle) * 40}%`, transform: `translate(-50%, -50%) rotate(${angle + Math.PI / 2}rad)` }
}

function ProductPicker({ items, onSelect, onQuickAdd }: { items: MenuItem[]; onSelect: (item: MenuItem) => void; onQuickAdd?: (item: MenuItem) => void }) {
  const [category, setCategory] = useState('Todos')
  const [search, setSearch] = useState('')
  const [allergen, setAllergen] = useState('')

  const categories = useMemo(() => {
    const list = Array.from(new Set(items.map(item => item.categoryName).filter(Boolean))).sort()
    return ['Todos', ...list]
  }, [items])

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { Todos: items.length }
    for (const item of items) {
      if (item.categoryName) {
        counts[item.categoryName] = (counts[item.categoryName] || 0) + 1
      }
    }
    return counts
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(item => {
      const matchCat = category === 'Todos' || item.categoryName === category
      const matchSearch = !q || item.name.toLowerCase().includes(q) || (item.code && item.code.toLowerCase().includes(q))
      const matchAllergen = !allergen || item.allergens.some(val => val.toLowerCase().includes(allergen.toLowerCase())) || item.dietaryTags.some(val => val.toLowerCase().includes(allergen.toLowerCase()))
      return matchCat && matchSearch && matchAllergen
    })
  }, [items, category, search, allergen])

  return (
    <div className="product-picker-modern">
      <div className="search-row-modern">
        <Search size={18} style={{ color: 'var(--primary)', flexShrink: 0 }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar plato, bebida o código..."
          aria-label="Buscar en el menú"
        />
        {search && (
          <button
            type="button"
            className="icon-button"
            style={{ width: 26, height: 26 }}
            onClick={() => setSearch('')}
            title="Limpiar búsqueda"
          >
            <X size={14} />
          </button>
        )}
        <select
          value={allergen}
          onChange={e => setAllergen(e.target.value)}
          style={{ width: 'auto', minWidth: 95, padding: '4px 8px', fontSize: 12, border: 'none', background: 'transparent' }}
        >
          <option value="">Alérgenos</option>
          <option value="gluten">Sin gluten</option>
          <option value="nuts">Sin nueces</option>
          <option value="dairy">Sin lácteos</option>
        </select>
      </div>

      <div className="category-chips-scroll" role="tablist" aria-label="Categorías del menú">
        {categories.map(cat => {
          const isActive = category === cat
          const count = categoryCounts[cat] || 0
          return (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`category-chip ${isActive ? 'active' : ''}`}
              onClick={() => setCategory(cat)}
            >
              <span>{cat}</span>
              <span className="category-count">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="product-grid">
        {filtered.map(item => {
          const hasRequiredMods = Array.isArray(item.modifiers) && item.modifiers.some((m: any) => m.required);
          return (
            <div
              key={item.id}
              className={`product-card-wrap ${!item.available ? 'unavailable' : ''}`}
            >
              <button
                type="button"
                className="product-card"
                disabled={!item.available}
                onClick={() => onSelect(item)}
              >
                <ProductPhoto item={item} />
                <strong className="product-name">{item.name}</strong>
                <small>{item.code || `n.º ${item.id}`}</small>
                <b>{formatMoney(item.price)}</b>
                {!item.available && (
                  <em>No disponible{item.availabilityReason ? ` · ${item.availabilityReason}` : ''}</em>
                )}
              </button>
              {item.available && onQuickAdd && !hasRequiredMods && (
                <button
                  type="button"
                  className="quick-add-btn"
                  title={`Agregar 1 ${item.name} a la orden`}
                  aria-label={`Agregar ${item.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuickAdd(item);
                  }}
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
          );
        })}
        {!filtered.length && (
          <div className="empty compact" style={{ gridColumn: 'span 2' }}>
            <p>No se encontraron platos que coincidan con la búsqueda.</p>
          </div>
        )}
      </div>
    </div>
  )
}

const PRESET_KITCHEN_NOTES = [
  'Sin cebolla',
  'Salsa aparte',
  'Término medio',
  'Bien cocido',
  'Poco picante',
  'Sin sal',
  'Sin picante',
  'Para llevar',
  'Servir primero',
  'Todo junto'
];

function ModifierModal({ item, seatCount, onClose, onAdd }: { item: MenuItem; seatCount?: number; onClose: () => void; onAdd: (line: OrderLine) => void }) {
  const [groups, setGroups] = useState<ModifierGroup[]>(normalizeModifiers(item.modifiers)); const [selected, setSelected] = useState<Record<number, ModifierOption[]>>({}); const [seat, setSeat] = useState<OrderLine['seatNumber']>(); const [quantity, setQuantity] = useState(1); const [note, setNote] = useState(''); const [loading, setLoading] = useState(false)
  // The loading flag intentionally changes when the asynchronous modifier request begins.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!groups.length && item.modifiers === undefined) { setLoading(true); api.modifierGroups('pin', item.id).then(value => setGroups(normalizeModifiers(value))).catch(() => setGroups([])).finally(() => setLoading(false)) } }, [item.id, item.modifiers, groups.length])
  // Seat tracking is useful when the table wants it, but it must never block a
  // normal order. The server accepts an omitted seat number, so the default is
  // intentionally "Sin asignar".
  const valid = groups.every(group => !group.required || (selected[group.id]?.length || 0) >= group.minSelect)
  function toggle(group: ModifierGroup, option: ModifierOption) { setSelected(prev => { const current = prev[group.id] || []; const has = current.some(value => value.id === option.id); const next = has ? current.filter(value => value.id !== option.id) : group.maxSelect === 1 ? [option] : current.length < group.maxSelect ? [...current, option] : current; return { ...prev, [group.id]: next } }) }
  const modifiers = groups.flatMap(group => (selected[group.id] || []).map(option => ({ id: option.id, name: option.name, price: option.price, groupId: group.id })))
  const seats = seatCount ? Array.from({ length: Math.max(1, Math.min(Math.round(seatCount), 12)) }, (_, index) => index + 1) : []
  return <div className="modal-backdrop"><section className="modal"><header><div><p className="eyebrow">PERSONALIZAR</p><h2>{item.name}</h2></div><button className="icon-button" onClick={onClose}><X /></button></header><p className="price">{formatMoney(item.price)}</p><div className="modal-content">{seatCount ? <label>Asiento · opcional<select aria-label="Asiento · opcional" value={seat === undefined ? '' : String(seat)} onChange={e => setSeat(e.target.value === 'shared' ? e.target.value : e.target.value === '' ? undefined : Number(e.target.value))}><option value="">Sin asignar</option>{seats.map(value => <option key={value} value={value}>Silla {value}</option>)}<option value="shared">Compartir</option></select></label> : null}{loading && <p className="muted">Cargando opciones…</p>}{groups.map(group => <fieldset key={group.id}><legend>{group.name}{group.required ? ' · obligatorio' : ''}</legend><div className="option-grid">{group.options.filter(option => option.available).map(option => <button key={option.id} className={(selected[group.id] || []).some(value => value.id === option.id) ? 'selected' : ''} onClick={() => toggle(group, option)}>{option.name}{option.price ? ` +${formatMoney(option.price)}` : ''}</button>)}</div></fieldset>)}<label>Nota para cocina
          <div className="preset-notes-chips" role="group" aria-label="Notas rápidas frecuentes">
            {PRESET_KITCHEN_NOTES.map(preset => {
              const active = note.includes(preset);
              return (
                <button
                  key={preset}
                  type="button"
                  className={`preset-chip ${active ? 'active' : ''}`}
                  onClick={() => {
                    if (active) {
                      setNote(prev => prev.replace(preset, '').replace(/^,?\s*|\s*,?\s*$/g, '').trim());
                    } else {
                      setNote(prev => prev ? `${prev.trim()}, ${preset}` : preset);
                    }
                  }}
                >
                  {active ? '✓ ' : '+ '}{preset}
                </button>
              );
            })}
          </div>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Escribir o pulsar las notas frecuentes arriba…" />
        </label><div className="quantity"><button onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus /></button><b>{quantity}</b><button onClick={() => setQuantity(quantity + 1)}><Plus /></button></div></div><footer><button className="button outline" onClick={onClose}>Cancelar</button><button className="button primary" disabled={!valid} onClick={() => onAdd({ clientId: crypto.randomUUID(), itemId: item.id, name: item.name, price: item.price, quantity, seatNumber: seat, note, modifiers })}>{valid ? 'Agregar a la comanda' : 'Complete las opciones requeridas'}</button></footer></section></div>
}

function MenuPanel({ items, onClose }: { items: MenuItem[]; onClose: () => void }) { return <div className="modal-backdrop"><section className="modal wide"><header><div><p className="eyebrow">CATÁLOGO DEL RESTAURANTE</p><h2>Disponibilidad del menú</h2></div><button className="icon-button" onClick={onClose}><X /></button></header><div className="availability-list">{items.map(item => <div key={item.id} className="availability-row"><ProductPhoto item={item} compact /><span className={item.available ? 'availability-dot on' : 'availability-dot off'} /><div><strong>{item.name}</strong><small>{item.available ? 'Disponible' : `No disponible${item.availabilityReason ? ` · ${item.availabilityReason}` : ''}`}</small></div><b>{formatMoney(item.price)}</b></div>)}</div></section></div> }

const permissionLabels: Record<string, string> = { 'orders.view': 'Consultar pedidos', 'orders.create': 'Crear pedidos', 'orders.update': 'Modificar pedidos', 'orders.kot': 'Enviar comandas', 'tables.view': 'Consultar mesas', 'tables.manage': 'Administrar mesas', 'payments.view': 'Consultar pagos', 'payments.charge': 'Registrar cobros', 'payments.refund': 'Reembolsar pagos', 'cash.view': 'Consultar caja', 'cash.open': 'Abrir turno', 'cash.close': 'Cerrar turno', 'cash.movement': 'Registrar movimientos de caja', 'cash.approve': 'Aprobar cierres', 'menu.view': 'Consultar menú', 'menu.manage': 'Administrar menú', 'kitchen.manage': 'Gestionar cocina', 'print.use': 'Usar impresión', 'customers.view': 'Consultar clientes', 'customers.manage': 'Administrar clientes', 'reports.view': 'Consultar informes', 'settings.manage': 'Administrar configuración' }

function NotificationSettingsCard({ settings, onChange, onPreview }: { settings: NotificationSettings; onChange: (patch: Partial<NotificationSettings>) => void; onPreview: () => void }) {
  return <section className="notification-settings"><div className="panel-section-heading"><div><strong>Ajustes de llamadas</strong><small>Seleccione el sonido y la vibración para reconocer una llamada nueva.</small></div><button className="button outline" onClick={onPreview}>Probar aviso</button></div><div className="notification-settings-grid"><label>Sonido<select value={settings.sound} onChange={event => onChange({ sound: event.target.value as NotificationSettings['sound'] })}><option value="service-bell">Campana de servicio</option><option value="bell">Campana breve</option><option value="service-bell-strikes">Campana de varios toques</option><option value="none">Sin sonido</option></select></label><label>Volumen<input type="range" min="0" max="1" step="0.05" value={settings.volume} disabled={settings.sound === 'none'} onChange={event => onChange({ volume: Number(event.target.value) })} /></label><label className="check-label"><input type="checkbox" checked={settings.vibration} onChange={event => onChange({ vibration: event.target.checked })} /> Vibración</label></div></section>
}

function OperationsPanel({ notifications, loading, offline, permissions, roleKey, onClose, onMarkNotificationRead }: { notifications: LiveNotification[]; loading: boolean; offline: boolean; permissions: Record<string, boolean>; roleKey: StaffRole; onClose: () => void; onMarkNotificationRead: (notification: LiveNotification) => Promise<void> }) {
  const enabled = Object.entries(permissions).filter(([, value]) => value).map(([key]) => permissionLabels[key] || key)
  const cached = readCache()
  const [waiterRequests, setWaiterRequests] = useState<WaiterRequest[]>(cached.waiterRequests || [])
  const [waiterLoading, setWaiterLoading] = useState(!offline)
  const [waiterError, setWaiterError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(cached.notificationSettings || defaultNotificationSettings)
  function updateNotificationSettings(patch: Partial<NotificationSettings>) {
    const next = { ...notificationSettings, ...patch }
    setNotificationSettings(next)
    saveCache({ notificationSettings: next })
  }
  async function loadWaiterRequests() {
    if (offline) { setWaiterRequests(readCache().waiterRequests || []); setWaiterLoading(false); return }
    setWaiterLoading(true)
    try {
      const rows = await api.waiterRequests('pin', 'pending')
      setWaiterRequests(rows); saveCache({ waiterRequests: rows }); setWaiterError('')
    } catch (cause) { setWaiterError(normalizeError(cause, 'No se pudieron consultar las solicitudes de mesa.')) }
    finally { setWaiterLoading(false) }
  }
  // Polling is the Firebase-free notification transport for this operational panel.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void loadWaiterRequests(); if (offline) return; const timer = window.setInterval(() => void loadWaiterRequests(), 5_000); return () => window.clearInterval(timer) }, [offline])
  async function completeWaiterRequest(request: WaiterRequest) {
    if (busyId !== null) return
    setBusyId(request.id); setWaiterError('')
    try {
      const idempotencyKey = newIdempotencyKey()
      if (offline) {
        await enqueue({ id: crypto.randomUUID(), scope: getStorageScope(), method: 'PUT', path: `/pos/waiter-requests/${request.id}/status`, body: { status: 'completed' }, idempotencyKey, createdAt: new Date().toISOString() })
        setWaiterError('Solicitud marcada localmente; se sincronizará al recuperar la conexión.')
      } else {
        await api.updateWaiterRequestStatus('pin', request.id, 'completed', idempotencyKey)
      }
      setWaiterRequests(current => current.filter(value => value.id !== request.id))
      saveCache({ waiterRequests: waiterRequests.filter(value => value.id !== request.id) })
    } catch (cause) { setWaiterError(normalizeError(cause, 'No se pudo marcar la solicitud como atendida.')) }
    finally { setBusyId(null) }
  }
  return <div className="modal-backdrop"><section className="modal wide"><header><div><p className="eyebrow">OPERACIÓN ACTUAL · {roleLabel(roleKey).toUpperCase()}</p><h2>Avisos y funciones disponibles</h2></div><button className="icon-button" onClick={onClose}><X /></button></header><div className="ops-summary"><div><strong>Cocina</strong><span>Las comandas se publican mediante el servicio de cocina. El tablero de cocina consulta los pedidos activos y requiere la autorización correspondiente.</span></div><div><strong>Catálogo</strong><span>La aplicación respeta la disponibilidad publicada. El servicio actual no informa existencias detalladas de ingredientes.</span></div><div><strong>Autorizaciones</strong><span>Las funciones activas corresponden a su perfil y permisos asignados.</span></div></div><div className="permission-list"><strong>Funciones autorizadas</strong>{enabled.length ? <div>{enabled.map(label => <span key={label}>{label}</span>)}</div> : <small>No se recibieron funciones autorizadas para este perfil.</small>}</div><NotificationSettingsCard settings={notificationSettings} onChange={updateNotificationSettings} onPreview={() => playWaiterAlert(notificationSettings)} />{offline && <div className="alert">Sin conexión: se conserva la última consulta y las atenciones quedan en cola para sincronizarse.</div>}{waiterError && <Alert>{waiterError}</Alert>}<section className="waiter-request-section"><div className="panel-section-heading"><div><strong>Llamadas de mesa</strong><small>Actualizacion continua en tiempo real. Al atender una llamada se retira de la lista.</small></div><button className="button outline" onClick={() => void loadWaiterRequests()} disabled={waiterLoading || offline}>Actualizar</button></div>{waiterLoading ? <div className="empty compact"><p>Consultando llamadas…</p></div> : waiterRequests.length ? <div className="waiter-request-list">{waiterRequests.map(request => <article className="waiter-request-card" key={request.id}><div><strong>{request.tableName}</strong><small>{request.createdAt ? new Date(request.createdAt).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) : 'Hora no publicada'} · Pendiente</small></div><button className="button primary" disabled={busyId !== null} onClick={() => void completeWaiterRequest(request)}>{busyId === request.id ? 'Guardando…' : 'Marcar atendida'}</button></article>)}</div> : <div className="empty compact"><Bell size={30} /><p>No hay llamadas pendientes.</p></div>}</section>{loading ? <div className="empty compact"><p>Consultando avisos…</p></div> : notifications.length ? <div className="notification-list">{notifications.map(notification => <article className="notification-card" key={notification.id} role="button" tabIndex={0} onClick={() => void onMarkNotificationRead(notification)}><span className="notification-icon"><Bell size={17} /></span><div><strong>{notification.title}</strong><p>{notification.message}</p><small>{notificationTypeLabel(notification.type)}{notification.createdAt ? ` · ${notification.createdAt}` : ''}{notification.unread ? ' · Sin leer' : ''}</small></div></article>)}</div> : <div className="empty compact"><Bell size={30} /><p>No hay avisos disponibles.</p></div>}<footer className="modal-note">Las llamadas de mesa se actualizan en vivo. Sin conexion, se guardan en el dispositivo y se sincronizan al restablecerse la red wifi.</footer></section></div>
}

function KotElapsedTimer({ createdAt }: { createdAt?: string }) {
  const [elapsedMinutes, setElapsedMinutes] = useState(() => {
    if (!createdAt) return 0
    const diff = Math.max(0, Date.now() - new Date(createdAt).getTime())
    return Math.floor(diff / 60_000)
  })

  useEffect(() => {
    if (!createdAt) return
    const interval = setInterval(() => {
      const diff = Math.max(0, Date.now() - new Date(createdAt).getTime())
      setElapsedMinutes(Math.floor(diff / 60_000))
    }, 15_000)
    return () => clearInterval(interval)
  }, [createdAt])

  if (!createdAt) return null

  const colorClass = elapsedMinutes < 10 ? 'kot-timer-green' : elapsedMinutes < 20 ? 'kot-timer-yellow' : 'kot-timer-red'

  return (
    <span className={`kot-timer-pill ${colorClass}`} title={`Transcurrido: ${elapsedMinutes} min`}>
      <Clock size={11} />
      {elapsedMinutes}m
    </span>
  )
}

function KitchenPanel({ offline, places, standalone = false, allowAll = true, viewScope = 'supervisor', onClose, onUpdateStatus }: { offline: boolean; places: KitchenPlace[]; standalone?: boolean; allowAll?: boolean; viewScope?: KitchenView['scope']; onClose: () => void; onUpdateStatus: (kotId: number, status: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string }> }) {
  const [tickets, setTickets] = useState<KitchenTicket[]>([])
  const [loading, setLoading] = useState(!offline)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const cachedView = readCache().kitchenView
  const cachedViewIsUsable = cachedView?.scope === viewScope && cachedView.locked && (allowAll || cachedView.placeId !== 'all')
  const [selectedPlaceId, setSelectedPlaceId] = useState<number | 'all'>(() => cachedViewIsUsable ? cachedView.placeId : allowAll ? 'all' : places.find(place => place.isDefault)?.id || places[0]?.id || 'all')
  const [areaLocked, setAreaLocked] = useState(() => Boolean(cachedViewIsUsable))
  const seenTicketIds = useRef<Set<number> | null>(null)
  const seenFilter = useRef<string | null>(null)
  const activeStatuses = ['pending_confirmation', 'in_kitchen', 'food_ready']
  const placeOptions = useMemo(() => {
    const known = new globalThis.Map<number, KitchenPlace>()
    places.filter(place => place.id > 0).forEach(place => known.set(place.id, place))
    tickets.forEach(ticket => {
      if (ticket.kitchenPlaceId && !known.has(ticket.kitchenPlaceId)) known.set(ticket.kitchenPlaceId, { id: ticket.kitchenPlaceId, name: ticket.kitchenPlace || `Estación ${ticket.kitchenPlaceId}` })
    })
    return [...known.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
  }, [places, tickets])
  const defaultPlaceId = places.find(place => place.isDefault)?.id || places[0]?.id || 'all'
  const activePlaceId = !allowAll && selectedPlaceId === 'all' ? defaultPlaceId : selectedPlaceId
  const selectedFilterKey = activePlaceId === 'all' ? 'all' : String(activePlaceId)
  function choosePlace(placeId: number | 'all') {
    setSelectedPlaceId(placeId)
    if (areaLocked) {
      setAreaLocked(false)
      saveCache({ kitchenView: { scope: viewScope, placeId, locked: false } })
    }
  }
  function toggleAreaLock() {
    const locked = !areaLocked
    setAreaLocked(locked)
    saveCache({ kitchenView: { scope: viewScope, placeId: activePlaceId, locked } })
  }
  async function load(placeId: number | 'all' = activePlaceId) {
    const filterKey = placeId === 'all' ? 'all' : String(placeId)
    if (offline) {
      const cached = readCache().kots || []
      setTickets(cached.filter(ticket => activeStatuses.includes(ticket.status) && (placeId === 'all' || ticket.kitchenPlaceId === placeId)))
      setLoading(false)
      return
    }
    setLoading(true); setError('')
    try {
      const values = await api.kots('pin', { kitchenPlaceId: placeId === 'all' ? undefined : Number(placeId) })
      const currentIds = new Set(values.map(ticket => ticket.id))
      if (seenFilter.current === filterKey && seenTicketIds.current && values.some(ticket => !seenTicketIds.current?.has(ticket.id))) {
        const newest = values.find(ticket => !seenTicketIds.current?.has(ticket.id))
        const placeName = newest?.kitchenPlace ? ` · ${newest.kitchenPlace}` : ''
        const tableName = newest?.tableName ? `Mesa ${newest.tableName}` : 'pedido sin mesa'
        void playWaiterAlert(readCache().notificationSettings || defaultNotificationSettings, 'Nueva comanda de cocina', `${tableName}${placeName}`)
      }
      seenFilter.current = filterKey
      seenTicketIds.current = currentIds
      saveCache({ kots: values })
      setTickets(values.filter(ticket => activeStatuses.includes(ticket.status)))
    } catch (cause) { setError(normalizeError(cause, 'No se pudieron cargar las órdenes de cocina.')) }
    finally { setLoading(false) }
  }
  // KDS refresh is an external API synchronization triggered by the panel.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(activePlaceId); if (offline) return; const timer = window.setInterval(() => void load(activePlaceId), 8_000); return () => window.clearInterval(timer) }, [offline, selectedFilterKey])
  async function advance(ticket: KitchenTicket) {
    if (busyId !== null) return
    const next = ticket.status === 'pending_confirmation' ? 'in_kitchen' : ticket.status === 'in_kitchen' ? 'food_ready' : ticket.status === 'food_ready' ? 'served' : null
    if (!next) return
    setBusyId(ticket.id); setError('')
    try {
      const result = await onUpdateStatus(ticket.id, next, newIdempotencyKey())
      setTickets(current => current.map(value => value.id === ticket.id ? { ...value, status: next } : value))
      saveCache({ kots: (readCache().kots || []).map(value => value.id === ticket.id ? { ...value, status: next } : value) })
      setError(result.message)
      if (!result.queued) await load(activePlaceId)
    }
    catch (cause) { setError(normalizeError(cause, 'El servicio no pudo actualizar la comanda.')) }
    finally { setBusyId(null) }
  }
  const statusLabel = (status: string) => status === 'pending_confirmation' ? 'Pendiente' : status === 'in_kitchen' ? 'En preparación' : status === 'food_ready' ? 'Listo' : status === 'served' ? 'Servido' : status
  const actionLabel = (status: string) => status === 'pending_confirmation' ? 'Iniciar preparación' : status === 'in_kitchen' ? 'Marcar como listo' : status === 'food_ready' ? 'Marcar como servido' : 'Actualizar'
  return <div className={standalone ? 'kitchen-standalone-panel' : 'modal-backdrop'}><section className={`modal wide kitchen-panel${standalone ? ' kitchen-panel-standalone' : ''}`}><header><div><p className="eyebrow">AUTORIZACIÓN DE COCINA</p><h2>Cocina · pedidos activos</h2><small>Las nuevas comandas aparecen aquí sin repetir las anteriores.</small></div><div className="kitchen-header-actions"><button className="button outline" onClick={() => void load(activePlaceId)} disabled={loading || offline}>Actualizar</button>{!standalone && <button className="icon-button" onClick={onClose}><X /></button>}</div></header>{placeOptions.length > 0 && <><div className="kitchen-place-filter"><label htmlFor="kitchen-area-filter">Mostrar área<select id="kitchen-area-filter" value={activePlaceId} disabled={areaLocked} onChange={event => choosePlace(event.target.value === 'all' ? 'all' : Number(event.target.value))}>{allowAll && <option value="all">Todas las áreas</option>}{placeOptions.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label><button className={`button ${areaLocked ? 'primary' : 'outline'}`} onClick={toggleAreaLock} title={areaLocked ? 'Desbloquear selección de área' : 'Bloquear esta área'}>{areaLocked ? <><Unlock size={15} /> Desbloquear área</> : <><Lock size={15} /> Bloquear área</>}</button></div><p className="kitchen-place-label">{areaLocked ? `Área bloqueada: ${activePlaceId === 'all' ? 'Todas' : placeOptions.find(place => place.id === activePlaceId)?.name || 'seleccionada'}` : 'Área de trabajo'}</p>{!areaLocked && <nav className="kitchen-place-tabs" aria-label="Áreas de preparación">{allowAll && <button className={activePlaceId === 'all' ? 'active' : ''} onClick={() => choosePlace('all')}>Todas</button>}{placeOptions.map(place => <button className={activePlaceId === place.id ? 'active' : ''} key={place.id} onClick={() => choosePlace(place.id)}>{place.name}</button>)}</nav>}</>}{!placeOptions.length && <div className="kitchen-place-empty">La sucursal todavía no publica sectores de preparación. Solicite al administrador configurar Cocina, Bar o Reparto en RestaPP.</div>}{offline && <Alert>Sin conexión: los cambios quedan guardados localmente y se sincronizarán al restablecerse la conexión.</Alert>}{error && <Alert>{error}</Alert>}{loading ? <div className="empty compact"><p>Cargando pedidos activos…</p></div> : tickets.length ? <div className="kitchen-list">{tickets.map(ticket => <article className={`kitchen-ticket kitchen-${ticket.status}`} key={ticket.id}><div className="kitchen-ticket-header"><div><strong>{kitchenTicketLabel(ticket.kotNumber, ticket.id)}</strong><small className="kitchen-table-label">{ticket.tableName ? `Mesa ${ticket.tableName}` : 'Pedido sin mesa'}</small><small>{orderNumberLabel(ticket.orderNumber, `Pedido n.º ${ticket.orderId}`)}{ticket.kitchenPlace ? ` · ${ticket.kitchenPlace}` : ''}</small>{ticket.waiterName && <small className="kitchen-waiter-label">Mesero: {ticket.waiterName}</small>}</div><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><KotElapsedTimer createdAt={ticket.createdAt} /><span className="kitchen-status">{statusLabel(ticket.status)}</span></div></div><ul>{ticket.items.map(item => <li key={item.id}><strong>{item.quantity}× {item.name}</strong>{item.variation && <small className="kitchen-item-meta">Variante: {item.variation}</small>}{item.modifiers?.length ? <small className="kitchen-item-meta">Suplementos: {item.modifiers.map(modifier => modifier.name).join(', ')}</small> : null}{item.note && <em>Nota: {item.note}</em>}</li>)}</ul>{ticket.note && <p className="kitchen-note"><strong>Nota general:</strong> {ticket.note}</p>}<footer><small>{ticket.createdAt ? new Date(ticket.createdAt).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) : 'Hora no publicada'}</small><button className="button primary" disabled={busyId !== null} onClick={() => void advance(ticket)}>{busyId === ticket.id ? 'Guardando…' : actionLabel(ticket.status)}</button></footer></article>)}</div> : <div className="empty compact"><ChefHat size={34} /><p>No hay pedidos pendientes en esta área.</p></div>}<footer className="modal-note">Cada estación ve únicamente sus comandas: cocina, bar, reparto u otra zona activa de la sucursal. El sonido y la vibración de una comanda nueva usa la misma configuración de avisos que las llamadas de mesa. El área bloqueada se conserva en este dispositivo por sucursal.</footer></section></div>
}

type CashRegisterView = { id: number; name: string; status?: string }
type CashSessionView = { id: number; registerId?: number; registerName?: string; status: string; openingFloat?: number; expectedCash?: number; countedCash?: number; difference?: number; openedAt?: string; closedAt?: string }

function normalizeCashRegister(raw: any): CashRegisterView | null {
  if (!raw || !Number(raw.id)) return null
  return { id: Number(raw.id), name: String(raw.name || raw.register_name || raw.title || `Caja ${raw.id}`), status: raw.status ? String(raw.status).toLowerCase() : undefined }
}

function normalizeCashSession(raw: any): CashSessionView | null {
  const value = raw?.session || raw?.active_session || raw?.data?.session || raw?.data || raw
  if (!value || typeof value !== 'object' || !Number(value.id || value.session_id)) return null
  const numberOrUndefined = (candidate: unknown) => candidate === null || candidate === undefined || candidate === '' ? undefined : Number(candidate)
  return { id: Number(value.id || value.session_id), registerId: numberOrUndefined(value.cash_register_id || value.register_id || value.cashRegister?.id), registerName: value.cash_register?.name || value.cashRegister?.name || value.register_name, status: String(value.status || 'open').toLowerCase(), openingFloat: numberOrUndefined(value.opening_float ?? value.opening_amount), expectedCash: numberOrUndefined(value.expected_cash ?? value.expected_amount), countedCash: numberOrUndefined(value.counted_cash ?? value.closing_cash), difference: numberOrUndefined(value.difference ?? value.cash_difference), openedAt: value.opened_at, closedAt: value.closed_at }
}

function cashNumber(value: unknown) { return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value) }
function cashSessionLabel(status: string) { return status === 'open' || status === 'opened' ? 'Abierto' : status === 'pending_approval' ? 'Pendiente de aprobación' : status === 'closed' ? 'Cerrado' : status === 'rejected' ? 'Rechazado' : status === 'reopened' ? 'Reabierto' : status }

function CashierPanel({ offline, permissions, onClose, onOpenSession, onCloseSession, onApproveSession, onRejectSession, onReopenSession, onCashMovement }: { offline: boolean; permissions: Record<string, boolean>; onClose: () => void; onOpenSession: (registerId: number, openingFloat: number, note: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onCloseSession: (sessionId: number, countedCash: number, expectedCash: number | undefined, note: string, sendForApproval: boolean, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onApproveSession: (sessionId: number, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onRejectSession: (sessionId: number, note: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onReopenSession: (sessionId: number, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onCashMovement: (movement: 'cash-in' | 'cash-out' | 'safe-drop', sessionId: number, amount: number, note: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; }) {
  const [registers, setRegisters] = useState<CashRegisterView[]>([])
  const [session, setSession] = useState<CashSessionView | null>(null)
  const [summary, setSummary] = useState<any>(null)
  const [selectedRegisterId, setSelectedRegisterId] = useState('')
  const [openingFloat, setOpeningFloat] = useState('')
  const [openingNote, setOpeningNote] = useState('')
  const [countedCash, setCountedCash] = useState('')
  const [closingNote, setClosingNote] = useState('')
  const [sendForApproval, setSendForApproval] = useState(true)
  const [movement, setMovement] = useState<'cash-in' | 'cash-out' | 'safe-drop'>('cash-in')
  const [movementAmount, setMovementAmount] = useState('')
  const [movementNote, setMovementNote] = useState('')
  const [cashLoading, setCashLoading] = useState(!offline)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const canViewCash = permissions['cash.view'] === true
  const canOpenCash = permissions['cash.open'] === true
  const canCloseCash = permissions['cash.close'] === true
  const canMoveCash = permissions['cash.movement'] === true
  const canApproveCash = permissions['cash.approve'] === true

  async function loadCash() {
    if (offline) {
      const cached = readCache(); setRegisters((cached.cashRegisters || []).map(normalizeCashRegister).filter(Boolean) as CashRegisterView[]); setSession(normalizeCashSession(cached.cashSession)); setSummary(cached.cashSummary || null); setCashLoading(false); return
    }
    setCashLoading(true)
    try {
      let nextRegisters: CashRegisterView[] = []
      let nextSession: CashSessionView | null = null
      if (canViewCash) nextRegisters = (await api.cashRegisters('pin')).map(normalizeCashRegister).filter(Boolean) as CashRegisterView[]
      if (canViewCash && canOpenCash) nextSession = normalizeCashSession(await api.activeCashSession('pin'))
      setRegisters(nextRegisters); setSession(nextSession); setSelectedRegisterId(previous => previous || String(nextSession?.registerId || nextRegisters[0]?.id || ''))
      let nextSummary: any = null
      if (nextSession && canViewCash) { try { nextSummary = await api.cashSessionSummary('pin', nextSession.id) } catch { /* el resumen es complementario al turno */ } }
      setSummary(nextSummary); saveCache({ cashRegisters: nextRegisters, cashSession: nextSession, cashSummary: nextSummary })
    } catch (cause) { setError(normalizeError(cause, 'No se pudo consultar el turno de caja.')) }
    finally { setCashLoading(false) }
  }

  // Loading both order balances and the cash session is an external API synchronization triggered by the modal.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void loadCash() }, [offline])

  function requireConnection() { if (offline) { setError('La apertura, cierre y movimientos de caja requieren conexion a la red del restaurante.'); return false } return true }
  async function runCashAction(action: () => Promise<{ queued: boolean; message: string; data?: any }>, after?: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setSuccess(''); try { const result = await action(); setSuccess(result.message); if (after && !result.queued) await after(); else if (!result.queued) await loadCash() } catch (cause) { setError(normalizeError(cause, 'No se pudo procesar la operacion de caja. Verifique la conexion.')) } finally { setBusy(false) } }
  async function openSession() {
    if (!requireConnection()) return
    const registerId = Number(selectedRegisterId); const float = Number(openingFloat || 0)
    if (!registerId) { setError('Seleccione la caja que desea abrir.'); return }
    if (openingFloat.trim() === '') { setError('Indique el fondo inicial / caja chica para abrir el turno.'); return }
    if (!Number.isFinite(float) || float < 0) { setError('El fondo inicial no puede ser negativo.'); return }
    await runCashAction(() => onOpenSession(registerId, float, openingNote, newIdempotencyKey()))
  }
  async function closeSession() {
    if (!requireConnection() || !session) return
    const counted = Number(countedCash); const expected = cashNumber(session.expectedCash ?? summary?.expected_cash ?? summary?.expected_amount)
    if (!Number.isFinite(counted) || counted < 0) { setError('Indique el efectivo contado para cerrar el turno.'); return }
    await runCashAction(() => onCloseSession(session.id, counted, expected, closingNote, sendForApproval, newIdempotencyKey()))
  }
  async function moveCash() {
    if (!requireConnection() || !session) return
    const value = Number(movementAmount)
    if (!Number.isFinite(value) || value <= 0) { setError('El monto del movimiento debe ser mayor que cero.'); return }
    await runCashAction(() => onCashMovement(movement, session.id, value, movementNote, newIdempotencyKey()))
    setMovementAmount(''); setMovementNote('')
  }
  const expected = cashNumber(session?.expectedCash ?? summary?.expected_cash ?? summary?.expected_amount)
  const difference = cashNumber(session?.difference ?? summary?.difference ?? summary?.cash_difference)
  const sessionClosed = session && ['closed', 'pending_approval', 'rejected'].includes(session.status)
  return <div className="modal-backdrop"><section className="modal wide cashier-panel"><header><div><p className="eyebrow">AUTORIZACIÓN DE CAJA</p><h2>Turno de caja</h2><small>Fondo inicial, movimientos, arqueo y cierre se administran aquí. Los cobros se registran desde cada mesa.</small></div><button className="icon-button" onClick={onClose}><X /></button></header>{offline && <Alert>Sin conexion: la apertura, cierre y movimientos de caja requieren conexion a la red central.</Alert>}{error && <Alert>{error}</Alert>}{success && <div className="success-box">{success}</div>}<section className="cash-register-section"><div className="cash-section-heading"><div><p className="eyebrow">TURNO DE CAJA</p><h3>{session ? `${session.registerName || `Caja ${session.registerId || ''}`} · ${cashSessionLabel(session.status)}` : 'Sin turno abierto'}</h3></div>{session && <span className="cash-session-badge">{cashSessionLabel(session.status)}</span>}</div>{cashLoading ? <div className="empty compact"><p>Consultando cajas y turno…</p></div> : !canViewCash && !canOpenCash ? <div className="empty compact"><Wallet size={28} /><p>Este perfil no tiene permisos para administrar la caja.</p></div> : session ? <div className="cash-session-card"><div className="cash-metrics"><div><span>Fondo inicial</span><strong>{formatMoney(session.openingFloat || 0)}</strong></div><div><span>Efectivo esperado</span><strong>{expected === undefined ? 'No informado' : formatMoney(expected)}</strong></div><div><span>Diferencia</span><strong>{difference === undefined ? 'No calculada' : formatMoney(difference)}</strong></div></div>{!sessionClosed && canMoveCash && <div className="cash-movement-form"><strong>Movimiento de efectivo</strong><div className="cash-form-grid"><label>Tipo<select value={movement} onChange={e => setMovement(e.target.value as typeof movement)}><option value="cash-in">Entrada de efectivo</option><option value="cash-out">Salida de efectivo</option><option value="safe-drop">Retiro a caja fuerte</option></select></label><label>Monto<input type="number" min="0.01" step="0.01" value={movementAmount} onChange={e => setMovementAmount(e.target.value)} placeholder="0.00" /></label><label>Motivo<input value={movementNote} onChange={e => setMovementNote(e.target.value)} placeholder="Cambio, compra, retiro…" /></label></div><button className="button outline" disabled={busy || offline} onClick={() => void moveCash()}>Registrar movimiento</button></div>}{!sessionClosed && canCloseCash && <div className="cash-close-form"><strong>Cierre y arqueo</strong><div className="cash-form-grid"><label>Efectivo contado<input type="number" min="0" step="0.01" value={countedCash} onChange={e => setCountedCash(e.target.value)} placeholder="0.00" /></label><label>Nota de cierre<input value={closingNote} onChange={e => setClosingNote(e.target.value)} placeholder="Observaciones del turno" /></label><label className="check-label"><input type="checkbox" checked={sendForApproval} onChange={e => setSendForApproval(e.target.checked)} /> Enviar para aprobación</label></div><button className="button primary" disabled={busy || offline} onClick={() => void closeSession()}>Cerrar turno y guardar arqueo</button></div>}{session.status === 'pending_approval' && canApproveCash && <div className="cash-approval-actions"><strong>Este cierre requiere revisión.</strong><div><button className="button primary" disabled={busy || offline} onClick={() => void runCashAction(() => onApproveSession(session.id, newIdempotencyKey()))}>Aprobar cierre</button><button className="button outline" disabled={busy || offline} onClick={() => void runCashAction(() => onRejectSession(session.id, closingNote, newIdempotencyKey()))}>Rechazar cierre</button></div></div>}{session.status === 'closed' && canApproveCash && <button className="button outline" disabled={busy || offline} onClick={() => void runCashAction(() => onReopenSession(session.id, newIdempotencyKey()))}>Reabrir turno</button>}</div> : <div className="cash-open-form">{canOpenCash ? <><div className="cash-form-grid"><label>Caja<select value={selectedRegisterId} onChange={e => setSelectedRegisterId(e.target.value)}><option value="">Seleccione una caja</option>{registers.map(register => <option value={register.id} key={register.id}>{register.name}</option>)}</select></label><label>Fondo inicial / caja chica<input type="number" min="0" step="0.01" value={openingFloat} onChange={e => setOpeningFloat(e.target.value)} placeholder="0.00" /></label><label>Nota de apertura<input value={openingNote} onChange={e => setOpeningNote(e.target.value)} placeholder="Fondo entregado por el encargado" /></label></div><button className="button primary" disabled={busy || offline} onClick={() => void openSession()}>Abrir turno de caja</button></> : <p className="muted">No tiene autorización para abrir un turno. Solicite al encargado que lo abra.</p>}</div>}</section><footer className="modal-note">La caja chica se registra como fondo inicial del turno. Las entradas, salidas y retiros a caja fuerte quedan asociadas a ese turno. Para cobrar, abra una mesa y use el botón “Cobrar” junto a “Precuenta”.</footer></section></div>
}

function SplitBill({ lines, table, onClose }: { lines: OrderLine[]; table: RestaurantTable; onClose: () => void }) {
  const [persons, setPersons] = useState(Math.max(2, Math.min(table.capacity || 2, 8)))
  const [mode, setMode] = useState<'equal' | 'items'>('equal')
  const [itemShares, setItemShares] = useState<Record<string, number>>({})

  const itemsTotal = lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, val) => m + val.price, 0)) * line.quantity, 0)
  const baseTotal = table.currentOrderTotal && table.currentOrderTotal > 0 ? table.currentOrderTotal : itemsTotal
  const estimatedTax = Math.round(baseTotal * 0.18 * 100) / 100
  const estimatedTip = Math.round(baseTotal * 0.10 * 100) / 100
  const grandTotal = baseTotal + estimatedTax + estimatedTip

  const perPersonTotal = grandTotal / persons
  const perPersonTax = estimatedTax / persons
  const perPersonTip = estimatedTip / persons

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal split-modal" onClick={e => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">MESA {table.number} · COMEDOR</p>
            <h2>Dividir cuenta</h2>
            <small>Calcule el importe correspondiente a cada comensal de la mesa.</small>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>

        <div className="modal-content">
          <div className="split-method-tabs">
            <button
              type="button"
              className={`split-tab-btn ${mode === 'equal' ? 'active' : ''}`}
              onClick={() => setMode('equal')}
            >
              En partes iguales
            </button>
            <button
              type="button"
              className={`split-tab-btn ${mode === 'items' ? 'active' : ''}`}
              onClick={() => setMode('items')}
            >
              Por artículos
            </button>
          </div>

          {mode === 'equal' ? (
            <div className="split-equal-box">
              <div className="split-persons-picker">
                <button
                  type="button"
                  className="split-counter-btn"
                  disabled={persons <= 2}
                  onClick={() => setPersons(p => Math.max(2, p - 1))}
                  aria-label="Restar una persona"
                >
                  <Minus size={18} />
                </button>
                <div className="split-persons-count">
                  <strong>{persons}</strong>
                  <small>Comensales</small>
                </div>
                <button
                  type="button"
                  className="split-counter-btn"
                  disabled={persons >= 16}
                  onClick={() => setPersons(p => Math.min(16, p + 1))}
                  aria-label="Agregar una persona"
                >
                  <Plus size={18} />
                </button>
              </div>

              <div className="split-summary-card">
                <div className="split-per-person-hero">
                  <span>Por persona:</span>
                  <strong>{formatMoney(perPersonTotal)}</strong>
                </div>

                <div style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Consumo base</span>
                    <b>{formatMoney(baseTotal / persons)}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>ITBIS (18%)</span>
                    <b>{formatMoney(perPersonTax)}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Propina de ley (10%)</span>
                    <b>{formatMoney(perPersonTip)}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 6, color: 'var(--ink)' }}>
                    <span>Total mesa ({persons} pers.)</span>
                    <b>{formatMoney(grandTotal)}</b>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="split-items-box" style={{ display: 'grid', gap: 10 }}>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Seleccione el número de porciones o personas para cada artículo:
              </p>
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 8 }}>
                {lines.map(line => {
                  const shares = itemShares[line.clientId] || 1
                  const lineTotal = (line.price + line.modifiers.reduce((s, m) => s + m.price, 0)) * line.quantity
                  return (
                    <div key={line.clientId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--surface-soft)', borderRadius: 10 }}>
                      <div style={{ display: 'grid', gap: 2 }}>
                        <strong style={{ fontSize: 13 }}>{line.quantity}× {line.name}</strong>
                        <small style={{ color: 'var(--muted)', fontSize: 11 }}>{formatMoney(lineTotal)}</small>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          className="split-counter-btn"
                          style={{ width: 32, height: 32 }}
                          onClick={() => setItemShares(prev => ({ ...prev, [line.clientId]: Math.max(1, shares - 1) }))}
                        >
                          <Minus size={14} />
                        </button>
                        <b style={{ minWidth: 20, textAlign: 'center', fontSize: 14 }}>{shares}</b>
                        <button
                          type="button"
                          className="split-counter-btn"
                          style={{ width: 32, height: 32 }}
                          onClick={() => setItemShares(prev => ({ ...prev, [line.clientId]: shares + 1 }))}
                        >
                          <Plus size={14} />
                        </button>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', minWidth: 70, textAlign: 'right' }}>
                          {formatMoney(lineTotal / shares)} c/u
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <footer>
          <button className="button outline" onClick={onClose}>Cerrar</button>
          <button className="button primary" onClick={onClose}>Listo</button>
        </footer>
      </section>
    </div>
  )
}

function Alert({ children }: { children: string }) { return <div className="alert" role="alert">{children}</div> }
function formatFiscalSummary(payload: any) {
  const value = payload?.cart?.summary || payload?.data?.cart?.summary || payload?.data || payload?.totals || payload?.financials
  if (!value || typeof value !== 'object' || value.total == null && value.grand_total == null) return ''
  const tax = Number(value.tax_total ?? value.taxTotal ?? 0)
  const tip = Number(value.legal_tip ?? value.tip_amount ?? 0)
  const total = Number(value.grand_total ?? value.total ?? 0)
  return ` Total ${formatMoney(total)} · Impuestos ${formatMoney(tax)}${tip > 0 ? ` · Propina legal ${formatMoney(tip)}` : ''}`
}
function normalizePreBill(payload: any, table: RestaurantTable, items: Array<{ amount?: number }> = []) {
  const value = payload?.data ?? payload ?? {}
  const fiscal = value.fiscal || value.order?.fiscal || {}
  const totals = value.totals || fiscal.totals || value.financials || value.payment_summary || value.cart?.summary || {}
  const readNumber = (values: unknown[]) => { const found = values.find(value => value !== null && value !== undefined && value !== ''); return found === undefined ? null : Number(found) }
  const itemSubtotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const subtotal = readNumber([totals.subtotal, totals.sub_total, value.sub_total, value.subtotal]) ?? (itemSubtotal > 0 ? itemSubtotal : null)
  const tax = readNumber([totals.tax_total, totals.total_tax_amount, value.total_tax_amount])
  const tip = readNumber([totals.legal_tip, totals.tip_amount, value.tip_amount])
  const discount = readNumber([totals.discount_amount, value.discount_amount])
  const total = readNumber([totals.total, totals.grand_total, value.total, value.total_amount, table.currentOrderTotal]) ?? 0
  const paid = readNumber([totals.amount_paid, value.amount_paid, value.paid_amount]) ?? 0
  const due = Math.max(0, readNumber([totals.amount_due, value.amount_due, table.currentOrderDue]) ?? (total - paid))
  return {
    customer: String(table.customerName || value.customer?.name || value.customer_name || ''),
    subtotal,
    tax,
    tip,
    discount,
    total,
    paid,
    due,
    breakdownMissing: subtotal === null || tax === null,
  }
}
function preBillMoney(value: number | null) { return value === null ? 'No informado' : formatMoney(value) }
function normalizeError(cause: unknown, fallback: string) { if (cause instanceof ApiError) { const fields = cause.details?.errors ? Object.values(cause.details.errors).flat().join(' ') : ''; return fields || cause.message } return cause instanceof Error && cause.message !== 'offline' ? cause.message : fallback }
function normalizeNotification(raw: any): LiveNotification | null { if (!raw || typeof raw !== 'object') return null; const type = String(raw.type || raw.event || 'notification'); const read = raw.unread === false || raw.read_at || raw.readAt || raw.read === true || raw.is_read === true; return { id: String(raw.id || raw.uuid || crypto.randomUUID()), type, title: String(raw.title || raw.subject || notificationTypeLabel(type)), message: String(raw.message || raw.body || raw.description || 'Actualización de operación'), createdAt: raw.created_at || raw.createdAt ? new Date(raw.created_at || raw.createdAt).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) : undefined, unread: !read } }
function seatLabel(seat: OrderLine['seatNumber']) { return typeof seat === 'number' ? `Silla ${seat}` : seat === 'shared' ? 'Compartir' : seat === 'takeaway' ? 'Para llevar' : '' }
function localizedText(value: unknown, fallback: string) {
  if (typeof value === 'string' && value.trim()) return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['es-do', 'es', 'en']) if (typeof record[key] === 'string' && record[key]) return record[key] as string
  }
  return fallback
}
function normalizeModifiers(value: any[] | undefined): ModifierGroup[] { return (value || []).map((group: any) => ({ id: Number(group.id), name: localizedText(group.name || group.group_name, 'Opciones'), required: Boolean(group.required ?? group.pivot?.is_required), minSelect: Number(group.min_select ?? group.pivot?.min_select ?? (group.required ? 1 : 0)), maxSelect: Number(group.max_select ?? group.pivot?.max_select ?? 1), options: (group.options || group.modifier_options || []).map((option: any) => ({ id: Number(option.id), name: localizedText(option.name || option.option_name, 'Opción'), price: Number(option.price || option.price_delta || 0), available: option.available !== false && option.is_available !== false })) })) }
