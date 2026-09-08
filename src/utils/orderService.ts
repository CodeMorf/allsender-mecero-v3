import type { OrderMode } from '../types'

export type OrderServiceKind = OrderMode | 'unknown'

type OrderLike = Record<string, any>

function normalizedText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function objectValue(source: OrderLike, ...keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key]
  }
  return undefined
}

export function resolveOrderService(source: unknown): OrderServiceKind {
  if (typeof source === 'string') {
    return resolveOrderService({ order_type: source })
  }
  if (!source || typeof source !== 'object') return 'unknown'

  const order = source as OrderLike
  const nestedOrder = order.order && typeof order.order === 'object' ? order.order as OrderLike : {}
  const typeMeta = order.order_type_meta && typeof order.order_type_meta === 'object'
    ? order.order_type_meta as OrderLike
    : {}
  const rawOrderType = order.order_type && typeof order.order_type === 'object'
    ? order.order_type as OrderLike
    : {}

  const text = [
    objectValue(order, 'mode', 'orderType', 'order_type_name', 'custom_order_type_name', 'customOrderTypeName'),
    typeof order.order_type === 'string' ? order.order_type : undefined,
    objectValue(typeMeta, 'slug', 'type', 'order_type_name', 'name'),
    objectValue(rawOrderType, 'slug', 'type', 'order_type_name', 'name'),
    objectValue(nestedOrder, 'mode', 'order_type', 'orderType', 'order_type_name', 'custom_order_type_name'),
  ].map(normalizedText).filter(Boolean).join(' ')

  if (/(room service|habitacion|servicio de habitacion)/.test(text)) return 'room_service'
  if (/(delivery|entrega|domicilio|envio)/.test(text)) return 'delivery'
  if (/(pickup|pick up|takeaway|take away|takeout|para llevar|recogida|retiro)/.test(text)) return 'pickup'
  if (/(dine in|comer aqui|salon|mesa)/.test(text)) return 'dine_in'

  const deliveryAppId = objectValue(order, 'delivery_app_id', 'deliveryAppId', 'deliveryPlatformId')
    ?? objectValue(nestedOrder, 'delivery_app_id', 'deliveryAppId')
  const deliveryAddress = objectValue(order, 'delivery_address', 'deliveryAddress')
    ?? objectValue(nestedOrder, 'delivery_address', 'deliveryAddress')
  const deliveryExecutiveId = objectValue(order, 'delivery_executive_id', 'deliveryExecutiveId')
    ?? objectValue(nestedOrder, 'delivery_executive_id', 'deliveryExecutiveId')
  if (deliveryAppId !== undefined || deliveryAddress || deliveryExecutiveId !== undefined) return 'delivery'

  const tableId = objectValue(order, 'table_id', 'tableId')
    ?? objectValue(nestedOrder, 'table_id', 'tableId')
    ?? (order.table && typeof order.table === 'object' ? order.table.id : undefined)
  if (tableId !== undefined && tableId !== null) return 'dine_in'

  return 'unknown'
}

export function orderServiceLabel(kind: OrderServiceKind): string {
  if (kind === 'dine_in') return 'Comer aquí'
  if (kind === 'pickup') return 'Recogida en el local'
  if (kind === 'delivery') return 'Entrega a domicilio'
  if (kind === 'room_service') return 'Servicio a habitación'
  return 'Servicio no identificado'
}

export function orderServiceShortLabel(kind: OrderServiceKind): string {
  if (kind === 'dine_in') return 'Mesa'
  if (kind === 'pickup') return 'Recogida'
  if (kind === 'delivery') return 'Entrega'
  if (kind === 'room_service') return 'Habitación'
  return 'Sin mesa'
}
