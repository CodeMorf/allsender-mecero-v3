import Pusher from 'pusher-js'

export const PUSHER_CONFIG = {
  key: 'dfbcd123451ef909b3d3',
  cluster: 'us2',
  forceTLS: true,
}

export type RealtimeCallbacks = {
  onOrderUpdated?: (data: any) => void
  onOrderCreated?: (data: any) => void
  onKotUpdated?: (data: any) => void
  onWaiterRequest?: (data: any) => void
  onTodayOrdersUpdated?: (data: any) => void
  onPrintJobCreated?: (data: any) => void
  onConnectionChange?: (state: 'connected' | 'connecting' | 'disconnected' | 'unavailable' | 'failed') => void
}

export class RealtimeService {
  private pusher: Pusher | null = null
  private branchId: number | null = null
  private restaurantId: number | null = null
  private callbacks: RealtimeCallbacks = {}
  private subscribedChannels: string[] = []

  init(branchId?: number, restaurantId?: number, callbacks?: RealtimeCallbacks) {
    if (callbacks) {
      this.callbacks = { ...this.callbacks, ...callbacks }
    }

    if (this.branchId === branchId && this.restaurantId === restaurantId && this.pusher) {
      return
    }

    this.disconnect()

    this.branchId = branchId ?? null
    this.restaurantId = restaurantId ?? null

    try {
      this.pusher = new Pusher(PUSHER_CONFIG.key, {
        cluster: PUSHER_CONFIG.cluster,
        forceTLS: PUSHER_CONFIG.forceTLS,
      })

      this.pusher.connection.bind('state_change', (states: { current: string }) => {
        const state = states.current as any
        if (this.callbacks.onConnectionChange) {
          this.callbacks.onConnectionChange(state)
        }
      })

      this.subscribeAll()
    } catch (err) {
      console.warn('[RealtimeService] Pusher initialization error:', err)
    }
  }

  setCallbacks(callbacks: RealtimeCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  private subscribeAll() {
    if (!this.pusher) return

    const channelsToSubscribe = new Set<string>()

    // Global / fallback channels
    channelsToSubscribe.add('orders')
    channelsToSubscribe.add('kots')
    channelsToSubscribe.add('print-jobs')
    channelsToSubscribe.add('active-waiter-requests')

    // Branch channels
    if (this.branchId) {
      channelsToSubscribe.add(`orders.branch.${this.branchId}`)
      channelsToSubscribe.add(`kots.branch.${this.branchId}`)
      channelsToSubscribe.add(`print-jobs.branch.${this.branchId}`)
      channelsToSubscribe.add(`active-waiter-requests.branch.${this.branchId}`)
      channelsToSubscribe.add(`today-orders.branch.${this.branchId}`)
    }

    // Restaurant channels
    if (this.restaurantId) {
      channelsToSubscribe.add(`orders.restaurant.${this.restaurantId}`)
      channelsToSubscribe.add(`kots.restaurant.${this.restaurantId}`)
      channelsToSubscribe.add(`active-waiter-requests.restaurant.${this.restaurantId}`)
      channelsToSubscribe.add(`today-orders.restaurant.${this.restaurantId}`)
    }

    channelsToSubscribe.forEach((channelName) => {
      try {
        const channel = this.pusher!.subscribe(channelName)
        this.subscribedChannels.push(channelName)

        // Bind events
        channel.bind('order.updated', (data: any) => {
          this.callbacks.onOrderUpdated?.(data)
        })

        channel.bind('order.created', (data: any) => {
          this.callbacks.onOrderCreated?.(data)
        })

        channel.bind('kot.updated', (data: any) => {
          this.callbacks.onKotUpdated?.(data)
        })

        channel.bind('active-waiter-requests.created', (data: any) => {
          this.callbacks.onWaiterRequest?.(data)
        })

        channel.bind('today-orders.updated', (data: any) => {
          this.callbacks.onTodayOrdersUpdated?.(data)
        })

        channel.bind('print-job.created', (data: any) => {
          this.callbacks.onPrintJobCreated?.(data)
        })
      } catch (err) {
        console.warn(`[RealtimeService] Failed to subscribe to ${channelName}:`, err)
      }
    })
  }

  disconnect() {
    if (this.pusher) {
      this.subscribedChannels.forEach((ch) => {
        try {
          this.pusher?.unsubscribe(ch)
        } catch {}
      })
      this.subscribedChannels = []
      try {
        this.pusher.disconnect()
      } catch {}
      this.pusher = null
    }
  }
}

export const realtimeService = new RealtimeService()
