export type RealtimeConnectionState = 'connected' | 'connecting' | 'disconnected' | 'unavailable' | 'failed'

/**
 * A REST resynchronization is needed only when a connection actually becomes
 * usable again. Repeated "connected" notifications from the transport must
 * not create repeated list requests.
 */
export function shouldResyncAfterConnection(
  previous: RealtimeConnectionState,
  current: RealtimeConnectionState,
): boolean {
  return current === 'connected' && previous !== 'connected'
}
