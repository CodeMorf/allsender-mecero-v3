import React, { useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  CreditCard,
  Hotel,
  RefreshCw,
  Search,
  ShoppingBag,
  Truck,
  Utensils,
  XCircle,
} from 'lucide-react'
import { orderServiceLabel, resolveOrderService, type OrderServiceKind } from '../utils/orderService'

type OrdersModuleProps = {
  orders: any[]
  onRefresh?: () => Promise<void>
  onOpenPayment?: (order: any) => void
  canCharge?: boolean
  currencySymbol?: string
}

type OrderStatusKey = 'active' | 'preparing' | 'ready' | 'served' | 'cancelled' | 'unknown'
type PaymentStatusKey = 'unpaid' | 'partial' | 'paid'

function normalizedText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ')
}

function orderCustomerName(order: any): string {
  return String(order.customer_name || order.customer?.name || order.order?.customer?.name || 'Consumidor Final')
}

function orderCustomerPhone(order: any): string {
  return String(order.customer_phone || order.customer?.phone || order.order?.customer?.phone || '')
}

function orderServiceDetail(order: any, service: OrderServiceKind): string {
  const table = order.table || order.order?.table || {}
  const tableCode = table.table_code || table.table_name || table.number || order.table_name
  if (service === 'dine_in') return tableCode ? `Mesa ${tableCode}` : 'Barra / sin mesa'
  if (service === 'pickup') return orderCustomerName(order) !== 'Consumidor Final'
    ? `Recoge: ${orderCustomerName(order)}`
    : 'El cliente recoge en el local · no utiliza mesa'
  if (service === 'room_service') return `Habitación ${order.custom_order_type_name || order.room_number || 'sin indicar'}`
  if (service === 'delivery') {
    const platform = order.custom_order_type_name || order.delivery_app?.name || order.delivery_platform?.name
    const address = order.delivery_address || order.order?.delivery_address
    const driver = order.delivery_executive?.name || order.order?.delivery_executive?.name
    return [platform, address, driver ? `Repartidor: ${driver}` : undefined].filter(Boolean).join(' · ') || 'Entrega sin detalle publicado'
  }
  return 'Tipo de servicio no publicado'
}

function orderStatusKey(order: any): OrderStatusKey {
  const values = [order.operational_status, order.order_status, order.kitchen_status, order.status]
    .map(normalizedText)
    .filter(Boolean)
  const operationalValues = values.filter(value => !['paid', 'billed', 'payment', 'payment paid'].includes(value) && !value.includes('paid'))
  if (operationalValues.some(value => value.includes('cancel'))) return 'cancelled'
  if (operationalValues.some(value => value.includes('food ready') || value.includes('ready for pickup') || value.includes('listo'))) return 'ready'
  if (operationalValues.some(value => value.includes('prepar') || value.includes('in kitchen') || value.includes('cocina'))) return 'preparing'
  if (operationalValues.some(value => value.includes('served') || value.includes('servido') || value.includes('delivered') || value.includes('entregado'))) return 'served'
  if (operationalValues.some(value => value.includes('confirm') || value.includes('placed') || value === 'kot' || value === 'active' || value.includes('pending') || value.includes('open') || value.includes('draft'))) return 'active'
  return 'unknown'
}

function orderStatusLabel(status: OrderStatusKey): string {
  if (status === 'active') return 'Activa / confirmada'
  if (status === 'preparing') return 'En preparación'
  if (status === 'ready') return 'Lista'
  if (status === 'served') return 'Servida'
  if (status === 'cancelled') return 'Cancelada'
  return 'Estado no publicado'
}

function orderStatusClass(status: OrderStatusKey): string {
  if (status === 'served') return 'posdan-badge-success'
  if (status === 'cancelled') return 'posdan-badge-danger'
  if (status === 'ready') return 'orders-badge-ready'
  if (status === 'preparing') return 'orders-badge-preparing'
  return 'orders-badge-active'
}

function orderDate(order: any): string {
  const value = order.created_at || order.date_time || order.createdAt
  if (!value) return 'Hora no publicada'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })
}

function orderItems(order: any): any[] {
  return Array.isArray(order.items) ? order.items : []
}

function firstNumber(values: unknown[]): number | null {
  const value = values.find(candidate => candidate !== null && candidate !== undefined && candidate !== '')
  if (value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function orderTotal(order: any): number {
  return firstNumber([
    order.grand_total,
    order.total,
    order.order_total,
    order.cart?.summary?.grand_total,
    order.cart?.summary?.total,
    order.payment_summary?.grand_total,
    order.payment_summary?.total,
  ]) ?? 0
}

function orderPaid(order: any): number {
  const payments = Array.isArray(order.payments) ? order.payments : []
  const paymentsTotal = payments.reduce((sum: number, payment: any) => sum + Number(payment.amount || payment.paid_amount || 0), 0)
  return firstNumber([
    order.amount_paid,
    order.paid_amount,
    order.payment_summary?.amount_paid,
    order.cart?.summary?.amount_paid,
    paymentsTotal > 0 ? paymentsTotal : null,
  ]) ?? 0
}

function orderDue(order: any): number {
  const total = orderTotal(order)
  const paid = orderPaid(order)
  return Math.max(0, firstNumber([
    order.amount_due,
    order.payment_summary?.amount_due,
    order.cart?.summary?.amount_due,
  ]) ?? (total - paid))
}

function paymentStatusKey(order: any): PaymentStatusKey {
  const due = orderDue(order)
  const paid = orderPaid(order)
  const raw = normalizedText(order.payment_status || order.paymentState || order.payment_summary?.status)
  if (due <= 0.01 && (orderTotal(order) > 0 || raw.includes('paid'))) return 'paid'
  if (paid > 0 || raw.includes('partial') || raw.includes('parcial')) return 'partial'
  return 'unpaid'
}

function paymentStatusLabel(status: PaymentStatusKey, paid: number, due: number, currencySymbol: string): string {
  if (status === 'paid') return `Pagado · ${currencySymbol} ${paid.toFixed(2)}`
  if (status === 'partial') return `Pago parcial · ${currencySymbol} ${due.toFixed(2)} pendiente`
  return `Pago pendiente · ${currencySymbol} ${due.toFixed(2)}`
}

function paymentStatusClass(status: PaymentStatusKey): string {
  return status === 'paid' ? 'orders-payment-paid' : status === 'partial' ? 'orders-payment-partial' : 'orders-payment-pending'
}

function orderItemName(item: any): string {
  return String(item.name || item.menu_item_name || item.menuItem?.name || 'Artículo')
}

function orderItemModifiers(item: any): string[] {
  const values = item.modifiers || item.modifier_options || item.modifierOptions || []
  if (!Array.isArray(values)) return []
  return values.map((modifier: any) => String(modifier.name || modifier.option_name || modifier.modifier_option_name || '')).filter(Boolean)
}

function serviceIcon(service: OrderServiceKind) {
  if (service === 'dine_in') return <Utensils size={16} />
  if (service === 'pickup') return <ShoppingBag size={16} />
  if (service === 'delivery') return <Truck size={16} />
  if (service === 'room_service') return <Hotel size={16} />
  return <ClipboardList size={16} />
}

export const OrdersModule: React.FC<OrdersModuleProps> = ({ orders, onRefresh, onOpenPayment, canCharge = false, currencySymbol = 'RD$' }) => {
  const [search, setSearch] = useState('')
  const [serviceFilter, setServiceFilter] = useState<OrderServiceKind | 'ALL'>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'paid' | 'cancelled'>('ALL')
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase()
    return orders.filter(order => {
      const service = resolveOrderService(order)
      const status = orderStatusKey(order)
      const payment = paymentStatusKey(order)
      const searchable = [
        order.id,
        order.order_number,
        order.formatted_order_number,
        orderCustomerName(order),
        orderCustomerPhone(order),
        orderServiceLabel(service),
        orderServiceDetail(order, service),
      ].join(' ').toLowerCase()
      return (!query || searchable.includes(query))
        && (serviceFilter === 'ALL' || service === serviceFilter)
        && (statusFilter === 'ALL'
          || (statusFilter === 'paid' && payment === 'paid')
          || (statusFilter === 'cancelled' && status === 'cancelled')
          || (statusFilter === 'active' && status !== 'cancelled' && status !== 'served' && status !== 'unknown'))
    })
  }, [orders, search, serviceFilter, statusFilter])

  const pickupOrders = orders.filter(order => resolveOrderService(order) === 'pickup')
  const pendingPickupOrders = pickupOrders.filter(order => paymentStatusKey(order) !== 'paid' && orderStatusKey(order) !== 'cancelled')

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="posdan-module-container orders-module">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <ClipboardList style={{ color: '#f97316' }} size={24} /> Órdenes
          </h2>
          <p className="posdan-module-subtitle">
            Todas las órdenes de esta sucursal: mesa, para llevar / recoger, entrega y habitación.
          </p>
        </div>

        <div className="posdan-module-actions orders-module-actions">
          <div className="posdan-search-box">
            <Search className="search-icon" size={16} />
            <input
              type="search"
              placeholder="Buscar orden, cliente o servicio..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="posdan-search-input"
              aria-label="Buscar órdenes"
            />
          </div>
          <select
            className="posdan-select"
            value={serviceFilter}
            onChange={event => setServiceFilter(event.target.value as OrderServiceKind | 'ALL')}
            aria-label="Filtrar órdenes por servicio"
          >
            <option value="ALL">Todos los servicios</option>
            <option value="dine_in">Comer aquí</option>
            <option value="pickup">Para llevar / Recoger</option>
            <option value="delivery">Entrega a domicilio</option>
            <option value="room_service">Servicio a habitación</option>
            <option value="unknown">Tipo no publicado</option>
          </select>
          <select
            className="posdan-select"
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}
            aria-label="Filtrar órdenes por estado"
          >
            <option value="ALL">Todos los estados</option>
            <option value="active">Activas</option>
            <option value="paid">Pagadas</option>
            <option value="cancelled">Canceladas</option>
          </select>
          {onRefresh && (
            <button type="button" className="posdan-btn-primary orders-refresh-btn" onClick={() => void handleRefresh()} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? 'orders-refresh-spin' : ''} />
              <span>{refreshing ? 'Actualizando…' : 'Actualizar'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="orders-summary-strip" aria-live="polite">
        <span><strong>{filteredOrders.length}</strong> visibles</span>
        <span><strong>{orders.length}</strong> recibidas de la sucursal</span>
        {search || serviceFilter !== 'ALL' || statusFilter !== 'ALL' ? <span>Filtros activos</span> : <span>Sin filtros</span>}
      </div>

      {(serviceFilter === 'ALL' || serviceFilter === 'pickup') && pickupOrders.length > 0 && (
        <section className="orders-pickup-guide" aria-label="Flujo de pedidos para llevar">
          <div className="orders-pickup-guide-icon"><ShoppingBag size={19} /></div>
          <div>
            <strong>Pedidos para llevar / recoger</strong>
            <span>Se crean desde Punto de venta y se envían a cocina. Cuando estén listos, se cobran aquí y se entregan al cliente; no utilizan mesa.</span>
          </div>
          <div className="orders-pickup-guide-count"><b>{pendingPickupOrders.length}</b><small>por cobrar</small></div>
        </section>
      )}

      <div className="posdan-table-wrap orders-table-wrap">
        <div className="posdan-table-scroll">
          <table className="posdan-table orders-table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Servicio / destino</th>
                <th>Cliente</th>
                <th>Estado del pedido</th>
                <th>Pago</th>
                <th>Total</th>
                <th>Fecha y hora</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(order => {
                const service = resolveOrderService(order)
                const status = orderStatusKey(order)
                const payment = paymentStatusKey(order)
                const orderId = Number(order.id)
                const paid = orderPaid(order)
                const due = orderDue(order)
                const expanded = expandedOrderId === orderId
                const items = orderItems(order)
                const canPayPickup = service === 'pickup' && payment !== 'paid' && status !== 'cancelled' && canCharge && Boolean(onOpenPayment) && orderId > 0
                return (
                  <React.Fragment key={orderId || `${order.order_number}-${order.created_at}`}>
                    <tr className={expanded ? 'orders-row-expanded' : undefined}>
                      <td className="orders-order-number">
                        <strong>#{order.order_number || order.formatted_order_number || order.id}</strong>
                        <small>ID {order.id}</small>
                      </td>
                      <td>
                        <div className={`orders-service-cell service-${service}`}>
                          <span className="orders-service-icon">{serviceIcon(service)}</span>
                          <span>
                            <strong>{orderServiceLabel(service)}</strong>
                            <small>{orderServiceDetail(order, service)}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <strong className="orders-customer-name">{orderCustomerName(order)}</strong>
                        {orderCustomerPhone(order) && <small className="orders-secondary-line">{orderCustomerPhone(order)}</small>}
                      </td>
                      <td>
                        <span className={orderStatusClass(status)}>{orderStatusLabel(status)}</span>
                      </td>
                      <td>
                        <span className={`orders-payment-pill ${paymentStatusClass(payment)}`}>
                          {payment === 'paid' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                          {payment === 'paid' ? 'Pagado' : payment === 'partial' ? 'Parcial' : 'Pendiente'}
                        </span>
                        {payment !== 'paid' && <small className="orders-secondary-line">Pendiente: {currencySymbol} {due.toFixed(2)}</small>}
                      </td>
                      <td className="orders-total">
                        {currencySymbol} {orderTotal(order).toFixed(2)}
                      </td>
                      <td className="orders-date"><Clock size={14} /> {orderDate(order)}</td>
                      <td className="orders-detail-action">
                        {canPayPickup && (
                          <button
                            type="button"
                            className="orders-charge-btn"
                            onClick={() => onOpenPayment?.(order)}
                            title="Cobrar este pedido antes de entregarlo"
                          >
                            <CreditCard size={14} /> Cobrar retiro
                          </button>
                        )}
                        <button
                          type="button"
                          className="orders-detail-btn"
                          onClick={() => setExpandedOrderId(expanded ? null : orderId)}
                          aria-expanded={expanded}
                        >
                          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                          <span>{expanded ? 'Ocultar' : 'Detalle'}</span>
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="orders-detail-row">
                        <td colSpan={8}>
                          <div className="orders-detail-panel">
                            <div className="orders-detail-heading">
                              <div>
                                <strong>Detalle de la orden #{order.order_number || order.id}</strong>
                                <small>{service === 'pickup' ? 'Para llevar / Recoger · el cliente recoge en el local' : orderServiceDetail(order, service)}</small>
                                <small>{order.notes || order.order_note || 'Sin nota general'}</small>
                              </div>
                              <span className={paymentStatusClass(payment)}>
                                {payment === 'paid' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                                {paymentStatusLabel(payment, paid, due, currencySymbol)}
                              </span>
                            </div>
                            <div className="orders-financial-summary">
                              <div><span>Total</span><b>{currencySymbol} {orderTotal(order).toFixed(2)}</b></div>
                              <div><span>Pagado</span><b>{currencySymbol} {paid.toFixed(2)}</b></div>
                              <div><span>Pendiente</span><b>{currencySymbol} {due.toFixed(2)}</b></div>
                            </div>
                            {service === 'pickup' && (
                              <div className={`orders-pickup-next-step ${payment === 'paid' ? 'is-paid' : ''}`}>
                                <ShoppingBag size={15} />
                                <span>{payment === 'paid' ? 'Pago confirmado. Entregue el pedido cuando el cliente lo recoja.' : 'El cobro de este retiro se realiza aquí, antes de entregar el pedido.'}</span>
                                {canPayPickup && (
                                  <button type="button" className="orders-charge-btn" onClick={() => onOpenPayment?.(order)}>
                                    <CreditCard size={14} /> Cobrar retiro
                                  </button>
                                )}
                              </div>
                            )}
                            {items.length ? (
                              <ul className="orders-item-list">
                                {items.map((item, index) => {
                                  const modifiers = orderItemModifiers(item)
                                  return (
                                    <li key={item.id || `${orderId}-${index}`}>
                                      <span><strong>{Number(item.quantity || 1)}× {orderItemName(item)}</strong>{item.variation_name && <small>Variante: {item.variation_name}</small>}{modifiers.length > 0 && <small>Suplementos: {modifiers.join(', ')}</small>}{item.note && <em>Nota: {item.note}</em>}</span>
                                      <b>{currencySymbol} {Number(item.amount || item.total || item.price || 0).toFixed(2)}</b>
                                    </li>
                                  )
                                })}
                              </ul>
                            ) : (
                              <p className="orders-empty-detail">Esta respuesta no publicó artículos para la orden.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
          {!filteredOrders.length && (
            <div className="orders-empty-state">
              <XCircle size={32} />
              <strong>{orders.length ? 'No hay órdenes con estos filtros.' : 'No hay órdenes recibidas.'}</strong>
              <span>{orders.length ? 'Quite o cambie el filtro para ver las órdenes de esta sucursal.' : 'La lista se alimenta de GET /pos/orders con la sesión actual.'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
