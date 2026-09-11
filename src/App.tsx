import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, ApiError, applyCategoryMetadata, normalizeAttendance } from './api/client'
import type { AttendanceRecord, Branch, DeliveryExecutive, DeliveryPlatform, DeliverySettings, DeviceBinding, FiscalCapabilities, KitchenPlace, KitchenTicket, KitchenView, MenuCategory, MenuItem, ModifierGroup, ModifierOption, NotificationSettings, OfflineOperation, OfflineStep, OfflineWorkflow, OrderDraft, OrderLine, OrderMode, OrderTypeConfig, PaymentMethodOption, PosCustomer, ProductVariation, RestaurantTable, Session, StaffRole, WaiterRequest } from './types'
import { clearSession, enqueue, getDeviceId, getStorageScope, listOutbox, newIdempotencyKey, readCache, readSession, removeOutbox, saveCache, saveSession, setStorageScope, updateOutbox } from './storage/offline'
import { CustomerModal } from './CustomerModal'
import { PosDanSidebar, PosDanModule } from './components/PosDanSidebar'
import { PosModule } from './modules/PosModule'
import { CashModule } from './modules/CashModule'
import { InvoicesModule } from './modules/InvoicesModule'
import { OrdersModule } from './modules/OrdersModule'
import { CustomersModule } from './modules/CustomersModule'
import { ProductsModule } from './modules/ProductsModule'
import { InventoryModule } from './modules/InventoryModule'
import { AnalyticsModule } from './modules/AnalyticsModule'
import { DiscountsModule } from './modules/DiscountsModule'
import { ReturnsModule } from './modules/ReturnsModule'
import { UsersModule } from './modules/UsersModule'
import { SettingsModule } from './modules/SettingsModule'
import { OrderTypeModal, type OrderTypeSelection, translateOrderTypeName } from './components/OrderTypeModal'
import { ArrowRightLeft, Banknote, BatteryCharging, BedDouble, Bell, BookOpen, CalendarDays, Check, ChefHat, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, CloudLightning, CloudOff, Clock, Coffee, CreditCard, Delete, Divide, Edit3, FileText, Flame, Globe2, History, Hotel, LayoutGrid, Lock, LogOut, Map as LucideMap, Martini, Minus, Plus, Printer, Receipt, Search, Send, ShieldCheck, SlidersHorizontal, ShoppingBag, ShoppingCart, Trash2, Truck, Unlock, UserCheck, UserCircle2, UserRound, Users, UserX, Utensils, UtensilsCrossed, Wallet, Wifi, X, XCircle } from 'lucide-react'

import { Capacitor } from '@capacitor/core'
import { Haptics } from '@capacitor/haptics'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Network } from '@capacitor/network'
import { normalizeReceiptSettings } from './receipt/profile'
import { buildReceiptDocumentViewModel } from './receipt/renderer'
import { printThermalZReport, printThermalCustomerReceipt } from './utils/thermalPrinter'
import { getStationPrinterConfig, routePrintReceipt, routePrintTest, type ThermalReceiptData } from './utils/printRouter'
import { realtimeService } from './services/realtime'
import { orderServiceLabel, resolveOrderService } from './utils/orderService'
import { menuCategoryNames } from './utils/menuCategories'

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

function kitchenOrderTarget(ticket: KitchenTicket) {
  const service = resolveOrderService({
    order_type: ticket.orderType,
    table_name: ticket.tableName,
    table_id: ticket.tableId,
  })
  if (service === 'dine_in') {
    return ticket.tableName ? `Mesa ${ticket.tableName}` : 'Comer aquí · Barra'
  }
  if (service === 'unknown') return 'Pedido sin mesa · tipo no publicado'
  return orderServiceLabel(service)
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

type OrderFlowStep = { title: string; description: string }

function orderFlowSteps(mode: OrderMode): OrderFlowStep[] {
  const firstStep = mode === 'delivery'
    ? { title: 'Confirmar cliente y dirección', description: 'Verifica el teléfono y la dirección antes de enviar.' }
    : mode === 'room_service'
      ? { title: 'Confirmar habitación', description: 'Revisa el número de habitación y el huésped.' }
      : mode === 'pickup'
        ? { title: 'Tomar pedido', description: 'Confirma qué va a llevar el cliente y sus datos.' }
        : { title: 'Tomar pedido', description: 'Confirma la mesa, los platos y las notas.' }
  const readyStep = mode === 'pickup'
    ? { title: 'Listo para recoger', description: 'Avisa al cliente cuando la orden esté lista.' }
    : mode === 'delivery'
      ? { title: 'Listo para entregar', description: 'Confirma el repartidor o prepara la entrega.' }
      : { title: 'Platos listos', description: 'Recoge la orden y entrégala al cliente.' }
  const finalStep = mode === 'dine_in'
    ? { title: 'Cobrar y cerrar mesa', description: 'Cobra el saldo y la mesa quedará libre.' }
    : mode === 'room_service'
      ? { title: 'Entregar y cerrar', description: 'Lleva la orden a la habitación y cobra o carga según corresponda.' }
      : mode === 'delivery'
        ? { title: 'Entregar y cerrar', description: 'Marca la entrega cuando el cliente reciba la orden.' }
        : { title: 'Cobrar y entregar', description: 'Cobra ahora o al recoger, según lo acordado.' }
  return [
    firstStep,
    { title: 'Enviar a cocina', description: 'Pulsa “Enviar a cocina” para que el equipo la prepare.' },
    readyStep,
    finalStep,
  ]
}

function orderFlowStage(status: unknown, hasOrder: boolean, stepCount: number): number {
  if (!hasOrder) return 0
  const normalized = String(status || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (normalized.includes('cancel')) return -1
  if (normalized.includes('served') || normalized.includes('servido') || normalized.includes('delivered') || normalized.includes('entregado') || normalized.includes('recogido') || normalized.includes('completed') || normalized.includes('complet')) return stepCount - 1
  if (normalized.includes('food ready') || normalized.includes('ready for pickup') || normalized.includes('listo')) return Math.min(2, stepCount - 1)
  if (normalized.includes('prepar') || normalized.includes('in kitchen') || normalized.includes('cocina') || normalized.includes('enviado') || normalized.includes('placed') || normalized.includes('pending') || normalized.includes('kot')) return Math.min(1, stepCount - 1)
  return 0
}

function orderFlowNextAction(mode: OrderMode, stage: number, hasOrder: boolean, amountDue: number): string {
  if (!hasOrder) return 'Agrega los platos, revisa el pedido y envíalo a cocina.'
  if (stage < 0) return 'Esta orden está cancelada. No continúes con ella.'
  if (stage === 0) return mode === 'delivery' ? 'Confirma la dirección y luego pulsa “Enviar a cocina”.' : 'Revisa el pedido y luego pulsa “Enviar a cocina”.'
  if (stage === 1) return 'Espera el aviso de cocina. Cuando esté listo, entrégalo o prepara el despacho.'
  if (stage === 2) {
    if (mode === 'dine_in') return amountDue > 0.01 ? 'Entrega los platos y cobra el saldo desde “Cobrar”.' : 'Entrega los platos y confirma que la mesa quede servida.'
    if (mode === 'pickup') return amountDue > 0.01 ? 'Cobra al cliente cuando recoja desde “Cobrar retiro”.' : 'Entrega la orden al cliente y confirma la recogida.'
    if (mode === 'room_service') return amountDue > 0.01 ? 'Lleva la orden y cobra o carga la habitación según corresponda.' : 'Lleva la orden a la habitación y confirma la entrega.'
    return amountDue > 0.01 ? 'Asigna o confirma el repartidor y cobra según el acuerdo.' : 'Confirma la entrega al cliente.'
  }
  return 'La orden ya llegó al último paso. Revisa que el cliente la haya recibido.'
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
const traditionalFiscalReceiptTypes = new Set(['B01', 'B02', 'B14', 'B15', 'B16'])
const electronicFiscalReceiptTypes = new Set(['E31', 'E32', 'E34', 'E44', 'E45', 'E46', 'E47'])
const notificationSoundUrls: Record<Exclude<NotificationSettings['sound'], 'none'>, string> = {
  bell: '/sounds/bell.mp3',
  'service-bell': '/sounds/service-bell.mp3',
  'service-bell-strikes': '/sounds/service-bell-strikes.mp3',
}

async function playWaiterAlert(settings: NotificationSettings = defaultNotificationSettings, title = '¡Llamada de mesa!', body = 'Hay una llamada pendiente en sala.') {
  if (settings.sound !== 'none') {
    try {
      const audioUrl = notificationSoundUrls[settings.sound] || '/sounds/service-bell.mp3'
      const audio = new Audio(audioUrl)
      audio.volume = Math.max(0, Math.min(1, Number(settings.volume ?? defaultNotificationSettings.volume)))
      void audio.play().catch(() => { /* el navegador puede exigir interacción previa para reproducir audio */ })
    } catch { /* ignorar error de reproducción web */ }
  }
  if (settings.vibration && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate([300, 150, 300, 150, 500]) } catch { /* ignorar */ }
  }
  if (!Capacitor.isNativePlatform()) return
  try {
    if (settings.vibration) {
      await Haptics.vibrate({ duration: 600 }).catch(() => undefined)
    }
    let permission = await LocalNotifications.checkPermissions()
    if (permission.display !== 'granted') {
      permission = await LocalNotifications.requestPermissions()
    }
    if (permission.display === 'granted') {
      await LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Date.now() % 2147483647),
          title,
          body,
          channelId: 'waiter-calls',
          sound: settings.sound === 'none' ? undefined : 'service_bell.mp3',
          smallIcon: 'ic_stat_mesero',
          iconColor: '#f59e0b',
          schedule: { at: new Date(Date.now() + 50) }
        }]
      })
    }
  } catch {
    // El sonido web y navigator.vibrate siguen siendo el respaldo en Android/web.
  }
}

async function prepareNativeFeatures() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await LocalNotifications.createChannel({
      id: 'waiter-calls',
      name: 'Llamadas de mesa',
      description: 'Avisos y alertas prioritarias cuando los clientes llaman al mesero desde la mesa.',
      importance: 5,
      sound: 'service_bell.mp3',
      vibration: true,
      lights: true,
      visibility: 1
    })
    const permissions = await LocalNotifications.checkPermissions()
    if (permissions.display !== 'granted') {
      await LocalNotifications.requestPermissions()
    }
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
  const [fiscalCapabilities, setFiscalCapabilities] = useState<FiscalCapabilities | null>(null)
  const [activeTable, setActiveTable] = useState<RestaurantTable | null>(null)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [queueCount, setQueueCount] = useState(0)
  const [restaurantName, setRestaurantName] = useState('RestaPP')
  const [restaurantHash, setRestaurantHash] = useState('')
  const [staffRole, setStaffRole] = useState<StaffRole>('mesero')
  const [, setCurrencyVersion] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const deviceId = useMemo(() => getDeviceId(), [])
  const syncInFlight = useRef<Promise<void> | null>(null)
  const workflowRuns = useRef<Map<string, Promise<{ remoteOrderId?: number; firstResponse?: unknown }>>>(new Map())
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
    document.documentElement.dataset.theme = 'dark'
    try { localStorage.setItem('restapp:theme', 'dark') } catch { /* ignore */ }
  }, [])

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
        // Attempt background outbox sync to drain any lingering queued operations
        void syncOutbox()
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
    if (cache.fiscalCapabilities) setFiscalCapabilities(cache.fiscalCapabilities)
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
      const cached = readCache()
      const [remoteTables, remoteItems, remoteCategories, config, remoteOrders, remoteKitchenPlaces, remoteNotifications, remoteReceiptSettings, remotePrinters, remotePaymentMethods, remoteFiscalCapabilities] = await Promise.all([
        session.permissions['tables.view'] ? api.tables('pin').catch(() => []) : Promise.resolve([]),
        canLoadCatalog ? api.menuItems('pin').catch(() => null) : Promise.resolve(null),
        canLoadCatalog ? api.categories('pin').catch(() => null) : Promise.resolve(null),
        api.config('pin').catch(() => null),
        session.permissions['payments.charge'] ? api.orders('pin').catch(() => null) : Promise.resolve(null),
        session.permissions['kitchen.manage'] ? api.kotPlaces('pin').catch(() => null) : Promise.resolve(null),
        api.notifications('pin').catch(() => null),
        api.receiptSettings('pin').catch(() => null),
        api.printers('pin').catch(() => null),
        session.permissions['payments.charge'] ? api.paymentMethods('pin').catch(() => null) : Promise.resolve(null),
        api.fiscalCapabilities('pin').catch(() => null),
      ])
      const categorySource: MenuCategory[] = remoteCategories === null
        ? (cached.menuCategories || [])
        : remoteCategories
      const initialItems = Array.isArray(remoteItems)
        ? applyCategoryMetadata(remoteItems, categorySource)
        : null
      // Pintar el catálogo base inmediatamente. Las categorías no deben esperar
      // a las consultas complementarias de suplementos de cada producto.
      if (initialItems) {
        setItems(initialItems)
        saveCache({ menuItems: initialItems, branchId: session.branchId, scopeKey: session.scopeKey || tenantScope(session) })
      }
      const enrichedItems = initialItems
        ? await Promise.all(initialItems.map(async item => {
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
      if (Array.isArray(remoteCategories)) cachePatch.menuCategories = remoteCategories
      if (enrichedItems) cachePatch.menuItems = enrichedItems
      if (remoteOrders) cachePatch.orders = remoteOrders
      if (remoteKitchenPlaces) { cachePatch.kotPlaces = remoteKitchenPlaces; setKitchenPlaces(remoteKitchenPlaces) }
      if (remoteNotifications) cachePatch.notifications = remoteNotifications
      if (remoteReceiptSettings) cachePatch.receiptSettings = remoteReceiptSettings
      if (remotePrinters) cachePatch.printers = remotePrinters
      if (Array.isArray(remotePaymentMethods)) {
        cachePatch.paymentMethods = remotePaymentMethods
        setPaymentMethods(remotePaymentMethods.length ? remotePaymentMethods : [])
      }
      if (remoteFiscalCapabilities) {
        cachePatch.fiscalCapabilities = remoteFiscalCapabilities
        setFiscalCapabilities(remoteFiscalCapabilities)
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
    setTables(currentTables => {
      const nextTables = currentTables.map(table => table.id === tableId ? updater(table) : table)
      saveCache({ tables: nextTables, branchId: pinSession?.branchId, scopeKey: pinSession?.scopeKey || getStorageScope() })
      return nextTables
    })
    setActiveTable(current => current?.id === tableId ? updater(current) : current)
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
    setQueueCount((await safeOutbox()).length)
    return { remoteOrderId: workflow.remoteOrderId, firstResponse }
  }

  function executeWorkflowOnce(operation: OfflineOperation) {
    const current = workflowRuns.current.get(operation.id)
    if (current) return current

    const run = executeWorkflow(operation).finally(() => {
      workflowRuns.current.delete(operation.id)
    })
    workflowRuns.current.set(operation.id, run)
    return run
  }

  async function queueAndRun(operation: OfflineOperation) {
    await enqueue(operation)
    setQueueCount((await safeOutbox()).length)
    if (navigator.onLine && api.getToken('pin')) {
      try {
        const res = await executeWorkflowOnce(operation)
        setQueueCount((await safeOutbox()).length)
        return res
      } catch (err) {
        setQueueCount((await safeOutbox()).length)
        throw err
      }
    }
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
          try { await executeWorkflowOnce(operation); processed++ }
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
    const itemPayload = lines.map(line => ({
      id: line.itemId,
      menu_item_id: line.itemId,
      quantity: line.quantity,
      price: line.price,
      variation_id: line.variationId,
      variation_name: line.variationName,
      note: [seatLabel(line.seatNumber), line.note].filter(Boolean).join(' · ') || undefined,
      seat_number: typeof line.seatNumber === 'number' ? line.seatNumber : undefined,
      modifiers: line.modifiers.map(m => ({ id: m.id, name: m.name, price: m.price }))
    }))
    const customerPayload = draft.customerName || draft.customerPhone || draft.customerEmail || draft.rncCedula || draft.fiscalName ? {
      name: draft.customerName,
      phone: draft.customerPhone,
      email: draft.customerEmail,
      rnc_cedula: draft.rncCedula,
      fiscal_name: draft.fiscalName,
    } : undefined
    const orderTypeName = draft.mode === 'room_service'
      ? 'Room Service'
      : draft.mode === 'delivery'
      ? 'Delivery'
      : draft.mode === 'pickup'
      ? 'Pickup'
      : 'Dine In'

    const body: Record<string, unknown> = {
      uuid: newIdempotencyKey(),
      order_type: orderTypeName,
      order_type_id: draft.orderTypeId !== undefined ? draft.orderTypeId : undefined,
      delivery_app_id: draft.deliveryPlatformId !== undefined ? draft.deliveryPlatformId : undefined,
      custom_order_type_name: draft.deliveryAppName || (draft.roomNumber ? `Habitación ${draft.roomNumber}` : undefined),
      items: itemPayload,
      customer: customerPayload,
      customer_id: draft.customerId || undefined,
      room_number: draft.mode === 'room_service' ? draft.roomNumber : undefined,
      bill_to: draft.mode === 'room_service' ? 'POST_TO_ROOM' : undefined,
      delivery_address: draft.deliveryAddress || (draft.roomNumber ? `Habitación: ${draft.roomNumber}` : undefined),
      delivery_time: draft.deliveryTime ? new Date(draft.deliveryTime).toISOString() : undefined,
      delivery_fee: draft.deliveryFee !== undefined ? draft.deliveryFee : undefined,
      delivery_executive_id: draft.deliveryExecutiveId !== undefined ? draft.deliveryExecutiveId : undefined,
      customer_lat: draft.customerLat !== undefined ? draft.customerLat : undefined,
      customer_lng: draft.customerLng !== undefined ? draft.customerLng : undefined,
    }
    if ((draft.mode === 'dine_in' || draft.mode === 'room_service') && table) {
      body.table_id = table.id
    }

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
      steps.push(makeStep('POST', `/pos/orders/${draft.existingOrderId}/kot`, { note: 'Artículos adicionales desde RestaPP Mesero' }))
      const operation = makeWorkflow(steps, { remoteOrderId: draft.existingOrderId, label: 'append-order' })
      try {
        await queueAndRun(operation)
        const addedDelta = lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0)
        updateTableLocally(table?.id || 0, current => ({
          ...current,
          status: 'waiting_kitchen',
          currentOrderTotal: Number(current.currentOrderTotal || 0) + addedDelta,
          currentOrderDue: Number(current.currentOrderDue || 0) + addedDelta,
          customerName: draft.customerName?.trim() || current.customerName,
          customerId: draft.customerId || current.customerId
        }))
        const cached = readCache()
        const orderKey = String(draft.existingOrderId)
        const existingDetail = (cached.orderDetails?.[orderKey] || {}) as any
        const currentItems = Array.isArray(existingDetail.items) ? existingDetail.items : []
        const newItems = lines.map((l, idx) => ({
          id: currentItems.length + idx + 1,
          name: l.variationName ? `${l.name} (${l.variationName})` : l.name,
          quantity: l.quantity,
          amount: l.price * l.quantity
        }))
        saveCache({
          orderDetails: {
            ...(cached.orderDetails || {}),
            [orderKey]: { ...existingDetail, items: [...currentItems, ...newItems] }
          }
        })
        setNotice(navigator.onLine ? `Artículos agregados a la orden n.º ${table?.currentOrderNumber || draft.existingOrderId} y enviados a cocina.` : `Artículos guardados para la orden n.º ${table?.currentOrderNumber || draft.existingOrderId}; se enviarán a cocina al restablecerse la conexión.`)
        if (navigator.onLine && pinSessionRef.current) {
          void hydrate(pinSessionRef.current)
        }
      } catch (cause) {
        if (isRetryableOffline(cause)) setNotice(`Artículos guardados para la orden n.º ${table?.currentOrderNumber || draft.existingOrderId}; se reintentará al restablecerse la conexión.`)
        else throw cause
      }
      return
    }

    const localOrderId = table && draft.mode === 'dine_in' ? -Date.now() : undefined
    // The /kot endpoint is the single owner of KOT creation and printing.
    // Keeping actions:['kot'] here would make PUT /orders create one KOT and
    // the following POST /kot process the same order a second time.
    const update: Record<string, unknown> = { waiter_id: pinSession.userId }
    if (draft.mode === 'dine_in' && table) update.table_id = table.id
    const operation = makeWorkflow([
      makeStep('POST', '/pos/orders', body),
      makeStep('PUT', '/pos/orders/{{orderId}}', update),
      makeStep('POST', '/pos/orders/{{orderId}}/kot', { note: 'Enviado desde RestaPP Mesero' }),
    ], { localOrderId, label: 'create-order' })
    try {
      const result = await queueAndRun(operation)
      const delta = lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0)
      if (!navigator.onLine || !result.remoteOrderId) {
        if (table && localOrderId) updateTableLocally(table.id, current => ({ ...current, status: 'waiting_kitchen', currentOrderId: localOrderId, currentOrderNumber: `P-${Math.abs(localOrderId) % 100000}`, currentOrderTotal: delta, currentOrderDue: delta, customerName: draft.customerName || current.customerName, customerId: draft.customerId || current.customerId }))
        setNotice('Orden guardada localmente; la mesa y la comanda se sincronizarán al restablecerse la conexión.')
      } else {
        const data = responseData(result.firstResponse)
        const newOrderId = result.remoteOrderId
        const kotPrintErrors = Array.isArray((data as any)?.print?.errors)
          ? (data as any).print.errors.filter(Boolean).map(String)
          : []
        if (table) {
          updateTableLocally(table.id, current => ({
            ...current,
            status: 'waiting_kitchen',
            currentOrderId: newOrderId,
            currentOrderNumber: String(newOrderId),
            currentOrderTotal: delta,
            currentOrderDue: delta,
            customerName: draft.customerName || current.customerName,
            customerId: draft.customerId || current.customerId
          }))
          const cached = readCache()
          const cachedItems = lines.map((l, idx) => ({
            id: idx + 1,
            name: l.variationName ? `${l.name} (${l.variationName})` : l.name,
            quantity: l.quantity,
            amount: l.price * l.quantity
          }))
          saveCache({
            orderDetails: {
              ...(cached.orderDetails || {}),
              [String(newOrderId)]: { id: newOrderId, items: cachedItems, order_status: 'waiting_kitchen' }
            }
          })
        }
        const printWarning = kotPrintErrors.length
          ? ` La comanda fue creada, pero no se pudo encolar la impresión: ${kotPrintErrors[0]}`
          : ''
        const trackingHint = draft.mode === 'delivery'
          ? ' Puede seguirla como Entrega en Cocina (KDS) y localizarla en Facturas por número, cliente o dirección.'
          : draft.mode === 'pickup'
          ? ' Puede seguirla como Recogida en Cocina (KDS) y localizarla en Facturas por número o cliente.'
          : draft.mode === 'room_service'
          ? ' Puede seguirla como Habitación en Cocina (KDS).'
          : ''
        setNotice(`${draft.mode === 'delivery' ? 'Entrega a domicilio' : draft.mode === 'pickup' ? 'Recogida en el local' : 'Comanda'} n.º ${result.remoteOrderId} enviada a cocina.${trackingHint}${printWarning}${formatFiscalSummary(data)}`)
        if (pinSessionRef.current) {
          void hydrate(pinSessionRef.current)
        }
      }
    } catch (cause) {
      if (!isRetryableOffline(cause)) throw cause
      if (table && localOrderId) updateTableLocally(table.id, current => ({ ...current, status: 'waiting_kitchen', currentOrderId: localOrderId, currentOrderNumber: `P-${Math.abs(localOrderId) % 100000}`, currentOrderTotal: lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0), currentOrderDue: lines.reduce((sum, line) => sum + (line.price + line.modifiers.reduce((m, value) => m + value.price, 0)) * line.quantity, 0), customerName: draft.customerName || current.customerName, customerId: draft.customerId || current.customerId }))
      setQueueCount((await safeOutbox()).length); setNotice('Orden guardada localmente; se enviará a cocina al restablecerse la conexión.')
    }
  }

  async function cancelTableOrder(table: RestaurantTable, reason?: string) {
    if (!pinSession || !table.currentOrderId) return { queued: false, message: 'La mesa no tiene una orden activa.' }
    const orderId = table.currentOrderId
    if (orderId < 0) {
      const operations = await safeOutbox()
      const op = operations.find(o => o.workflow?.localOrderId === orderId)
      if (op) await removeOutbox(op.id)
      updateTableLocally(table.id, current => ({
        ...current,
        status: 'available',
        currentOrderId: undefined,
        currentOrderNumber: undefined,
        currentOrderTotal: undefined,
        currentOrderDue: undefined,
        customerName: undefined,
        customerId: undefined
      }))
      setNotice(`Orden local de la Mesa ${table.number} cancelada.`)
      return { queued: false, message: `Orden local de la Mesa ${table.number} cancelada.` }
    }
    const operation = makeWorkflow([
      makeStep('PUT', `/pos/orders/${orderId}`, { actions: ['cancel'], reason: reason || 'Cancelada por el usuario' }, newIdempotencyKey())
    ], { remoteOrderId: orderId, label: 'cancel-order' })
    try {
      const result = await queueAndRun(operation)
      updateTableLocally(table.id, current => ({
        ...current,
        status: 'available',
        currentOrderId: undefined,
        currentOrderNumber: undefined,
        currentOrderTotal: undefined,
        currentOrderDue: undefined,
        customerName: undefined,
        customerId: undefined
      }))
      const cached = readCache()
      if (cached.orderDetails?.[String(orderId)]) {
        const nextOrderDetails = { ...cached.orderDetails }
        delete nextOrderDetails[String(orderId)]
        saveCache({ orderDetails: nextOrderDetails })
      }
      if (navigator.onLine && result.firstResponse && pinSessionRef.current) {
        await hydrate(pinSessionRef.current)
      }
      const msg = navigator.onLine ? `Orden n.º ${orderId} cancelada y Mesa ${table.number} liberada.` : `Cancelación de orden guardada localmente.`
      setNotice(msg)
      return { queued: !navigator.onLine || !result.firstResponse, message: msg }
    } catch (cause) {
      if (!isRetryableOffline(cause)) throw cause
      updateTableLocally(table.id, current => ({
        ...current,
        status: 'available',
        currentOrderId: undefined,
        currentOrderNumber: undefined,
        currentOrderTotal: undefined,
        currentOrderDue: undefined,
        customerName: undefined,
        customerId: undefined
      }))
      setQueueCount((await safeOutbox()).length)
      return { queued: true, message: 'Cancelación guardada; se sincronizará al restablecerse la conexión.' }
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
    if (!navigator.onLine) {
      const cachedCashSession = readCache().cashSession as any
      if (!cachedCashSession || cachedCashSession.status !== 'open') {
        throw new Error('Debe abrir un turno de caja antes de cobrar. Sin conexión, solo se permite cobrar con un turno abierto previamente en este dispositivo.')
      }
    } else {
      const activeCashSession = await api.activeCashSession('pin').catch(() => null)
      if (!activeCashSession || activeCashSession.status !== 'open') {
        throw new Error('Debe abrir un turno de caja antes de cobrar.')
      }
    }
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
  if (screen === 'pin') return <PinScreen brand={restaurantName} branch={activeBranch?.name || ''} role={staffRole} onRoleChange={setStaffRole} offline={offline} loading={loading} error={error} notice={notice} onSubmit={handlePin} canChangeBranch={Boolean(adminSession)} onBack={() => setScreen('branches')} />
  return <FloorScreen brand={restaurantName} branch={activeBranch?.name || ''} branchId={activeBranch?.id || pinSession?.branchId} restaurantId={pinSession?.restaurantId || adminSession?.restaurantId} roleKey={pinSession?.roleKey || staffRole} userName={pinSession?.userName} userId={pinSession?.userId} deviceId={deviceId} permissions={pinSession?.permissions || {}} tables={tables} items={items} kitchenPlaces={kitchenPlaces} paymentMethods={paymentMethods} fiscalCapabilities={fiscalCapabilities} offline={offline} queueCount={queueCount} isSyncing={isSyncing} notice={notice} onNotice={setNotice} error={error} onLogout={logout} onRefresh={() => pinSession && hydrate(pinSession)} onSubmitOrder={submitOrder} onSaveCustomer={saveTableCustomer} onRemoveOrderItem={removeOrderItem} onPrintPreBill={printPreBill} onPayOrder={payOrder} onTransferTable={transferTableOrder} onCancelOrder={cancelTableOrder} onOpenCashSession={openCashSession} onCloseCashSession={closeCashSession} onApproveCashSession={approveCashSession} onRejectCashSession={rejectCashSession} onReopenCashSession={reopenCashSession} onCashMovement={cashMovement} onClockIn={clockInAttendance} onClockOut={clockOutAttendance} onUpdateKotStatus={updateKotStatus} onSelectTable={setActiveTable} activeTable={activeTable} />
}

function nextAdminRestaurantId(session: Session) { return session.restaurantId }

function SetupScreen({
  loading,
  error,
  defaultDeviceId,
  onSubmit,
  onDirectPin,
}: {
  loading: boolean
  error: string
  defaultDeviceId: string
  onSubmit: (email: string, password: string) => void
  onDirectPin: (pin: string, hash: string, deviceId: string, role: StaffRole) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [hash, setHash] = useState('')
  const [linkedDeviceId, setLinkedDeviceId] = useState(defaultDeviceId)
  const [pin, setPin] = useState('')
  const [role, setRole] = useState<StaffRole>('mesero')

  return (
    <main className="login-shell theme-dark">
      <section className="hero-panel" aria-label="RestaPP Hospitality">
        <div className="hero-overlay" />

        <header className="brand-lockup">
          {/* Logo oficial de RestaPP Mesero; el asset se comparte con la publicación web y Windows. */}
          <img src="/assets/restapp-logo-20260908.png" alt="RestaPP" className="brand-logo" />
          <div>
            <div className="brand-name">Resta<span>PP</span></div>
            <div className="brand-subtitle">RESTAURANTES · HOTELES · BARES</div>
          </div>
        </header>

        <div className="hero-copy">
          <p className="eyebrow">HOSPITALIDAD QUE CONECTA</p>
          <h1>
            Buena<br />comida,<br />mejores <em>historias</em>
          </h1>
          <div className="gold-rule" />
          <p className="hero-subclaim">LA HOSPITALIDAD<br />TAMBIÉN<br />SE SIRVE</p>
        </div>

        <div className="hospitality-list" aria-label="Sectores">
          <div><UtensilsCrossed size={22} strokeWidth={1.5} /><span>Restaurantes</span></div>
          <div><BedDouble size={22} strokeWidth={1.5} /><span>Hoteles</span></div>
          <div><Martini size={22} strokeWidth={1.5} /><span>Bares</span></div>
          <div><Coffee size={22} strokeWidth={1.5} /><span>Cafeterías</span></div>
        </div>
      </section>

      <section className="access-side">
        <article className="login-card setup-card">
          <div className="card-toolbar">
            <button className="language-button" type="button" aria-label="Idioma">
              <Globe2 size={17} />
              <span>ES</span>
              <ChevronDown size={14} />
            </button>
          </div>

          <div className="card-brand">
            <img src="/assets/restapp-logo-20260908.png" alt="RestaPP" />
            <div className="card-brand-name">Resta<span>PP</span></div>
            <div className="card-brand-subtitle">AUTORIZACIÓN DE TERMINAL</div>
          </div>

          <div className="welcome-copy">
            <h2>Configurar terminal</h2>
            <p>El administrador autoriza este punto de venta una sola vez.</p>
          </div>

          <form
            className="setup-form"
            onSubmit={e => {
              e.preventDefault()
              onSubmit(email, password)
            }}
          >
            <label className="setup-field">
              <span>Correo del administrador</span>
              <input
                required
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="dueno@restaurante.com"
                autoComplete="username"
              />
            </label>
            <label className="setup-field">
              <span>Contraseña</span>
              <input
                required
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button className="primary-action" type="submit" disabled={loading}>
              {loading ? 'Conectando…' : 'Iniciar sesión'}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <div className="setup-gold-divider">
            <span>o</span>
          </div>

          <details className="setup-direct-accordion">
            <summary>
              <span>Ya tengo una terminal autorizada</span>
              <ChevronDown size={16} className="accordion-chevron" />
            </summary>
            <p className="setup-direct-hint">
              Indique el código del restaurante, el nombre de la terminal, su código personal y su rol en sala o cocina.
            </p>
            <form
              className="setup-form setup-direct-form"
              onSubmit={e => {
                e.preventDefault()
                onDirectPin(pin, hash, linkedDeviceId, role)
              }}
            >
              <label className="setup-field">
                <span>Perfil</span>
                <div className="setup-select-wrap">
                  <select value={role} onChange={e => setRole(e.target.value as StaffRole)}>
                    <option value="mesero">Mesero</option>
                    <option value="chef">Cocina</option>
                    <option value="cajero">Cajero</option>
                    <option value="head">Supervisor</option>
                    <option value="repartidor">Repartidor</option>
                  </select>
                  <ChevronDown className="select-arrow" size={16} />
                </div>
              </label>

              <label className="setup-field">
                <span>Código del restaurante</span>
                <input
                  required
                  value={hash}
                  onChange={e => setHash(e.target.value)}
                  placeholder="ej. kebab"
                  autoComplete="off"
                />
              </label>

              <label className="setup-field">
                <span>Identificador de terminal</span>
                <input
                  required
                  value={linkedDeviceId}
                  onChange={e => setLinkedDeviceId(e.target.value)}
                  autoComplete="off"
                />
              </label>

              <label className="setup-field">
                <span>Código personal (PIN)</span>
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  autoComplete="one-time-code"
                />
                <small>El código personal nunca se guarda de forma insegura.</small>
              </label>

              <button
                className="button outline full setup-direct-submit"
                disabled={loading || pin.length !== 4}
              >
                {loading ? 'Validando…' : `Ingresar como ${roleLabel(role)}`}
              </button>
            </form>
          </details>

          {error && (
            <div className="status-message has-error" aria-live="polite">
              {error}
            </div>
          )}

          <div className="trust-row">
            <span>Seguridad</span><i>•</i>
            <span>Control</span><i>•</i>
            <span>Mejor Servicio</span>
          </div>
        </article>

        <aside className="side-strip">
          <div className="side-message side-message-top">
            <ShieldCheck size={28} strokeWidth={1.5} />
            <span>PERSONAS<br />QUE CREAN<br />EXPERIENCIAS<br />INOLVIDABLES</span>
          </div>

          <div className="side-rule" />

          <div className="side-message side-message-bottom">
            <ChefHat size={28} strokeWidth={1.5} />
            <span>LA<br />GASTRONOMÍA<br />NOS UNE</span>
          </div>

          <div className="side-version">
            <strong>RestaPP</strong>
            <span>V 1.0.0</span>
          </div>
        </aside>
      </section>
    </main>
  )
}

function BranchScreen({ branches, loading, error, offline, onSelect, onBack }: { branches: Branch[]; loading: boolean; error: string; offline: boolean; onSelect: (branch: Branch) => void; onBack: () => void }) {
  return <main className="page padded"><header className="simple-header"><button className="icon-button" onClick={onBack}><ChevronLeft /></button><div><p className="eyebrow">AUTORIZACIÓN DEL DISPOSITIVO</p><h1>Seleccione la sucursal</h1></div>{offline && <CloudOff className="warning-icon" />}</header><div className="branch-grid">{branches.length ? branches.map(branch => <button className="branch-card" key={branch.id} onClick={() => onSelect(branch)} disabled={loading}><LucideMap size={24} /><span>{branch.name}</span><small>Identificador {branch.id}</small></button>) : <div className="empty"><p>No hay sucursales disponibles.</p><button className="button outline" onClick={onBack}>Volver a configurar</button></div>}</div>{error && <Alert>{error}</Alert>}</main>
}

function PinScreen({ brand, branch, role, onRoleChange, offline, loading, error, notice, onSubmit, canChangeBranch, onBack }: { brand: string; branch: string; role: StaffRole; onRoleChange: (role: StaffRole) => void; offline: boolean; loading: boolean; error: string; notice: string; onSubmit: (pin: string) => void; canChangeBranch: boolean; onBack: () => void }) {
  const [pin, setPin] = useState('')

  const dots = useMemo(() => Array.from({ length: 4 }, (_, i) => i < pin.length), [pin])

  const addDigit = (digit: string) => {
    if (loading) return
    if (pin.length < 4) {
      const next = pin + digit
      setPin(next)
      if (next.length === 4) {
        window.setTimeout(() => onSubmit(next), 120)
      }
    }
  }

  const removeDigit = () => {
    if (loading) return
    setPin(current => current.slice(0, -1))
  }

  const clearPin = () => setPin('')

  const signIn = () => {
    if (loading) return
    if (pin.length === 4) {
      onSubmit(pin)
    }
  }

  const profiles = ['Cajero', 'Mesero', 'Cocina', 'Supervisor', 'Repartidor']

  const roleDisplayMap: Record<StaffRole, string> = {
    cajero: 'Cajero',
    mesero: 'Mesero',
    chef: 'Cocina',
    head: 'Supervisor',
    repartidor: 'Repartidor',
  }
  const roleValueMap: Record<string, StaffRole> = {
    'Cajero': 'cajero',
    'Mesero': 'mesero',
    'Cocina': 'chef',
    'Supervisor': 'head',
    'Repartidor': 'repartidor',
  }

  const statusText = loading
    ? 'Validando código personal…'
    : error
      ? 'Código incorrecto. Intente de nuevo.'
      : notice || (offline ? 'Sin conexión · sesión local' : 'Sesión cerrada. Introduce el código del siguiente empleado.')

  return (
    <main className="login-shell theme-dark">
      <section className="hero-panel" aria-label="RestaPP Hospitality">
        <div className="hero-overlay" />

        <header className="brand-lockup">
          <img src="/assets/restapp-logo-20260908.png" alt={brand || 'RestaPP'} className="brand-logo" />
          <div>
            {brand && brand.trim().toLowerCase() !== 'restapp' ? (
              <>
                <div className="brand-name">{brand}</div>
                <div className="brand-subtitle">{branch ? `${branch.toUpperCase()} · ` : ''}PLATAFORMA RESTAPP</div>
              </>
            ) : (
              <>
                <div className="brand-name">Resta<span>PP</span></div>
                <div className="brand-subtitle">RESTAURANTES · HOTELES · BARES</div>
              </>
            )}
          </div>
        </header>

        <div className="hero-copy">
          <p className="eyebrow">HOSPITALIDAD QUE CONECTA</p>
          <h1>
            Buena<br />comida,<br />mejores <em>historias</em>
          </h1>
          <div className="gold-rule" />
          <p className="hero-subclaim">LA HOSPITALIDAD<br />TAMBIÉN<br />SE SIRVE</p>
        </div>

        <div className="hospitality-list" aria-label="Sectores">
          <div><UtensilsCrossed size={22} strokeWidth={1.5} /><span>Restaurantes</span></div>
          <div><BedDouble size={22} strokeWidth={1.5} /><span>Hoteles</span></div>
          <div><Martini size={22} strokeWidth={1.5} /><span>Bares</span></div>
          <div><Coffee size={22} strokeWidth={1.5} /><span>Cafeterías</span></div>
        </div>
      </section>

      <section className="access-side">
        <article className="login-card">
          <div className="card-toolbar">
            {canChangeBranch && (
              <button className="branch-button" type="button" onClick={onBack} title="Cambiar de sucursal">
                <ChevronLeft size={16} />
                <span>Sucursal</span>
              </button>
            )}
            <button className="language-button" type="button" aria-label="Idioma">
              <Globe2 size={17} />
              <span>ES</span>
              <ChevronDown size={14} />
            </button>
          </div>

          <div className="card-brand">
            <img src="/assets/restapp-logo-20260908.png" alt={brand || 'RestaPP'} />
            {brand && brand.trim().toLowerCase() !== 'restapp' ? (
              <>
                <div className="card-brand-name brand-linked">{brand.toUpperCase()}</div>
                {branch && (
                  <div className="card-branch-tag">
                    <span>{branch.toUpperCase()}</span>
                  </div>
                )}
                <div className="card-brand-subtitle">TERMINAL PUNTO DE VENTA · RESTAPP</div>
              </>
            ) : (
              <>
                <div className="card-brand-name">Resta<span>PP</span></div>
                <div className="card-brand-subtitle">{branch ? `RESTAPP · ${branch.toUpperCase()}` : 'SISTEMA PARA HOSPITALIDAD'}</div>
              </>
            )}
          </div>

          <div className="welcome-copy">
            <h2>Bienvenido</h2>
            <p>Selecciona tu perfil e ingresa tu código</p>
          </div>

          <label className="profile-select">
            <UserRound size={22} />
            <span className="profile-text">
              <small>Seleccionar perfil</small>
              <strong>{roleDisplayMap[role] || 'Cajero'}</strong>
            </span>
            <select
              value={roleDisplayMap[role] || 'Cajero'}
              disabled={offline || loading}
              onChange={(event) => {
                clearPin()
                const selectedRole = roleValueMap[event.target.value] || 'mesero'
                onRoleChange(selectedRole)
              }}
              aria-label="Seleccionar perfil"
            >
              {profiles.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <ChevronDown className="select-arrow" size={18} />
          </label>

          <div className={`pin-dots ${error ? 'has-error' : ''}`} aria-label={`${pin.length} dígitos ingresados`}>
            {dots.map((filled, index) => (
              <span key={index} className={filled ? 'filled' : ''} />
            ))}
          </div>

          <div className="keypad" aria-label="Teclado numérico">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <button key={digit} type="button" disabled={loading} onClick={() => addDigit(String(digit))}>
                {digit}
              </button>
            ))}
            <span className="keypad-spacer" />
            <button type="button" disabled={loading} onClick={() => addDigit('0')}>
              0
            </button>
            <button type="button" disabled={loading} onClick={removeDigit} aria-label="Borrar">
              <Delete size={22} />
            </button>
          </div>

          <button className="primary-action" type="button" disabled={loading || pin.length !== 4} onClick={signIn}>
            {loading ? 'Validando…' : 'Iniciar sesión'}
            <span aria-hidden="true">→</span>
          </button>

          <div className={`status-message ${error ? 'has-error' : notice || (pin.length === 4 && !error) ? 'success' : ''}`} aria-live="polite">
            {statusText}
          </div>

          <div className="trust-row">
            <span>Seguridad</span><i>•</i>
            <span>Control</span><i>•</i>
            <span>Mejor Servicio</span>
          </div>
        </article>

        <aside className="side-strip">
          <div className="side-message side-message-top">
            <ShieldCheck size={28} strokeWidth={1.5} />
            <span>PERSONAS<br />QUE CREAN<br />EXPERIENCIAS<br />INOLVIDABLES</span>
          </div>

          <div className="side-rule" />

          <div className="side-message side-message-bottom">
            <ChefHat size={28} strokeWidth={1.5} />
            <span>LA<br />GASTRONOMÍA<br />NOS UNE</span>
          </div>

          <div className="side-version">
            <strong>RestaPP</strong>
            <span>V 1.0.0</span>
          </div>
        </aside>
      </section>
    </main>
  )
}

function FloorScreen({ brand, branch, branchId, restaurantId, roleKey, userName, userId, deviceId, permissions, tables, items, kitchenPlaces, paymentMethods, fiscalCapabilities, offline, queueCount, isSyncing, notice, onNotice, error, onLogout, onRefresh, onSubmitOrder, onSaveCustomer, onRemoveOrderItem, onPrintPreBill, onPayOrder, onTransferTable, onCancelOrder, onOpenCashSession, onCloseCashSession, onApproveCashSession, onRejectCashSession, onReopenCashSession, onCashMovement, onClockIn, onClockOut, onUpdateKotStatus, onSelectTable, activeTable }: { brand: string; branch: string; branchId?: number; restaurantId?: number; roleKey: StaffRole; userName?: string; userId?: number; deviceId: string; permissions: Record<string, boolean>; tables: RestaurantTable[]; items: MenuItem[]; kitchenPlaces: KitchenPlace[]; paymentMethods: PaymentMethodOption[]; fiscalCapabilities?: FiscalCapabilities | null; offline: boolean; queueCount: number; isSyncing?: boolean; notice: string; onNotice: (message: string) => void; error: string; onLogout: () => void; onRefresh: () => void; onSubmitOrder: (lines: OrderLine[], table: RestaurantTable | null, draft: OrderDraft) => Promise<void>; onSaveCustomer: (table: RestaurantTable, name: string, customerId?: number, rncCedula?: string, fiscalName?: string) => Promise<void>; onRemoveOrderItem: (orderId: number, orderItemId: number, itemName: string) => Promise<{ queued: boolean; message: string }>; onPrintPreBill: (orderId: number, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>; onPayOrder: (orderId: number, amount: number, method: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>; onTransferTable?: (fromTable: RestaurantTable, targetTable: RestaurantTable) => Promise<{ queued: boolean; message: string }>; onCancelOrder?: (table: RestaurantTable, reason?: string) => Promise<{ queued: boolean; message: string }>; onOpenCashSession: (registerId: number, openingFloat: number, note: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onCloseCashSession: (sessionId: number, countedCash: number, expectedCash: number | undefined, note: string, sendForApproval: boolean, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onApproveCashSession: (sessionId: number, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onRejectCashSession: (sessionId: number, note: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onReopenCashSession: (sessionId: number, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onCashMovement: (movement: 'cash-in' | 'cash-out' | 'safe-drop', sessionId: number, amount: number, note: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string; data?: any }>; onClockIn: (idempotencyKey: string) => Promise<{ queued: boolean; message: string; attendance: AttendanceRecord }>; onClockOut: (idempotencyKey: string) => Promise<{ queued: boolean; message: string; attendance: AttendanceRecord }>; onUpdateKotStatus: (kotId: number, status: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>; onSelectTable: (table: RestaurantTable | null) => void; activeTable: RestaurantTable | null }) {
  const [showMenu, setShowMenu] = useState(false); const [showQuick, setShowQuick] = useState(false); const [showOps, setShowOps] = useState(false); const [showCashier, setShowCashier] = useState(false); const [showAttendance, setShowAttendance] = useState(false); const [opsLoading, setOpsLoading] = useState(false); const [notifications, setNotifications] = useState<LiveNotification[]>([]); const [deliverySettings, setDeliverySettings] = useState<DeliverySettings | null>(null); const [deliveryExecutives, setDeliveryExecutives] = useState<DeliveryExecutive[]>([]); const [deliveryPlatforms, setDeliveryPlatforms] = useState<DeliveryPlatform[]>([]); const [orderTypes, setOrderTypes] = useState<OrderTypeConfig[]>([])
  const [pickupPaymentTarget, setPickupPaymentTarget] = useState<{ summary: any; detail: any } | null>(null)
  const [pickupPaymentLoading, setPickupPaymentLoading] = useState(false)

  const canCreate = permissions['orders.create'] === true
  const canDelivery = roleKey === 'cajero' && canCreate
  const canQuickSale = canDelivery
  const canCharge = permissions['payments.charge'] === true && paymentMethods.length > 0
  const canCashier = ['cash.view', 'cash.open', 'cash.close', 'cash.movement', 'cash.approve', 'payments.charge'].some(permission => permissions[permission] === true)
  const canKitchen = permissions['kitchen.manage'] === true

  async function openPickupPayment(order: any) {
    const orderId = Number(order?.id)
    if (!orderId || !canCharge) return
    setPickupPaymentLoading(true)
    try {
      // Reuse the authoritative detail endpoint before opening the payment
      // panel. Offline mode may use the branch-scoped cached order, but the
      // existing pay workflow still enforces the local cash-session policy.
      const detail = offline ? order : await api.getOrder('pin', orderId)
      setPickupPaymentTarget({ summary: order, detail: responseData(detail) })
    } catch {
      onNotice('No se pudo cargar el detalle del retiro. Actualice las órdenes e intente nuevamente.')
    } finally {
      setPickupPaymentLoading(false)
    }
  }

  async function markPickupCollected(orderId: number, status: 'delivered') {
    if (offline) {
      onNotice('La entrega del retiro requiere conexión para confirmarse en RestaPP.')
      return
    }
    try {
      await api.updateOrderStatus('pin', orderId, status, newIdempotencyKey())
      await loadPosDanData()
      onNotice(`Pedido n.º ${orderId} marcado como recogido.`)
    } catch (cause) {
      onNotice(normalizeError(cause, 'No se pudo confirmar la recogida. Actualice e intente nuevamente.'))
    }
  }

  const pickupPaymentTable = pickupPaymentTarget ? (() => {
    const source = pickupPaymentTarget.detail || pickupPaymentTarget.summary || {}
    const customer = source.customer || pickupPaymentTarget.summary.customer || {}
    const orderId = Number(pickupPaymentTarget.summary.id || source.id)
    const total = Number(source.grand_total ?? source.total ?? source.order_total ?? source.cart?.summary?.grand_total ?? pickupPaymentTarget.summary.grand_total ?? pickupPaymentTarget.summary.total ?? 0)
    const paid = Number(source.amount_paid ?? source.paid_amount ?? pickupPaymentTarget.summary.amount_paid ?? pickupPaymentTarget.summary.paid_amount ?? 0)
    const due = Number(source.amount_due ?? source.payment_summary?.amount_due ?? pickupPaymentTarget.summary.amount_due ?? Math.max(0, total - paid))
    return {
      id: 0,
      name: 'Para llevar / Recoger',
      number: 'Retiro',
      capacity: 0,
      status: 'occupied' as const,
      currentOrderId: orderId,
      currentOrderNumber: String(pickupPaymentTarget.summary.order_number || pickupPaymentTarget.summary.formatted_order_number || source.order_number || orderId),
      currentOrderTotal: total,
      currentOrderDue: due,
      customerId: Number(customer.id || source.customer_id || pickupPaymentTarget.summary.customer_id || 0) || undefined,
      customerName: customer.name || source.customer_name || pickupPaymentTarget.summary.customer_name,
      customerPhone: customer.phone || source.customer_phone || pickupPaymentTarget.summary.customer_phone,
      customerRnc: customer.rnc_cedula || source.rnc_cedula || pickupPaymentTarget.summary.rnc_cedula,
      customerFiscalName: customer.fiscal_name || source.fiscal_name || pickupPaymentTarget.summary.fiscal_name,
    } satisfies RestaurantTable
  })() : null
  const table = activeTable
  const [tableFilter, setTableFilter] = useState<'all' | 'available' | 'occupied' | 'prebill'>('all')
  const [waiterRequests, setWaiterRequests] = useState<WaiterRequest[]>(() => readCache().waiterRequests || [])
  const [attendingRequestId, setAttendingRequestId] = useState<number | null>(null)
  const waiterSeenIds = useRef<Set<number> | null>(null)
  const seenNotificationIds = useRef<Set<string> | null>(null)
  const unreadNotifications = notifications.filter(notification => notification.unread).length

  async function handleDismissWaiterRequest(request: WaiterRequest, e?: React.MouseEvent) {
    if (e) e.stopPropagation()
    if (attendingRequestId !== null) return
    setAttendingRequestId(request.id)
    try {
      const idempotencyKey = newIdempotencyKey()
      if (offline) {
        await enqueue({ id: crypto.randomUUID(), scope: getStorageScope(), method: 'PUT', path: `/pos/waiter-requests/${request.id}/status`, body: { status: 'completed' }, idempotencyKey, createdAt: new Date().toISOString() })
      } else {
        await api.updateWaiterRequestStatus('pin', request.id, 'completed', idempotencyKey)
      }
      const next = waiterRequests.filter(r => r.id !== request.id)
      setWaiterRequests(next)
      saveCache({ waiterRequests: next })
    } catch {
      // Si falla, abrimos el panel de operaciones
      setShowOps(true)
    } finally {
      setAttendingRequestId(null)
    }
  }

  // Mapa rápido de mesas que están llamando para destacar su tarjeta visual
  const callingTableMap = useMemo(() => {
    const map = new Map<number | string, WaiterRequest>()
    for (const req of waiterRequests) {
      if (req.tableId) map.set(req.tableId, req)
      if (req.tableName) {
        map.set(req.tableName, req)
        const clean = req.tableName.toLowerCase().replace(/^(mesa|table)\s*/i, '').trim()
        if (clean) map.set(clean, req)
      }
    }
    return map
  }, [waiterRequests])

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
        const rows = cached.waiterRequests || []
        waiterSeenIds.current = new Set(rows.map(request => request.id))
        setWaiterRequests(rows)
        return
      }
      try {
        const rows = await api.waiterRequests('pin', 'pending')
        if (cancelled) return
        const nextIds = new Set(rows.map(request => request.id))
        const previousIds = waiterSeenIds.current
        if (previousIds && rows.some(request => !previousIds.has(request.id))) {
          playWaiterAlert(readCache().notificationSettings || defaultNotificationSettings, '¡Llamada de Mesa!', `${rows.length === 1 ? rows[0].tableName : `${rows.length} mesas`} solicitan atención.`)
        }
        waiterSeenIds.current = nextIds
        setWaiterRequests(rows)
        saveCache({ waiterRequests: rows })
      } catch { /* un perfil sin este permiso simplemente no recibe llamadas */ }
    }
    void loadWaiterAlerts()
    if (offline) return () => { cancelled = true }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadWaiterAlerts()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    const timer = window.setInterval(() => void loadWaiterAlerts(), 2_500)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(timer)
    }
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
  // Enterprise POS Layout State
  const [activeNavTab, setActiveNavTab] = useState<PosDanModule>('tables')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [posCustomers, setPosCustomers] = useState<PosCustomer[]>([])
  const [selectedPosCustomer, setSelectedPosCustomer] = useState<PosCustomer | null>(null)
  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [cashRegisters, setCashRegisters] = useState<any[]>([])
  const [activeCashSession, setActiveCashSession] = useState<any | null>(null)
  const [activeCashSummary, setActiveCashSummary] = useState<any | null>(null)
  const [cashSessionReady, setCashSessionReady] = useState(false)
  const [cashLoading, setCashLoading] = useState(false)
  const [allOrders, setAllOrders] = useState<any[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [posCustomizingItem, setPosCustomizingItem] = useState<MenuItem | null>(null)
  const [localItemAvailability, setLocalItemAvailability] = useState<Record<number, boolean>>({})
  const [selectedCategory, setSelectedCategory] = useState('Todos')
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [clockTime, setClockTime] = useState(() => new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))

  useEffect(() => {
    const timer = setInterval(() => {
      setClockTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const menuCategories = useMemo(() => {
    const list = menuCategoryNames(items)
    return ['Todos', ...list]
  }, [items])

  const effectiveMenuItems = useMemo(() => {
    return items.map(item => {
      if (localItemAvailability[item.id] !== undefined) {
        return { ...item, available: localItemAvailability[item.id] }
      }
      return item
    })
  }, [items, localItemAvailability])

  const filteredMenuItems = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    return items.filter(item => {
      const matchCat = selectedCategory === 'Todos' || item.categoryName === selectedCategory
      const matchSearch = !q || item.name.toLowerCase().includes(q) || (item.code && item.code.toLowerCase().includes(q))
      return matchCat && matchSearch
    })
  }, [items, selectedCategory, productSearch])

  const totalFreeTables = useMemo(() => tables.filter(t => t.status === 'available').length, [tables])
  const totalOccupiedTables = useMemo(() => tables.filter(t => t.status === 'occupied' || t.status === 'waiting_kitchen' || t.status === 'food_ready').length, [tables])
  const totalBillTables = useMemo(() => tables.filter(t => t.status === 'bill_requested').length, [tables])

  // Load POS data on mount / refresh
  const loadPosDanData = async () => {
    try {
      if (!offline) {
        const [custs, regs, actSess, ords, oTypes, delPlats, delExecs, delSets] = await Promise.all([
          api.customers('pin').catch(() => []),
          api.cashRegisters('pin').catch(() => []),
          api.activeCashSession('pin').catch(() => null),
          api.orders('pin').catch(() => []),
          api.orderTypes('pin').catch(() => []),
          api.deliveryPlatforms('pin').catch(() => []),
          api.deliveryExecutives('pin').catch(() => []),
          api.deliverySettings('pin').catch(() => null)
        ])
        setPosCustomers(custs)
        setCashRegisters(regs)
        setActiveCashSession(actSess)
        setAllOrders(ords)
        if (oTypes && oTypes.length > 0) setOrderTypes(oTypes)
        if (delPlats) setDeliveryPlatforms(delPlats)
        if (delExecs) setDeliveryExecutives(delExecs)
        if (delSets) setDeliverySettings(delSets)
        let cashSummary = null
        if (actSess && actSess.id) {
          try {
            cashSummary = await api.cashSessionSummary('pin', actSess.id)
            setActiveCashSummary(cashSummary)
          } catch {
            setActiveCashSummary(null)
          }
        } else {
          setActiveCashSummary(null)
        }
        saveCache({ cashRegisters: regs, cashSession: actSess, cashSummary, orders: ords })
      } else {
        const cached = readCache()
        setAllOrders(cached.orders || [])
        setCashRegisters(cached.cashRegisters || [])
        setActiveCashSession(cached.cashSession || null)
        setActiveCashSummary(cached.cashSummary || null)
      }
    } catch {
      // ignore
    } finally {
      setCashSessionReady(true)
    }
  }


  useEffect(() => {
    loadPosDanData()
  }, [offline])

  // Cash summaries must reflect payments made by another terminal without
  // forcing the cashier to press F5. Poll only the small cash endpoints while
  // this module is visible; the broader POS hydration remains user-triggered.
  useEffect(() => {
    if (activeNavTab !== 'cash' || offline) return

    let cancelled = false
    let requestInFlight = false

    const refreshCashSummary = async () => {
      if (cancelled || requestInFlight || document.visibilityState === 'hidden') return
      requestInFlight = true
      try {
        const session = await api.activeCashSession('pin')
        if (cancelled) return
        setActiveCashSession(session)

        if (session?.id) {
          const summary = await api.cashSessionSummary('pin', session.id)
          if (!cancelled) setActiveCashSummary(summary)
        } else if (!cancelled) {
          setActiveCashSummary(null)
        }
      } catch {
        // Keep the last good values during a transient network/API failure.
      } finally {
        requestInFlight = false
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshCashSummary()
    }

    void refreshCashSummary()
    const timer = window.setInterval(() => void refreshCashSummary(), 3_000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [activeNavTab, offline])

  const cashSessionOpen = activeCashSession?.status === 'open'
  const cashierNeedsCashSession = roleKey === 'cajero' && cashSessionReady && !cashSessionOpen

  useEffect(() => {
    if (!cashierNeedsCashSession || activeNavTab === 'cash') return
    // A cajero cannot operate another POS module until the shift is open.
    setActiveNavTab('cash')
  }, [activeNavTab, cashierNeedsCashSession])

  // Real-time WebSocket connection & live listeners
  const [realtimeState, setRealtimeState] = useState<'connected' | 'connecting' | 'disconnected' | 'unavailable' | 'failed'>('disconnected')

  useEffect(() => {
    if (offline) {
      realtimeService.disconnect()
      setRealtimeState('disconnected')
      return
    }

    realtimeService.init(branchId, restaurantId, {
      onConnectionChange: (state) => {
        setRealtimeState(state)
      },
      onOrderCreated: (data) => {
        onRefresh()
        void loadPosDanData()
      },
      onOrderUpdated: (data) => {
        onRefresh()
        void loadPosDanData()
      },
      onKotUpdated: (data) => {
        window.dispatchEvent(new CustomEvent('restapp:kot-updated', { detail: data }))
        // If waiter or supervisor, notify
        if (data?.kot_status === 'food_ready') {
          void playWaiterAlert(readCache().notificationSettings || defaultNotificationSettings, '¡Plato Listo!', `Mesa ${data.table_code || ''} orden ${data.order_number || ''}`)
        }
      },
      onWaiterRequest: (data) => {
        // Instant reload of waiter requests
        if (!offline) {
          api.waiterRequests('pin', 'pending').then((rows) => {
            setWaiterRequests(rows)
            saveCache({ waiterRequests: rows })
            playWaiterAlert(readCache().notificationSettings || defaultNotificationSettings, '¡Llamada de Mesa!', `${rows.length === 1 ? rows[0].tableName : `${rows.length} mesas`} solicitan atención.`)
          }).catch(() => {})
        }
      },
      onTodayOrdersUpdated: () => {
        void loadPosDanData()
      },
      onPrintJobCreated: async (data) => {
        // If device has local printer config and autoPrintOnPayment is active, route print job
        try {
          const config = getStationPrinterConfig()
          if (config.mode === 'windows_local' && data?.payload) {
            routePrintReceipt(data.payload)
          }
        } catch {}
      }
    })

    return () => {
      // Keep connection alive across tab switches, clean up on unmount
    }
  }, [offline, branchId, restaurantId, onRefresh])


  return (
    <div className="pos-app-shell">
      {/* 1. System Status Bar (Enterprise POS Top Bar) */}
      <div className="system-status-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className={offline ? 'sync-offline' : 'sync-ok'}>
            <CloudLightning size={13} /> {offline ? 'Modo Offline' : isSyncing ? 'Sincronizando…' : 'Sync OK'}
          </span>
          {!offline && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 8px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 700,
                background: realtimeState === 'connected' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: realtimeState === 'connected' ? '#34d399' : '#fbbf24',
                border: realtimeState === 'connected' ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(245, 158, 11, 0.35)',
              }}
              title={realtimeState === 'connected' ? 'WebSockets activo y conectado' : 'Conectando a WebSockets...'}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: realtimeState === 'connected' ? '#34d399' : '#fbbf24',
                }}
              />
              {realtimeState === 'connected' ? 'En vivo' : 'WS...'}
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#A1A5AB' }}>
            <ChefHat size={13} /> {brand} · {branch}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {queueCount > 0 && (
            <span style={{ color: '#FFD54F', fontSize: '0.7rem', fontWeight: 700 }}>
              {queueCount} cola offline
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {offline ? <CloudOff size={13} style={{ color: '#FF8A65' }} /> : <Wifi size={13} style={{ color: '#5EDBAC' }} />}
            <span className="hidden sm:inline">{offline ? 'Sin red' : 'Terminal 01'}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <BatteryCharging size={13} style={{ color: '#5EDBAC' }} />
            <span className="hidden sm:inline">100%</span>
          </span>
          <span style={{ fontFamily: 'monospace', color: '#fff', fontSize: '13px', marginLeft: 4, fontWeight: 700 }}>
            {clockTime}
          </span>
        </div>
      </div>

      {/* FLOATING PERSISTENT WAITER CALL BANNER AT ROOT LEVEL - ALWAYS VISIBLE */}
      {waiterRequests.length > 0 && (
        <div className="waiter-call-floating-dock" role="alert" aria-live="assertive">
          <div className="waiter-call-floating-card">
            <div className="waiter-call-floating-icon">
              <Bell size={22} className="bell-ringing-icon" />
              <span className="waiter-pulse-halo" />
            </div>
            <div className="waiter-call-floating-content">
              <strong>
                {waiterRequests.length === 1 ? `¡${waiterRequests[0].tableName} llama al mesero!` : `¡${waiterRequests.length} mesas llaman al mesero!`}
              </strong>
              <small>
                {waiterRequests.map(r => r.tableName).join(' · ')}
              </small>
            </div>
            <div className="waiter-call-floating-actions">
              {waiterRequests.length === 1 ? (
                <button
                  type="button"
                  className="waiter-floating-btn primary"
                  disabled={attendingRequestId === waiterRequests[0].id}
                  onClick={(e) => void handleDismissWaiterRequest(waiterRequests[0], e)}
                >
                  {attendingRequestId === waiterRequests[0].id ? 'Atendiendo…' : 'Marcar atendida'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="waiter-floating-btn primary"
                    disabled={attendingRequestId === waiterRequests[0].id}
                    onClick={(e) => void handleDismissWaiterRequest(waiterRequests[0], e)}
                  >
                    {attendingRequestId === waiterRequests[0].id ? 'Atendiendo…' : `Atender ${waiterRequests[0].tableName}`}
                  </button>
                  <button
                    type="button"
                    className="waiter-floating-btn outline"
                    onClick={() => setShowOps(true)}
                  >
                    Ver todas ({waiterRequests.length})
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {(notice || error) && (
        <div className="toast-stack">
          {notice && <div className="toast success"><Check size={16} />{notice}</div>}
          {error && <div className="toast error"><X size={16} />{error}</div>}
        </div>
      )}

      {/* 2. Main POS Application Layout with Sidebar + View Layers */}
      <div className="pos-app-layout">
        {/* POSDAN Professional Sidebar */}
        <PosDanSidebar
          activeModule={activeNavTab}
          onSelectModule={(mod) => {
            if (cashierNeedsCashSession && mod !== 'cash') {
              setActiveNavTab('cash')
              onNotice('Abra el turno de caja para continuar.')
              return
            }
            // Auto close mobile order drawer when switching between modules
            if (mod !== 'tables' && mod !== 'menu') {
              setMobileDrawerOpen(false)
            }
            setActiveNavTab(mod)
            if (mod === 'kds') {
              setMobileDrawerOpen(false)
            }
            if (mod === 'users') setShowAttendance(true)
          }}
          userName={userName && userName.trim() ? userName : roleLabel(roleKey)}
          roleKey={roleKey}
          brandName={brand || 'RestaPP'}
          permissions={permissions}
          onLogout={onLogout}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          kdsPendingCount={0}
          waiterCallsCount={waiterRequests.length}
          ordersCount={allOrders.length}
        />

        {/* Main Content Area: Vistas con transición */}
        <main className="pos-main-content">
          {/* VIEW: TABLES / SALÓN */}
          <div className={`pos-view-layer ${activeNavTab === 'tables' ? 'view-active' : 'view-hidden'}`}>
            <header className="pos-view-header">
              <div className="pos-view-title">
                <h1>Salón Principal</h1>
                <p>
                  <span><span style={{ color: '#5EDBAC' }}>●</span> {totalFreeTables} Libres</span>
                  <span><span style={{ color: '#FF8A65' }}>●</span> {totalOccupiedTables} Ocupadas</span>
                  <span><span style={{ color: '#7986CB' }}>●</span> {totalBillTables} Cuenta</span>
                </p>
              </div>
              <div className="pos-view-actions">
                <button
                  type="button"
                  className={`pos-filter-pill-btn ${tableFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setTableFilter(prev => prev === 'all' ? 'available' : prev === 'available' ? 'occupied' : prev === 'occupied' ? 'prebill' : 'all')}
                >
                  <SlidersHorizontal size={14} style={{ color: '#A1A5AB' }} />
                  <span>{tableFilter === 'all' ? 'Todas' : tableFilter === 'available' ? 'Libres' : tableFilter === 'occupied' ? 'Ocupadas' : 'Cuentas'}</span>
                </button>
                {canQuickSale && (
                  <button
                    type="button"
                    className="pos-btn-primary"
                    style={{ padding: '0.5rem 1rem', fontSize: '0.82rem', borderRadius: 9999, width: 'auto' }}
                    onClick={() => {
                      setShowQuick(true)
                      setMobileDrawerOpen(true)
                    }}
                  >
                    <Plus size={15} /> Venta directa
                  </button>
                )}
              </div>
            </header>

            {/* Grid de Mesas Estilo POS */}
            <div className="pos-tables-grid">
              {(() => {
                const visibleTables = tables.filter(item => {
                  if (tableFilter === 'available') return item.status === 'available'
                  if (tableFilter === 'occupied') return item.status === 'occupied' || item.status === 'waiting_kitchen' || item.status === 'food_ready'
                  if (tableFilter === 'prebill') return item.status === 'bill_requested'
                  return true
                })
                if (!visibleTables.length) {
                  return (
                    <div className="empty" style={{ gridColumn: '1 / -1', minHeight: 220 }}>
                      <ClipboardList size={40} style={{ color: 'var(--pos-text-tertiary)' }} />
                      <p style={{ color: 'var(--pos-text-secondary)', marginTop: 8 }}>
                        {tableFilter === 'all' ? 'No hay mesas configuradas.' : 'No hay mesas con el estado seleccionado.'}
                      </p>
                    </div>
                  )
                }
                return visibleTables.map(item => {
                  const callingRequest = callingTableMap.get(item.id) || callingTableMap.get(item.name) || callingTableMap.get(item.number)
                  const isAvailable = item.status === 'available'
                  const isKitchen = item.status === 'waiting_kitchen'
                  const isBill = item.status === 'bill_requested'
                  const isOccupied = !isAvailable && !isKitchen && !isBill

                  const cardStatusClass = isAvailable ? 'status-free' : isKitchen ? 'status-kitchen' : isBill ? 'status-bill' : 'status-occupied'
                  const statusBadgeLabel = isAvailable ? 'Libre' : isKitchen ? 'Cocina' : isBill ? 'Cuenta' : 'Ocupada'

                  return (
                    <div
                      key={item.id}
                      className={`pos-table-card ${cardStatusClass} ${callingRequest ? 'table-is-calling' : ''}`}
                      onClick={() => {
                        onSelectTable(item)
                        setMobileDrawerOpen(true)
                      }}
                    >
                      {callingRequest && (
                        <div className="table-calling-badge" aria-label="¡Llamando al mesero!">
                          <Bell size={12} className="bell-ringing-icon" />
                          <span>¡Llamando!</span>
                        </div>
                      )}
                      <div className="pos-table-header">
                        <span className="pos-table-number">{item.number}</span>
                        {isAvailable ? (
                          <Users size={19} className="pos-table-icon" />
                        ) : isKitchen ? (
                          <Flame size={19} className="pos-table-icon" />
                        ) : isBill ? (
                          <Receipt size={19} className="pos-table-icon" />
                        ) : (
                          <Utensils size={19} className="pos-table-icon" />
                        )}
                      </div>

                      <div className="pos-table-footer">
                        <div className="pos-table-meta-text" title={item.customerName || (item.currentOrderTotal ? formatMoney(item.currentOrderTotal) : `${item.capacity} Personas`)}>
                          {item.customerName ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#5EDBAC', fontWeight: 700 }}>
                              <UserCircle2 size={13} style={{ flexShrink: 0 }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.customerName}</span>
                            </span>
                          ) : item.currentOrderTotal ? (
                            formatMoney(item.currentOrderTotal)
                          ) : (
                            `${item.capacity} Personas`
                          )}
                        </div>
                        <div className="pos-table-subrow">
                          <div className="pos-status-badge">
                            {statusBadgeLabel}
                          </div>
                          <span className="pos-time-badge">
                            {isAvailable ? `Cap: ${item.capacity}` : item.currentOrderTotal ? formatMoney(item.currentOrderTotal) : item.currentOrderDue ? formatMoney(item.currentOrderDue) : 'Activa'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>

          {/* VIEW: MENU / CATÁLOGO */}
          <div className={`pos-view-layer ${activeNavTab === 'menu' ? 'view-active' : 'view-hidden'}`}>
            <header className="pos-view-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="button"
                  className="pos-filter-pill-btn"
                  onClick={() => setActiveNavTab('tables')}
                  style={{ width: 38, height: 38, padding: 0, justifyContent: 'center' }}
                >
                  <ChevronLeft size={20} />
                </button>
                <div className="pos-view-title">
                  <h1>{table ? `Mesa ${table.number} · Menú` : 'Menú General'}</h1>
                  <p>{filteredMenuItems.length} productos disponibles</p>
                </div>
              </div>

              <div className="pos-view-actions">
                <div style={{ position: 'relative', width: 220 }}>
                  <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6C7278' }} />
                  <input
                    type="text"
                    placeholder="Buscar plato…"
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    style={{
                      background: 'var(--pos-bg-surface)',
                      borderColor: 'var(--pos-bg-surface-elevated)',
                      color: '#fff',
                      borderRadius: 9999,
                      paddingLeft: 34,
                      height: 38,
                      fontSize: '0.82rem'
                    }}
                  />
                </div>
                {/* Mobile Comanda Button */}
                <button
                  type="button"
                  className="md:hidden pos-btn-primary"
                  style={{ width: 40, height: 40, padding: 0, borderRadius: 9999 }}
                  onClick={() => setMobileDrawerOpen(true)}
                  title="Ver comanda"
                >
                  <ShoppingCart size={18} />
                </button>
              </div>
            </header>

            {/* Categorías (Chips horizontales) */}
            <div className="pos-category-bar">
              {menuCategories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  className={`pos-category-chip ${selectedCategory === cat ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat === 'Todos' ? 'Todos los productos' : cat}
                </button>
              ))}
            </div>

            {/* Grid de Productos */}
            <div className="pos-products-grid">
              {filteredMenuItems.map(item => {
                const hasRequiredMods = Array.isArray(item.modifiers) && item.modifiers.some((m: any) => m.required)
                return (
                  <div
                    key={item.id}
                    className="pos-product-card"
                    onClick={() => {
                      if (!table && !showQuick) {
                        setActiveNavTab('tables')
                        return
                      }
                      const hasMods = Array.isArray(item.modifiers) && item.modifiers.length > 0
                      const hasVars = Array.isArray(item.variations) && item.variations.length > 0
                      if (hasMods || hasVars) {
                        setMobileDrawerOpen(true)
                        window.dispatchEvent(new CustomEvent('restapp:customize-item', { detail: item }))
                      } else {
                        window.dispatchEvent(new CustomEvent('restapp:quick-add-item', { detail: item }))
                        onNotice(`+1 ${item.name} agregado a la comanda`)
                      }
                    }}
                  >
                    <div className="pos-product-image-wrap">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} loading="lazy" />
                      ) : (
                        <div className="pos-product-placeholder-wrap">
                          <Utensils size={28} style={{ opacity: 0.4 }} />
                          <span>{item.categoryName || 'Plato'}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        className="pos-product-add-btn"
                        title={`Agregar ${item.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!table && !showQuick) {
                            setActiveNavTab('tables')
                            return
                          }
                          setMobileDrawerOpen(true)
                          const hasModifiers = Array.isArray(item.modifiers) && item.modifiers.length > 0
                          const hasVars = Array.isArray(item.variations) && item.variations.length > 0
                          if (hasModifiers || hasVars) {
                            window.dispatchEvent(new CustomEvent('restapp:customize-item', { detail: item }))
                          } else {
                            window.dispatchEvent(new CustomEvent('restapp:quick-add-item', { detail: item }))
                          }
                        }}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <div className="pos-product-body">
                      <div className="pos-product-name">{item.name}</div>
                      <div className="pos-product-category">{item.categoryName}</div>
                      <div className="pos-product-price">{formatMoney(item.price)}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Mobile / Tablet Floating Comanda Bar */}
            {(table || showQuick) && (
              <div className="pos-menu-floating-comanda-bar">
                <button
                  type="button"
                  className="pos-menu-floating-comanda-btn"
                  onClick={() => setMobileDrawerOpen(true)}
                  aria-label="Abrir y revisar la comanda"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ClipboardList size={20} style={{ color: '#5edbac' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f6fc' }}>
                      {table ? `Mesa ${table.number}` : 'Venta Directa'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#5edbac', fontWeight: 800, fontSize: 13 }}>
                    <span>Ver comanda</span>
                    <span>→</span>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* VIEW: POS DIRECT SALE */}
          {activeNavTab === 'pos' && (
            <div className="pos-view-layer view-active">
              <PosModule
                menuItems={effectiveMenuItems}
                tables={tables}
                customers={posCustomers}
                selectedCustomer={selectedPosCustomer}
                onSelectCustomer={setSelectedPosCustomer}
                onOpenCustomerModal={() => setCustomerModalOpen(true)}
                onCustomizeItem={(item) => setPosCustomizingItem(item)}
                orderTypes={orderTypes}
                deliveryPlatforms={deliveryPlatforms}
                deliveryExecutives={deliveryExecutives}
                deliverySettings={deliverySettings}
                onOpenOrders={() => setActiveNavTab('orders')}
                onCheckout={async (orderData) => {
                  try {
                    const lines = orderData.items.map((i: any) => ({
                      clientId: crypto.randomUUID(),
                      itemId: Number(i.id),
                      name: i.name,
                      price: i.price,
                      quantity: i.quantity,
                      variationId: i.variationId,
                      variationName: i.variationName,
                      modifiers: i.modifiers || [],
                      note: i.notes
                    }))
                    const draft: OrderDraft = {
                      mode: orderData.mode,
                      orderTypeId: orderData.orderTypeId,
                      deliveryPlatformId: orderData.deliveryPlatformId,
                      deliveryAppName: orderData.deliveryAppName,
                      roomNumber: orderData.roomNumber,
                      deliveryAddress: orderData.deliveryAddress,
                      deliveryFee: orderData.deliveryFee,
                      deliveryExecutiveId: orderData.deliveryExecutiveId,
                      customerLat: orderData.customerLat,
                      customerLng: orderData.customerLng,
                      customerId: orderData.customerId,
                      customerName: selectedPosCustomer?.name,
                      customerPhone: selectedPosCustomer?.phone,
                      customerEmail: selectedPosCustomer?.email,
                      rncCedula: selectedPosCustomer?.rncCedula,
                      fiscalName: selectedPosCustomer?.fiscalName,
                      receiptType: undefined,
                      ecfType: undefined
                    }
                    const tableObj = orderData.tableId ? tables.find(t => t.id === orderData.tableId) || null : null
                    await onSubmitOrder(lines, tableObj, draft)
                    await loadPosDanData()
                  } catch (e: any) {
                    alert(e?.message || 'Error al procesar pedido')
                  }
                }}
                roleKey={roleKey}
              />

            </div>
          )}

          {/* VIEW: ALL ORDERS */}
          {activeNavTab === 'orders' && (
            <div className="pos-view-layer view-active">
              <OrdersModule
                orders={allOrders}
                onRefresh={loadPosDanData}
                onOpenPayment={openPickupPayment}
                onUpdateStatus={markPickupCollected}
                canCharge={canCharge}
                currencySymbol={activeCurrency.symbol}
              />
            </div>
          )}

          {/* VIEW: CASH REGISTER / SHIFTS */}
          {activeNavTab === 'cash' && (
            <div className="pos-view-layer view-active">
              <CashModule
                registers={cashRegisters}
                activeSession={activeCashSession}
                activeSummary={activeCashSummary}
                currentCashierName={roleLabel(roleKey)}
                roleKey={roleKey}
                requireOpen={cashierNeedsCashSession}
                currencySymbol="RD$"
                loading={cashLoading}
                onRefresh={async () => {
                  setCashLoading(true)
                  try {
                    await loadPosDanData()
                  } finally {
                    setCashLoading(false)
                  }
                }}
                onOpenSession={async (registerId, openingFloat, note) => {
                  await onOpenCashSession(registerId, openingFloat, note, newIdempotencyKey())
                  await loadPosDanData()
                }}
                onCloseSession={async (sessionId, countedCash, expectedCash, note, sendForApproval) => {
                  return onCloseCashSession(sessionId, countedCash, expectedCash, note, sendForApproval, newIdempotencyKey())
                }}
                onSessionClosed={onLogout}
                onCashMovement={async (type, amount, reason) => {
                  if (!activeCashSession?.id) return
                  await onCashMovement(type, activeCashSession.id, amount, reason, newIdempotencyKey())
                  await loadPosDanData()
                }}
                onFetchHistory={async () => {
                  try {
                    const res = await api.request<any>('/pos/cash-register/sessions?per_page=100', { tokenKind: 'pin' })
                    const list = res?.data || res?.sessions || res || []
                    return Array.isArray(list) ? list : []
                  } catch {
                    return []
                  }
                }}
                onPrintReport={async (sessionId, reportType, sessionData) => {
                  try {
                    if (navigator.onLine) {
                      try {
                        const response = await api.printCashSession('pin', sessionId, reportType, newIdempotencyKey())
                        const queued = responseData(response)
                        onNotice(queued?.message || 'Cierre enviado a la impresora configurada de la sucursal.')
                        return
                      } catch (serverError) {
                        console.error('No se pudo encolar el reporte de caja en la impresora configurada.', serverError)
                        onNotice('No se pudo enviar el reporte a la impresora configurada. Revise la impresora y vuelva a intentarlo.')
                        return
                      }
                    }

                    let summary = sessionData?.totals ? sessionData : null
                    const sess = sessionData || (activeCashSession?.id === sessionId ? activeCashSession : null)

                    if (!summary) {
                      try {
                        const res = await api.cashSessionSummary('pin', sessionId)
                        summary = res?.data || res || {}
                      } catch {
                        // ignore
                      }
                    }

                    const totals = summary?.totals || summary || {}
                    const openingFloat = Number(totals.opening_float ?? sess?.opening_float ?? 0)
                    const cashSales = Number(totals.cash_sales ?? totals.cash_sales_total ?? sess?.cash_sales_total ?? 0)
                    const cashIn = Number(totals.cash_in ?? totals.cash_in_total ?? sess?.cash_in_total ?? 0)
                    const cashOut = Number(totals.cash_out ?? totals.cash_out_total ?? sess?.cash_out_total ?? 0)
                    const safeDrops = Number(totals.safe_drops ?? totals.safe_drops_total ?? sess?.safe_drops_total ?? 0)
                    const refunds = Number(totals.refunds ?? totals.refunds_total ?? sess?.refunds_total ?? 0)
                    const changeGiven = Number(totals.change_given ?? totals.change_given_total ?? sess?.change_given_total ?? 0)
                    const expected = Number(sess?.expected_cash ?? totals.expected_cash ?? (openingFloat + cashSales + cashIn - cashOut - safeDrops - refunds - changeGiven))
                    const counted = Number(sess?.counted_cash ?? expected)
                    const discrepancy = Number(sess?.discrepancy ?? (counted - expected))

                    printThermalZReport({
                      restaurantName: brand || 'RESTAURANTE',
                      branchName: branch || undefined,
                      registerName: cashRegisters.find(r => r.id === (sess?.cash_register_id || sess?.registerId))?.name || 'Caja Principal',
                      sessionId,
                      cashierName: sess?.opened_by_user?.name || sess?.closer?.name || roleLabel(roleKey),
                      openedAt: sess?.opened_at,
                      closedAt: sess?.closed_at || new Date().toISOString(),
                      openingFloat,
                      cashSales,
                      cardSales: Number(totals.card_sales || 0),
                      transferSales: Number(totals.bank_transfer_sales || 0),
                      cashIn,
                      cashOut,
                      safeDrops,
                      refunds,
                      changeGiven,
                      expectedCash: expected,
                      countedCash: counted,
                      discrepancy,
                      currencySymbol: 'RD$',
                      note: sess?.closing_note,
                      transactions: Array.isArray(summary?.transactions)
                        ? summary.transactions
                        : Array.isArray(sess?.transactions) ? sess.transactions : [],
                    })
                  } catch (err) {
                    console.error('Error al imprimir reporte Z:', err)
                  }
                }}
              />
            </div>
          )}

          {/* VIEW: INVOICES */}
          {activeNavTab === 'invoices' && (
            <div className="pos-view-layer view-active">
              <InvoicesModule
                orders={allOrders}
                onPrintInvoice={(orderId) => {
                  const ord = allOrders.find(o => o.id === orderId)
                  if (ord) {
                    const cached = readCache()
                    const thermalData: ThermalReceiptData = {
                      restaurantName: cached.restaurantName || 'Restaurante',
                      tableNumber: ord.table_number || ord.table?.number,
                      orderNumber: ord.order_number || ord.id,
                      customerName: ord.customer_name || ord.customer?.name || 'Cliente Final',
                      customerRnc: ord.customer?.rnc_cedula || ord.rnc_cedula,
                      ncf: ord.ncf,
                      receiptType: ord.receipt_type,
                      items: (ord.items || []).map((it: any) => ({
                        name: it.menu_item_name || it.name || 'Artículo',
                        quantity: Number(it.quantity || 1),
                        amount: Number(it.amount || it.price || 0)
                      })),
                      subtotal: Number(ord.sub_total || ord.subtotal || ord.total || 0),
                      tax: Number(ord.tax || ord.total_tax || 0),
                      tip: Number(ord.tip || 0),
                      discount: Number(ord.discount || 0),
                      total: Number(ord.total || 0),
                      amountPaid: Number(ord.amount_paid || ord.total || 0),
                      paymentMethod: ord.payment_method || ord.payments?.[0]?.payment_method || 'Completado',
                      isPreBill: false
                    }
                    void routePrintReceipt(thermalData, {
                      sendToBackend: async () => {
                        await api.printOrder('pin', orderId, 'receipt', newIdempotencyKey())
                      }
                    })
                  } else {
                    onPrintPreBill(orderId, newIdempotencyKey()).catch(() => {})
                  }
                }}
                onSendEmail={async (orderId, email) => {
                  try {
                    await api.request(`/pos/orders/${orderId}/send-email`, {
                      method: 'POST',
                      body: JSON.stringify({ email }),
                      headers: { 'Content-Type': 'application/json' },
                      tokenKind: 'pin'
                    })
                  } catch {
                    // fallback simulated email dispatch
                    await new Promise(r => setTimeout(r, 600))
                  }
                }}
              />
            </div>
          )}

          {/* VIEW: CUSTOMERS */}
          {activeNavTab === 'customers' && (
            <div className="pos-view-layer view-active">
              <CustomersModule
                customers={posCustomers}
                orders={allOrders}
                onOpenCustomerModal={() => setCustomerModalOpen(true)}
                onEditCustomer={(cust) => {
                  setSelectedPosCustomer(cust)
                  setCustomerModalOpen(true)
                }}
              />
            </div>
          )}

          {/* VIEW: PRODUCTS */}
          {activeNavTab === 'products' && (
            <div className="pos-view-layer view-active">
              <ProductsModule
                menuItems={effectiveMenuItems}
                roleKey={roleKey}
                permissions={permissions}
                onToggleAvailability={(itemId, available) => {
                  setLocalItemAvailability(prev => ({ ...prev, [itemId]: available }))
                  // attempt backend sync
                  api.request(`/pos/items/${itemId}/toggle`, {
                    method: 'POST',
                    body: JSON.stringify({ available }),
                    headers: { 'Content-Type': 'application/json' },
                    tokenKind: 'pin'
                  }).catch(() => {})
                }}
                onInspectItem={(item) => setPosCustomizingItem(item)}
              />
            </div>
          )}

          {/* VIEW: INVENTORY */}
          {activeNavTab === 'inventory' && (
            <div className="pos-view-layer view-active">
              <InventoryModule menuItems={items} />
            </div>
          )}

          {/* VIEW: ANALYTICS */}
          {activeNavTab === 'analytics' && (
            <div className="pos-view-layer view-active">
              <AnalyticsModule orders={allOrders} />
            </div>
          )}

          {/* VIEW: DISCOUNTS */}
          {activeNavTab === 'discounts' && (
            <div className="pos-view-layer view-active">
              <DiscountsModule />
            </div>
          )}

          {/* VIEW: RETURNS */}
          {activeNavTab === 'returns' && (
            <div className="pos-view-layer view-active">
              <ReturnsModule />
            </div>
          )}

          {/* VIEW: USERS */}
          {activeNavTab === 'users' && (
            <div className="pos-view-layer view-active">
              <UsersModule />
            </div>
          )}

          {/* VIEW: SETTINGS */}
          {activeNavTab === 'settings' && (
            <div className="pos-view-layer view-active">
              <SettingsModule onTestPrint={() => routePrintTest()} />
            </div>
          )}

          {activeNavTab === 'kds' && canKitchen && (
            <div className="pos-view-layer view-active kitchen-screen-view">
              <KitchenPanel
                offline={offline}
                places={kitchenPlaces}
                standalone
                viewScope="supervisor"
                onClose={() => setActiveNavTab('tables')}
                onUpdateStatus={onUpdateKotStatus}
              />
            </div>
          )}
        </main>

        {/* 3. Right Enterprise Order Drawer (Slide over on Mobile, column on Desktop) */}
        <div
          className={`pos-drawer-overlay ${mobileDrawerOpen && (table || showQuick) ? 'is-visible' : ''}`}
          onClick={() => setMobileDrawerOpen(false)}
        />

        {/* OrderPanel rendered inside layout */}
        {activeNavTab !== 'kds' && (table || (showQuick && canQuickSale)) && (
          <OrderPanel
            key={`${table?.id || 'quick'}-${table?.currentOrderId || 'new'}`}
            table={table}
            tables={tables}
            quick={showQuick}
            mobileDrawerOpen={mobileDrawerOpen}
            isMenuOpen={activeNavTab === 'menu'}
            roleKey={roleKey}
            permissions={permissions}
            paymentMethods={paymentMethods}
            fiscalCapabilities={fiscalCapabilities}
            canCharge={canCharge}
            cashSessionOpen={cashSessionOpen}
            cashSessionReady={cashSessionReady}
            offline={offline}
            deliverySettings={deliverySettings}
            deliveryExecutives={deliveryExecutives}
            deliveryPlatforms={deliveryPlatforms}
            orderTypes={orderTypes}
            items={items}
            onClose={() => {
              onSelectTable(null)
              setShowQuick(false)
              setMobileDrawerOpen(false)
            }}
            onOpenMenu={() => {
              setActiveNavTab('menu')
              if (window.innerWidth <= 768) {
                setMobileDrawerOpen(false)
              }
            }}
            onSubmit={onSubmitOrder}
            onSaveCustomer={onSaveCustomer}
            onRemoveOrderItem={onRemoveOrderItem}
            onPrintPreBill={onPrintPreBill}
            onPayOrder={onPayOrder}
            onTransferTable={onTransferTable}
            onCancelOrder={onCancelOrder}
          />
        )}

        {pickupPaymentLoading && (
          <div className="modal-backdrop" role="status" aria-live="polite">
            <section className="pickup-payment-loading">
              <Clock size={20} />
              <span>Cargando el detalle del retiro…</span>
            </section>
          </div>
        )}

        {pickupPaymentTarget && pickupPaymentTable && !pickupPaymentLoading && (
          <div className="modal-backdrop" onClick={() => setPickupPaymentTarget(null)}>
            <div className="payment-dialog-shell" onClick={event => event.stopPropagation()}>
              <TablePaymentPanel
                table={pickupPaymentTable}
                payload={pickupPaymentTarget.detail}
                items={extractOrderItems(pickupPaymentTarget.detail)}
                paymentMethods={paymentMethods}
                fiscalCapabilities={fiscalCapabilities}
                cashSessionOpen={cashSessionOpen}
                cashSessionReady={cashSessionReady}
                offline={offline}
                customerRnc={pickupPaymentTable.customerRnc}
                customerFiscalName={pickupPaymentTable.customerFiscalName}
                customerName={pickupPaymentTable.customerName}
                customerId={pickupPaymentTable.customerId}
                targetLabel="Para llevar / Recoger"
                targetDescription="Cobro del pedido antes de entregarlo. No utiliza mesa."
                loadingPreview={false}
                onClose={() => setPickupPaymentTarget(null)}
                onPay={async (orderId, amount, method, idempotencyKey) => {
                  const result = await onPayOrder(orderId, amount, method, idempotencyKey)
                  if (!result.queued) await loadPosDanData()
                  return result
                }}
                onSaveCustomer={onSaveCustomer}
              />
            </div>
          </div>
        )}
      </div>

      {showMenu && <MenuPanel items={items} onClose={() => setShowMenu(false)} />}
      {showOps && (
        <OperationsPanel
          notifications={notifications}
          loading={opsLoading}
          offline={offline}
          permissions={permissions}
          roleKey={roleKey}
          onClose={() => setShowOps(false)}
          onMarkNotificationRead={markNotificationRead}
        />
      )}
      {showAttendance && (
        <JornadaPanel
          offline={offline}
          userId={userId}
          deviceId={deviceId}
          onClose={() => setShowAttendance(false)}
          onClockIn={onClockIn}
          onClockOut={onClockOut}
        />
      )}
      {showCashier && canCashier && (
        <CashierPanel
          offline={offline}
          permissions={permissions}
          onClose={() => setShowCashier(false)}
          onOpenSession={onOpenCashSession}
          onCloseSession={onCloseCashSession}
          onApproveSession={onApproveCashSession}
          onRejectSession={onRejectCashSession}
          onReopenSession={onReopenCashSession}
          onCashMovement={onCashMovement}
        />
      )}
      {customerModalOpen && (
        <CustomerModal
          currentCustomer={selectedPosCustomer ? {
            id: selectedPosCustomer.id,
            name: selectedPosCustomer.name,
            phone: selectedPosCustomer.phone,
            email: selectedPosCustomer.email,
            rncCedula: selectedPosCustomer.rncCedula,
            fiscalName: selectedPosCustomer.fiscalName,
            commercialName: selectedPosCustomer.commercialName,
            deliveryAddress: selectedPosCustomer.deliveryAddress,
          } : undefined}
          canManageFiscal={roleKey === 'cajero' || roleKey === 'head' || permissions['payments.charge'] === true}
          fiscalCapabilities={fiscalCapabilities}
          offline={offline}
          onClose={() => setCustomerModalOpen(false)}
          onSelect={customer => {
            setSelectedPosCustomer(customer)
            setCustomerModalOpen(false)
            // Actualizar lista local de clientes si es nuevo
            setPosCustomers(prev => {
              const idx = prev.findIndex(c => c.id === customer.id)
              if (idx >= 0) {
                const next = [...prev]
                next[idx] = customer
                return next
              }
              return [customer, ...prev]
            })
          }}
        />
      )}
      {posCustomizingItem && (
        <ModifierModal
          item={posCustomizingItem}
          onClose={() => setPosCustomizingItem(null)}
          onAdd={line => {
            // PosModule escucha este evento para conservar el carrito en su
            // propia instancia sin enviar todavía la orden al backend.
            window.dispatchEvent(new CustomEvent('restapp:pos-add-line', { detail: line }))
            setPosCustomizingItem(null)
          }}
        />
      )}
    </div>
  )
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

function OrderFlowPanel({ mode, status, hasOrder, amountDue, orderNumber, destination, onClose }: { mode: OrderMode; status: string; hasOrder: boolean; amountDue: number; orderNumber?: string | number; destination: string; onClose: () => void }) {
  const steps = orderFlowSteps(mode)
  const stage = orderFlowStage(status, hasOrder, steps.length)
  const nextAction = orderFlowNextAction(mode, stage, hasOrder, amountDue)
  const currentLabel = stage < 0 ? 'Orden cancelada' : stage >= steps.length - 1 ? 'Último paso' : `Paso ${stage + 1} de ${steps.length}`
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="modal wide order-flow-panel" onClick={event => event.stopPropagation()} aria-labelledby="order-flow-title">
      <header>
        <div>
          <p className="eyebrow">GUÍA DE LA ORDEN</p>
          <h2 id="order-flow-title">¿Qué sigue ahora?</h2>
          <small>{orderNumber ? `Pedido n.º ${orderNumber} · ` : ''}{orderServiceLabel(mode)} · {destination}</small>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar guía de la orden"><X size={18} /></button>
      </header>
      <section className={`order-flow-current ${stage < 0 ? 'is-cancelled' : ''}`}>
        <div className="order-flow-current-icon">{stage < 0 ? <XCircle size={22} /> : stage >= steps.length - 1 ? <Check size={22} /> : <Clock size={22} />}</div>
        <div><span>{currentLabel}</span><strong>{stage < 0 ? 'No continúes con esta orden' : orderProgressLabel(status)}</strong><small>{nextAction}</small></div>
      </section>
      <ol className="order-flow-steps">
        {steps.map((step, index) => {
          const stepState = stage < 0 ? 'cancelled' : index < stage ? 'done' : index === stage ? 'current' : 'next'
          return <li className={`order-flow-step ${stepState}`} key={step.title}>
            <span className="order-flow-step-marker">{stepState === 'done' ? <Check size={15} /> : index + 1}</span>
            <div><strong>{step.title}</strong><small>{step.description}</small></div>
          </li>
        })}
      </ol>
      <footer className="order-flow-footer">
        <span><strong>Regla sencilla:</strong> el pago y la cocina son pasos distintos. Una orden puede estar pagada y seguir en preparación.</span>
        <button className="button primary" onClick={onClose}>Entendido</button>
      </footer>
    </section>
  </div>
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

type PaymentPreviewItem = {
  id: number
  name: string
  quantity: number
  amount: number
  variation?: string
  modifiers: string[]
  note?: string
}

function paymentPreviewItems(items: Array<any>): PaymentPreviewItem[] {
  return items.map((item, index) => {
    const quantity = Math.max(1, Number(item?.quantity || 1))
    const rawAmount = [item?.amount, item?.line_total, item?.total, item?.subtotal].find(value => value !== null && value !== undefined && value !== '')
    const fallbackAmount = Number(item?.price ?? item?.unit_price ?? item?.unitPrice ?? 0) * quantity
    const amount = Number(rawAmount ?? fallbackAmount)
    const rawModifiers = item?.modifiers || item?.modifier_options || item?.modifierOptions || item?.options || item?.addons || []
    const modifiers = Array.isArray(rawModifiers)
      ? rawModifiers.map((modifier: any) => {
        const name = String(modifier?.name || modifier?.option_name || modifier?.modifier_option_name || modifier?.label || '').trim()
        const price = Number(modifier?.price ?? modifier?.price_delta ?? modifier?.priceDelta ?? 0)
        return name ? `${name}${price > 0 ? ` (+${formatMoney(price)})` : ''}` : ''
      }).filter(Boolean)
      : []
    const variation = String(item?.variation_name || item?.variationName || item?.variant_name || item?.variantName || item?.variation?.name || item?.variant?.name || '').trim()
    const note = String(item?.note || item?.notes || item?.special_instructions || item?.specialInstructions || '').trim()
    return {
      id: Number(item?.id || item?.order_item_id || index + 1),
      name: String(item?.name || item?.menu_item_name || item?.product_name || item?.menuItem?.name || 'Producto'),
      quantity,
      amount: Number.isFinite(amount) ? amount : 0,
      variation: variation || undefined,
      modifiers,
      note: note || undefined,
    }
  })
}

function receiptPreviewLabel(value: string): string {
  const labels: Record<string, string> = {
    B01: 'B01 · Factura de Crédito Fiscal',
    B02: 'B02 · Factura de Consumo',
    B14: 'B14 · Régimen Especial',
    B15: 'B15 · Gubernamental',
    E31: 'E31 · Crédito Fiscal Electrónica',
    E32: 'E32 · Consumo Electrónica',
    E44: 'E44 · Régimen Especial Electrónico',
    E45: 'E45 · Gubernamental Electrónico',
    receipt: 'Recibo normal',
  }
  return labels[value] || value || 'Documento de cobro'
}

function TablePaymentPanel({
  table,
  payload,
  items,
  paymentMethods,
  fiscalCapabilities,
  cashSessionOpen,
  cashSessionReady,
  offline,
  customerRnc,
  customerFiscalName,
  customerName,
  customerId,
  onClose,
  onPay,
  onSaveCustomer,
  targetLabel,
  targetDescription,
  loadingPreview = false,
}: {
  table: RestaurantTable
  payload: any
  items: Array<any>
  paymentMethods: PaymentMethodOption[]
  fiscalCapabilities?: FiscalCapabilities | null
  cashSessionOpen: boolean
  cashSessionReady: boolean
  offline: boolean
  customerRnc?: string
  customerFiscalName?: string
  customerName?: string
  customerId?: number
  loadingPreview?: boolean
  onClose: () => void
  onPay: (orderId: number, amount: number, method: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>
  onSaveCustomer?: (table: RestaurantTable, name: string, customerId?: number, rncCedula?: string, fiscalName?: string) => Promise<void>
  targetLabel?: string
  targetDescription?: string
}) {
  const summary = normalizePreBill(payload, table, items)
  const previewSource = payload?.data ?? payload ?? {}
  const previewCandidates = [previewSource, previewSource?.order, previewSource?.data, previewSource?.data?.order].filter(value => value && typeof value === 'object')
  const readPreviewValue = (...keys: string[]) => {
    for (const candidate of previewCandidates) {
      for (const key of keys) {
        if (candidate[key] !== undefined && candidate[key] !== null && candidate[key] !== '') return candidate[key]
      }
    }
    return undefined
  }
  const previewLines = paymentPreviewItems(items)
  const previewService = resolveOrderService({ ...previewSource, order_type: readPreviewValue('order_type', 'orderType') ?? (targetLabel ? 'pickup' : undefined), table_id: readPreviewValue('table_id', 'tableId') ?? (table.id || undefined) })
  const previewOrderNumber = String(readPreviewValue('order_number', 'formatted_order_number', 'number') || table.currentOrderNumber || table.currentOrderId || '—')
  const previewDateValue = readPreviewValue('created_at', 'createdAt', 'date_time', 'placed_at') || orderStartedAt(previewSource)
  const previewDate = previewDateValue
    ? (Number.isNaN(new Date(String(previewDateValue)).getTime()) ? String(previewDateValue) : new Date(String(previewDateValue)).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }))
    : 'Hora no informada'
  const previewStatus = orderProgressLabel(readPreviewValue('operational_status', 'order_status', 'kitchen_status', 'status') || table.kitchenStatus || table.currentOrderStatus)
  const previewAddress = String(readPreviewValue('delivery_address', 'deliveryAddress', 'address') || '').trim()
  const previewRoom = String(readPreviewValue('room_number', 'roomNumber') || '').trim()
  const previewPlatform = String(readPreviewValue('delivery_platform_name', 'delivery_app_name', 'custom_order_type_name', 'customOrderTypeName') || '').trim()
  const previewWaiter = String(readPreviewValue('waiter_name', 'server_name', 'employee_name', 'attended_by') || previewSource?.waiter?.name || previewSource?.server?.name || '').trim()
  const previewNotes = String(readPreviewValue('notes', 'order_note', 'note') || '').trim()
  const previewDeliveryFee = Number(readPreviewValue('delivery_fee', 'deliveryFee') || 0)
  const previewCharges = Number(readPreviewValue('service_charge', 'serviceCharge', 'charges_total', 'charges') || 0)
  const cached = readCache()
  const printer = (cached.printers || []).find(value => value.isActive !== false && (value.isDefault || (value.orders || []).length > 0)) || (cached.printers || []).find(value => value.isActive !== false)
  const enabledMethods = paymentMethods.filter(value => value.enabled)
  const [method, setMethod] = useState(enabledMethods[0]?.code || 'cash')
  const [amount, setAmount] = useState(summary.due > 0 ? summary.due.toFixed(2) : '')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  // Determine branch fiscal configuration
  // Fallback to cache if not passed directly
  const cachedCaps = fiscalCapabilities || readCache().fiscalCapabilities
  // "enabled" only means configured. The backend contract exposes "ready"
  // for a mode that can actually issue a document now (including sequences or
  // verified e-CF acceptance), so the UI must never advertise an unready mode.
  const isElectronicActive = Boolean(cachedCaps?.electronic?.ready)
  const isTraditionalActive = Boolean(cachedCaps?.traditional?.ready)
  const defaultConsumerType = isElectronicActive ? 'E32' : isTraditionalActive ? 'B02' : 'receipt'
  const defaultCreditType = isElectronicActive ? 'E31' : isTraditionalActive ? 'B01' : 'receipt'

  const cust = payload?.customer || (payload?.data as any)?.customer
  const initialRnc = (customerRnc || cust?.rnc_cedula || cust?.rncCedula || payload?.rnc_cedula || table?.customerRnc || '').trim()
  const initialFiscalName = (customerFiscalName || cust?.fiscal_name || cust?.fiscalName || payload?.fiscal_name || table?.customerFiscalName || '').trim()
  const effectiveCustName = (customerName || cust?.name || payload?.customer_name || table?.customerName || '').trim()
  const effectiveCustId = customerId ?? cust?.id ?? payload?.customer_id ?? table?.customerId

  // Factura electrónica / Comprobante fiscal
  const [receiptType, setReceiptType] = useState(initialRnc ? defaultCreditType : defaultConsumerType)
  const [rncCedula, setRncCedula] = useState(initialRnc)
  const [fiscalName, setFiscalName] = useState(initialFiscalName)
  const [searchingRnc, setSearchingRnc] = useState(false)
  const [rncStatusMsg, setRncStatusMsg] = useState('')
  const [showFiscalDetails, setShowFiscalDetails] = useState(Boolean(initialRnc || initialFiscalName))
  const [printReceiptOnPay, setPrintReceiptOnPay] = useState(() => getStationPrinterConfig().autoPrintOnPayment)
  const previewDestination = previewService === 'dine_in'
    ? `Mesa ${table.number}`
    : previewService === 'room_service'
      ? (previewRoom ? `Habitación ${previewRoom}` : 'Habitación no indicada')
      : previewService === 'delivery'
        ? (previewAddress || 'Dirección no indicada')
        : 'Retiro en el local'
  const previewCustomer = effectiveCustName || String(readPreviewValue('customer_name', 'customerName') || previewSource?.customer?.name || previewSource?.customer?.full_name || 'Consumidor Final')
  const previewCustomerPhone = String(readPreviewValue('customer_phone', 'customerPhone', 'phone') || previewSource?.customer?.phone || previewSource?.customer?.telephone || 'Teléfono no indicado')
  const previewPaymentStatus = summary.due <= 0.01 ? 'Pagado' : summary.paid > 0 ? 'Pago parcial' : 'Pendiente'

  // Initialize fiscal data from payload / customer
  useEffect(() => {
    const activeCust = payload?.customer || (payload?.data as any)?.customer
    const currentRnc = (customerRnc || activeCust?.rnc_cedula || activeCust?.rncCedula || payload?.rnc_cedula || table?.customerRnc || '').trim()
    const currentFiscalName = (customerFiscalName || activeCust?.fiscal_name || activeCust?.fiscalName || payload?.fiscal_name || table?.customerFiscalName || '').trim()
    if (currentRnc) {
      setRncCedula(currentRnc)
      // If customer has RNC, auto-select Crédito Fiscal (E31 or B01 according to branch setup)
      setReceiptType(defaultCreditType)
      setShowFiscalDetails(true)
    }
    if (currentFiscalName) setFiscalName(currentFiscalName)
  }, [payload, customerRnc, customerFiscalName, defaultCreditType, table?.customerRnc, table?.customerFiscalName])

  // Auto-lookup registered customer RNC if customer has a profile with RNC
  useEffect(() => {
    let active = true
    if (!rncCedula && (effectiveCustId || effectiveCustName) && !offline) {
      const searchTarget = effectiveCustName.trim() || (effectiveCustId ? String(effectiveCustId) : '')
      if (searchTarget) {
        api.customers('pin', searchTarget)
          .then(results => {
            if (!active) return
            const matchWithRnc = results.find(c =>
              (c.rncCedula && c.rncCedula.trim().length >= 9) &&
              (c.id === effectiveCustId || (effectiveCustName && c.name?.toLowerCase().trim() === effectiveCustName.toLowerCase().trim()))
            )
            if (matchWithRnc && matchWithRnc.rncCedula) {
              setRncCedula(matchWithRnc.rncCedula)
              if (matchWithRnc.fiscalName) setFiscalName(matchWithRnc.fiscalName)
              setReceiptType(defaultCreditType)
              setShowFiscalDetails(true)
              if (table.currentOrderId && onSaveCustomer) {
                void onSaveCustomer(table, matchWithRnc.name, matchWithRnc.id, matchWithRnc.rncCedula, matchWithRnc.fiscalName).catch(() => undefined)
              }
            }
          })
          .catch(() => undefined)
      }
    }
    return () => { active = false }
  }, [effectiveCustId, effectiveCustName, rncCedula, defaultCreditType, offline, table, onSaveCustomer])

  const selectedMethod = enabledMethods.some(value => value.code === method) ? method : enabledMethods[0]?.code || ''

  async function verifyRnc() {
    const cleaned = rncCedula.replace(/[^0-9]/g, '').trim()
    if (cleaned.length < 9) {
      setRncStatusMsg('El RNC debe tener 9 dígitos o la Cédula 11 dígitos.')
      return
    }
    setSearchingRnc(true)
    setRncStatusMsg('Consultando base de datos y DGII…')
    try {
      // 1. Verificar si ya existe registrado en la base local
      const res = await api.customers('pin', cleaned)
      const found = res?.find(c => (c.rncCedula || '').replace(/\D/g, '') === cleaned)
      if (found && (found.name || found.fiscalName)) {
        if (!fiscalName.trim()) setFiscalName(found.fiscalName || found.name)
        setReceiptType(defaultCreditType)
        setShowFiscalDetails(true)
        setRncStatusMsg(`✓ Registrado en sistema: ${found.fiscalName || found.name}`)
        return
      }

      // 2. Si no está en la base local, consultar en vivo en el padrón DGII
      const dgii = await api.lookupDgiiRnc(cleaned)
      if (dgii.found && dgii.fiscalName) {
        setFiscalName(dgii.fiscalName)
        if (dgii.rncCedula) setRncCedula(dgii.rncCedula)
        setReceiptType(defaultCreditType)
        setShowFiscalDetails(true)
        setRncStatusMsg(`✓ Verificado DGII: ${dgii.fiscalName} (${dgii.status || 'ACTIVO'})`)
      } else {
        setReceiptType(defaultCreditType)
        setShowFiscalDetails(true)
        setRncStatusMsg(dgii.message || 'RNC/Cédula sin registro previo en la DGII.')
      }
    } catch {
      setRncStatusMsg('No se pudo verificar el RNC en este momento.')
    } finally {
      setSearchingRnc(false)
    }
  }

  async function charge(withPrint = printReceiptOnPay) {
    const numericAmount = Number(amount)
    if (!cashSessionReady) { setError('Verificando el turno de caja. Intente nuevamente en un momento.'); return }
    if (!cashSessionOpen) { setError('Debe abrir un turno de caja antes de cobrar.'); return }
    if (!table.currentOrderId || summary.due <= 0) { setError('Esta mesa no tiene saldo pendiente de pago.'); return }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > summary.due + 0.01) { setError(`El monto debe estar entre ${formatMoney(0.01)} y ${formatMoney(summary.due)}.`); return }
    if (!enabledMethods.some(value => value.code === selectedMethod)) { setError('Este metodo de pago no esta habilitado para esta sucursal.'); return }
    if (electronicFiscalReceiptTypes.has(receiptType)) {
      setError('La emisión electrónica todavía no está habilitada en el backend para esta sucursal. No se registrará el cobro.')
      return
    }
    if ((receiptType === 'E31' || receiptType === 'B01') && !rncCedula.trim()) {
      setError('Para comprobante con Crédito Fiscal (E31 / B01) debe ingresar el RNC o Cédula.')
      return
    }
    const wantsTraditionalFiscal = isTraditionalActive && traditionalFiscalReceiptTypes.has(receiptType)
    if (wantsTraditionalFiscal && !navigator.onLine) {
      setError('Para emitir un comprobante fiscal tradicional se necesita conexión con RestaPP. No se registrará el cobro sin conexión.')
      return
    }
    setBusy(true); setError(''); setStatus('')
    try {
      // If fiscal data or receiptType provided, save to order/customer first
      if (table.currentOrderId && onSaveCustomer && (rncCedula.trim() || fiscalName.trim())) {
        await onSaveCustomer(
          table,
          effectiveCustName || table.customerName || fiscalName.trim() || 'Cliente Final',
          effectiveCustId || table.customerId,
          rncCedula.trim() || undefined,
          fiscalName.trim() || undefined
        ).catch(() => undefined)
      }
      const orderIdToPrint = table.currentOrderId
      const result = await onPay(table.currentOrderId, numericAmount, selectedMethod, newIdempotencyKey())
      setStatus(result.message)
      let printSucceeded = true
      let printDocument: 'receipt' | 'fiscal' = 'receipt'

      if (wantsTraditionalFiscal) {
        if (result.queued) {
          printSucceeded = false
          setError('El cobro quedó pendiente y todavía no se emitió el comprobante fiscal. Se requiere confirmación online para emitirlo.')
        } else {
          await api.issueFiscalDocument(
            'pin',
            orderIdToPrint,
            'traditional',
            receiptType,
            newIdempotencyKey(),
            undefined,
            { rncCedula: rncCedula.trim() || undefined, fiscalName: fiscalName.trim() || undefined },
          )
          printDocument = 'fiscal'
        }
      }

      if (!printSucceeded) {
        setBusy(false)
        return
      }

      if (withPrint && orderIdToPrint) {
        const cached = readCache()
        const thermalData: ThermalReceiptData = {
          restaurantName: cached.restaurantName || 'Restaurante',
          rncCedula: rncCedula.trim() || undefined,
          fiscalName: fiscalName.trim() || undefined,
          receiptType: receiptType || undefined,
          ncf: payload?.ncf || payload?.invoice?.ncf || undefined,
          tableNumber: table.number,
          orderNumber: table.currentOrderNumber || orderIdToPrint,
          cashierName: (readSession('pin') as any)?.userName || 'Cajero',
          customerName: effectiveCustName || table.customerName || 'Cliente Final',
          customerRnc: rncCedula.trim() || undefined,
          items: (items || []).map((it: any) => ({
            name: it.name || it.menu_item_name || 'Artículo',
            quantity: Number(it.quantity || 1),
            amount: Number(it.amount || it.price || 0),
          })),
          subtotal: summary.subtotal ?? 0,
          tax: summary.tax ?? 0,
          tip: summary.tip ?? 0,
          discount: summary.discount ?? 0,
          total: summary.total ?? numericAmount,
          amountPaid: numericAmount,
          changeDue: Math.max(0, numericAmount - (summary.due ?? 0)),
          paymentMethod: enabledMethods.find(m => m.code === selectedMethod)?.label || selectedMethod,
          isPreBill: false,
        }

        const printResult = await routePrintReceipt(thermalData, {
          sendToBackend: async () => {
            if (orderIdToPrint) {
              await api.printOrder('pin', orderIdToPrint, printDocument, newIdempotencyKey())
            }
          }
        })
        if (!printResult.success) {
          printSucceeded = false
          setError(`${result.message} ${printResult.message}`)
        }
      }

      if (!result.queued && printSucceeded) onClose()
    } catch (cause) {
      setError(normalizeError(cause, 'No se pudo procesar el cobro. Verifique la conexion o el monto e intente de nuevo.'))
    } finally { setBusy(false) }
  }

  return (
    <section className="table-payment-panel" aria-label={`Cobro de ${targetLabel || `la mesa ${table.number}`}`}>
      <div className="table-payment-header">
        <div>
          <p className="eyebrow">{targetLabel ? 'COBRO DEL PEDIDO' : 'COBRO DE LA MESA'}</p>
          <h3>{targetLabel || `Mesa ${table.number}`}</h3>
          <small>{targetDescription || 'El turno y la caja chica se administran por separado desde “Turno de caja”.'}</small>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar cobro"><X size={18} /></button>
      </div>
      {offline && <Alert>Sin conexión: el cobro queda pendiente y se validará automáticamente al recuperar internet.</Alert>}
      {!cashSessionReady && <Alert>Verificando el turno de caja antes de habilitar el cobro…</Alert>}
      {cashSessionReady && !cashSessionOpen && <Alert>Debe abrir el turno de caja antes de cobrar. Vaya a “Cajas/Turnos” y abra el turno del cajero.</Alert>}
      {error && <Alert>{error}</Alert>}
      {status && <p className="table-payment-status" role="status">{status}</p>}
      <section className="payment-review-card" aria-labelledby="payment-review-title">
        <div className="payment-review-heading">
          <div>
            <p className="eyebrow">REVISIÓN ANTES DEL COBRO</p>
            <strong id="payment-review-title">Confirme toda la orden</strong>
          </div>
          <span className="payment-review-badge">Sin registrar</span>
        </div>
        {loadingPreview ? (
          <div className="payment-review-loading" role="status" aria-live="polite">
            <Clock size={18} />
            <span>Cargando el detalle completo de la orden…</span>
          </div>
        ) : (
          <>
            <div className="payment-review-facts">
              <div><span>Orden</span><strong>#{previewOrderNumber}</strong><small>{previewDate}</small></div>
              <div><span>Servicio</span><strong>{orderServiceLabel(previewService)}</strong><small>{previewDestination}</small>{previewPlatform && previewService === 'delivery' && <small>Plataforma: {previewPlatform}</small>}</div>
              <div><span>Estado operativo</span><strong>{previewStatus}</strong><small>Pago actual: {previewPaymentStatus}</small></div>
            </div>

            <div className="payment-review-party-grid">
                <div className="payment-review-party">
                <UserCircle2 size={17} />
                <div><span>Cliente</span><strong>{previewCustomer}</strong><small>{previewCustomerPhone}</small>{(rncCedula || initialRnc) && <small>RNC/Cédula: {rncCedula || initialRnc}</small>}{(fiscalName || initialFiscalName) && <small>Razón social: {fiscalName || initialFiscalName}</small>}</div>
              </div>
              <div className="payment-review-party">
                <UserCheck size={17} />
                <div><span>Atendido por</span><strong>{previewWaiter || 'No informado'}</strong><small>{previewNotes ? `Nota general: ${previewNotes}` : 'Sin nota general'}</small></div>
              </div>
            </div>

            <div className="payment-review-lines">
              <div className="payment-review-section-title"><strong>Productos y detalles</strong><span>{previewLines.reduce((total, line) => total + line.quantity, 0)} artículo(s)</span></div>
              {previewLines.length ? previewLines.map((line, index) => (
                <div className="payment-review-line" key={`${line.id}-${index}`}>
                  <div><strong>{line.quantity}× {line.name}</strong>{line.variation && <small>Variante: {line.variation}</small>}{line.modifiers.length > 0 && <small>Suplementos: {line.modifiers.join(' · ')}</small>}{line.note && <small>Nota: {line.note}</small>}</div>
                  <b>{formatMoney(line.amount)}</b>
                </div>
              )) : <div className="payment-review-empty">El detalle de productos no está disponible todavía. El total seguirá siendo el confirmado por el servidor.</div>}
            </div>

            <div className="payment-review-totals">
              <div><span>Subtotal</span><b>{preBillMoney(summary.subtotal)}</b></div>
              {previewDeliveryFee > 0 && <div><span>Entrega</span><b>{formatMoney(previewDeliveryFee)}</b></div>}
              <div><span>Impuestos</span><b>{preBillMoney(summary.tax)}</b></div>
              {summary.tip !== null && summary.tip > 0 && <div><span>Propina legal</span><b>{formatMoney(summary.tip)}</b></div>}
              {previewCharges > 0 && <div><span>Cargos</span><b>{formatMoney(previewCharges)}</b></div>}
              {summary.discount !== null && summary.discount > 0 && <div><span>Descuento</span><b>-{formatMoney(summary.discount)}</b></div>}
              <div className="payment-review-grand-total"><span>Total confirmado</span><strong>{formatMoney(summary.total)}</strong></div>
              <div className="payment-review-paid"><span>Pagado {summary.paid > 0 ? 'hasta ahora' : ''}</span><b>{formatMoney(summary.paid)}</b><span>Pendiente</span><strong>{formatMoney(summary.due)}</strong></div>
            </div>

            <div className="payment-review-document">
              <FileText size={17} />
              <div><span>Comprobante seleccionado</span><strong>{receiptPreviewLabel(receiptType)}</strong><small>{(rncCedula || initialRnc) ? `Titular fiscal: ${fiscalName || initialFiscalName || 'Pendiente de confirmar'}` : 'Cliente final / datos fiscales no indicados'}</small></div>
            </div>
            <div className="payment-review-print">
              <Printer size={16} />
              <span>{printReceiptOnPay ? `Se imprimirá al confirmar${printer ? ` · ${printer.name}` : ''}` : 'No se imprimirá automáticamente'}</span>
            </div>
          </>
        )}
      </section>
      <div className="table-payment-due">
        <span>Saldo pendiente</span>
        <strong>{formatMoney(summary.due)}</strong>
      </div>
      {enabledMethods.length ? (
        <div className="table-payment-form">
          <label>
            Método
            <select value={selectedMethod} onChange={event => setMethod(event.target.value)}>
              {enabledMethods.map(value => <option value={value.code} key={value.code}>{value.label}</option>)}
            </select>
          </label>
          <label>
            Monto
            <input type="number" min="0.01" max={summary.due.toFixed(2)} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} />
          </label>
        </div>
      ) : (
        <Alert>No hay metodos de pago configurados en esta sucursal.</Alert>
      )}

      {/* Selector de Comprobante / Factura Fiscal exclusivo de caja */}
      <div style={{ margin: '14px 0', padding: '12px 14px', borderRadius: 10, background: 'var(--pos-bg-surface-elevated, #202428)', border: '1px solid var(--pos-border, rgba(255,255,255,0.08))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--pos-text-primary, #fff)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileText size={15} style={{ color: 'var(--color-pos-primary, #5EDBAC)' }} />
            {isElectronicActive ? 'Factura Electrónica (DGII / e-CF)' : isTraditionalActive ? 'Comprobante Fiscal (DGII / NCF)' : 'Documento fiscal no disponible'}
          </span>
          <button
            type="button"
            className="pos-category-chip"
            style={{ padding: '2px 8px', fontSize: '0.72rem', height: 'auto' }}
            onClick={() => setShowFiscalDetails(!showFiscalDetails)}
          >
            {showFiscalDetails ? 'Ocultar datos fiscales' : 'Editar RNC / Razón Social'}
          </button>
        </div>

        {/* Indicador de si el cliente lleva comprobante fiscal por RNC */}
        {rncCedula.trim() && (
          <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(94, 219, 172, 0.12)', border: '1px solid rgba(94, 219, 172, 0.3)', fontSize: '0.76rem', color: '#5EDBAC', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} />
            <span>Cliente con RNC detectado: Se asignó automáticamente <strong>Crédito Fiscal ({defaultCreditType})</strong>.</span>
          </div>
        )}

        <label style={{ display: 'block', fontSize: '0.82rem', marginBottom: 6 }}>
          <span style={{ color: 'var(--pos-text-secondary, #aaa)', display: 'block', marginBottom: 4 }}>
            Tipo de Comprobante ({isElectronicActive ? 'Modalidad Electrónica Lista' : isTraditionalActive ? 'Modalidad Tradicional Lista' : 'Fiscalidad no lista'}):
          </span>
          <select
            value={receiptType}
            onChange={e => {
              const val = e.target.value
              setReceiptType(val)
              if (val === 'E31' || val === 'B01') setShowFiscalDetails(true)
            }}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, background: 'var(--surface, #181a1d)', border: '1px solid var(--line, #333)', color: '#fff', fontSize: '0.84rem' }}
          >
            {isElectronicActive ? (
              <>
                <optgroup label="Factura Electrónica (e-CF) · Lista en esta sucursal">
                  <option value="E32">E32 - Consumo Electrónica (Consumidor Final)</option>
                  <option value="E31">E31 - Crédito Fiscal Electrónica</option>
                  <option value="E44">E44 - Régimen Especial Electrónico</option>
                  <option value="E45">E45 - Gubernamental Electrónico</option>
                </optgroup>
                {isTraditionalActive && <optgroup label="Comprobantes Tradicionales (NCF) · Listos">
                  <option value="B02">B02 - Factura de Consumo (Consumidor Final)</option>
                  <option value="B01">B01 - Factura de Crédito Fiscal</option>
                  <option value="B14">B14 - Régimen Especial</option>
                  <option value="B15">B15 - Gubernamental</option>
                </optgroup>}
              </>
            ) : isTraditionalActive ? (
              <>
                <optgroup label="Comprobantes Tradicionales (NCF) · Listos en esta sucursal">
                  <option value="B02">B02 - Factura de Consumo (Consumidor Final)</option>
                  <option value="B01">B01 - Factura de Crédito Fiscal</option>
                  <option value="B14">B14 - Régimen Especial</option>
                  <option value="B15">B15 - Gubernamental</option>
                </optgroup>
              </>
            ) : <option value="receipt">Recibo normal (fiscalidad no disponible en esta sucursal)</option>}
          </select>
        </label>

        {showFiscalDetails && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--pos-text-secondary, #aaa)', display: 'block', marginBottom: 3 }}>
                RNC o Cédula {(receiptType === 'E31' || receiptType === 'B01') && <span style={{ color: '#ff6b6b' }}>*</span>}
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  placeholder="Ej: 101000000 o 001-0000000-0"
                  value={rncCedula}
                  onChange={e => {
                    const nextVal = e.target.value
                    setRncCedula(nextVal)
                    setRncStatusMsg('')
                    if (nextVal.trim().length >= 9 && (receiptType === 'B02' || receiptType === 'E32')) {
                      setReceiptType(defaultCreditType)
                    }
                  }}
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 6, background: 'var(--surface, #181a1d)', border: '1px solid var(--line, #333)', color: '#fff', fontSize: '0.82rem' }}
                />
                <button
                  type="button"
                  className="button outline small"
                  style={{ padding: '6px 10px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                  disabled={searchingRnc || offline}
                  onClick={verifyRnc}
                >
                  {searchingRnc ? 'Verificando…' : 'Validar DGII'}
                </button>
              </div>
              {rncStatusMsg && (
                <small style={{ display: 'block', marginTop: 3, fontSize: '0.72rem', color: rncStatusMsg.startsWith('✓') ? '#16a34a' : '#ea580c' }}>
                  {rncStatusMsg}
                </small>
              )}
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--pos-text-secondary, #aaa)', display: 'block', marginBottom: 3 }}>
                Razón Social / Nombre Fiscal
              </label>
              <input
                type="text"
                placeholder="Nombre formal en DGII"
                value={fiscalName}
                onChange={e => setFiscalName(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, background: 'var(--surface, #181a1d)', border: '1px solid var(--line, #333)', color: '#fff', fontSize: '0.82rem' }}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ margin: '12px 0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface, #181a1d)', borderRadius: 10, border: '1px solid var(--line, #333)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: '#e2e8f0' }}>
          <Printer size={16} style={{ color: '#f97316' }} />
          <span>Imprimir ticket / comprobante al cobrar</span>
        </div>
        <input
          type="checkbox"
          checked={printReceiptOnPay}
          onChange={e => setPrintReceiptOnPay(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: '#f97316', cursor: 'pointer' }}
        />
      </div>

      <footer>
        <button className="button outline" onClick={onClose}>Cancelar</button>
        <button className="button outline" disabled={busy || loadingPreview || !cashSessionReady || !cashSessionOpen || !enabledMethods.length || summary.due <= 0} onClick={() => void charge(false)}>
          <CreditCard size={16} />{busy ? 'Registrando…' : 'Solo cobrar'}
        </button>
        <button className="button primary" disabled={busy || loadingPreview || !cashSessionReady || !cashSessionOpen || !enabledMethods.length || summary.due <= 0} onClick={() => void charge(true)} style={{ background: '#f97316', borderColor: '#f97316', color: '#fff' }}>
          <Printer size={16} />{busy ? 'Procesando…' : 'Cobrar e Imprimir'}
        </button>
      </footer>
    </section>
  )
}

function OrderPanel({ table, tables, quick, mobileDrawerOpen, isMenuOpen, roleKey, permissions, paymentMethods, fiscalCapabilities, canCharge, cashSessionOpen, cashSessionReady, offline, deliverySettings, deliveryExecutives, deliveryPlatforms = [], orderTypes = [], items, onClose, onOpenMenu, onSubmit, onSaveCustomer, onRemoveOrderItem, onPrintPreBill, onPayOrder, onTransferTable, onCancelOrder }: { table: RestaurantTable | null; tables?: RestaurantTable[]; quick: boolean; mobileDrawerOpen?: boolean; isMenuOpen?: boolean; roleKey: StaffRole; permissions: Record<string, boolean>; paymentMethods: PaymentMethodOption[]; fiscalCapabilities?: FiscalCapabilities | null; canCharge: boolean; cashSessionOpen: boolean; cashSessionReady: boolean; offline: boolean; deliverySettings: DeliverySettings | null; deliveryExecutives: DeliveryExecutive[]; deliveryPlatforms?: DeliveryPlatform[]; orderTypes?: OrderTypeConfig[]; items: MenuItem[]; onClose: () => void; onOpenMenu?: () => void; onSubmit: (lines: OrderLine[], table: RestaurantTable | null, draft: OrderDraft) => Promise<void>; onSaveCustomer: (table: RestaurantTable, name: string, customerId?: number, rncCedula?: string, fiscalName?: string) => Promise<void>; onRemoveOrderItem?: (orderId: number, orderItemId: number, itemName: string) => Promise<{ queued: boolean; message: string }>; onPrintPreBill: (orderId: number, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>; onPayOrder: (orderId: number, amount: number, method: string, idempotencyKey: string) => Promise<{ queued: boolean; message: string }>; onTransferTable?: (fromTable: RestaurantTable, targetTable: RestaurantTable) => Promise<{ queued: boolean; message: string }>; onCancelOrder?: (table: RestaurantTable, reason?: string) => Promise<{ queued: boolean; message: string }> }) {
  const canDelivery = roleKey === 'cajero' && permissions['orders.create'] === true
  const [mode, setMode] = useState<OrderMode>(table ? 'dine_in' : canDelivery ? 'pickup' : 'dine_in')
  const [orderTypeModalOpen, setOrderTypeModalOpen] = useState(false)
  const [selectedOrderTypeId, setSelectedOrderTypeId] = useState<number | undefined>(() => {
    const defaultType = orderTypes.find(t => t.slug === (table ? 'dine_in' : canDelivery ? 'pickup' : 'dine_in'))
    return defaultType?.id
  })
  const [selectedOrderTypeName, setSelectedOrderTypeName] = useState<string>(() => {
    const defaultType = orderTypes.find(t => t.slug === (table ? 'dine_in' : canDelivery ? 'pickup' : 'dine_in'))
    return translateOrderTypeName(defaultType?.slug, defaultType?.order_type_name || (table ? 'Comer aquí' : canDelivery ? 'Recogida' : 'Comer aquí'))
  })
  const [selectedDeliveryPlatformId, setSelectedDeliveryPlatformId] = useState<number | null | undefined>(null)
  const [selectedDeliveryAppName, setSelectedDeliveryAppName] = useState<string | undefined>(undefined)
  const [roomNumber, setRoomNumber] = useState<string>('')
  const [customerLat, setCustomerLat] = useState<number | undefined>(undefined)
  const [customerLng, setCustomerLng] = useState<number | undefined>(undefined)
  const [customerId, setCustomerId] = useState<number | undefined>(table?.customerId)
  const [customerName, setCustomerName] = useState(table?.customerName || '')
  const [customerPhone, setCustomerPhone] = useState(table?.customerPhone || '')
  const [customerEmail, setCustomerEmail] = useState('')
  const [rncCedula, setRncCedula] = useState(table?.customerRnc || '')
  const [fiscalName, setFiscalName] = useState(table?.customerFiscalName || '')
  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryTime, setDeliveryTime] = useState('')
  const defaultFee = deliverySettings?.fixed_fee != null
    ? Number(deliverySettings.fixed_fee)
    : (deliverySettings?.fee_tiers?.[0]?.fee ?? 150)
  const [deliveryFee, setDeliveryFee] = useState<string>(String(defaultFee))
  const [deliveryExecutiveId, setDeliveryExecutiveId] = useState('')
  const [lines, setLines] = useState<OrderLine[]>([])
  const [existingItems, setExistingItems] = useState<Array<{ id: number; name: string; quantity: number; amount?: number }>>(() => {
    if (!table?.currentOrderId) return []
    const cached = readCache()
    const detail = cached.orderDetails?.[String(table.currentOrderId)]
    const data = (detail as any)?.data ?? detail
    const items = extractOrderItems(data)
    if (Array.isArray(items) && items.length > 0) {
      return items.map((item: any) => {
        const quantity = Math.max(1, Number(item.quantity || 1))
        const amount = Number(item.amount ?? item.total ?? item.price ?? 0)
        return {
          id: Number(item.id || item.order_item_id || 1),
          name: String(item.name || item.menu_item_name || item.product_name || 'Producto'),
          quantity,
          amount: amount || Number(item.price || 0) * quantity
        }
      })
    }
    return []
  })
  const [orderDetail, setOrderDetail] = useState<any>(() => {
    if (!table?.currentOrderId) return null
    const cached = readCache()
    const detail = cached.orderDetails?.[String(table.currentOrderId)]
    return (detail as any)?.data ?? detail ?? null
  })
  const [loadingExistingOrder, setLoadingExistingOrder] = useState(() => Boolean(table?.currentOrderId))
  const [latestKotStatus, setLatestKotStatus] = useState('')
  const [lastSentSummary, setLastSentSummary] = useState('')
  const [selected, setSelected] = useState<MenuItem | null>(null)
  const [showMenu, setShowMenu] = useState(true)
  const [preBillOpen, setPreBillOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [flowOpen, setFlowOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
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
  const newLinesTotal = lines.reduce((sum, line) => sum + line.price * line.quantity + line.modifiers.reduce((s, m) => s + m.price, 0) * line.quantity, 0)
  // When there is an active order use the server total (subtotal before taxes).
  // Fall back to summing existingItems amounts, and finally to new-lines only.
  const existingSubtotal = (() => {
    const fromServer = orderDetail?.subtotal ?? orderDetail?.sub_total ?? orderDetail?.data?.subtotal ?? orderDetail?.data?.sub_total ?? orderDetail?.order?.subtotal ?? orderDetail?.order?.sub_total
    if (fromServer != null && Number(fromServer) > 0) return Number(fromServer)
    return existingItems.reduce((s, item) => s + (item.amount || 0), 0)
  })()
  const total = existingSubtotal > 0 ? existingSubtotal + newLinesTotal : newLinesTotal
  // When we have a real order total use those taxes directly; otherwise estimate.
  const serverTotal = (() => {
    const t = orderDetail?.total ?? orderDetail?.order_total ?? orderDetail?.data?.total ?? orderDetail?.order?.total
    if (t != null && Number(t) > 0) return Number(t) + newLinesTotal
    return null
  })()
  const estimatedItbis = Math.round(total * 0.18 * 100) / 100
  const estimatedTip = mode === 'dine_in' ? Math.round(total * 0.10 * 100) / 100 : 0
  const currentDeliveryFee = mode === 'delivery'
    ? (deliveryFee.trim() !== '' ? Number(deliveryFee) : (deliverySettings?.fixed_fee ?? 150))
    : 0
  const grandEstimatedTotal = serverTotal ?? (total + estimatedItbis + estimatedTip + currentDeliveryFee)
  const deliveryReady = mode !== 'delivery' || (Boolean(customerName.trim() && customerPhone.trim() && deliveryAddress.trim()) && (deliveryFee.trim() !== '' || deliverySettings?.fixed_fee != null || true))
  const tableReady = mode !== 'dine_in' || table !== null
  const activeElapsed = useElapsedSince(orderStartedAt(orderDetail))
  const activeOrderStatus = orderProgressLabel(latestKotStatus || orderDetail?.order_status || orderDetail?.status || orderDetail?.order?.status || table?.kitchenStatus || table?.currentOrderStatus)
  const paymentItems = extractOrderItems(orderDetail)
  const flowDestination = mode === 'dine_in'
    ? `Mesa ${table?.number || 'sin asignar'}`
    : mode === 'room_service'
      ? (roomNumber ? `Habitación ${roomNumber}` : 'Habitación no indicada')
      : mode === 'delivery'
        ? (deliveryAddress || 'Dirección no indicada')
        : 'Retiro en el local'
  // Keep the field aligned with the server when the floor refreshes the active order.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setCustomerName(table?.customerName || '')
    setCustomerId(table?.customerId)
    if (table?.customerPhone) setCustomerPhone(table.customerPhone)
  }, [table?.id, table?.currentOrderId, table?.customerName, table?.customerId, table?.customerPhone])
  // Load the existing order read-only so the waiter can distinguish previous lines from the new KOT.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    let cancelled = false
    setPreBillOpen(false)
    setFlowOpen(false)
    setLastSentSummary('')
    setPrintStatus('')
    setPrintIdempotencyKey('')
    setPrinting(false)
    if (!table?.currentOrderId) {
      setExistingItems([])
      setOrderDetail(null)
      setLoadingExistingOrder(false)
      return () => { cancelled = true }
    }
    setLoadingExistingOrder(true)
    const cached = readCache()
    const cachedDetail = cached.orderDetails?.[String(table.currentOrderId)]
    const cachedKots = cached.orderKots?.[String(table.currentOrderId)] || []
    if (cachedDetail) {
      const data = (cachedDetail as any)?.data ?? cachedDetail
      setOrderDetail(data)
      const values = extractOrderItems(data)
      if (values.length) {
        setExistingItems(values.map((item: any) => ({
          id: Number(item.id || item.order_item_id || 1),
          name: String(item.name || item.menu_item_name || item.product_name || 'Producto'),
          quantity: Math.max(1, Number(item.quantity || 1)),
          amount: Number(item.amount ?? item.total ?? item.price ?? 0)
        })))
      }
    }
    if (!navigator.onLine) {
      setLoadingExistingOrder(false)
      const latest = cachedKots.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]
      if (latest) setLastSentSummary(`${latest.items.map(item => `${item.quantity}× ${item.name}`).join(' · ') || 'Artículos sin detalle'}${latest.createdAt ? ` · ${new Date(latest.createdAt).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}` : ''}`)
      return () => { cancelled = true }
    }
    Promise.all([api.getOrder('pin', table.currentOrderId), api.orderKots('pin', table.currentOrderId)]).then(([orderPayload, kots]) => {
      if (cancelled) return
      const data = orderPayload?.data ?? orderPayload
      saveCache({
        orderDetails: { ...(readCache().orderDetails || {}), [String(table.currentOrderId)]: data },
        orderKots: { ...(readCache().orderKots || {}), [String(table.currentOrderId)]: kots }
      })
      setOrderDetail(data)
      const values = extractOrderItems(data)
      if (values.length) {
        setExistingItems(values.map((item: any) => {
          const quantity = Math.max(1, Number(item.quantity || 1))
          const amount = Number(item.amount ?? item.total ?? 0)
          return { id: Number(item.id || item.order_item_id || 1), name: String(item.name || item.menu_item_name || item.product_name || 'Producto'), quantity, amount: amount || Number(item.price || 0) * quantity }
        }))
      }
      const latest = kots.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]
      if (latest) {
        const summary = latest.items.map(item => `${item.quantity}× ${item.name}`).join(' · ')
        setLastSentSummary(`${summary || 'Artículos sin detalle'}${latest.createdAt ? ` · ${new Date(latest.createdAt).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}` : ''}`)
      }
    }).catch(() => {
      // Don't wipe existingItems on network error if we already had them from cache
    }).finally(() => {
      if (!cancelled) setLoadingExistingOrder(false)
    })
    return () => { cancelled = true }
  }, [table?.currentOrderId])
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
    const cust = orderDetail?.customer || orderDetail?.data?.customer
    const orderRnc = (cust?.rnc_cedula || cust?.rncCedula || orderDetail?.rnc_cedula || table?.customerRnc || '').trim()
    const orderFiscalName = (cust?.fiscal_name || cust?.fiscalName || orderDetail?.fiscal_name || table?.customerFiscalName || '').trim()
    const orderCustName = (cust?.name || orderDetail?.customer_name || table?.customerName || '').trim()
    const orderCustId = cust?.id ?? orderDetail?.customer_id ?? table?.customerId

    if (orderRnc) {
      setRncCedula(orderRnc)
    }
    if (orderFiscalName) {
      setFiscalName(orderFiscalName)
    }
    if (orderCustName && !customerName) {
      setCustomerName(orderCustName)
    }
    if (orderCustId && !customerId) {
      setCustomerId(Number(orderCustId))
    }

    // Sync order type, room service, delivery from order detail if available
    const oType = (orderDetail?.order_type || orderDetail?.orderType || '').toLowerCase()
    const customTypeName = orderDetail?.custom_order_type_name || orderDetail?.customOrderTypeName || ''
    const deliveryAddr = orderDetail?.delivery_address || orderDetail?.deliveryAddress || ''
    const delivFee = orderDetail?.delivery_fee ?? orderDetail?.deliveryFee
    const delivExecutive = orderDetail?.delivery_executive_id ?? orderDetail?.deliveryExecutiveId
    const oTypeId = orderDetail?.order_type_id ?? orderDetail?.orderTypeId
    const dAppId = orderDetail?.delivery_app_id ?? orderDetail?.deliveryAppId

    if (oType.includes('room') || customTypeName.toLowerCase().includes('habitación') || customTypeName.toLowerCase().includes('habitacion') || deliveryAddr.toLowerCase().includes('habitación') || deliveryAddr.toLowerCase().includes('habitacion')) {
      setMode('room_service')
      const roomMatch = (customTypeName + ' ' + deliveryAddr).match(/(\d+)/)
      if (roomMatch && !roomNumber) {
        setRoomNumber(roomMatch[1])
      }
    } else if (oType.includes('delivery') || delivFee != null || dAppId != null) {
      setMode('delivery')
      if (delivFee != null) setDeliveryFee(String(delivFee))
      if (deliveryAddr && !deliveryAddress) setDeliveryAddress(deliveryAddr)
      if (delivExecutive) setDeliveryExecutiveId(String(delivExecutive))
      if (dAppId) setSelectedDeliveryPlatformId(Number(dAppId))
      if (customTypeName && !selectedDeliveryAppName) setSelectedDeliveryAppName(customTypeName)
    } else if (oType.includes('pickup') || oType.includes('recogida') || oType.includes('takeaway')) {
      setMode('pickup')
    }

    if (oTypeId) {
      setSelectedOrderTypeId(Number(oTypeId))
      const matched = orderTypes.find(t => t.id === Number(oTypeId))
      if (matched) {
        setSelectedOrderTypeName(translateOrderTypeName(matched.slug, matched.order_type_name))
      }
    }

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
  }, [orderDetail, table?.customerRnc, table?.customerFiscalName, table?.customerName, table?.customerId, customerName, customerId, orderTypes])

  // Auto-resolve customer RNC if customer is known but RNC not yet populated
  useEffect(() => {
    let active = true
    const searchTarget = (customerName || table?.customerName || '').trim()
    if (!rncCedula && searchTarget && !offline) {
      api.customers('pin', searchTarget)
        .then(results => {
          if (!active) return
          const matchWithRnc = results.find(c =>
            (c.rncCedula && c.rncCedula.trim().length >= 9) &&
            (c.name?.toLowerCase().trim() === searchTarget.toLowerCase().trim() || (customerId && c.id === customerId))
          )
          if (matchWithRnc && matchWithRnc.rncCedula) {
            setRncCedula(matchWithRnc.rncCedula)
            if (matchWithRnc.fiscalName) setFiscalName(matchWithRnc.fiscalName)
            if (!customerId && matchWithRnc.id) setCustomerId(matchWithRnc.id)
          }
        })
        .catch(() => undefined)
    }
    return () => { active = false }
  }, [customerName, customerId, rncCedula, table?.customerName, offline])
  useEffect(() => {
    const handleQuickAdd = (e: any) => {
      const item = e.detail
      if (!item) return
      triggerAddLine({
        clientId: crypto.randomUUID(),
        itemId: item.id,
        name: item.name,
        price: item.price,
        quantity: 1,
        modifiers: []
      })
    }
    const handleCustomize = (e: any) => {
      const item = e.detail
      if (!item) return
      setSelected(item)
    }
    window.addEventListener('restapp:quick-add-item', handleQuickAdd)
    window.addEventListener('restapp:customize-item', handleCustomize)
    return () => {
      window.removeEventListener('restapp:quick-add-item', handleQuickAdd)
      window.removeEventListener('restapp:customize-item', handleCustomize)
    }
  }, [])

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
        orderTypeId: selectedOrderTypeId,
        deliveryPlatformId: selectedDeliveryPlatformId,
        deliveryAppName: selectedDeliveryAppName,
        roomNumber: roomNumber.trim() || undefined,
        customerLat,
        customerLng,
        existingOrderId: mode === 'dine_in' ? table?.currentOrderId : undefined,
        customerId,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        rncCedula: rncCedula.trim() || undefined,
        fiscalName: fiscalName.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        deliveryTime: deliveryTime || undefined,
        deliveryFee: mode === 'delivery' ? currentDeliveryFee : undefined,
        deliveryExecutiveId: deliveryExecutiveId ? Number(deliveryExecutiveId) : undefined,
      })
      setLines([])
      setConfirmKotOpen(false)
      // Reload existingItems from cache immediately so the sent items appear
      // in the "Enviados a cocina" section without waiting for hydrate().
      const orderId = table?.currentOrderId
      if (orderId) {
        const cached = readCache()
        const cachedDetail = cached.orderDetails?.[String(orderId)]
        if (cachedDetail) {
          const data = (cachedDetail as any)?.data ?? cachedDetail
          setOrderDetail(data)
          const values = Array.isArray((data as any)?.items) ? (data as any).items : []
          setExistingItems(values.map((item: any) => {
            const quantity = Math.max(1, Number(item.quantity || 1))
            const amount = Number(item.amount ?? item.total ?? 0)
            return { id: Number(item.id || item.order_item_id), name: String(item.name || item.menu_item_name || 'Producto'), quantity, amount: amount || Number(item.price || 0) * quantity }
          }).filter((item: any) => item.id > 0 || item.name))
        }
      }
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
  return (
    <>
      <section className={`pos-order-drawer ${mobileDrawerOpen !== false ? 'is-open' : ''}`} style={{ height: '100%' }}>
        {/* Drawer Header matching POS Layout */}
        <header className="pos-drawer-header">
          <div className="pos-drawer-title-row">
            <div className="pos-drawer-title">
              <span>{table ? `Mesa ${table.number}` : mode === 'delivery' ? 'Entrega' : 'Venta Rápida'}</span>
              <span className="pos-order-badge">
                {table?.currentOrderNumber ? `#${table.currentOrderNumber}` : table?.currentOrderId ? `#${table.currentOrderId}` : '#NUEVA'}
              </span>
            </div>
            <button
              type="button"
              className="pos-drawer-close-btn"
              onClick={onClose}
              aria-label="Cerrar comanda"
            >
              <X size={18} />
            </button>
          </div>

          <div className="pos-drawer-info-strip">
            <button
              type="button"
              className="pos-drawer-customer-chip"
              onClick={() => setOrderTypeModalOpen(true)}
              title="Pulsar para cambiar tipo de servicio (habitación, entrega, comer aquí)"
              style={{
                background: mode === 'room_service' ? 'rgba(234, 88, 12, 0.15)' : mode === 'delivery' ? 'rgba(96, 165, 250, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                border: mode === 'room_service' ? '1px solid rgba(234, 88, 12, 0.4)' : mode === 'delivery' ? '1px solid rgba(96, 165, 250, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                padding: '2px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                color: mode === 'room_service' ? '#fb923c' : mode === 'delivery' ? '#60a5fa' : mode === 'pickup' ? '#c084fc' : '#5EDBAC',
                fontWeight: 600,
                fontSize: '0.8rem',
                maxWidth: '48%',
                textAlign: 'left'
              }}
            >
              {mode === 'room_service' ? <Hotel size={13} style={{ color: '#fb923c', flexShrink: 0 }} /> :
               mode === 'delivery' ? <Truck size={13} style={{ color: '#60a5fa', flexShrink: 0 }} /> :
               mode === 'pickup' ? <ShoppingBag size={13} style={{ color: '#c084fc', flexShrink: 0 }} /> :
               <Utensils size={13} style={{ color: '#5EDBAC', flexShrink: 0 }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {mode === 'room_service'
                  ? (roomNumber ? `Hab. ${roomNumber}` : 'Habitación')
                  : mode === 'delivery'
                  ? (selectedDeliveryAppName ? `Entrega (${selectedDeliveryAppName})` : 'Entrega')
                  : selectedOrderTypeName || (mode === 'pickup' ? 'Recogida' : 'Comer aquí')}
              </span>
              <Edit3 size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
            </button>
            <span style={{ color: 'var(--pos-bg-surface-elevated)' }}>|</span>
            <button
              type="button"
              className="pos-drawer-customer-chip"
              onClick={() => setCustomerModalOpen(true)}
              title="Pulsar para cambiar o actualizar cliente"
              style={{
                background: 'transparent',
                border: 'none',
                padding: '2px 6px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                color: customerName.trim() ? '#5EDBAC' : 'var(--pos-text-secondary)',
                fontWeight: 600,
                fontSize: '0.8rem',
                maxWidth: '38%',
                textAlign: 'left'
              }}
            >
              <UserCircle2 size={14} style={{ flexShrink: 0, color: customerName.trim() ? '#5EDBAC' : 'var(--color-pos-primary)' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {customerName.trim() || 'Cliente'}
              </span>
              <Edit3 size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
            </button>
            <span style={{ color: 'var(--pos-bg-surface-elevated)' }}>|</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={14} style={{ color: 'var(--color-pos-primary)' }} />
              <span>{activeElapsed || 'Reciente'}</span>
            </span>
          </div>

          {/* Quick Actions (Precuenta, Cobrar, Mover mesa) */}
          {table?.currentOrderId && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button
                type="button"
                className="pos-category-chip"
                style={{ padding: '0.45rem 0.75rem', fontSize: '0.78rem', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                onClick={() => { setPaymentOpen(false); setPreBillOpen(true) }}
                title="Ver e imprimir precuenta sin cobrar"
              >
                <Receipt size={14} />
                <span>Precuenta</span>
              </button>
              {canCharge && (
                <button
                  type="button"
                  className="pos-category-chip active"
                  style={{ padding: '0.45rem 0.75rem', fontSize: '0.78rem', flex: 1.2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'var(--color-pos-primary)', color: '#fff' }}
                  onClick={() => { setPreBillOpen(false); setPaymentOpen(true) }}
                  title="Cobrar orden de la mesa"
                >
                  <CreditCard size={14} />
                  <span>Cobrar</span>
                </button>
              )}
              {mode === 'dine_in' && (
                <button
                  type="button"
                  className="pos-category-chip"
                  style={{ padding: '0.45rem 0.65rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={() => setTransferOpen(true)}
                  title="Mover comanda a otra mesa"
                >
                  <ArrowRightLeft size={14} />
                </button>
              )}
              {onCancelOrder && permissions['orders.update'] && (
                <button
                  type="button"
                  className="pos-category-chip"
                  style={{ padding: '0.45rem 0.65rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff6b6b', borderColor: 'rgba(255, 107, 107, 0.3)' }}
                  onClick={() => setCancelModalOpen(true)}
                  title="Cancelar comanda de la mesa"
                >
                  <XCircle size={14} />
                </button>
              )}
            </div>
          )}

          {table?.currentOrderId && (
            <button type="button" className="pos-flow-control" onClick={() => setFlowOpen(true)} title="Ver el paso a paso de esta orden">
              <span className="pos-flow-control-icon"><ClipboardList size={15} /></span>
              <span className="pos-flow-control-copy"><strong>Ver paso a paso</strong><small>{activeOrderStatus}</small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          {/* Botón destacado "+ Agregar platos" (visible si no estamos ya en el catálogo) */}
          {onOpenMenu && !isMenuOpen && (
            <button
              type="button"
              className="pos-category-chip"
              style={{
                marginTop: 6,
                padding: '0.5rem 0.8rem',
                fontSize: '0.8rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                background: 'rgba(94, 219, 172, 0.12)',
                borderColor: 'rgba(94, 219, 172, 0.4)',
                color: '#5EDBAC',
                width: '100%'
              }}
              onClick={onOpenMenu}
              title="Abrir catálogo para agregar más platos a la comanda"
            >
              <Plus size={15} />
              <span>+ Agregar platos del menú</span>
            </button>
          )}
        </header>

        <div className="pos-order-items-list">
          {localError && <Alert>{localError}</Alert>}

          {/* Artículos ya enviados a cocina */}
          {existingItems.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--pos-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Enviados a cocina ({existingItems.length})
              </div>
              {existingItems.map(item => (
                <div key={item.id} className="pos-order-item-card is-sent">
                  <div className="pos-order-item-top">
                    <div className="pos-order-item-title">
                      <span style={{ color: 'var(--color-pos-primary)', fontWeight: 800 }}>{item.quantity}×</span> {item.name}
                    </div>
                    <div className="pos-order-item-right">
                      <span className="pos-order-item-price">
                        {item.amount ? formatMoney(item.amount) : 'Confirmado'}
                      </span>
                      {permissions['orders.update'] && (
                        <button
                          type="button"
                          className="pos-item-remove-btn"
                          disabled={removingItemId !== null}
                          onClick={() => void removeItem(item)}
                          title="Quitar este plato de la orden activa"
                          aria-label="Quitar plato"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Artículos Nuevos / Borrador */}
          {lines.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#5EDBAC', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Artículos nuevos ({lines.reduce((s, l) => s + l.quantity, 0)})
              </div>
              {lines.map(line => (
                <div key={line.clientId} className="pos-order-item-card">
                  <div className="pos-order-item-top">
                    <div className="pos-order-item-title">{line.name}</div>
                    <div className="pos-order-item-right">
                      <span className="pos-order-item-price">{formatMoney(line.price * line.quantity)}</span>
                      <button
                        type="button"
                        className="pos-item-remove-btn"
                        onClick={() => removeDraftLine(line.clientId)}
                        title="Eliminar plato de la comanda"
                        aria-label="Eliminar plato"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="pos-order-item-bottom">
                    <button
                      type="button"
                      className="pos-modifier-pill"
                      onClick={() => {
                        const itemFound = items.find(i => i.id === line.itemId)
                        if (itemFound) setSelected(itemFound)
                      }}
                    >
                      <Edit3 size={11} />
                      <span>{line.note || (line.modifiers.length ? line.modifiers.map(m => m.name).join(', ') : 'Nota')}</span>
                    </button>
                    <div className="pos-stepper-control">
                      <button
                        type="button"
                        className="pos-stepper-btn"
                        onClick={() => updateLineQuantity(line.clientId, -1)}
                        aria-label="Restar"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="pos-stepper-val">{line.quantity}</span>
                      <button
                        type="button"
                        className="pos-stepper-btn"
                        onClick={() => updateLineQuantity(line.clientId, 1)}
                        aria-label="Sumar"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!lines.length && !existingItems.length && loadingExistingOrder && (
            <div className="empty compact" style={{ padding: '2.5rem 1rem', background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Clock size={32} style={{ color: 'var(--color-pos-primary)', animation: 'spin 1.5s linear infinite' }} />
              <p style={{ color: 'var(--pos-text-secondary)', fontSize: '0.85rem', margin: 0, textAlign: 'center' }}>
                Cargando comanda activa…
              </p>
            </div>
          )}

          {!lines.length && !existingItems.length && !loadingExistingOrder && (
            <div className="empty compact" style={{ padding: '2.5rem 1rem', background: 'transparent', borderColor: 'var(--pos-bg-surface-elevated)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <ClipboardList size={36} style={{ color: 'var(--pos-text-tertiary)' }} />
              <p style={{ color: 'var(--pos-text-secondary)', fontSize: '0.85rem', margin: 0, textAlign: 'center' }}>
                La comanda está vacía. Seleccione platos del catálogo para armar la orden.
              </p>
              {onOpenMenu && (
                <button
                  type="button"
                  className="pos-btn-primary"
                  style={{ padding: '0.65rem 1.2rem', fontSize: '0.85rem', borderRadius: 9999, width: 'auto', marginTop: 4 }}
                  onClick={onOpenMenu}
                >
                  <Plus size={16} /> Ver menú y agregar platos
                </button>
              )}
            </div>
          )}
        </div>

        {/* Drawer Footer Resumen & CTA */}
        <footer className="pos-drawer-footer">
          <div className="pos-summary-lines">
            {existingSubtotal > 0 && newLinesTotal > 0 && (
              <div className="pos-summary-row" style={{ opacity: 0.7, fontSize: '0.78rem' }}>
                <span>Enviados a cocina</span>
                <span>{formatMoney(existingSubtotal)}</span>
              </div>
            )}
            {newLinesTotal > 0 && existingSubtotal > 0 && (
              <div className="pos-summary-row" style={{ opacity: 0.7, fontSize: '0.78rem' }}>
                <span>Nuevos artículos</span>
                <span>{formatMoney(newLinesTotal)}</span>
              </div>
            )}
            <div className="pos-summary-row">
              <span>Subtotal</span>
              <span>{formatMoney(total)}</span>
            </div>
            <div className="pos-summary-row">
              <span>ITBIS (18%)</span>
              <span>{formatMoney(estimatedItbis)}</span>
            </div>
            {estimatedTip > 0 && (
              <div className="pos-summary-row">
                <span>Propina legal (10%)</span>
                <span>{formatMoney(estimatedTip)}</span>
              </div>
            )}
            {mode === 'delivery' && currentDeliveryFee > 0 && (
              <div className="pos-summary-row" style={{ color: '#60a5fa', fontWeight: 600 }}>
                <span>Costo de Envío</span>
                <span>{formatMoney(currentDeliveryFee)}</span>
              </div>
            )}
          </div>

          <div className="pos-summary-total-box">
            <span className="pos-summary-total-label">TOTAL</span>
            <span className="pos-summary-total-value">{formatMoney(grandEstimatedTotal)}</span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {lines.length > 0 && table && mode === 'dine_in' && (
              <button
                type="button"
                className="pos-category-chip"
                style={{ height: 50, padding: '0 1rem', display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => setSplitOpen(true)}
                title="Dividir cuenta"
              >
                <Divide size={16} />
              </button>
            )}
            <button
              type="button"
              className="pos-btn-primary"
              disabled={!lines.length || submitting || !deliveryReady || !tableReady}
              onClick={() => setConfirmKotOpen(true)}
            >
              <Send size={18} />
              <span>{submitting ? 'ENVIANDO…' : 'ENVIAR A COCINA'}</span>
            </button>
          </div>
        </footer>
        {confirmKotOpen && (
          <div className="modal-backdrop" onClick={() => setConfirmKotOpen(false)}>
            <section className="modal confirm-kot-modal" onClick={e => e.stopPropagation()}>
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
        )}
        {preBillOpen && table?.currentOrderId && (
          <div className="modal-backdrop" onClick={() => setPreBillOpen(false)}>
            <div onClick={e => e.stopPropagation()} style={{ width: 'min(520px, 100%)' }}>
              <PreBillPanel
                table={table}
                payload={orderDetail}
                items={existingItems}
                onClose={() => setPreBillOpen(false)}
                onAddMore={() => {
                  setPreBillOpen(false)
                  if (onOpenMenu) onOpenMenu()
                }}
                onPrint={printPreBill}
                printing={printing}
                printStatus={printStatus}
              />
            </div>
          </div>
        )}
        {paymentOpen && table?.currentOrderId && canCharge && (
          <div className="modal-backdrop" onClick={() => setPaymentOpen(false)}>
            <div className="payment-dialog-shell" onClick={e => e.stopPropagation()}>
              <TablePaymentPanel
                table={table}
                payload={orderDetail}
                items={paymentItems.length ? paymentItems : existingItems}
                paymentMethods={paymentMethods}
                fiscalCapabilities={fiscalCapabilities}
                cashSessionOpen={cashSessionOpen}
                cashSessionReady={cashSessionReady}
                offline={offline}
                customerRnc={rncCedula || table.customerRnc}
                customerFiscalName={fiscalName || table.customerFiscalName}
                customerName={customerName || table.customerName}
                customerId={customerId || table.customerId}
                loadingPreview={loadingExistingOrder && !orderDetail}
                onClose={() => setPaymentOpen(false)}
                onPay={onPayOrder}
                onSaveCustomer={onSaveCustomer}
              />
            </div>
          </div>
        )}
        {flowOpen && table?.currentOrderId && (
          <OrderFlowPanel
            mode={mode}
            status={activeOrderStatus}
            hasOrder={Boolean(table.currentOrderId)}
            amountDue={Number(table.currentOrderDue ?? table.currentOrderTotal ?? 0)}
            orderNumber={table.currentOrderNumber || table.currentOrderId}
            destination={flowDestination}
            onClose={() => setFlowOpen(false)}
          />
        )}
        {selected && (
          <ModifierModal
            item={selected}
            seatCount={mode === 'dine_in' && table ? table.capacity : undefined}
            onClose={() => setSelected(null)}
            onAdd={line => { triggerAddLine(line); setSelected(null) }}
          />
        )}
        {splitOpen && table && mode === 'dine_in' && (
          <SplitBill lines={lines} table={table} onClose={() => setSplitOpen(false)} />
        )}
        {transferOpen && table && mode === 'dine_in' && (
          <TransferTableModal
            currentTable={table}
            tables={tables || []}
            onClose={() => setTransferOpen(false)}
            onTransfer={async targetTable => {
              if (!onTransferTable) return
              setTransferring(true)
              try {
                const res = await onTransferTable(table, targetTable)
                setLocalError(res.message)
                setTransferOpen(false)
                onClose()
              } catch (err) {
                setLocalError(normalizeError(err, 'No se pudo mover la orden de mesa.'))
              } finally {
                setTransferring(false)
              }
            }}
            busy={transferring}
          />
        )}
        {customerModalOpen && (
          <CustomerModal
            currentCustomer={{ id: customerId, name: customerName, phone: customerPhone, email: customerEmail, rncCedula, fiscalName }}
            canManageFiscal={roleKey === 'cajero' || roleKey === 'head' || permissions['payments.charge'] === true}
            fiscalCapabilities={fiscalCapabilities}
            offline={offline}
            onClose={() => setCustomerModalOpen(false)}
            onSelect={customer => {
              setCustomerId(customer.id > 0 ? customer.id : undefined)
              setCustomerName(customer.name || '')
              if (customer.phone) setCustomerPhone(customer.phone)
              if (customer.email) setCustomerEmail(customer.email)
              if (customer.deliveryAddress && !deliveryAddress) setDeliveryAddress(customer.deliveryAddress)
              if (customer.rncCedula) setRncCedula(customer.rncCedula)
              if (customer.fiscalName) setFiscalName(customer.fiscalName)
              setCustomerModalOpen(false)
              if (table?.currentOrderId) {
                void onSaveCustomer(table, customer.name, customer.id > 0 ? customer.id : undefined, customer.rncCedula, customer.fiscalName).catch(() => undefined)
              }
            }}
          />
        )}
        <OrderTypeModal
          isOpen={orderTypeModalOpen}
          onClose={() => setOrderTypeModalOpen(false)}
          onSelect={sel => {
            setMode(sel.mode)
            setSelectedOrderTypeId(sel.orderTypeId)
            setSelectedOrderTypeName(sel.orderTypeName)
            setSelectedDeliveryPlatformId(sel.deliveryPlatformId)
            setSelectedDeliveryAppName(sel.deliveryAppName)
            if (sel.roomNumber !== undefined) setRoomNumber(sel.roomNumber)
            if (sel.deliveryExecutiveId !== undefined) setDeliveryExecutiveId(String(sel.deliveryExecutiveId))
            if (sel.deliveryAddress !== undefined) setDeliveryAddress(sel.deliveryAddress)
            if (sel.deliveryFee !== undefined) setDeliveryFee(String(sel.deliveryFee))
            if (sel.customerLat !== undefined) setCustomerLat(sel.customerLat)
            if (sel.customerLng !== undefined) setCustomerLng(sel.customerLng)
          }}
          currentSelection={{
            mode,
            orderTypeId: selectedOrderTypeId,
            orderTypeName: selectedOrderTypeName,
            deliveryPlatformId: selectedDeliveryPlatformId,
            deliveryAppName: selectedDeliveryAppName,
            roomNumber,
            deliveryExecutiveId: deliveryExecutiveId ? Number(deliveryExecutiveId) : undefined,
            deliveryAddress,
            deliveryFee: currentDeliveryFee,
            customerLat,
            customerLng,
          }}
          orderTypes={orderTypes}
          deliveryPlatforms={deliveryPlatforms}
          deliveryExecutives={deliveryExecutives}
          deliverySettings={deliverySettings}
        />
        {cancelModalOpen && table?.currentOrderId && (
          <div className="modal-backdrop" onClick={() => !cancelling && setCancelModalOpen(false)}>
            <section className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
              <header>
                <div>
                  <p className="eyebrow" style={{ color: '#ff6b6b' }}>CANCELAR ORDEN</p>
                  <h2>Mesa {table.number}</h2>
                  <small>Esta acción cancelará la orden #{table.currentOrderNumber || table.currentOrderId} y liberará la mesa inmediatamente.</small>
                </div>
                <button className="icon-button" onClick={() => setCancelModalOpen(false)} disabled={cancelling}><X size={18} /></button>
              </header>
              <div className="modal-content" style={{ gap: 12 }}>
                <label>
                  <span>Motivo de cancelación (opcional)</span>
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    placeholder="Ej. Cliente se retiró, error al ordenar..."
                    disabled={cancelling}
                  />
                </label>
                <p className="muted" style={{ fontSize: 13, color: '#ff8a65' }}>
                  Atención: Los artículos enviados a cocina se marcarán como cancelados en el sistema y la mesa quedará libre para nuevos clientes.
                </p>
              </div>
              <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="button outline" onClick={() => setCancelModalOpen(false)} disabled={cancelling}>
                  Atrás
                </button>
                <button
                  type="button"
                  className="button"
                  style={{ background: '#e53935', color: '#fff', borderColor: '#e53935' }}
                  disabled={cancelling}
                  onClick={async () => {
                    if (!onCancelOrder || !table) return
                    setCancelling(true)
                    try {
                      const res = await onCancelOrder(table, cancelReason)
                      setCancelModalOpen(false)
                      setCancelReason('')
                      setExistingItems([])
                      setOrderDetail(null)
                      onClose()
                    } catch (err) {
                      setLocalError(normalizeError(err, 'No se pudo cancelar la orden.'))
                    } finally {
                      setCancelling(false)
                    }
                  }}
                >
                  <Trash2 size={16} />
                  {cancelling ? 'Cancelando…' : 'Confirmar cancelación'}
                </button>
              </footer>
            </section>
          </div>
        )}
      </section>
    </>
  )

}

function TransferTableModal({ currentTable, tables, onClose, onTransfer, busy }: { currentTable: RestaurantTable; tables: RestaurantTable[]; onClose: () => void; onTransfer: (targetTable: RestaurantTable) => void; busy?: boolean }) {
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null)
  const [confirmStep, setConfirmStep] = useState(false)
  const availableTables = useMemo(() => {
    return tables.filter(t => t.id !== currentTable.id && (t.status === 'available' || !t.currentOrderId))
  }, [tables, currentTable.id])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <header>
          <div>
            <p className="eyebrow" style={{ color: confirmStep ? '#ff8a65' : undefined }}>
              {confirmStep ? 'CONFIRMAR TRASLADO' : 'REASIGNAR MESA'}
            </p>
            <h2>{confirmStep ? `¿Mover a Mesa ${selectedTable?.number}?` : 'Mover comanda'}</h2>
            <small>
              {confirmStep
                ? `Paso 2 de 2: Confirme que desea trasladar la orden activa de la Mesa ${currentTable.number} a la Mesa ${selectedTable?.number}.`
                : `Paso 1 de 2: Seleccione la mesa disponible a donde transferir la comanda de la Mesa ${currentTable.number}.`}
            </small>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>

        <div className="modal-content">
          {!confirmStep ? (
            <>
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
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', background: 'rgba(255, 255, 255, 0.04)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--pos-text-secondary)', display: 'block' }}>ORIGEN</span>
                  <strong style={{ fontSize: '1.25rem', color: '#ff8a65' }}>Mesa {currentTable.number}</strong>
                  {currentTable.customerName && <small style={{ display: 'block', color: 'var(--pos-text-secondary)' }}>{currentTable.customerName}</small>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#5EDBAC' }}>
                  <ArrowRightLeft size={24} />
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, marginTop: 4 }}>TRASLADAR</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--pos-text-secondary)', display: 'block' }}>DESTINO</span>
                  <strong style={{ fontSize: '1.25rem', color: '#5EDBAC' }}>Mesa {selectedTable?.number}</strong>
                  <small style={{ display: 'block', color: 'var(--pos-text-secondary)' }}>{selectedTable?.capacity} sillas</small>
                </div>
              </div>
              <p style={{ fontSize: 13, color: 'var(--pos-text-secondary)', margin: 0 }}>
                La comanda activa, los productos enviados a cocina y el cliente asignado se reubicarán a la Mesa {selectedTable?.number}. La Mesa {currentTable.number} quedará disponible inmediatamente.
              </p>
            </div>
          )}
        </div>

        <footer>
          {!confirmStep ? (
            <>
              <button type="button" className="button outline" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button
                type="button"
                className="button primary"
                disabled={!selectedTable || busy}
                onClick={() => setConfirmStep(true)}
              >
                <span>Continuar</span>
                <ArrowRightLeft size={15} />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button outline" onClick={() => setConfirmStep(false)} disabled={busy}>
                Cambiar mesa
              </button>
              <button
                type="button"
                className="button primary"
                disabled={!selectedTable || busy}
                onClick={() => selectedTable && onTransfer(selectedTable)}
              >
                <Check size={16} />
                {busy ? 'Moviendo…' : `Sí, confirmar cambio a Mesa ${selectedTable?.number}`}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}

function ProductPhoto({ item, compact = false }: { item: MenuItem; compact?: boolean }) {
  const [failed, setFailed] = useState(false)
  return <div className={`product-photo ${compact ? 'compact' : ''}`} aria-label={`Imagen de ${item.name}`}>{item.imageUrl && !failed ? <img src={item.imageUrl} alt={`Fotografía de ${item.name}`} loading="lazy" onError={() => setFailed(true)} /> : <div className="product-photo-empty"><span>Sin fotografía publicada</span><small>{item.imageUrl ? 'No fue posible cargar la imagen' : 'El propietario debe cargarla en el catálogo'}</small></div>}</div>
}

function TableVisual({ table, isCalling = false }: { table: RestaurantTable; isCalling?: boolean }) {
  const chairCount = Math.max(1, Math.min(Math.round(table.capacity) || 2, 12))
  return (
    <div
      className={`table-visual ${isCalling ? 'is-calling-table' : ''}`}
      aria-label={`${table.number}: ${statusLabels[table.status]} · ${chairCount} sillas${isCalling ? ' · ¡Llamando al mesero!' : ''}`}
    >
      {Array.from({ length: chairCount }, (_, index) => (
        <span className="table-chair" key={index} style={chairStyle(index, chairCount)} aria-hidden="true" />
      ))}
      <span className="table-top" aria-hidden="true">
        <i />
      </span>
    </div>
  )
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
    const list = menuCategoryNames(items)
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
              <span>{cat === 'Todos' ? 'Todos los productos' : cat}</span>
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
                <small className="product-category-label">{item.categoryName}</small>
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
  const [groups, setGroups] = useState<ModifierGroup[]>(normalizeModifiers(item.modifiers));
  const [variations, setVariations] = useState<ProductVariation[]>(Array.isArray(item.variations) ? item.variations : []);
  const [selectedVariation, setSelectedVariation] = useState<ProductVariation | null>(null);
  const [selected, setSelected] = useState<Record<number, ModifierOption[]>>({});
  const [seat, setSeat] = useState<OrderLine['seatNumber']>();
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchModifiers = !groups.length && item.modifiers === undefined;
    const fetchVars = !variations.length && item.variations === undefined;
    if (fetchModifiers || fetchVars) {
      setLoading(true);
      Promise.all([
        fetchModifiers ? api.modifierGroups('pin', item.id).catch(() => []) : Promise.resolve(null),
        fetchVars ? api.itemVariations('pin', item.id).catch(() => []) : Promise.resolve(null),
      ]).then(([mods, vars]) => {
        if (cancelled) return;
        if (mods) setGroups(normalizeModifiers(mods));
        if (vars && Array.isArray(vars) && vars.length > 0) {
          setVariations(vars);
          setSelectedVariation(vars[0]);
        }
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    } else if (variations.length > 0 && !selectedVariation) {
      setSelectedVariation(variations[0]);
    }
    return () => { cancelled = true; };
  }, [item.id, item.modifiers, item.variations, groups.length, variations, selectedVariation]);


  const basePrice = selectedVariation?.price ?? item.price;
  const modifiersTotal = groups.flatMap(group => (selected[group.id] || []).map(option => option.price)).reduce((sum, p) => sum + p, 0);
  const unitPrice = basePrice + modifiersTotal;

  const valid = groups.every(group => !group.required || (selected[group.id]?.length || 0) >= group.minSelect);

  function toggle(group: ModifierGroup, option: ModifierOption) {
    setSelected(prev => {
      const current = prev[group.id] || [];
      const has = current.some(value => value.id === option.id);
      const next = has ? current.filter(value => value.id !== option.id) : group.maxSelect === 1 ? [option] : current.length < group.maxSelect ? [...current, option] : current;
      return { ...prev, [group.id]: next };
    });
  }

  const modifiers = groups.flatMap(group => (selected[group.id] || []).map(option => ({ id: option.id, name: option.name, price: option.price, groupId: group.id })));
  const seats = seatCount ? Array.from({ length: Math.max(1, Math.min(Math.round(seatCount), 12)) }, (_, index) => index + 1) : [];

  return (
    <div className="modal-backdrop">
      <section className="modal">
        <header>
          <div>
            <p className="eyebrow">PERSONALIZAR</p>
            <h2>{item.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </header>
        <p className="price">
          {formatMoney(unitPrice)}
          {selectedVariation && <span style={{ fontSize: '0.85rem', color: 'var(--pos-text-secondary)', marginLeft: 8 }}>({selectedVariation.name})</span>}
        </p>
        <div className="modal-content">
          {seatCount ? (
            <label>Asiento · opcional
              <select aria-label="Asiento · opcional" value={seat === undefined ? '' : String(seat)} onChange={e => setSeat(e.target.value === 'shared' ? e.target.value : e.target.value === '' ? undefined : Number(e.target.value))}>
                <option value="">Sin asignar</option>
                {seats.map(value => <option key={value} value={value}>Silla {value}</option>)}
                <option value="shared">Compartir</option>
              </select>
            </label>
          ) : null}
          {loading && <p className="muted">Cargando opciones…</p>}
          {variations.length > 0 && (
            <fieldset>
              <legend>Tamaño / Variación</legend>
              <div className="option-grid">
                {variations.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    className={selectedVariation?.id === v.id ? 'selected' : ''}
                    onClick={() => setSelectedVariation(v)}
                  >
                    {v.name} · {formatMoney(v.price)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {groups.map(group => (
            <fieldset key={group.id}>
              <legend>{group.name}{group.required ? ' · obligatorio' : ''}</legend>
              <div className="option-grid">
                {group.options.filter(option => option.available).map(option => (
                  <button
                    key={option.id}
                    type="button"
                    className={(selected[group.id] || []).some(value => value.id === option.id) ? 'selected' : ''}
                    onClick={() => toggle(group, option)}
                  >
                    {option.name}{option.price ? ` +${formatMoney(option.price)}` : ''}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <label>Nota para cocina
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
          </label>
          <div className="quantity">
            <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus /></button>
            <b>{quantity}</b>
            <button type="button" onClick={() => setQuantity(quantity + 1)}><Plus /></button>
          </div>
        </div>
        <footer>
          <button type="button" className="button outline" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="button primary"
            disabled={!valid}
            onClick={() => onAdd({
              clientId: crypto.randomUUID(),
              itemId: item.id,
              name: selectedVariation ? `${item.name} (${selectedVariation.name})` : item.name,
              price: basePrice,
              quantity,
              seatNumber: seat,
              note,
              variationId: selectedVariation?.id,
              variationName: selectedVariation?.name,
              modifiers
            })}
          >
            {valid ? 'Agregar a la comanda' : 'Complete las opciones requeridas'}
          </button>
        </footer>
      </section>
    </div>
  );
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
  const activeStatuses = ['pending_confirmation', 'in_kitchen', 'food_ready']
  const cachedKots = readCache().kots || []
  const cachedView = readCache().kitchenView
  const cachedViewIsUsable = cachedView?.scope === viewScope && cachedView.locked && (allowAll || cachedView.placeId !== 'all')
  const initialSelectedPlaceId: number | 'all' = cachedViewIsUsable ? cachedView.placeId : allowAll ? 'all' : places.find(place => place.isDefault)?.id || places[0]?.id || 'all'
  const initialTickets = cachedKots.filter(ticket => activeStatuses.includes(ticket.status) && (initialSelectedPlaceId === 'all' || ticket.kitchenPlaceId === initialSelectedPlaceId))
  const [tickets, setTickets] = useState<KitchenTicket[]>(initialTickets)
  const [loading, setLoading] = useState(!offline && initialTickets.length === 0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [selectedPlaceId, setSelectedPlaceId] = useState<number | 'all'>(initialSelectedPlaceId)
  const [mobileStageTab, setMobileStageTab] = useState<'all' | 'pending_confirmation' | 'in_kitchen' | 'food_ready'>('all')
  const [areaLocked, setAreaLocked] = useState(() => Boolean(cachedViewIsUsable))
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const seenTicketIds = useRef<Set<number> | null>(null)
  const seenFilter = useRef<string | null>(null)
  const loadRequestId = useRef(0)
  const inFlightFilter = useRef<string | null>(null)
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
  async function load(placeId: number | 'all' = activePlaceId, background = false) {
    const filterKey = placeId === 'all' ? 'all' : String(placeId)
    if (inFlightFilter.current === filterKey) return
    inFlightFilter.current = filterKey
    const requestId = ++loadRequestId.current
    if (offline) {
      const cached = readCache().kots || []
      if (requestId === loadRequestId.current) {
        const nextTickets = cached.filter(ticket => activeStatuses.includes(ticket.status) && (placeId === 'all' || ticket.kitchenPlaceId === placeId))
        setTickets(nextTickets)
        setLoading(false)
        setIsRefreshing(false)
      }
      inFlightFilter.current = null
      return
    }
    if (background) {
      setIsRefreshing(true)
    } else {
      setLoading(tickets.length === 0)
      setIsRefreshing(true)
    }
    setError('')
    try {
      const values = await api.kots('pin', { kitchenPlaceId: placeId === 'all' ? undefined : Number(placeId) })
      if (requestId !== loadRequestId.current) return
      const currentIds = new Set(values.map(ticket => ticket.id))
      if (seenFilter.current === filterKey && seenTicketIds.current && values.some(ticket => !seenTicketIds.current?.has(ticket.id))) {
        const newest = values.find(ticket => !seenTicketIds.current?.has(ticket.id))
        const placeName = newest?.kitchenPlace ? ` · ${newest.kitchenPlace}` : ''
        const tableName = newest?.tableName ? `Mesa ${newest.tableName}` : 'pedido sin mesa'
        void playWaiterAlert(readCache().notificationSettings || defaultNotificationSettings, 'Nueva comanda de cocina', `${tableName}${placeName}`)
      }
      seenFilter.current = filterKey
      seenTicketIds.current = currentIds
      const cachedKots = readCache().kots || []
      const cacheValues = placeId === 'all'
        ? values
        : [...cachedKots.filter(ticket => ticket.kitchenPlaceId !== placeId && !currentIds.has(ticket.id)), ...values]
      saveCache({ kots: cacheValues })
      const nextTickets = values.filter(ticket => activeStatuses.includes(ticket.status))
      setTickets(nextTickets)
    } catch (cause) {
      if (requestId === loadRequestId.current) setError(normalizeError(cause, 'No se pudieron cargar las órdenes de cocina.'))
    }
    finally {
      if (requestId === loadRequestId.current) {
        setLoading(false)
        setIsRefreshing(false)
      }
      if (inFlightFilter.current === filterKey) inFlightFilter.current = null
    }
  }
  // KDS refresh is triggered immediately on place change, realtime event, or heartbeat
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(activePlaceId, false); if (offline) return; const timer = window.setInterval(() => void load(activePlaceId, true), 10_000); return () => window.clearInterval(timer) }, [offline, selectedFilterKey])

  // Realtime instant refresh for KDS
  useEffect(() => {
    const handleKotEvent = () => {
      void load(activePlaceId, true)
    }
    window.addEventListener('restapp:kot-updated', handleKotEvent)
    return () => window.removeEventListener('restapp:kot-updated', handleKotEvent)
  }, [activePlaceId])

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
      if (!result.queued) await load(activePlaceId, true)
    }
    catch (cause) { setError(normalizeError(cause, 'El servicio no pudo actualizar la comanda.')) }
    finally { setBusyId(null) }
  }
  const statusLabel = (status: string) => status === 'pending_confirmation' ? 'Pendiente' : status === 'in_kitchen' ? 'En preparación' : status === 'food_ready' ? 'Listo' : status === 'served' ? 'Servido' : status
  const actionLabel = (status: string) => status === 'pending_confirmation' ? 'Iniciar preparación' : status === 'in_kitchen' ? 'Marcar como listo' : status === 'food_ready' ? 'Marcar como servido' : 'Actualizar'
  const renderTicket = (ticket: KitchenTicket) => <article className={`kitchen-ticket kitchen-${ticket.status}`} key={ticket.id}><div className="kitchen-ticket-header"><div><strong>{kitchenTicketLabel(ticket.kotNumber, ticket.id)}</strong><small className="kitchen-table-label">{kitchenOrderTarget(ticket)}</small><small>{orderNumberLabel(ticket.orderNumber, `Pedido n.º ${ticket.orderId}`)}{ticket.kitchenPlace ? ` · ${ticket.kitchenPlace}` : ''}</small>{ticket.waiterName && <small className="kitchen-waiter-label">Mesero: {ticket.waiterName}</small>}</div><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><KotElapsedTimer createdAt={ticket.createdAt} /><span className="kitchen-status">{statusLabel(ticket.status)}</span></div></div><ul>{ticket.items.map(item => <li key={item.id}><strong>{item.quantity}× {item.name}</strong>{item.variation && <small className="kitchen-item-meta">Variante: {item.variation}</small>}{item.modifiers?.length ? <small className="kitchen-item-meta">Suplementos: {item.modifiers.map(modifier => modifier.name).join(', ')}</small> : null}{item.note && <em>Nota: {item.note}</em>}</li>)}</ul>{ticket.note && <p className="kitchen-note"><strong>Nota general:</strong> {ticket.note}</p>}<footer><small>{ticket.createdAt ? new Date(ticket.createdAt).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) : 'Hora no publicada'}</small><button className={`button ${ticket.status === 'in_kitchen' ? 'primary kds-btn-ready' : ticket.status === 'food_ready' ? 'kds-btn-served' : 'primary'}`} disabled={busyId !== null} onClick={() => void advance(ticket)}>{busyId === ticket.id ? 'Guardando…' : actionLabel(ticket.status)}</button></footer></article>
  const kitchenColumns = [
    { status: 'pending_confirmation', title: 'Nuevos', subtitle: 'Recién recibidos', className: 'kitchen-column-new' },
    { status: 'in_kitchen', title: 'En preparación', subtitle: 'En trabajo de cocina', className: 'kitchen-column-preparing' },
    { status: 'food_ready', title: 'Listos', subtitle: 'Esperando entrega', className: 'kitchen-column-ready' },
  ] as const

  const visibleColumns = mobileStageTab === 'all'
    ? kitchenColumns
    : kitchenColumns.filter(c => c.status === mobileStageTab)

  const activeAreaName = activePlaceId === 'all'
    ? 'Todas las áreas'
    : placeOptions.find(p => p.id === activePlaceId)?.name || 'Área seleccionada'

  const board = (
    <div className="kitchen-board" aria-busy={loading || isRefreshing} aria-label="Tablero de pedidos de cocina">
      {visibleColumns.map(column => {
        const columnTickets = tickets.filter(ticket => ticket.status === column.status)
        return (
          <section className={`kitchen-column ${column.className}`} key={column.status}>
            <header className="kitchen-column-header">
              <div>
                <strong>{column.title}</strong>
                <small>{column.subtitle}</small>
              </div>
              <b>{columnTickets.length}</b>
            </header>
            <div className="kitchen-column-list">
              {columnTickets.length ? (
                columnTickets.map(renderTicket)
              ) : (
                <div className="kitchen-column-empty">
                  {loading ? 'Cargando pedidos…' : 'Sin comandas en esta etapa'}
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )

  return (
    <div className={standalone ? 'kitchen-standalone-panel' : 'modal-backdrop'}>
      <section className={`modal wide kitchen-panel${standalone ? ' kitchen-panel-standalone' : ''}`}>
        <header>
          {/* Mobile-optimized Header Row */}
          <div className="kitchen-mobile-header-compact">
            <div className="kitchen-mobile-header-title">
              <h2>Cocina</h2>
              <span className={`kitchen-realtime-badge ${offline ? 'offline' : 'live'}`}>
                <span className="kitchen-pulse-dot" />
                {offline ? 'Offline' : 'En vivo'}
              </span>
              <span style={{ fontSize: '11px', color: '#8b949e', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                · {activeAreaName}
              </span>
            </div>
            <div className="kitchen-mobile-header-actions">
              {placeOptions.length > 0 && (
                <button
                  type="button"
                  className={`kitchen-mobile-icon-btn ${showMobileFilters ? 'active' : ''}`}
                  onClick={() => setShowMobileFilters(!showMobileFilters)}
                  title="Filtrar área de trabajo"
                  aria-label="Filtrar área"
                >
                  <SlidersHorizontal size={16} />
                </button>
              )}
              <button
                type="button"
                className="kitchen-mobile-icon-btn"
                onClick={() => void load(activePlaceId, false)}
                disabled={loading || offline}
                title="Actualizar comandas"
                aria-label="Actualizar"
              >
                <History size={16} />
              </button>
              {standalone ? (
                <button className="button outline" style={{ minHeight: '34px', padding: '0 10px', fontSize: '12px' }} onClick={onClose}>
                  Mesas
                </button>
              ) : (
                <button className="icon-button" onClick={onClose} aria-label="Cerrar"><X /></button>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Horizontal Stage Bar */}
        <div className="kitchen-mobile-stage-bar">
          <button
            type="button"
            className={`kitchen-stage-pill ${mobileStageTab === 'all' ? 'active' : ''}`}
            onClick={() => setMobileStageTab('all')}
          >
            Todas ({tickets.length})
          </button>
          {kitchenColumns.map(column => {
            const count = tickets.filter(t => t.status === column.status).length
            return (
              <button
                key={column.status}
                type="button"
                className={`kitchen-stage-pill ${mobileStageTab === column.status ? 'active' : ''}`}
                onClick={() => setMobileStageTab(column.status as any)}
              >
                {column.title} ({count})
              </button>
            )
          })}
        </div>

        {/* Collapsible Area Filter (Visible on desktop or when toggled on mobile) */}
        {placeOptions.length > 0 && (
          <div className={showMobileFilters ? 'kitchen-mobile-filter-drawer' : 'mobile-collapsed'}>
            <div className={`kitchen-place-filter ${!showMobileFilters ? 'mobile-collapsed' : ''}`}>
              <label htmlFor="kitchen-area-filter">
                Mostrar área
                <select
                  id="kitchen-area-filter"
                  value={activePlaceId}
                  disabled={areaLocked}
                  onChange={event => choosePlace(event.target.value === 'all' ? 'all' : Number(event.target.value))}
                >
                  {allowAll && <option value="all">Todas las áreas</option>}
                  {placeOptions.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
                </select>
              </label>
              <button
                className={`button ${areaLocked ? 'primary' : 'outline'}`}
                onClick={toggleAreaLock}
                title={areaLocked ? 'Desbloquear selección de área' : 'Bloquear esta área'}
              >
                {areaLocked ? <><Unlock size={15} /> Desbloquear área</> : <><Lock size={15} /> Bloquear área</>}
              </button>
            </div>
            <p className={`kitchen-place-label ${!showMobileFilters ? 'mobile-collapsed' : ''}`}>
              {areaLocked
                ? `Área bloqueada: ${activePlaceId === 'all' ? 'Todas' : placeOptions.find(place => place.id === activePlaceId)?.name || 'seleccionada'}`
                : 'Área de trabajo'}
            </p>
            {!areaLocked && (
              <nav className={`kitchen-place-tabs ${!showMobileFilters ? 'mobile-collapsed' : ''}`} aria-label="Áreas de preparación">
                {allowAll && <button className={activePlaceId === 'all' ? 'active' : ''} onClick={() => choosePlace('all')}>Todas</button>}
                {placeOptions.map(place => <button className={activePlaceId === place.id ? 'active' : ''} key={place.id} onClick={() => choosePlace(place.id)}>{place.name}</button>)}
              </nav>
            )}
          </div>
        )}

        {!placeOptions.length && (
          <div className="kitchen-place-empty">
            La sucursal todavía no publica sectores de preparación. Solicite al administrador configurar Cocina, Bar o Reparto en RestaPP.
          </div>
        )}

        {offline && <Alert>Sin conexión: los cambios quedan guardados localmente y se sincronizarán al restablecerse la conexión.</Alert>}
        {error && <Alert>{error}</Alert>}

        {standalone ? (
          board
        ) : loading && !tickets.length ? (
          <div className="empty compact"><p>Consultando pedidos activos…</p></div>
        ) : tickets.length ? (
          <div className="kitchen-list">{tickets.map(renderTicket)}</div>
        ) : (
          <div className="empty compact"><ChefHat size={34} /><p>No hay pedidos pendientes en esta área.</p></div>
        )}

        <footer className="modal-note">
          Cada estación ve únicamente sus comandas: cocina, bar, reparto u otra zona activa de la sucursal. El sonido y la vibración de una comanda nueva usa la misma configuración de avisos que las llamadas de mesa. El área bloqueada se conserva en este dispositivo por sucursal.
        </footer>
      </section>
    </div>
  )
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
  const expected = cashNumber(session?.expectedCash ?? summary?.expected_cash ?? summary?.expected_amount ?? session?.openingFloat)
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
