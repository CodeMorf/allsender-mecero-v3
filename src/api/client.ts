import type { ApiErrorShape, AttendanceRecord, Branch, DeliveryExecutive, DeliveryOrder, DeliveryOrderItem, DeliveryPlatform, DeliverySettings, DeviceBinding, FiscalCapabilities, KitchenPlace, KitchenTicket, MenuCategory, MenuItem, OrderTypeConfig, PaymentMethodOption, PosCustomer, Printer, ProductVariation, ReceiptSettings, RestaurantTable, Session, StaffRole, StaffSchedule, TokenKind, WaiterRequest } from '../types'

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
  private kotsInFlight = new Map<string, Promise<KitchenTicket[]>>()

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
    const token = tokenKind 
      ? (this.tokens[tokenKind] || (tokenKind === 'pin' ? this.tokens['admin'] : this.tokens['pin']))
      : (this.tokens['pin'] || this.tokens['admin'])
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
  async categories(kind: TokenKind): Promise<MenuCategory[]> { return asArray<any>(await this.request('/pos/categories', { tokenKind: kind })).map(normalizeCategory).filter(category => category.id > 0 && category.name !== '') }
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
  async orderTypes(kind: TokenKind): Promise<OrderTypeConfig[]> {
    return asArray<any>(await this.request('/pos/order-types', { tokenKind: kind })).map((ot: any) => ({
      id: Number(ot.id),
      slug: (ot.slug || ot.type || 'dine_in') as any,
      order_type_name: String(ot.order_type_name || ot.name || ot.slug || 'Tipo'),
      type: String(ot.type || ot.slug || '')
    }))
  }
  async deliveryPlatforms(kind: TokenKind): Promise<DeliveryPlatform[]> {
    return asArray<any>(await this.request('/pos/delivery-platforms', { tokenKind: kind })).map((p: any) => ({
      id: Number(p.id),
      name: String(p.name || `Plataforma ${p.id}`),
      logo: p.logo,
      logo_url: p.logo_url
    }))
  }
  async deliveryExecutives(kind: TokenKind, status?: string): Promise<DeliveryExecutive[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : ''
    return asArray<any>(await this.request(`/pos/delivery-executives${query}`, { tokenKind: kind })).map((value: any) => ({
      id: Number(value.id),
      name: String(value.name || `Repartidor ${value.id}`),
      phone: value.phone,
      phone_code: value.phone_code,
      status: value.status || value.status_raw
    }))
  }

  async createDeliveryExecutive(kind: TokenKind, body: { name: string; phone?: string; phone_code?: string; status?: string }): Promise<DeliveryExecutive> {
    const res = await this.request<any>('/pos/delivery-executives', {
      method: 'POST',
      tokenKind: kind,
      body: JSON.stringify(body),
    })
    const data = unwrap<any>(res)
    return {
      id: Number(data.id),
      name: String(data.name),
      phone: data.phone,
      phone_code: data.phone_code,
      status: data.status || 'available',
    }
  }

  async updateDeliveryExecutive(kind: TokenKind, id: number, body: { name?: string; phone?: string; phone_code?: string; status?: string }): Promise<DeliveryExecutive> {
    const res = await this.request<any>(`/pos/delivery-executives/${id}`, {
      method: 'PUT',
      tokenKind: kind,
      body: JSON.stringify(body),
    })
    const data = unwrap<any>(res)
    return {
      id: Number(data.id),
      name: String(data.name),
      phone: data.phone,
      phone_code: data.phone_code,
      status: data.status,
    }
  }

  async deleteDeliveryExecutive(kind: TokenKind, id: number): Promise<void> {
    await this.request(`/pos/delivery-executives/${id}`, {
      method: 'DELETE',
      tokenKind: kind,
    })
  }

  async deliveryOrders(kind: TokenKind, params: { status?: string; deliveryExecutiveId?: number; deliveryAppId?: number; date?: string; limit?: number; offset?: number } = {}): Promise<DeliveryOrder[]> {
    const query = new URLSearchParams()
    if (params.status) query.set('status', params.status)
    if (params.deliveryExecutiveId) query.set('delivery_executive_id', String(params.deliveryExecutiveId))
    if (params.deliveryAppId) query.set('delivery_app_id', String(params.deliveryAppId))
    if (params.date) query.set('date', params.date)
    if (params.limit) query.set('limit', String(params.limit))
    if (params.offset) query.set('offset', String(params.offset))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    const payload = await this.request<any>(`/pos/delivery-orders${suffix}`, { tokenKind: kind })
    return asArray<any>(payload).map(normalizeDeliveryOrder)
  }

  async assignDeliveryExecutive(kind: TokenKind, orderId: number, body: { deliveryExecutiveId?: number; deliveryAppId?: number }, idempotencyKey?: string) {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
    return this.request(`/pos/orders/${orderId}/assign-delivery`, {
      method: 'PUT',
      tokenKind: kind,
      headers,
      body: JSON.stringify({
        delivery_executive_id: body.deliveryExecutiveId,
        delivery_app_id: body.deliveryAppId,
      }),
    })
  }

  async updateDeliveryStatus(kind: TokenKind, orderId: number, status: string, idempotencyKey?: string) {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
    return this.request(`/pos/orders/${orderId}/delivery-status`, {
      method: 'PUT',
      tokenKind: kind,
      headers,
      body: JSON.stringify({ status }),
    })
  }

  async deliverySettings(kind: TokenKind): Promise<DeliverySettings | null> { const value = await this.request<any>('/pos/delivery-settings', { tokenKind: kind }); const data = value?.data; if (!data) return null; return { ...data, is_enabled: data.is_enabled === true || data.is_enabled === 1 || data.is_enabled === '1', fixed_fee: data.fixed_fee == null ? null : Number(data.fixed_fee) } }

  async customers(kind: TokenKind, search = ''): Promise<PosCustomer[]> {
    const query = search ? `?search=${encodeURIComponent(search)}` : ''
    return asArray<any>(await this.request(`/pos/customers${query}`, { tokenKind: kind })).map(normalizeCustomer)
  }
  async lookupDgiiRnc(rawRnc: string, kind: TokenKind = 'pin'): Promise<{
    found: boolean
    name?: string
    fiscalName?: string
    commercialName?: string
    rncCedula?: string
    status?: string
    regime?: string
    isElectronic?: boolean
    message?: string
  }> {
    const digits = rawRnc.replace(/\D/g, '').trim()
    if (!digits || (digits.length !== 9 && digits.length !== 11)) {
      return { found: false, message: 'El RNC debe tener 9 dígitos o la Cédula 11 dígitos' }
    }
    try {
      // 1. Intentar a través del proxy del backend (evita bloqueo CORS en el navegador)
      const tokenKindToUse: TokenKind = this.getToken(kind) ? kind : (this.getToken('admin') ? 'admin' : (this.getToken('pin') ? 'pin' : kind))
      const res = await this.request<any>('/pos/customers/dgii-lookup', {
        method: 'POST',
        tokenKind: tokenKindToUse,
        body: JSON.stringify({ rnc: digits }),
      })
      if (res && res.found) {
        const fiscalName = (res.fiscal_name || '').trim()
        const commName = (res.commercial_name || '').trim()
        return {
          found: true,
          name: commName || fiscalName,
          fiscalName,
          commercialName: commName || undefined,
          rncCedula: res.rnc_cedula || digits,
          status: res.status || 'ACTIVO',
          regime: res.regime || 'NORMAL',
          isElectronic: res.is_electronic === true,
          message: res.message || `✓ DGII: ${commName || fiscalName}`
        }
      }
      if (res && res.message) {
        return { found: false, message: res.message }
      }
    } catch (e: any) {
      const errMsg = e?.message || ''
      // Las identificaciones fiscales nunca salen del navegador: si el proxy
      // falla, mostramos un mensaje neutro y dejamos el dato para entrada manual.
      return {
        found: false,
        message: errMsg && !errMsg.includes('502') && !errMsg.includes('Failed to fetch')
          ? errMsg
          : 'No se pudo conectar con el servicio de la DGII',
      }
    }

    return { found: false, message: 'No se pudo conectar con el servicio de la DGII' }
  }
  async getCustomer(kind: TokenKind, customerId: number): Promise<PosCustomer> {
    return normalizeCustomer(unwrap<any>(await this.request(`/pos/customers/${customerId}`, { tokenKind: kind })))
  }
  async saveCustomer(kind: TokenKind, payload: Partial<PosCustomer>): Promise<PosCustomer> {
    const body: Record<string, unknown> = {
      name: payload.name,
      phone_code: payload.phoneCode || '1',
      phone: payload.phone || null,
      email: payload.email || null,
      address: payload.deliveryAddress || null,
    }
    if (payload.id && payload.id > 0) {
      body.id = payload.id
      body.customer_id = payload.id
    }
    if (payload.rncCedula) body.rnc_cedula = payload.rncCedula
    if (payload.fiscalName) body.fiscal_name = payload.fiscalName
    if (payload.commercialName) body.commercial_name = payload.commercialName
    if (payload.dgiiStatus) body.dgii_status = payload.dgiiStatus
    if (payload.dgiiTaxRegime) body.dgii_tax_regime = payload.dgiiTaxRegime
    if (payload.dgiiIsElectronicBiller !== undefined) body.dgii_is_electronic_biller = payload.dgiiIsElectronicBiller
    const path = payload.id && payload.id > 0 ? `/pos/customers/${payload.id}` : '/pos/customers'
    const method = payload.id && payload.id > 0 ? 'PUT' : 'POST'
    const res = await this.request<any>(path, { method, tokenKind: kind, body: JSON.stringify(body) })
    const data = unwrap<any>(res)
    const customer = data?.customer ?? data
    return normalizeCustomer(customer)
  }
  async orders(kind: TokenKind) { return asArray<any>(await this.request('/pos/orders', { tokenKind: kind })) }
  async getOrder(kind: TokenKind, orderId: number) { return unwrap<any>(await this.request(`/pos/orders/${orderId}`, { tokenKind: kind })) }
  async printOrder(kind: TokenKind, orderId: number, document: 'prebill' | 'receipt' | 'fiscal', idempotencyKey: string) {
    return this.request(`/pos/orders/${orderId}/print`, {
      method: 'POST',
      tokenKind: kind,
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ document }),
    })
  }
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
  async issueFiscalDocument(
    kind: TokenKind,
    orderId: number,
    documentType: 'traditional' | 'electronic',
    receiptType?: string,
    idempotencyKey?: string,
    ecfType?: string,
    customer?: { rncCedula?: string; fiscalName?: string },
  ) {
    return this.request(`/pos/orders/${orderId}/fiscal`, {
      method: 'POST',
      tokenKind: kind,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: JSON.stringify({
        document_type: documentType,
        receipt_type: documentType === 'traditional' ? receiptType : undefined,
        ecf_type: documentType === 'electronic' ? (ecfType || receiptType || 'E32') : undefined,
        customer_rnc_cedula: customer?.rncCedula || undefined,
        customer_fiscal_name: customer?.fiscalName || undefined,
      }),
    })
  }
  async fiscalCapabilities(kind: TokenKind): Promise<FiscalCapabilities | null> {
    try {
      return unwrap<any>(await this.request('/platform/fiscal-capabilities', { tokenKind: kind })) as FiscalCapabilities
    } catch {
      return null
    }
  }
  async fiscalDocumentStatus(kind: TokenKind, orderId: number) { return this.request(`/pos/orders/${orderId}/fiscal`, { tokenKind: kind }) }
  async modifierGroups(kind: TokenKind, itemId: number): Promise<any[]> { return asArray<any>(await this.request(`/pos/items/${itemId}/modifier-groups`, { tokenKind: kind })) }
  async itemVariations(kind: TokenKind, itemId: number): Promise<Array<{ id: number; name: string; price: number }>> {
    return asArray<any>(await this.request(`/pos/items/${itemId}/variations`, { tokenKind: kind })).map((v: any) => ({
      id: Number(v.id),
      name: String(v.name || v.variation_name || v.title || 'Variación'),
      price: Number(v.price ?? v.amount ?? 0),
    })).filter(v => v.id > 0)
  }
  async createOrder(kind: TokenKind, body: unknown, idempotencyKey: string) { return this.request('/pos/orders', { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }) }
  async updateOrder(kind: TokenKind, orderId: number, body: unknown, idempotencyKey: string) { return this.request(`/pos/orders/${orderId}`, { method: 'PUT', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }) }
  async updateOrderStatus(kind: TokenKind, orderId: number, status: string, idempotencyKey: string) { return this.request(`/pos/orders/${orderId}/status`, { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ status }) }) }
  async cancelOrder(kind: TokenKind, orderId: number, idempotencyKey: string) {
    try {
      return await this.updateOrder(kind, orderId, { actions: ['cancel'] }, idempotencyKey)
    } catch {
      return await this.updateOrderStatus(kind, orderId, 'cancelled', idempotencyKey)
    }
  }
  async updateOrderItems(kind: TokenKind, orderId: number, body: unknown, idempotencyKey: string) { return this.request(`/pos/orders/${orderId}/items`, { method: 'PUT', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }) }
  async createKot(kind: TokenKind, orderId: number, body: unknown, idempotencyKey: string) { return this.request(`/pos/orders/${orderId}/kot`, { method: 'POST', tokenKind: kind, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }) }
  async orderKots(kind: TokenKind, orderId: number): Promise<KitchenTicket[]> { return asArray<any>(await this.request(`/pos/orders/${orderId}/kots`, { tokenKind: kind })).map(normalizeKitchenTicket) }
  async kots(kind: TokenKind, params: { status?: string; date?: string; kitchenPlaceId?: number } = {}): Promise<KitchenTicket[]> {
    const query = new URLSearchParams()
    if (params.status) query.set('status', params.status)
    if (params.date) query.set('date', params.date)
    if (params.kitchenPlaceId) query.set('kitchen_place_id', String(params.kitchenPlaceId))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    const requestKey = `${kind}:${this.tokens[kind] || 'no-token'}:${suffix}`
    const inFlight = this.kotsInFlight.get(requestKey)
    if (inFlight) return inFlight
    const request = this.request(`/pos/kots${suffix}`, { tokenKind: kind }).then(payload => asArray<any>(payload).map(normalizeKitchenTicket))
    this.kotsInFlight.set(requestKey, request)
    try { return await request }
    finally { if (this.kotsInFlight.get(requestKey) === request) this.kotsInFlight.delete(requestKey) }
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

  async printCashSession(kind: TokenKind, sessionId: number, reportType: 'x_report' | 'z_report' = 'z_report', idempotencyKey?: string) {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
    return this.request(`/pos/cash-register/sessions/${sessionId}/print`, {
      method: 'POST',
      tokenKind: kind,
      headers,
      body: JSON.stringify({ report_type: reportType }),
    })
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
  const activeOrder = raw.active_order || raw.activeOrder || raw.order
  const status = String(raw.ui_status || raw.available_status || (raw.status !== 'active' ? raw.status : undefined) || 'available').toLowerCase()
  const map: Record<string, RestaurantTable['status']> = {
    libre: 'available',
    available: 'available',
    active: 'available',
    running: 'occupied',
    ocupada: 'occupied',
    ocupada_orden_abierta: 'occupied',
    occupied: 'occupied',
    reservada: 'occupied',
    esperando: 'waiting_kitchen',
    waiting: 'waiting_kitchen',
    waiting_kitchen: 'waiting_kitchen',
    listo: 'food_ready',
    ready: 'food_ready',
    food_ready: 'food_ready',
    por_cobrar: 'bill_requested',
    cuenta: 'bill_requested',
    bill_requested: 'bill_requested',
    locked: 'locked',
    bloqueada: 'locked',
    cerrada: 'locked',
    closed: 'locked'
  }
  const number = raw.table_code || raw.number || raw.table_number || raw.name || raw.table_name || raw.id
  const rawOrderNumber = raw.current_order_number ?? raw.order_number ?? activeOrder?.order_number
  const currentOrderNumber = rawOrderNumber == null ? undefined : String(rawOrderNumber).replace(/^(order|orden)\s*#?/i, '').replace(/^#/, '')
  const paymentState = String(raw.payment_status || raw.order_payment_status || raw.order?.status || activeOrder?.status || '').toLowerCase()
  const progressState = String(raw.order_status || raw.current_order_status || raw.kitchen_status || activeOrder?.order_status || activeOrder?.status || '').toLowerCase()
  const progressMap: Record<string, RestaurantTable['status']> = { preparing: 'waiting_kitchen', food_ready: 'food_ready', ready_for_pickup: 'food_ready', kot: 'waiting_kitchen', billed: 'bill_requested' }
  const displayStatus = status === 'por_cobrar' && !['billed', 'payment_due', 'bill_requested'].includes(paymentState)
    ? (progressMap[progressState] || 'occupied')
    : (raw.is_locked ? 'locked' : (activeOrder && status === 'running' ? (progressMap[progressState] || 'occupied') : (map[status] || 'available')))
  const customerRnc = raw.customer_rnc || raw.order_customer_rnc || raw.customer?.rnc_cedula || raw.customer?.rncCedula || raw.order?.customer?.rnc_cedula || raw.order?.customer?.rncCedula || raw.order?.rnc_cedula || activeOrder?.customer?.rnc_cedula || undefined
  const customerFiscalName = raw.customer_fiscal_name || raw.order_customer_fiscal_name || raw.customer?.fiscal_name || raw.customer?.fiscalName || raw.order?.customer?.fiscal_name || raw.order?.customer?.fiscalName || raw.order?.fiscal_name || activeOrder?.customer?.fiscal_name || undefined
  const currentOrderId = raw.current_order_id ?? raw.order_id ?? activeOrder?.id
  const currentOrderTotal = raw.order_total ?? raw.current_order_total ?? (activeOrder?.total != null ? Number(activeOrder.total) : undefined)
  const currentOrderDue = raw.amount_due ?? raw.current_order_due ?? (activeOrder?.total != null ? Math.max(0, Number(activeOrder.total) - Number(activeOrder.amount_paid || 0)) : undefined)
  const currentOrderStatus = raw.order_status || raw.current_order_status || activeOrder?.order_status || activeOrder?.status

  return {
    id: Number(raw.id),
    name: raw.name || raw.table_name || raw.table_code || `Mesa ${raw.id}`,
    number: String(number),
    capacity: Number(raw.seating_capacity || raw.capacity || raw.seats || 2),
    status: displayStatus,
    area: raw.area?.name || raw.area?.area_name || raw.area_name,
    waiter: raw.waiter?.name || raw.waiter_name,
    currentOrderId,
    currentOrderNumber,
    currentOrderStatus,
    currentOrderTotal,
    currentOrderDue,
    customerId: raw.customer_id ?? raw.order_customer_id ?? activeOrder?.customer_id,
    customerName: raw.customer_name || raw.order_customer_name || raw.customer?.name || raw.order?.customer?.name || activeOrder?.customer?.name,
    customerPhone: raw.customer_phone || raw.order_customer_phone || raw.customer?.phone || raw.order?.customer?.phone || activeOrder?.customer?.phone,
    customerRnc,
    customerFiscalName,
    guestCount: raw.guest_count || raw.number_of_pax || activeOrder?.number_of_pax,
    kitchenStatus: raw.kitchen_status || raw.order_status || activeOrder?.status,
    position: raw.position
  }
}

export function normalizeItem(raw: any): MenuItem {
  const dineInPrice = (raw.prices || []).find((value: any) => value?.order_type?.order_type_name === 'Comer aquí' || value?.order_type?.translated_name === 'Dine In')?.final_price
  const allergens = raw.allergens || raw.eu_allergen_keys || []
  const dietaryTags = raw.dietary_tags || raw.dietary_labels || raw.tags || []
  const rawVariations = raw.variations ?? raw.item_variations ?? raw.menu_item_variations
  const variations: ProductVariation[] | undefined = Array.isArray(rawVariations)
    ? rawVariations.map((variation: any) => ({
      id: Number(variation.id),
      name: String(variation.name || variation.variation || variation.variation_name || variation.title || `Variación ${variation.id}`),
      price: Number(variation.price ?? variation.final_price ?? variation.amount ?? 0),
    })).filter((variation: ProductVariation) => variation.id > 0)
    : undefined
  const computedPhotoUrl = raw.item_photo_url || raw.itemPhotoUrl
  const hasRealComputedPhoto = typeof computedPhotoUrl === 'string' && computedPhotoUrl.trim() && !/(?:^|\/)food\.svg(?:\?|$)/i.test(computedPhotoUrl) && !/(?:^|\/)transparent\.svg(?:\?|$)/i.test(computedPhotoUrl)
  const imageSource = raw.image_url || raw.imageUrl || raw.photo_url || raw.thumbnail_url || raw.image?.url || raw.image?.path || raw.photo?.url || raw.images?.[0]?.url || raw.images?.[0]?.path || (hasRealComputedPhoto ? computedPhotoUrl : undefined)
  const categoryValue = raw.category_name || raw.category?.name || raw.category?.title || raw.category?.label || (typeof raw.category === 'string' ? raw.category : undefined) || raw.item_category?.name || raw.item_category?.title || (typeof raw.item_category === 'string' ? raw.item_category : undefined)
  const categoryName = typeof categoryValue === 'string' && categoryValue.trim() ? categoryValue.trim() : `Categoría ${raw.category_id || raw.item_category_id || ''}`.trim()
  return { id: Number(raw.id), name: raw.name || raw.item_name || raw.menu_item_name || `Producto ${raw.id}`, imageUrl: normalizeMediaUrl(imageSource), code: raw.code || raw.item_code || raw.sku || String(raw.id), price: Number(dineInPrice ?? raw.price ?? raw.selling_price ?? raw.final_price ?? 0), categoryId: raw.category_id || raw.item_category_id, categoryName, available: raw.available !== false && raw.is_available !== false && raw.in_stock !== 0 && raw.status !== 'sold_out', availabilityReason: raw.availability_reason || raw.reason || (raw.in_stock === 0 ? 'Sin existencia' : undefined), allergens: (Array.isArray(allergens) ? allergens : String(allergens).split(',').filter(Boolean)).map((x: any) => typeof x === 'string' ? x : x.name || x.code || x.key), dietaryTags: (Array.isArray(dietaryTags) ? dietaryTags : String(dietaryTags).split(',').filter(Boolean)).map((x: any) => typeof x === 'string' ? x : x.name || x.code), modifiers: raw.modifiers || raw.modifier_groups, variations }
}

export function normalizeCategory(raw: any): MenuCategory {
  const rawName = raw.category_name ?? raw.name ?? raw.title ?? raw.label
  const name = typeof rawName === 'object' && rawName !== null
    ? rawName['es-do'] || rawName.es || rawName.en || Object.values(rawName).find(value => typeof value === 'string')
    : rawName
  return {
    id: Number(raw.id ?? raw.category_id),
    name: typeof name === 'string' ? name.trim() : '',
    count: raw.count == null ? undefined : Number(raw.count),
    sortOrder: raw.sort_order == null ? (raw.sortOrder == null ? undefined : Number(raw.sortOrder)) : Number(raw.sort_order),
  }
}

export function applyCategoryMetadata(items: MenuItem[], categories: MenuCategory[]): MenuItem[] {
  const categoryById = new Map(categories.map(category => [category.id, category]))
  return items.map(item => {
    const category = item.categoryId == null ? undefined : categoryById.get(Number(item.categoryId))
    return category
      ? { ...item, categoryName: category.name, categorySortOrder: category.sortOrder }
      : item
  })
}

export function normalizeKitchenTicket(raw: any): KitchenTicket {
  const order = raw?.order && typeof raw.order === 'object' ? raw.order : {}
  const orderType = raw.order_type?.name || raw.order_type?.order_type_name || raw.order_type || raw.order_type_name || order.order_type?.name || order.order_type?.order_type_name || order.order_type
  const waiter = raw.waiter || order.waiter || order.waiter_user || {}
  const firstText = (...values: any[]) => values.find(value => typeof value === 'string' && value.trim())?.trim()
  const items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.kot_items) ? raw.kot_items : []
  return {
    id: Number(raw.id),
    kotNumber: raw.kot_number || raw.kotNumber,
    tokenNumber: raw.token_number || raw.tokenNumber,
    orderId: Number(raw.order_id || order.id),
    orderNumber: raw.order_number || raw.formatted_order_number || order.formatted_order_number || order.order_number,
    orderType: orderType ? String(orderType) : undefined,
    waiterName: firstText(raw.waiter_name, raw.waiter?.name, waiter.name, waiter.full_name, order.waiter_name),
    tableName: raw.table_name || raw.table_code || raw.table?.table_code || raw.table?.name || order.table?.table_code || order.table?.name,
    tableId: raw.table_id ?? raw.table?.id ?? order.table_id ?? order.table?.id,
    kitchenPlace: raw.kitchen_place?.name || raw.kitchen_place || raw.kitchenPlace || raw.kot_place?.name || raw.kot_place,
    kitchenPlaceId: raw.kitchen_place_id ?? raw.kitchenPlaceId,
    status: String(raw.status || 'pending_confirmation').toLowerCase(),
    note: firstText(raw.note, raw.notes, raw.order_note, order.note, order.notes),
    items: items.map((item: any) => ({
      id: Number(item.id),
      orderItemId: item.order_item_id ?? item.orderItemId ?? item.order_item?.id,
      menuItemId: item.menu_item_id ?? item.menuItemId ?? item.order_item?.menu_item_id,
      name: String(item.name || item.menu_item_name || item.menuItem?.name || item.menu_item?.name || item.order_item?.menu_item?.name || 'Producto'),
      quantity: Math.max(1, Number(item.quantity || 1)),
      status: item.status ? String(item.status).toLowerCase() : undefined,
      note: firstText(item.note, item.notes, item.kot_item_note, item.order_item?.note),
      variation: firstText(item.variation?.name, item.variation, item.variation_name, item.menu_item_variation?.name, item.menuItemVariation?.name, item.order_item?.variation?.name, item.order_item?.variation_name),
      modifiers: (() => {
        const values = item.modifiers || item.modifier_options || item.modifierOptions || item.order_item?.modifiers || item.order_item?.modifier_options
        if (!Array.isArray(values)) return undefined
        return values.map((modifier: any) => ({ id: Number(modifier.id || modifier.modifier_option_id || 0), name: String(modifier.name || modifier.option_name || modifier.modifier_option_name || 'Opción') })).filter((modifier: any) => modifier.name)
      })(),
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

export function normalizeCustomer(raw: any): PosCustomer {
  return {
    id: Number(raw?.id || 0),
    name: String(raw?.name || raw?.customer_name || 'Cliente sin nombre').trim(),
    phone: raw?.phone || raw?.customer_phone || undefined,
    phoneCode: raw?.phone_code || undefined,
    email: raw?.email || raw?.customer_email || undefined,
    deliveryAddress: raw?.delivery_address || raw?.address || undefined,
    rncCedula: raw?.rnc_cedula || undefined,
    fiscalName: raw?.fiscal_name || undefined,
    commercialName: raw?.commercial_name || undefined,
    dgiiStatus: raw?.dgii_status || undefined,
    dgiiTaxRegime: raw?.dgii_tax_regime || undefined,
    dgiiIsElectronicBiller: raw?.dgii_is_electronic_biller === true || raw?.dgii_is_electronic_biller === 1 || raw?.dgii_is_electronic_biller === '1',
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

export function normalizeDeliveryOrder(raw: any): DeliveryOrder {
  const items = Array.isArray(raw?.items) ? raw.items : []
  const customer = raw?.customer || null
  const exec = raw?.delivery_executive || null
  const platform = raw?.delivery_app || raw?.delivery_platform || null

  return {
    id: Number(raw?.id || 0),
    order_number: raw?.order_number,
    formatted_order_number: raw?.formatted_order_number,
    status: String(raw?.status || raw?.order_status || 'preparing').toLowerCase(),
    order_type: raw?.order_type || 'delivery',
    total: Number(raw?.total || 0),
    delivery_fee: raw?.delivery_fee != null ? Number(raw.delivery_fee) : 0,
    delivery_address: raw?.delivery_address || undefined,
    delivery_time: raw?.delivery_time || undefined,
    delivery_executive_id: raw?.delivery_executive_id != null ? Number(raw.delivery_executive_id) : null,
    delivery_app_id: raw?.delivery_app_id != null ? Number(raw.delivery_app_id) : null,
    customer: customer ? {
      id: customer.id ? Number(customer.id) : undefined,
      name: customer.name,
      phone: customer.phone,
    } : null,
    delivery_executive: exec ? {
      id: Number(exec.id),
      name: String(exec.name || `Repartidor ${exec.id}`),
      phone: exec.phone,
      phone_code: exec.phone_code,
      status: exec.status,
    } : null,
    delivery_platform: platform ? {
      id: Number(platform.id),
      name: String(platform.name || `Plataforma ${platform.id}`),
      logo: platform.logo,
      logo_url: platform.logo_url,
    } : null,
    items_count: raw?.items_count != null ? Number(raw.items_count) : items.length,
    items: items.map((it: any) => ({
      id: Number(it.id || 0),
      name: String(it.item_name || it.name || it.menu_item_name || 'Artículo'),
      quantity: Number(it.quantity || 1),
      price: Number(it.price || it.amount || 0),
      item_total: it.item_total != null ? Number(it.item_total) : (Number(it.price || 0) * Number(it.quantity || 1)),
      note: it.note || it.notes || undefined,
      variation_name: it.variation_name || it.variation?.name || undefined,
      modifiers: Array.isArray(it.modifiers) ? it.modifiers : undefined,
    })),
    created_at: raw?.created_at || raw?.createdAt,
    updated_at: raw?.updated_at || raw?.updatedAt,
  }
}

export const api = new ApiClient()

