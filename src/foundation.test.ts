import { describe, expect, it } from 'vitest'
import { ApiError, applyCategoryMetadata, normalizeAttendance, normalizeCategory, normalizeItem, normalizeKitchenPlace, normalizeKitchenTicket, normalizeStaffSchedule, normalizeTable, normalizeWaiterRequest } from './api/client'
import { cartItemUnitPrice } from './modules/PosModule'
import { newIdempotencyKey, readCache, saveCache, setStorageScope } from './storage/offline'
import { orderServiceLabel, resolveOrderService } from './utils/orderService'
import { menuCategoryNames } from './utils/menuCategories'

describe('contrato base del mesero', () => {
  it('normaliza estados de mesa de la API al mapa visual', () => {
    const table = normalizeTable({ id: 7, table_number: 'T7', seats: 4, status: 'occupied' })
    expect(table).toMatchObject({ id: 7, number: 'T7', capacity: 4, status: 'occupied' })
  })

  it('lee el contrato real de mesas y precio de comer aquí', () => {
    const table = normalizeTable({ id: 45, table_code: 'I01', seating_capacity: 6, available_status: 'available', ui_status: 'libre' })
    const item = normalizeItem({ id: 24, item_name: 'Mangu', price: 295, is_available: true, in_stock: 1, prices: [{ final_price: '89.00', order_type: { translated_name: 'Dine In' } }] })
    expect(table).toMatchObject({ number: 'I01', capacity: 6, status: 'available' })
    expect(item).toMatchObject({ name: 'Mangu', price: 89, available: true })
  })

  it('conserva disponibilidad, alérgenos y modificadores del catálogo', () => {
    const item = normalizeItem({
      id: 12,
      item_name: 'Corte de carne',
      selling_price: '890.50',
      category: { name: 'Fuertes' },
      is_available: false,
      allergens: [{ code: 'dairy' }],
      dietary_tags: ['gluten-free'],
      modifier_groups: [{ id: 3, name: 'Término', required: true }],
    })
    expect(item).toMatchObject({ id: 12, name: 'Corte de carne', price: 890.5, categoryName: 'Fuertes', available: false })
    expect(item.allergens).toEqual(['dairy'])
    expect(item.dietaryTags).toEqual(['gluten-free'])
    expect(item.modifiers).toHaveLength(1)
  })

  it('resuelve categorías dinámicas por el ID real de la sucursal', () => {
    const item = normalizeItem({ id: 24, item_name: 'Mangu', item_category_id: 15, price: 295 })
    const categories = [
      normalizeCategory({ id: 36, category_name: 'Bebidas', sort_order: 10 }),
      normalizeCategory({ id: 15, category_name: 'Desayuno', sort_order: 1 }),
    ]
    const resolved = applyCategoryMetadata([item], categories)
    expect(resolved[0]).toMatchObject({ categoryId: 15, categoryName: 'Desayuno', categorySortOrder: 1 })
    expect(menuCategoryNames([
      { categoryName: 'Bebidas', categorySortOrder: 10 },
      { categoryName: 'Desayuno', categorySortOrder: 1 },
      { categoryName: 'Platos del día', categorySortOrder: 2 },
    ])).toEqual(['Desayuno', 'Platos del día', 'Bebidas'])
  })

  it('conserva las variaciones del catálogo para abrir el personalizador', () => {
    const item = normalizeItem({
      id: 18,
      item_name: 'Hamburguesa',
      price: 350,
      variations: [
        { id: 41, variation: 'Doble', price: '475.00' },
        { id: 42, name: 'Triple', final_price: '575.00' },
      ],
    })
    expect(item.variations).toEqual([
      { id: 41, name: 'Doble', price: 475 },
      { id: 42, name: 'Triple', price: 575 },
    ])
  })

  it('suma los suplementos una sola vez en el precio de la línea POS', () => {
    expect(cartItemUnitPrice({ price: 475, modifiers: [{ id: 7, name: 'Extra queso', price: 35 }] })).toBe(510)
  })

  it('normaliza la foto publicada por el tenant sin inventar una URL', () => {
    const item = normalizeItem({ id: 99, name: 'Plato de prueba', image_url: '/storage/items/plato.jpg' })
    expect(item.imageUrl).toBe('https://restapp.allsender.tech/storage/items/plato.jpg')
  })

  it('usa item_photo_url del backend y descarta su food.svg genérico', () => {
    expect(normalizeItem({ id: 100, item_photo_url: 'https://cdn.example.test/item/real.webp' }).imageUrl).toBe('https://cdn.example.test/item/real.webp')
    expect(normalizeItem({ id: 101, item_photo_url: 'https://restapp.allsender.tech/img/food.svg' }).imageUrl).toBeUndefined()
  })

  it('genera claves únicas para reintentos offline idempotentes', () => {
    const first = newIdempotencyKey()
    const second = newIdempotencyKey()
    expect(first).not.toBe(second)
    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('separa la caché offline por tenant y sucursal', () => {
    const tenantA = `tenant-a-${crypto.randomUUID()}:branch:1`
    const tenantB = `tenant-b-${crypto.randomUUID()}:branch:1`
    setStorageScope(tenantA)
    saveCache({ restaurantName: 'Restaurante A', tables: [{ id: 1, name: 'A', number: 'A1', capacity: 2, status: 'available' }] })
    setStorageScope(tenantB)
    expect(readCache().restaurantName).toBeUndefined()
    saveCache({ restaurantName: 'Restaurante B' })
    setStorageScope(tenantA)
    expect(readCache().restaurantName).toBe('Restaurante A')
    expect(readCache().tables?.[0].number).toBe('A1')
    setStorageScope(tenantB)
    expect(readCache().restaurantName).toBe('Restaurante B')
    expect(readCache().tables).toBeUndefined()
  })

  it('expone el estado HTTP para que la UI decida si encolar', () => {
    const error = new ApiError('Servidor no disponible', 503)
    expect(error.status).toBe(503)
    expect(error).toBeInstanceOf(Error)
  })

  it('lee KOT activos y conserva la relación orden-mesa para agregar líneas', () => {
    const table = normalizeTable({ id: 9, table_code: 'T9', seating_capacity: 4, available_status: 'running', current_order_id: 42, current_order_number: 'Order #42', customer_id: 18, customer_name: 'María López', order_total: 640, amount_due: 320 })
    const ticket = normalizeKitchenTicket({ id: 88, kot_number: 'KOT-88', order_id: 42, order_number: 'Order #42', table_code: 'T9', kitchen_place: 'Cocina', status: 'in_kitchen', items: [{ id: 301, order_item_id: 77, menu_item_id: 24, name: 'Pizza simple', quantity: 1, status: 'cooking' }] })
    expect(table).toMatchObject({ currentOrderId: 42, currentOrderNumber: '42', customerId: 18, customerName: 'María López', currentOrderTotal: 640, currentOrderDue: 320, status: 'occupied' })
    expect(ticket).toMatchObject({ id: 88, orderId: 42, tableName: 'T9', kitchenPlace: 'Cocina', status: 'in_kitchen' })
    expect(ticket.items[0]).toMatchObject({ orderItemId: 77, name: 'Pizza simple', status: 'cooking' })
  })

  it('distingue mesa, llevar/recoger, entrega y habitación con el contrato real de órdenes', () => {
    expect(resolveOrderService({ order_type_meta: { slug: 'dine_in' }, table_id: 12 })).toBe('dine_in')
    expect(resolveOrderService({ order_type_meta: { slug: 'pickup', order_type_name: 'Para llevar' } })).toBe('pickup')
    expect(resolveOrderService({ order_type: 'Delivery', delivery_address: 'Av. Principal 10' })).toBe('delivery')
    expect(resolveOrderService({ custom_order_type_name: 'Habitación 204' })).toBe('room_service')
    expect(orderServiceLabel('pickup')).toBe('Para llevar / Recoger')
    expect(orderServiceLabel('delivery')).toBe('Entrega a domicilio')
  })

  it('expone en cocina el mesero, la variante, los suplementos y las notas del backend', () => {
    const ticket = normalizeKitchenTicket({
      id: 89,
      order_id: 43,
      order_number: 'Order #43',
      waiter_name: 'Mesero Prueba',
      note: 'Enviado desde RestaPP Mesero',
      items: [{
        id: 302,
        name: 'Hamburguesa',
        variation: 'Doble',
        note: 'Silla 2 · Sin cebolla',
        modifier_options: [{ id: 7, name: 'Extra queso' }],
        quantity: 1,
      }],
    })
    expect(ticket).toMatchObject({ waiterName: 'Mesero Prueba', note: 'Enviado desde RestaPP Mesero' })
    expect(ticket.items[0]).toMatchObject({ variation: 'Doble', note: 'Silla 2 · Sin cebolla', modifiers: [{ id: 7, name: 'Extra queso' }] })
  })

  it('normaliza las áreas de cocina publicadas por la sucursal', () => {
    expect(normalizeKitchenPlace({ id: 3, name: 'Bar', type: 'bar', is_default: false, printer_id: 12 })).toMatchObject({ id: 3, name: 'Bar', type: 'bar', isDefault: false, printerId: 12 })
  })

  it('normaliza horarios y asistencia con la zona horaria publicada', () => {
    const schedule = normalizeStaffSchedule({ id: 4, user_id: 9, user_name: 'Ana', days: ['Monday', 'Friday'], start_time: '09:00:00', end_time: '17:00:00', timezone: 'America/Santo_Domingo', is_active: 1 })
    const attendance = normalizeAttendance({ id: 8, user_id: 9, user_name: 'Ana', clock_in_at: '2026-08-20T13:00:00Z', local_date: '2026-08-20', timezone: 'America/Santo_Domingo', status: 'active', device_id: 'device-1' })
    expect(schedule).toMatchObject({ id: 4, userId: 9, userName: 'Ana', startTime: '09:00:00', timezone: 'America/Santo_Domingo', isActive: true })
    expect(attendance).toMatchObject({ id: 8, userId: 9, userName: 'Ana', localDate: '2026-08-20', status: 'active', deviceId: 'device-1' })
  })

  it('normaliza las llamadas persistentes de una mesa', () => {
    expect(normalizeWaiterRequest({ id: 19, branch_id: 9, table_id: 22, table_code: 'T05', status: 'PENDING', created_at: '2026-08-20T20:00:00Z' })).toMatchObject({ id: 19, branchId: 9, tableId: 22, tableCode: 'T05', tableName: 'Mesa T05', status: 'pending' })
  })
})
