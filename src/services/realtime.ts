import Pusher from 'pusher-js'
import { API_BASE_URL, api } from '../api/client'
import type { RealtimeConnectionState } from '../utils/realtimeState'

export const PUSHER_CONFIG = {
  key: 'dfbcd123451ef909b3d3',
  cluster: 'us2',
  forceTLS: true,
}

type ChannelAuthorizationData = { auth: string; channel_data?: string }
type AuthorizationCallback = (error: Error | null, data: ChannelAuthorizationData | null) => void

export type RealtimeCallbacks = {
  onOrderUpdated?: (data: any) => void
  onOrderCreated?: (data: any) => void
  onKotUpdated?: (data: any) => void
  onWaiterRequest?: (data: any) => void
  onTodayOrdersUpdated?: (data: any) => void
  onPrintJobCreated?: (data: any) => void
  onConnectionChange?: (state: RealtimeConnectionState) => void
}

const REALTIME_CHANNELS = {
  orders: 'orders',
  kots: 'kots',
  printJobs: 'print-jobs',
  waiterRequests: 'active-waiter-requests',
  todayOrders: 'today-orders',
} as const

export class RealtimeService {
  private pusher: Pusher | null = null
  private branchId: number | null = null
  private restaurantId: number | null = null
  private callbacks: RealtimeCallbacks = {}
  private subscribedChannels: string[] = []

  init(branchId?: number, restaurantId?: number, callbacks?: RealtimeCallbacks) {
    if (callbacks) this.callbacks = { ...this.callbacks, ...callbacks }

    if (this.branchId === (branchId ?? null) && this.restaurantId === (restaurantId ?? null) && this.pusher) {
      return
    }

    this.disconnect()
    this.branchId = branchId ?? null
    this.restaurantId = restaurantId ?? null

    if (!this.branchId && !this.restaurantId) {
      this.callbacks.onConnectionChange?.('disconnected')
      return
    }

    try {
      this.pusher = new Pusher(PUSHER_CONFIG.key, {
        cluster: PUSHER_CONFIG.cluster,
        forceTLS: PUSHER_CONFIG.forceTLS,
        // Pusher sends the `private-` channel name to this endpoint. The
        // bearer token is the already authenticated PIN/admin session; the
        // backend is responsible for tenant and branch authorization.
        authorizer: (channel: { name: string }) => ({
          authorize: (socketId: string, callback: AuthorizationCallback) => {
            void this.authorizeChannel(channel.name, socketId, callback)
          },
        }),
      } as any)

      this.pusher.connection.bind('state_change', (states: { current: string }) => {
        const state = states.current as RealtimeConnectionState
        if (['connected', 'connecting', 'disconnected', 'unavailable', 'failed'].includes(state)) {
          this.callbacks.onConnectionChange?.(state)
        }
      })

      this.subscribeAll()
    } catch {
      this.callbacks.onConnectionChange?.('failed')
    }
  }

  setCallbacks(callbacks: RealtimeCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  private async authorizeChannel(channelName: string, socketId: string, callback: AuthorizationCallback) {
    const token = api.getToken('pin') || api.getToken('admin')
    if (!token) {
      callback(new Error('La sesión de la sucursal no está disponible.'), null)
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/pusher/authorize-channel`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ channel_name: channelName, socket_id: socketId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || typeof payload?.auth !== 'string') {
        callback(new Error(payload?.message || 'No se pudo validar el canal en vivo.'), null)
        return
      }
      callback(null, payload as ChannelAuthorizationData)
    } catch {
      callback(new Error('No se pudo conectar con las actualizaciones en vivo.'), null)
    }
  }

  private subscribeAll() {
    if (!this.pusher) return

    // A branch-scoped terminal subscribes to exactly one channel per stream.
    // Restaurant fallback is used only for sessions without a branch. This
    // prevents the same event arriving through global, branch and restaurant
    // subscriptions and keeps all received data tenant-scoped.
    if (!this.branchId && !this.restaurantId) return

    const channelNames = buildRealtimeChannelNames(this.branchId, this.restaurantId)

    for (const channelName of channelNames) {
      try {
        const channel = this.pusher.subscribe(channelName)
        this.subscribedChannels.push(channelName)

        if (channelName.includes(`-${REALTIME_CHANNELS.orders}.`)) {
          channel.bind('order.created', (data: any) => this.callbacks.onOrderCreated?.(data))
          channel.bind('order.updated', (data: any) => this.callbacks.onOrderUpdated?.(data))
        } else if (channelName.includes(`-${REALTIME_CHANNELS.kots}.`)) {
          channel.bind('kot.updated', (data: any) => this.callbacks.onKotUpdated?.(data))
        } else if (channelName.includes(`-${REALTIME_CHANNELS.waiterRequests}.`)) {
          channel.bind('active-waiter-requests.created', (data: any) => this.callbacks.onWaiterRequest?.(data))
        } else if (channelName.includes(`-${REALTIME_CHANNELS.todayOrders}.`)) {
          channel.bind('today-orders.updated', (data: any) => this.callbacks.onTodayOrdersUpdated?.(data))
        } else if (channelName.includes(`-${REALTIME_CHANNELS.printJobs}.`)) {
          channel.bind('print-job.created', (data: any) => this.callbacks.onPrintJobCreated?.(data))
        }
      } catch {
        // Pusher reports the connection state; individual channel failures do
        // not expose internal details in the POS UI.
      }
    }
  }

  disconnect() {
    if (this.pusher) {
      for (const channel of this.subscribedChannels) {
        try { this.pusher.unsubscribe(channel) } catch {
          // The connection is already being torn down.
        }
      }
      try { this.pusher.disconnect() } catch {
        // Pusher may already be disconnected after a network failure.
      }
    }
    this.subscribedChannels = []
    this.pusher = null
  }
}

export const realtimeService = new RealtimeService()

export function buildRealtimeChannelNames(branchId?: number | null, restaurantId?: number | null): string[] {
  const scope = branchId ? 'branch' : 'restaurant'
  const scopeId = branchId || restaurantId
  if (!scopeId) return []

  return [
    'private-' + REALTIME_CHANNELS.orders + '.' + scope + '.' + scopeId,
    'private-' + REALTIME_CHANNELS.kots + '.' + scope + '.' + scopeId,
    'private-' + REALTIME_CHANNELS.printJobs + '.' + scope + '.' + scopeId,
    'private-' + REALTIME_CHANNELS.waiterRequests + '.' + scope + '.' + scopeId,
    'private-' + REALTIME_CHANNELS.todayOrders + '.' + scope + '.' + scopeId,
  ]
}
