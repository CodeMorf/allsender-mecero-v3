export type TokenKind = 'admin' | 'pin'
export type StaffRole = 'head' | 'mesero' | 'chef' | 'cajero' | 'repartidor'
export type OrderMode = 'dine_in' | 'delivery' | 'pickup' | 'room_service'
export type OrderTypeSlug = 'dine_in' | 'delivery' | 'pickup' | 'room_service' | string


export type ApiErrorShape = {
  message?: string
  errors?: Record<string, string[]>
  status?: boolean
}

export type Branch = {
  id: number
  name: string
  restaurantId?: number
  restaurantHash?: string
}

export type DeviceBinding = {
  deviceId: string
  deviceName?: string
  restaurantId?: number
  restaurantHash?: string
  restaurantName?: string
  branchId?: number
  branchName?: string
  claimedAt?: string
  configured: boolean
}

export type StaffSchedule = {
  id: number
  userId: number
  userName?: string
  branchId?: number
  branchName?: string
  shiftName?: string
  days: string[]
  startTime: string
  endTime: string
  timezone: string
  isActive: boolean
}

export type AttendanceRecord = {
  id: number
  userId: number
  userName?: string
  branchId?: number
  branchName?: string
  clockInAt: string
  clockOutAt?: string
  localDate?: string
  timezone: string
  status: 'active' | 'closed' | 'auto_closed' | string
  source?: string
  deviceId?: string
}

export type WaiterRequest = {
  id: number
  branchId: number
  tableId: number
  tableCode?: string
  tableName: string
  status: 'pending' | 'completed' | string
  createdAt?: string
  updatedAt?: string
}

export type NotificationSound = 'bell' | 'service-bell' | 'service-bell-strikes' | 'none'

export type NotificationSettings = {
  sound: NotificationSound
  vibration: boolean
  volume: number
}

export type TableStatus = 'available' | 'occupied' | 'waiting_kitchen' | 'food_ready' | 'bill_requested' | 'locked' | 'unknown'

export type RestaurantTable = {
  id: number
  name: string
  number: string
  capacity: number
  status: TableStatus
  area?: string
  waiter?: string
  currentOrderId?: number
  currentOrderNumber?: string
  currentOrderStatus?: string
  currentOrderTotal?: number
  currentOrderDue?: number
  customerId?: number
  customerName?: string
  customerPhone?: string
  customerRnc?: string
  customerFiscalName?: string
  guestCount?: number
  kitchenStatus?: string
  position?: { x: number; y: number; rotation?: number }
}

export type PosCustomer = {
  id: number
  name: string
  phone?: string
  phoneCode?: string
  email?: string
  deliveryAddress?: string
  rncCedula?: string
  fiscalName?: string
  commercialName?: string
  dgiiStatus?: string
  dgiiTaxRegime?: string
  dgiiIsElectronicBiller?: boolean
}

export type ModifierOption = {
  id: number
  name: string
  price: number
  available: boolean
}

export type ModifierGroup = {
  id: number
  name: string
  required: boolean
  minSelect: number
  maxSelect: number
  options: ModifierOption[]
}

export type ProductVariation = {
  id: number
  name: string
  price: number
}

export type MenuItem = {
  id: number
  name: string
  imageUrl?: string
  code?: string
  price: number
  categoryId?: number
  categoryName: string
  available: boolean
  availabilityReason?: string
  allergens: string[]
  dietaryTags: string[]
  modifiers?: ModifierGroup[]
  variations?: ProductVariation[]
}

export type OrderLine = {
  clientId: string
  itemId: number
  name: string
  price: number
  quantity: number
  seatNumber?: number | 'shared' | 'takeaway'
  note?: string
  variationId?: number
  variationName?: string
  modifiers: Array<{ id: number; name: string; price: number; groupId?: number }>
}

export type DeliveryExecutive = {
  id: number
  name: string
  phone?: string
  status?: string
}

export type DeliveryPlatform = {
  id: number
  name: string
  logo?: string
  logo_url?: string
}

export type OrderTypeConfig = {
  id: number
  slug: OrderTypeSlug
  order_type_name: string
  type: string
}

export type DeliverySettings = {
  is_enabled: boolean
  fixed_fee?: number | null
  unit?: string
  fee_tiers?: Array<{ id: number; min_distance: number; max_distance: number; fee: number }>
  prep_time_minutes?: number
}


export type ReceiptSettingValue = boolean | number | string

export type ReceiptSettings = {
  title?: string
  footer?: string
  show_restaurant_name?: ReceiptSettingValue
  show_branch_name?: ReceiptSettingValue
  show_branch_address?: ReceiptSettingValue
  show_table_number?: ReceiptSettingValue
  show_payment_details?: ReceiptSettingValue
  show_payment_status?: ReceiptSettingValue
  show_order_type?: ReceiptSettingValue
  show_tax?: ReceiptSettingValue
  show_restaurant_logo?: ReceiptSettingValue
  show_payment_qr_code?: ReceiptSettingValue
  receipt_languages?: string[]
  [key: string]: unknown
}

export type FiscalTypeDetails = {
  [code: string]: string
}

export type FiscalCapabilities = {
  version?: string
  scope?: {
    restaurant_id?: number
    branch_id?: number
  }
  country?: {
    id?: number
    code?: string
    name?: string
  }
  traditional?: {
    available: boolean
    enabled: boolean
    ready: boolean
    types?: Record<string, string>
    default_type?: string
    sequences_configured?: number
  }
  electronic?: {
    available: boolean
    enabled: boolean
    ready: boolean
    acceptance_source?: string
    certificate_configured?: boolean
    commercial_status?: string
    types?: Record<string, string>
    type_map?: Record<string, string>
    default_type?: string
    readiness?: {
      ready: boolean
      status?: string
      acceptance_source?: string
      provider_class?: string
      provider_configured?: boolean
      acceptance_verified?: boolean
      reasons?: Record<string, string>
      checklist?: Array<{
        id: string
        label: string
        complete: boolean
      }>
    }
  }
  rules?: {
    source?: string
    frontend_must_not_calculate?: boolean
    preview_consumes_sequence?: boolean
  }
}

export type PaymentMethodOption = {
  code: string
  label: string
  enabled: boolean
  requiresGateway?: boolean
}

export type Printer = {
  id: number
  name: string
  branchId?: number
  printingChoice?: string
  printType?: string
  printFormat?: string
  isActive?: boolean
  isDefault?: boolean
  orders?: unknown[]
}

export type OrderDraft = {
  mode: OrderMode
  orderTypeId?: number
  deliveryPlatformId?: number | null
  deliveryAppName?: string
  roomNumber?: string
  existingOrderId?: number
  customerId?: number
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  deliveryAddress?: string
  deliveryTime?: string
  deliveryFee?: number
  deliveryExecutiveId?: number
  customerLat?: number
  customerLng?: number
  rncCedula?: string
  fiscalName?: string
  receiptType?: string
  ecfType?: string
}


export type KitchenOrderItem = {
  id: number
  orderItemId?: number
  menuItemId?: number
  name: string
  quantity: number
  status?: string
  note?: string
  variation?: string
  modifiers?: Array<{ id: number; name: string }>
}

export type KitchenTicket = {
  id: number
  kotNumber?: string
  tokenNumber?: string
  orderId: number
  orderNumber?: string
  orderType?: string
  waiterName?: string
  tableName?: string
  tableId?: number
  kitchenPlace?: string
  kitchenPlaceId?: number
  status: string
  note?: string
  items: KitchenOrderItem[]
  createdAt?: string
  updatedAt?: string
}

export type KitchenPlace = {
  id: number
  name: string
  type?: string
  isDefault?: boolean
  printerId?: number
}

export type KitchenView = {
  scope: 'chef' | 'supervisor'
  placeId: number | 'all'
  locked: boolean
}

export type OfflineOperation = {
  id: string
  scope?: string
  method: 'POST' | 'PUT' | 'DELETE'
  path: string
  body: unknown
  idempotencyKey: string
  createdAt: string
  /**
   * A durable sequence lets the app finish a multi-request POS action after
   * the connection returns. Older single-request outbox rows remain valid.
   */
  workflow?: OfflineWorkflow
}

export type OfflineStep = {
  method: 'POST' | 'PUT' | 'DELETE'
  path: string
  body: unknown
  idempotencyKey: string
}

export type OfflineWorkflow = {
  type: 'sequence'
  stage: number
  steps: OfflineStep[]
  remoteOrderId?: number
  localOrderId?: number
  label?: string
}

export type AppCache = {
  scopeKey?: string
  branches?: Branch[]
  tables?: RestaurantTable[]
  menuItems?: MenuItem[]
  orders?: unknown[]
  paymentMethods?: PaymentMethodOption[]
  kots?: KitchenTicket[]
  kotPlaces?: KitchenPlace[]
  kitchenView?: KitchenView
  notifications?: unknown[]
  waiterRequests?: WaiterRequest[]
  notificationSettings?: NotificationSettings
  deliverySettings?: DeliverySettings | null
  deliveryExecutives?: DeliveryExecutive[]
  receiptSettings?: ReceiptSettings | null
  fiscalCapabilities?: FiscalCapabilities | null
  printers?: Printer[]
  modules?: string[]
  features?: Record<string, boolean>
  orderDetails?: Record<string, unknown>
  orderKots?: Record<string, KitchenTicket[]>
  restaurantHash?: string
  restaurantName?: string
  branchId?: number
  currency?: { symbol: string; code?: string; decimals?: number }
  cashRegisters?: unknown[]
  cashSession?: unknown | null
  cashSummary?: unknown | null
  deviceBinding?: DeviceBinding | null
  currentAttendance?: AttendanceRecord | null
  attendanceHistory?: AttendanceRecord[]
  staffSchedules?: StaffSchedule[]
}

export type Session = {
  token: string
  kind: TokenKind
  userName: string
  userId?: number
  restaurantHash?: string
  restaurantId?: number
  branchId?: number
  scopeKey?: string
  roleKey?: StaffRole
  permissions: Record<string, boolean>
}
