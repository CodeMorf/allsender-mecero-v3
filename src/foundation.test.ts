import { describe, expect, it } from 'vitest'
import { ApiError, applyCategoryMetadata, normalizeAttendance, normalizeCategory, normalizeItem, normalizeKitchenPlace, normalizeKitchenTicket, normalizeStaffSchedule, normalizeTable, normalizeWaiterRequest } from './api/client'
import { cartItemUnitPrice } from './modules/PosModule'
import { newIdempotencyKey, readCache, saveCache, setStorageScope } from './storage/offline'
import { orderServiceLabel, resolveOrderService } from './utils/orderService'
import { menuCategoryNames, buildCategoryFilterOptions, isItemInCategory } from './utils/menuCategories'
import { dedupeOrders, mergeOrderRealtimeEvent } from './utils/orderRealtime'
import { buildRealtimeChannelNames } from './services/realtime'
import { shouldResyncAfterConnection } from './utils/realtimeState'

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

  it('resuelve categoryId desde category_id, item_category_id, category.id o item_category.id', () => {
    const it1 = normalizeItem({ id: 1, item_name: 'P1', category_id: 10, price: 100 })
    const it2 = normalizeItem({ id: 2, item_name: 'P2', item_category_id: 20, price: 100 })
    const it3 = normalizeItem({ id: 3, item_name: 'P3', category: { id: 30, name: 'Entradas' }, price: 100 })
    const it4 = normalizeItem({ id: 4, item_name: 'P4', item_category: { id: 40, name: 'Postres' }, price: 100 })
    const it5 = normalizeItem({ id: 5, item_name: 'P5', price: 100 })

    expect(it1.categoryId).toBe(10)
    expect(it2.categoryId).toBe(20)
    expect(it3.categoryId).toBe(30)
    expect(it3.categoryName).toBe('Entradas')
    expect(it4.categoryId).toBe(40)
    expect(it4.categoryName).toBe('Postres')
    expect(it5.categoryId).toBeUndefined()
    expect(it5.categoryName).toBe('Otros')
  })

  it('filtra por ID estable y tolera variaciones de acentos y mayúsculas', () => {
    const itDesayuno = normalizeItem({ id: 24, item_name: 'Mangu', item_category_id: 15, price: 295 })
    const itPlato = normalizeItem({ id: 71, item_name: 'Plato del Día', item_category_id: 35, price: 300 })
    const itBebida = normalizeItem({ id: 76, item_name: 'Café', item_category_id: 36, price: 50 })
    const itOtro = normalizeItem({ id: 99, item_name: 'Servicio extra', price: 10 })

    const categories = [
      normalizeCategory({ id: 15, category_name: 'Desayuno', sort_order: 1 }),
      normalizeCategory({ id: 35, category_name: 'Platos del día', sort_order: 2 }),
      normalizeCategory({ id: 36, category_name: 'Bebidas', sort_order: 10 }),
    ]

    const resolved = applyCategoryMetadata([itDesayuno, itPlato, itBebida, itOtro], categories)
    const options = buildCategoryFilterOptions(resolved, categories)

    expect(options.map(o => o.name)).toEqual(['Todos los productos', 'Desayuno', 'Platos del día', 'Bebidas', 'Otros'])
    expect(options.find(o => o.id === 15)?.count).toBe(1)
    expect(options.find(o => o.id === 35)?.count).toBe(1)
    expect(options.find(o => o.id === 36)?.count).toBe(1)
    expect(options.find(o => o.id === 'OTHER')?.count).toBe(1)
    expect(options.find(o => o.id === 'ALL')?.count).toBe(4)

    // Filtrar por ID estable
    expect(resolved.filter(it => isItemInCategory(it, 15))).toEqual([resolved[0]])
    expect(resolved.filter(it => isItemInCategory(it, 35))).toEqual([resolved[1]])
    expect(resolved.filter(it => isItemInCategory(it, 36))).toEqual([resolved[2]])
    expect(resolved.filter(it => isItemInCategory(it, 'OTHER'))).toEqual([resolved[3]])
    expect(resolved.filter(it => isItemInCategory(it, 'ALL'))).toHaveLength(4)
  })

  it('filtra por el nombre normalizado cuando el ID no alcanza', () => {
    const item = normalizeItem({ id: 71, item_name: 'Plato del Día', item_category_id: 35, price: 300 })
    const categories = [normalizeCategory({ id: 35, category_name: 'Platos del día', sort_order: 2 })]
    const resolved = applyCategoryMetadata([item], categories)

    // El respaldo por texto tolera acentos, mayúsculas y espacios sobrantes.
    expect(isItemInCategory(resolved[0], 999, 'platos del dia')).toBe(true)
    expect(isItemInCategory(resolved[0], 999, '  PLATOS   DEL   DÍA  ')).toBe(true)
    // Y no arrastra productos de otras categorías.
    expect(isItemInCategory(resolved[0], 999, 'Bebidas')).toBe(false)
  })

  it('conserva un id de categoría válido aunque falte su metadata', () => {
    // La API manda el id de categoría, pero el endpoint de categorías no la
    // incluye. El producto conserva un fallback estable y no se agrupa en
    // "Otros".
    const item = normalizeItem({ id: 3, item_name: 'Producto sin categoría resoluble', item_category_id: 27, price: 100 })
    const resolved = applyCategoryMetadata([item], [])
    const options = buildCategoryFilterOptions(resolved, [])

    expect(options.map(o => ({ id: o.id, name: o.name }))).toEqual([
      { id: 'ALL', name: 'Todos los productos' },
      { id: 27, name: 'Categoría 27' }
    ])
    expect(options.find(o => o.id === 27)?.count).toBe(1)
    expect(options.find(o => o.id === 'OTHER')).toBeUndefined()

    // El producto no desaparece: sigue visible en Todos y responde por su ID.
    expect(resolved.filter(it => isItemInCategory(it, 'ALL'))).toHaveLength(1)
    expect(resolved.filter(it => isItemInCategory(it, 'OTHER'))).toHaveLength(0)
    expect(resolved.filter(it => isItemInCategory(it, 27))).toHaveLength(1)
    expect(options.find(o => o.id === 27)?.name).toBe('Categoría 27')
  })

  it('reserva Otros exclusivamente para productos sin id de categoría válido', () => {
    const item = normalizeItem({ id: 4, item_name: 'Producto sin categoría', category_name: 'Bebidas', price: 100 })
    const resolved = applyCategoryMetadata([item], [])
    const options = buildCategoryFilterOptions(resolved, [])

    expect(resolved[0]).toMatchObject({ categoryId: undefined, categoryName: 'Bebidas' })
    expect(options.find(o => o.id === 'OTHER')?.count).toBe(1)
    expect(isItemInCategory(resolved[0], 'OTHER')).toBe(true)
  })

  it('aplica un alta realtime sin duplicar el pedido', () => {
    const initial = [{ id: 10, branch_id: 9, status: 'placed', total: 120 }]
    const created = { order_id: 11, branch_id: 9, restaurant_id: 3, status: 'placed', total: 250, updated_at: '2026-09-11T12:00:00Z' }

    const first = mergeOrderRealtimeEvent(initial, created, { branchId: 9, restaurantId: 3 })
    const second = mergeOrderRealtimeEvent(first.orders, { ...created, id: 11 }, { branchId: 9, restaurantId: 3 })

    expect(first).toMatchObject({ applied: true, orderId: 11 })
    expect(second.orders).toHaveLength(2)
    expect(second.orders.filter(order => order.id === 11)).toHaveLength(1)
  })

  it('actualiza en memoria el pedido existente y rechaza otro tenant', () => {
    const current = [{ id: 10, branch_id: 9, restaurant_id: 3, status: 'placed', total: 120 }]
    const updated = mergeOrderRealtimeEvent(current, {
      id: 10,
      order_id: 10,
      branch_id: 9,
      restaurant_id: 3,
      status: 'paid',
      updated_at: '2026-09-11T12:01:00Z',
    }, { branchId: 9, restaurantId: 3 })
    const foreign = mergeOrderRealtimeEvent(updated.orders, {
      id: 20,
      order_id: 20,
      branch_id: 10,
      restaurant_id: 3,
      status: 'placed',
    }, { branchId: 9, restaurantId: 3 })

    expect(updated.orders).toHaveLength(1)
    expect(updated.orders[0]).toMatchObject({ id: 10, status: 'paid', total: 120 })
    expect(foreign.applied).toBe(false)
    expect(foreign.orders).toEqual(updated.orders)
  })

  it('mantiene una sola fila después de 100 eventos repetidos', () => {
    let orders: Array<Record<string, unknown>> = []
    for (let index = 0; index < 100; index += 1) {
      orders = mergeOrderRealtimeEvent(orders, {
        id: 77,
        branch_id: 9,
        restaurant_id: 3,
        status: index === 99 ? 'paid' : 'placed',
        updated_at: `2026-09-11T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
      }, { branchId: 9, restaurantId: 3 }).orders
    }

    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({ id: 77, status: 'paid' })
  })

  it('deduplica respuestas REST sin perder el resumen más reciente', () => {
    expect(dedupeOrders([
      { id: 1, status: 'placed', updated_at: '2026-09-11T12:00:00Z' },
      { id: 1, status: 'confirmed', total: 90, updated_at: '2026-09-11T12:01:00Z' },
      { id: 2, status: 'paid' },
    ])).toEqual([
      { id: 1, status: 'confirmed', total: 90, updated_at: '2026-09-11T12:01:00Z' },
      { id: 2, status: 'paid' },
    ])
  })

  it('resincroniza una sola vez al volver a conectado y no por eventos repetidos', () => {
    expect(shouldResyncAfterConnection('disconnected', 'connected')).toBe(true)
    expect(shouldResyncAfterConnection('connecting', 'connected')).toBe(true)
    expect(shouldResyncAfterConnection('connected', 'connected')).toBe(false)
    expect(shouldResyncAfterConnection('connected', 'connecting')).toBe(false)
  })

  it('suscribe una terminal a un solo alcance por cada flujo realtime', () => {
    expect(buildRealtimeChannelNames(9, 3)).toEqual([
      'private-orders.branch.9',
      'private-kots.branch.9',
      'private-print-jobs.branch.9',
      'private-active-waiter-requests.branch.9',
      'private-today-orders.branch.9',
    ])
    expect(buildRealtimeChannelNames(null, 3)).toEqual([
      'private-orders.restaurant.3',
      'private-kots.restaurant.3',
      'private-print-jobs.restaurant.3',
      'private-active-waiter-requests.restaurant.3',
      'private-today-orders.restaurant.3',
    ])
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

  it('reescribe URLs firmadas de R2 y nombres crudos de item_photo al proxy permanente', () => {
    // URL prefirmada de Cloudflare R2 con expiración
    const signedR2Url = 'https://restapp-media.r2.cloudflarestorage.com/item/b1fd2b430f936f18b6b12c54192466de.png?X-Amz-Expires=3600&X-Amz-Signature=abcd'
    const itemWithSigned = normalizeItem({ id: 24, item_name: 'Mangu', item_photo_url: signedR2Url })
    expect(itemWithSigned.imageUrl).toBe('https://restapp.allsender.tech/api/application-integration/media/item/b1fd2b430f936f18b6b12c54192466de.png')

    // Nombre crudo en item_photo (como está almacenado en BD)
    const itemWithRaw = normalizeItem({ id: 25, item_name: 'Arroz', item_photo: '7df47249aa7d90a7fb4bb9b0afc1a142.png' })
    expect(itemWithRaw.imageUrl).toBe('https://restapp.allsender.tech/api/application-integration/media/item/7df47249aa7d90a7fb4bb9b0afc1a142.png')
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
