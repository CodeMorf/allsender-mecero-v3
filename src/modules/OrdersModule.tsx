import React, { useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
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
  currencySymbol?: string
}

type OrderStatusKey = 'active' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled' | 'unknown'

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
  const values = [order.payment_status, order.order_status, order.status]
    .map(normalizedText)
    .filter(Boolean)
  if (values.some(value => value.includes('cancel'))) return 'cancelled'

  const total = Number(order.total || order.grand_total || order.order_total || 0)
  const paid = Number(order.amount_paid || order.paid_amount || 0)
  if (values.some(value => value === 'paid' || value === 'billed' || value.includes('paid'))) return 'paid'
  if (total > 0 && paid >= total) return 'paid'
  if (values.some(value => value.includes('food ready') || value.includes('ready for pickup') || value.includes('listo'))) return 'ready'
  if (values.some(value => value.includes('prepar') || value.includes('in kitchen') || value.includes('cocina'))) return 'preparing'
  if (values.some(value => value.includes('served') || value.includes('servido'))) return 'served'
  if (values.some(value => value.includes('confirm') || value === 'kot' || value.includes('open') || value.includes('draft'))) return 'active'
  return 'unknown'
}

function orderStatusLabel(status: OrderStatusKey): string {
  if (status === 'active') return 'Activa / confirmada'
  if (status === 'preparing') return 'En preparación'
  if (status === 'ready') return 'Lista'
  if (status === 'served') return 'Servida'
  if (status === 'paid') return 'Pagada'
  if (status === 'cancelled') return 'Cancelada'
  return 'Estado no publicado'
}

function orderStatusClass(status: OrderStatusKey): string {
  if (status === 'paid' || status === 'served') return 'posdan-badge-success'
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

export const OrdersModule: React.FC<OrdersModuleProps> = ({ orders, onRefresh, currencySymbol = 'RD$' }) => {
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
        && (statusFilter === 'ALL' || status === statusFilter)
    })
  }, [orders, search, serviceFilter, statusFilter])

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

      <div className="posdan-table-wrap orders-table-wrap">
        <div className="posdan-table-scroll">
          <table className="posdan-table orders-table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Servicio / destino</th>
                <th>Cliente</th>
                <th>Estado</th>
                <th>Total</th>
                <th>Fecha y hora</th>
                <th aria-label="Detalle" />
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(order => {
                const service = resolveOrderService(order)
                const status = orderStatusKey(order)
                const orderId = Number(order.id)
                const expanded = expandedOrderId === orderId
                const items = orderItems(order)
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
                      <td className="orders-total">
                        {currencySymbol} {Number(order.total || order.grand_total || order.order_total || 0).toFixed(2)}
                      </td>
                      <td className="orders-date"><Clock size={14} /> {orderDate(order)}</td>
                      <td className="orders-detail-action">
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
                        <td colSpan={7}>
                          <div className="orders-detail-panel">
                            <div className="orders-detail-heading">
                              <div>
                                <strong>Detalle de la orden #{order.order_number || order.id}</strong>
                                <small>{order.notes || order.order_note || 'Sin nota general'}</small>
                              </div>
                              <span className={Number(order.amount_paid || 0) > 0 ? 'orders-payment-paid' : 'orders-payment-pending'}>
                                {Number(order.amount_paid || 0) > 0 ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                                {Number(order.amount_paid || 0) > 0 ? `Pagado: ${currencySymbol} ${Number(order.amount_paid).toFixed(2)}` : 'Pendiente de pago'}
                              </span>
                            </div>
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
