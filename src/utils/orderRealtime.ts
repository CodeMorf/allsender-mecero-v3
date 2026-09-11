type UnknownRecord = Record<string, unknown>

export type OrderRealtimeScope = {
  branchId?: number
  restaurantId?: number
}

export type OrderRealtimeMergeResult<T extends UnknownRecord = UnknownRecord> = {
  orders: T[]
  applied: boolean
  orderId?: number
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function positiveId(value: unknown): number | undefined {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function compact<T extends UnknownRecord>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

/**
 * Extracts the order summary from either a broadcast payload or a payload
 * wrapped in `data.order`. The backend sends the summary at the top level, but
 * accepting the wrapped shape keeps old event producers compatible while the
 * frontend migrates to the canonical events.
 */
export function extractOrderRealtimePayload(payload: unknown): UnknownRecord | null {
  const envelope = asRecord(payload)
  if (!envelope) return null

  const data = asRecord(envelope.data) || envelope
  const nestedOrder = asRecord(data.order) || asRecord(envelope.order)
  const merged = compact({
    ...envelope,
    ...data,
    ...(nestedOrder || {}),
  })
  const id = positiveId(merged.id ?? merged.order_id ?? nestedOrder?.id ?? nestedOrder?.order_id)
  if (!id) return null

  const branchId = positiveId(merged.branch_id ?? merged.branchId)
  const restaurantId = positiveId(merged.restaurant_id ?? merged.restaurantId)
  return compact({
    ...merged,
    id,
    order_id: positiveId(merged.order_id) ?? id,
    branch_id: branchId,
    restaurant_id: restaurantId,
  })
}

function belongsToScope(order: UnknownRecord, scope: OrderRealtimeScope): boolean {
  const branchId = positiveId(order.branch_id ?? order.branchId)
  const restaurantId = positiveId(order.restaurant_id ?? order.restaurantId)

  // A scoped channel must always carry its tenant marker. Silently accepting
  // a missing marker would turn a malformed/global event into a tenant event.
  if (scope.branchId != null && branchId !== positiveId(scope.branchId)) return false
  if (scope.restaurantId != null && restaurantId != null && restaurantId !== positiveId(scope.restaurantId)) return false
  return true
}

function orderId(order: UnknownRecord): number | undefined {
  return positiveId(order.id ?? order.order_id)
}

function mergeOne<T extends UnknownRecord>(current: T, incoming: UnknownRecord): T {
  const currentTime = timestampValue(current.updated_at ?? current.updatedAt ?? current.timestamp)
  const incomingTime = timestampValue(incoming.updated_at ?? incoming.updatedAt ?? incoming.timestamp)

  // Pusher can deliver a delayed event after a newer one. Keep the newer
  // snapshot, while still allowing the caller's normal deduplication pass to
  // remove duplicate IDs.
  if (currentTime !== undefined && incomingTime !== undefined && incomingTime < currentTime) {
    return current
  }

  return compact({ ...current, ...incoming }) as T
}

/**
 * Removes duplicate order IDs from a REST response and preserves the latest
 * summary received for each order.
 */
export function dedupeOrders<T extends UnknownRecord>(orders: T[]): T[] {
  const indexById = new Map<number, number>()
  const result: T[] = []

  for (const order of orders) {
    const id = orderId(order)
    if (!id) continue
    const previousIndex = indexById.get(id)
    if (previousIndex === undefined) {
      indexById.set(id, result.length)
      result.push(order)
    } else {
      result[previousIndex] = mergeOne(result[previousIndex], order)
    }
  }

  return result
}

/**
 * Applies one realtime order event in memory. It is deliberately pure so the
 * App can test add/update/deduplication/tenant filtering without mounting the
 * whole POS or issuing a REST request.
 */
export function mergeOrderRealtimeEvent<T extends UnknownRecord>(
  currentOrders: T[],
  payload: unknown,
  scope: OrderRealtimeScope = {},
): OrderRealtimeMergeResult<T> {
  const incoming = extractOrderRealtimePayload(payload)
  if (!incoming || !belongsToScope(incoming, scope)) {
    return { orders: dedupeOrders(currentOrders), applied: false }
  }

  const id = orderId(incoming)
  if (!id) return { orders: dedupeOrders(currentOrders), applied: false }

  const result = dedupeOrders(currentOrders)
  const existingIndex = result.findIndex(order => orderId(order) === id)
  if (existingIndex >= 0) {
    result[existingIndex] = mergeOne(result[existingIndex], incoming)
  } else {
    result.unshift(incoming as T)
  }

  return { orders: result, applied: true, orderId: id }
}
