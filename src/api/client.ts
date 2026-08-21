import type { ApiErrorShape, AttendanceRecord, Branch, DeliveryExecutive, DeliverySettings, DeviceBinding, KitchenPlace, KitchenTicket, MenuItem, PaymentMethodOption, Printer, ReceiptSettings, RestaurantTable, Session, StaffRole, StaffSchedule, TokenKind, WaiterRequest } from '../types'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://restapp.allsender.tech/api/application-integration').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  details?: ApiErrorShape

  constructor(message: string, status: number, details?: ApiErrorShape) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const data = (payload as { data?: unknown }).data
    return (data ?? payload) as T
  }
  return payload as T
}

function asArray<T>(payload: unknown): T[] {
  const value = unwrap<unknown>(payload)
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['items', 'branches', 'tables', 'menus', 'categories', 'orders', 'registers', 'cash_registers', 'kots', 'kot_places', 'places', 'notifications', 'printers', 'waiter_requests', 'results', 'data']) {
      if (Array.isArray(record[key])) return record[key] as T[]
    }
  }
  return []
}

export class ApiClient {
  private tokens: Partial<Record<TokenKind, string>> = {}

  setToken(kind: TokenKind, token: string | undefined) {
    if (token) this.tokens[kind] = token
    else delete this.tokens[kind]
  }

  getToken(kind: TokenKind) {
    return this.tokens[kind]
  }

  async request<T>(path: string, options: RequestInit & { tokenKind?: TokenKind } = {}): Promise<T> {
    const { tokenKind, ...init } = options
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const token = tokenKind ? this.tokens[tokenKind] : undefined
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal: controller.signal })
      const text = await response.text()
      let payload: unknown = null
      try { payload = text ? JSON.parse(text) : null } catch { payload = { message: text } }
      if (!response.ok) {
        const details = (payload || {}) as ApiErrorShape
        const message = details.message || `El servicio respondió con el estado ${response.status}`
        throw new ApiError(message, response.status, details)
      }
      return payload as T
    } finally {
      window.clearTimeout(timeout)
    }
  }

  async loginAdmin(email: string, password: string): Promise<Session> {
    const response = await this.request<any>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    const data = unwrap<any>(response)
    const token = data.access_token
    if (!token) throw new ApiError('El servicio no devolvió la credencial administrativa.', 502)
    this.setToken('admin', token)
    const user = data.user || {}
    return { token, kind: 'admin', userName: user.name || email, userId: user.id, restaurantHash: user.restaurant?.hash, restaurantId: user.restaurant_id, branchId: user.branch_id, permissions: data.permission_map || {} }
  }

  async me(kind: TokenKind): Promise<any> {
    return unwrap(await this.request('/auth/me', { tokenKind: kind }))
  }

  async permissions(kind: TokenKind): Promise<any> {
    return unwrap(await this.request('/platform/permissions', { tokenKind: kind }))
  }

  async config(kind: TokenKind): Promise<any> {
    return unwrap(await this.request('/platform/config', { tokenKind: kind }))
  }

  async branches(kind: TokenKind): Promise<Branch[]> {
    return asArray<any>(await this.request('/pos/branches', { tokenKind: kind })).map((branch: any) => ({ id: Number(branch.id), name: branch.name || branch.branch_name || `Sucursal ${branch.id}`, restaurantId: branch.restaurant_id, restaurantHash: branch.restaurant_hash }))
  }

  async switchBranch(kind: TokenKind, branchId: number) {
    return unwrap(await this.request('/platform/switch-branch', { method: 'POST', tokenKind: kind, body: JSON.stringify({ branch_id: branchId }) }))
  }

  /** Public and read-only: a configured browser/tablet can recover its tenant without asking the owner again. */
  async resolveDevice(deviceId: string): Promise<DeviceBinding | null> {
    try {
      const payload = await this.request<any>(`/devices/resolve?device_id=${encodeURIComponent(deviceId)}`)
      const data = unwrap<any>(payload)
      const value = data?.data ?? data
      if (!value || data?.configured === false) return null
      return {
        deviceId: String(value.device_id || deviceId),
        deviceName: value.device_name,
        restaurantId: value.restaurant_id == null ? undefined : Number(value.restaurant_id),
        restaurantHash: value.restaurant_hash,
        restaurantName: value.restaurant_name,
        branchId: value.branch_id == null ? undefined : Number(value.branch_id),
        branchName: value.branch_name,
        claimedAt: value.claimed_at,
        configured: true,
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) return null
      throw cause
    }
  }

  async registerDevice(session: Session, deviceId: string, branchId: number) {
    this.setToken('admin', session.token)
    return unwrap(await this.request('/devices', { method: 'POST', tokenKind: 'admin', body: JSON.stringify({ device_id: deviceId, device_name: 'RestaPP Mesero Web', platform: 'web', branch_id: branchId }) }))
  }

  async loginPin(pin: string, restaurantHash: string, deviceId: string, role: StaffRole = 'mesero'): Promise<Session> {
    const response = await this.request<any>('/auth/pin', { method: 'POST', body: JSON.stringify({ pin, restaurant_hash: restaurantHash, role, device_id: deviceId }) })
    const data = unwrap<any>(response)
    if (!data.access_token) throw new ApiError('El servicio no devolvió la credencial de acceso.', 502)
    this.setToken('pin', data.access_token)
    const user = data.user || {}
    return { token: data.access_token, kind: 'pin', userName: user.name || role, userId: user.id, restaurantHash, restaurantId: user.restaurant_id, branchId: user.branch_id, roleKey: data.role_key || role, permissions: data.permission_map || {} }
  }

  async logout(kind: TokenKind) {
    try { await this.request('/auth/logout', { method: 'POST', tokenKind: kind }) } finally { this.setToken(kind, undefined) }
  }

  async tables(kind: TokenKind): Promise<RestaurantTable[]> { return asArray<any>(await this.request('/pos/tables', { tokenKind: kind })).map(normalizeTable) }
  async menuItems(kind: TokenKind): Promise<MenuItem[]> { return asArray<any>(await this.request('/pos/items', { tokenKind: kind })).map(normalizeItem) }
  async printers(kind: TokenKind): Promise<Printer[]> {
    return asArray<any>(await this.request('/platform/printers', { tokenKind: kind })).map((value: any) => ({
      id: Number(value.id),
      name: String(value.name || value.printer_name || `Impresora ${value.id}`),
      branchId: value.branch_id == null ? undefined : Number(value.branch_id),
      printingChoice: value.printing_choice,
      printType: value.print_type,
      printFormat: value.print_format,
      isActive: value.is_active === undefined ? undefined : Boolean(Number(value.is_active)),
      isDefault: value.is_default === undefined ? undefined : Boolean(Number(value.is_default)),
      orders: Array.isArray(value.orders) ? value.orders : [],
    })).filter(printer => printer.id > 0)
  }
  async receiptSettings(kind: TokenKind): Promise<ReceiptSettings | null> {
    const value = unwrap<any>(await this.request('/platform/receipt-settings', { tokenKind: kind }))
    return value && typeof value === 'object' ? value as ReceiptSettings : null
  }
  async fiscalCapabilities(kind: TokenKind): Promise<Record<string, unknown> | null> {
    const value = unwrap<any>(await this.request('/platform/fiscal-capabilities', { tokenKind: kind }))
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  }
  async orderTypes(kind: TokenKind) { return asArray<any>(await this.request('/pos/order-types', { tokenKind: kind })) }
  async deliveryExecutives(kind: TokenKind): Promise<DeliveryExecutive[]> { return asArray<any>(await this.request('/pos/delivery-executives', { tokenKind: kind })).map((value: any) => ({ id: Number(value.id), name: String(value.name || `Repartidor ${value.id}`), phone: value.phone, status: value.status || value.status_raw })) }
  async deliverySettings(kind: TokenKind): Promise<DeliverySettings | null> { const value = await this.request<any>('/pos/delivery-settings', { tokenKind: kind }); const data = value?.data; if (!data) return null; return { ...data, is_enabled: data.is_enabled === true || data.is_enabled === 1 || data.is_enabled === '1', fixed_fee: data.fixed_fee == null ? null : Number(data.fixed_fee) } }
  async orders(kind: TokenKind) { return asArray<any>(await this.request('/pos/orders', { tokenKind: kind })) }
  async getOrder(kind: TokenKind, orderId: number) { return unwrap<any>(await this.request(`/pos/orders/${orderId}`, { tokenKind: kind })) }
  async printOrder(kind: TokenKind, orderId: number, idempotencyKey: string) { return this.request(`/pos/orders/${orderId}/print`, { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ document: 'prebill' }) }) }
  async payOrder(kind: TokenKind, orderId: number, amount: number, method: string, idempotencyKey: string) { return this.request(`/pos/orders/${orderId}/pay`, { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ amount, method }) }) }
  async paymentMethods(kind: TokenKind): Promise<PaymentMethodOption[]> {
    const payload = unwrap<any>(await this.request('/pos/payment-methods', { tokenKind: kind }))
    const values = Array.isArray(payload) ? payload : Array.isArray(payload?.methods) ? payload.methods : []
    return values.map((value: any) => ({
      code: String(value.code || value.method || ''),
      label: String(value.label || value.name || value.code || 'Método de pago'),
      enabled: value.enabled !== false && value.enabled !== 0 && value.enabled !== '0',
      requiresGateway: Boolean(value.requires_gateway ?? value.requiresGateway),
    })).filter((value: PaymentMethodOption) => value.code && value.enabled)
  }
  async issueFiscalDocument(kind: TokenKind, orderId: number, documentType: 'traditional' | 'electronic', receiptType?: string, idempotencyKey?: string, ecfType?: string) {
    return this.request(`/pos/orders/${orderId}/fiscal`, {
      method: 'POST',
      tokenKind: kind,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: JSON.stringify({
        document_type: documentType,
        receipt_type: documentType === 'traditional' ? receiptType : undefined,
        ecf_type: documentType === 'electronic' ? (ecfType || receiptType || 'E32') : undefined,
      }),
    })
  }
  async fiscalDocumentStatus(kind: TokenKind, orderId: number) { return this.request(`/pos/orders/${orderId}/fiscal`, { tokenKind: kind }) }
  async modifierGroups(kind: TokenKind, itemId: number): Promise<any[]> { return asArray<any>(await this.request(`/pos/items/${itemId}/modifier-groups`, { tokenKind: kind })) }
  async createOrder(kind: TokenKind, body: unknown, idempotencyKey: string) { return this.request('/pos/orders', { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }) }
  async updateOrder(kind: TokenKind, orderId: number, body: unknown, idempotencyKey: string) { return this.request(`/pos/orders/${orderId}`, { method: 'PUT', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }) }
  async updateOrderItems(kind: TokenKind, orderId: number, body: unknown, idempotencyKey: string) { return this.request(`/pos/orders/${orderId}/items`, { method: 'PUT', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }) }
  async createKot(kind: TokenKind, orderId: number, body: unknown, idempotencyKey: string) { return this.request(`/pos/orders/${orderId}/kot`, { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }) }
  async orderKots(kind: TokenKind, orderId: number): Promise<KitchenTicket[]> { return asArray<any>(await this.request(`/pos/orders/${orderId}/kots`, { tokenKind: kind })).map(normalizeKitchenTicket) }
  async kots(kind: TokenKind, params: { status?: string; date?: string; kitchenPlaceId?: number } = {}): Promise<KitchenTicket[]> {
    const query = new URLSearchParams()
    if (params.status) query.set('status', params.status)
    if (params.date) query.set('date', params.date)
    if (params.kitchenPlaceId) query.set('kitchen_place_id', String(params.kitchenPlaceId))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return asArray<any>(await this.request(`/pos/kots${suffix}`, { tokenKind: kind })).map(normalizeKitchenTicket)
  }
  async kotPlaces(kind: TokenKind): Promise<KitchenPlace[]> {
    return asArray<any>(await this.request('/pos/kot-places', { tokenKind: kind })).map(normalizeKitchenPlace)
  }
  async updateKotStatus(kind: TokenKind, kotId: number, status: string, idempotencyKey: string) { return this.request(`/pos/kots/${kotId}/status`, { method: 'PUT', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ status }) }) }
  async updateKotItemStatus(kind: TokenKind, kotItemId: number, status: string, idempotencyKey: string) { return this.request(`/pos/kot-items/${kotItemId}/status`, { method: 'PUT', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ status }) }) }
  async notifications(kind: TokenKind) { return asArray<any>(await this.request('/pos/notifications', { tokenKind: kind })) }
  async markNotificationRead(kind: TokenKind, notificationId: number) {
    return this.request(`/pos/notifications/${notificationId}/read`, { method: 'POST', tokenKind: kind })
  }
  async waiterRequests(kind: TokenKind, status: 'pending' | 'completed' | 'all' = 'pending'): Promise<WaiterRequest[]> {
    const payload = await this.request<any>(`/pos/waiter-requests?status=${encodeURIComponent(status)}`, { tokenKind: kind })
    return asArray<any>(payload).map(normalizeWaiterRequest).filter(Boolean) as WaiterRequest[]
  }
  async updateWaiterRequestStatus(kind: TokenKind, requestId: number, status: 'pending' | 'completed', idempotencyKey: string) {
    return this.request(`/pos/waiter-requests/${requestId}/status`, { method: 'PUT', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ status }) })
  }

  async cashRegisters(kind: TokenKind): Promise<any[]> {
    return asArray<any>(await this.request('/pos/cash-register/registers', { tokenKind: kind }))
  }

  async activeCashSession(kind: TokenKind): Promise<any | null> {
    try {
      return unwrap<any>(await this.request('/pos/cash-register/sessions/active', { tokenKind: kind }))
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) return null
      throw cause
    }
  }

  async cashSessionSummary(kind: TokenKind, sessionId: number): Promise<any> {
    return unwrap(await this.request(`/pos/cash-register/sessions/${sessionId}/summary`, { tokenKind: kind }))
  }

  async openCashSession(kind: TokenKind, body: unknown, idempotencyKey: string) {
    return this.request('/pos/cash-register/sessions/open', { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) })
  }

  async closeCashSession(kind: TokenKind, sessionId: number, body: unknown, idempotencyKey: string) {
    return this.request(`/pos/cash-register/sessions/${sessionId}/close`, { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) })
  }

  async approveCashSession(kind: TokenKind, sessionId: number, body: unknown, idempotencyKey: string) {
    return this.request(`/pos/cash-register/sessions/${sessionId}/approve`, { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) })
  }

  async rejectCashSession(kind: TokenKind, sessionId: number, body: unknown, idempotencyKey: string) {
    return this.request(`/pos/cash-register/sessions/${sessionId}/reject`, { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) })
  }

  async reopenCashSession(kind: TokenKind, sessionId: number, body: unknown, idempotencyKey: string) {
    return this.request(`/pos/cash-register/sessions/${sessionId}/reopen`, { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) })
  }

  async cashMovement(kind: TokenKind, movement: 'cash-in' | 'cash-out' | 'safe-drop', body: unknown, idempotencyKey: string) {
    return this.request(`/pos/cash-register/transactions/${movement}`, { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) })
  }

  async staffSchedules(kind: TokenKind, userId?: number): Promise<StaffSchedule[]> {
    const suffix = userId ? `?user_id=${encodeURIComponent(String(userId))}` : ''
    return asArray<any>(await this.request(`/staff/schedules${suffix}`, { tokenKind: kind })).map(normalizeStaffSchedule)
  }

  async createStaffSchedule(kind: TokenKind, body: unknown, idempotencyKey: string) {
    return this.request('/staff/schedules', { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) })
  }

  async updateStaffSchedule(kind: TokenKind, scheduleId: number, body: unknown, idempotencyKey: string) {
    return this.request(`/staff/schedules/${scheduleId}`, { method: 'PUT', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) })
  }

  async deleteStaffSchedule(kind: TokenKind, scheduleId: number, idempotencyKey: string) {
    return this.request(`/staff/schedules/${scheduleId}`, { method: 'DELETE', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey } })
  }

  async currentAttendance(kind: TokenKind): Promise<AttendanceRecord | null> {
    try {
      const payload = await this.request<any>('/staff/attendance/current', { tokenKind: kind })
      const value = unwrap<any>(payload)
      const record = value?.attendance ?? value?.current ?? value?.data ?? value
      return record && typeof record === 'object' && record.id ? normalizeAttendance(record) : null
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) return null
      throw cause
    }
  }

  async clockIn(kind: TokenKind, deviceId: string, idempotencyKey: string) {
    return this.request('/staff/attendance/clock-in', { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ device_id: deviceId }) })
  }

  async clockOut(kind: TokenKind, idempotencyKey: string) {
    return this.request('/staff/attendance/clock-out', { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({}) })
  }

  async attendanceHistory(kind: TokenKind, params: { from?: string; to?: string; userId?: number } = {}): Promise<AttendanceRecord[]> {
    const query = new URLSearchParams()
    if (params.from) query.set('from', params.from)
    if (params.to) query.set('to', params.to)
    if (params.userId) query.set('user_id', String(params.userId))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return asArray<any>(await this.request(`/staff/attendance/history${suffix}`, { tokenKind: kind })).map(normalizeAttendance)
  }
}

export function normalizeTable(raw: any): RestaurantTable {
  const status = String(raw.ui_status || raw.available_status || raw.status || raw.table_status || 'available').toLowerCase()
  const map: Record<string, RestaurantTable['status']> = { libre: 'available', available: 'available', running: 'occupied', ocupada: 'occupied', ocupada_orden_abierta: 'occupied', occupied: 'occupied', reservada: 'occupied', esperando: 'waiting_kitchen', waiting: 'waiting_kitchen', waiting_kitchen: 'waiting_kitchen', listo: 'food_ready', ready: 'food_ready', food_ready: 'food_ready', por_cobrar: 'bill_requested', cuenta: 'bill_requested', bill_requested: 'bill_requested', locked: 'locked', bloqueada: 'locked', cerrada: 'locked', closed: 'locked' }
  const number = raw.table_code || raw.number || raw.table_number || raw.name || raw.table_name || raw.id
  const rawOrderNumber = raw.current_order_number ?? raw.order_number
  const currentOrderNumber = rawOrderNumber == null ? undefined : String(rawOrderNumber).replace(/^(order|orden)\s*#?/i, '').replace(/^#/, '')
  const paymentState = String(raw.payment_status || raw.order_payment_status || raw.order?.status || '').toLowerCase()
  const progressState = String(raw.order_status || raw.current_order_status || raw.kitchen_status || '').toLowerCase()
  const progressMap: Record<string, RestaurantTable['status']> = { preparing: 'waiting_kitchen', food_ready: 'food_ready', ready_for_pickup: 'food_ready' }
  // The production floor endpoint uses `por_cobrar` for every unpaid active
  // order, not only when a waiter explicitly requests the bill. Keep those
  // tables red/occupied; reserve blue for an explicit billing state.
  const displayStatus = status === 'por_cobrar' && !['billed', 'payment_due', 'bill_requested'].includes(paymentState) ? progressMap[progressState] || 'occupied' : map[status] || 'unknown'
  return { id: Number(raw.id), name: raw.name || raw.table_name || raw.table_code || `Mesa ${raw.id}`, number: String(number), capacity: Number(raw.seating_capacity || raw.capacity || raw.seats || 2), status: displayStatus, area: raw.area?.name || raw.area_name, waiter: raw.waiter?.name || raw.waiter_name, currentOrderId: raw.current_order_id ?? raw.order_id, currentOrderNumber, currentOrderStatus: raw.order_status || raw.current_order_status, currentOrderTotal: raw.order_total ?? raw.current_order_total, currentOrderDue: raw.amount_due ?? raw.current_order_due, customerId: raw.customer_id ?? raw.order_customer_id, customerName: raw.customer_name || raw.order_customer_name || raw.customer?.name || raw.order?.customer?.name, customerPhone: raw.customer_phone || raw.order_customer_phone || raw.customer?.phone || raw.order?.customer?.phone, guestCount: raw.guest_count || raw.number_of_pax, kitchenStatus: raw.kitchen_status || raw.order_status, position: raw.position }
}

export function normalizeItem(raw: any): MenuItem {
  const dineInPrice = (raw.prices || []).find((value: any) => value?.order_type?.order_type_name === 'Comer aquí' || value?.order_type?.translated_name === 'Dine In')?.final_price
  const allergens = raw.allergens || raw.eu_allergen_keys || []
  const dietaryTags = raw.dietary_tags || raw.dietary_labels || raw.tags || []
  const computedPhotoUrl = raw.item_photo_url || raw.itemPhotoUrl
  const hasRealComputedPhoto = typeof computedPhotoUrl === 'string' && computedPhotoUrl.trim() && !/(?:^|\/)food\.svg(?:\?|$)/i.test(computedPhotoUrl) && !/(?:^|\/)transparent\.svg(?:\?|$)/i.test(computedPhotoUrl)
  const imageSource = raw.image_url || raw.imageUrl || raw.photo_url || raw.thumbnail_url || raw.image?.url || raw.image?.path || raw.photo?.url || raw.images?.[0]?.url || raw.images?.[0]?.path || (hasRealComputedPhoto ? computedPhotoUrl : undefined)
  return { id: Number(raw.id), name: raw.name || raw.item_name || raw.menu_item_name || `Producto ${raw.id}`, imageUrl: normalizeMediaUrl(imageSource), code: raw.code || raw.item_code || raw.sku || String(raw.id), price: Number(dineInPrice ?? raw.price ?? raw.selling_price ?? raw.final_price ?? 0), categoryId: raw.category_id || raw.item_category_id, categoryName: raw.category_name || raw.category?.name || raw.category || raw.item_category?.name || `Categoría ${raw.item_category_id || ''}`.trim(), available: raw.available !== false && raw.is_available !== false && raw.in_stock !== 0 && raw.status !== 'sold_out', availabilityReason: raw.availability_reason || raw.reason || (raw.in_stock === 0 ? 'Sin existencia' : undefined), allergens: (Array.isArray(allergens) ? allergens : String(allergens).split(',').filter(Boolean)).map((x: any) => typeof x === 'string' ? x : x.name || x.code || x.key), dietaryTags: (Array.isArray(dietaryTags) ? dietaryTags : String(dietaryTags).split(',').filter(Boolean)).map((x: any) => typeof x === 'string' ? x : x.name || x.code), modifiers: raw.modifiers || raw.modifier_groups }
}

export function normalizeKitchenTicket(raw: any): KitchenTicket {
  const orderType = raw.order_type?.name || raw.order_type?.order_type_name || raw.order_type || raw.order_type_name
  const items = Array.isArray(raw.items) ? raw.items : []
  return {
    id: Number(raw.id),
    kotNumber: raw.kot_number || raw.kotNumber,
    tokenNumber: raw.token_number || raw.tokenNumber,
    orderId: Number(raw.order_id || raw.order?.id),
    orderNumber: raw.order_number || raw.formatted_order_number || raw.order?.formatted_order_number || raw.order?.order_number,
    orderType: orderType ? String(orderType) : undefined,
    tableName: raw.table_name || raw.table_code || raw.table?.table_code || raw.table?.name,
    tableId: raw.table_id ?? raw.table?.id,
    kitchenPlace: raw.kitchen_place?.name || raw.kitchen_place || raw.kitchenPlace,
    kitchenPlaceId: raw.kitchen_place_id ?? raw.kitchenPlaceId,
    status: String(raw.status || 'pending_confirmation').toLowerCase(),
    note: raw.note || undefined,
    items: items.map((item: any) => ({
      id: Number(item.id),
      orderItemId: item.order_item_id ?? item.orderItemId,
      menuItemId: item.menu_item_id ?? item.menuItemId,
      name: String(item.name || item.menu_item_name || 'Producto'),
      quantity: Math.max(1, Number(item.quantity || 1)),
      status: item.status ? String(item.status).toLowerCase() : undefined,
      note: item.note || undefined,
      variation: item.variation || item.variation_name || undefined,
      modifiers: Array.isArray(item.modifiers) ? item.modifiers.map((modifier: any) => ({ id: Number(modifier.id), name: String(modifier.name || modifier.option_name || 'Opción') })) : undefined,
    })),
    createdAt: raw.created_at || raw.createdAt,
    updatedAt: raw.updated_at || raw.updatedAt,
  }
}

export function normalizeKitchenPlace(raw: any): KitchenPlace {
  return {
    id: Number(raw?.id || 0),
    name: String(raw?.name || raw?.title || raw?.label || `Estación ${raw?.id || ''}`).trim(),
    type: raw?.type == null ? undefined : String(raw.type),
    isDefault: raw?.is_default === true || raw?.isDefault === true || raw?.is_default === 1,
    printerId: raw?.printer_id == null && raw?.printerId == null ? undefined : Number(raw.printer_id ?? raw.printerId),
  }
}

export function normalizeStaffSchedule(raw: any): StaffSchedule {
  const days = raw.days || raw.day_of_week || raw.days_of_week || []
  return {
    id: Number(raw.id),
    userId: Number(raw.user_id || raw.user?.id || 0),
    userName: raw.user_name || raw.user?.name,
    branchId: raw.branch_id == null ? undefined : Number(raw.branch_id),
    branchName: raw.branch_name || raw.branch?.name,
    shiftName: raw.shift_name || raw.name,
    days: Array.isArray(days) ? days.map(String) : String(days).split(',').map(value => value.trim()).filter(Boolean),
    startTime: String(raw.start_time || raw.startTime || ''),
    endTime: String(raw.end_time || raw.endTime || ''),
    timezone: String(raw.timezone || 'UTC'),
    isActive: raw.is_active !== false && raw.is_active !== 0,
  }
}

export function normalizeAttendance(raw: any): AttendanceRecord {
  const status = String(raw.status || (raw.clock_out_at ? 'closed' : 'active')).toLowerCase()
  return {
    id: Number(raw.id),
    userId: Number(raw.user_id || raw.user?.id || 0),
    userName: raw.user_name || raw.user?.name,
    branchId: raw.branch_id == null ? undefined : Number(raw.branch_id),
    branchName: raw.branch_name || raw.branch?.name,
    clockInAt: String(raw.clock_in_at || raw.clockInAt || raw.started_at || ''),
    clockOutAt: raw.clock_out_at || raw.clockOutAt || raw.ended_at || undefined,
    localDate: raw.local_date || raw.localDate,
    timezone: String(raw.timezone || 'UTC'),
    status,
    source: raw.source,
    deviceId: raw.device_id,
  }
}

export function normalizeWaiterRequest(raw: any): WaiterRequest | null {
  if (!raw || typeof raw !== 'object' || raw.id == null) return null
  const tableCode = raw.table_code || raw.tableCode || raw.table?.table_code || raw.table?.number
  return {
    id: Number(raw.id),
    branchId: Number(raw.branch_id || raw.branchId || 0),
    tableId: Number(raw.table_id || raw.tableId || raw.table?.id || 0),
    tableCode: tableCode == null ? undefined : String(tableCode),
    tableName: String(raw.table_name || raw.tableName || (tableCode ? `Mesa ${tableCode}` : `Mesa ${raw.table_id || raw.tableId || ''}`)).trim(),
    status: String(raw.status || 'pending').toLowerCase(),
    createdAt: raw.created_at || raw.createdAt,
    updatedAt: raw.updated_at || raw.updatedAt,
  }
}

function normalizeMediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const source = value.trim()
  if (/^(data:|blob:|https?:\/\/)/i.test(source)) return source
  try {
    const origin = new URL(API_BASE_URL).origin
    return new URL(source.startsWith('/') ? source : `/${source}`, origin).toString()
  } catch {
    return source
  }
}

export const api = new ApiClient()
