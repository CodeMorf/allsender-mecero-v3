import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Truck,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  Phone,
  MapPin,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Search,
  Filter,
  UserCheck,
  User,
  Store,
  CheckSquare,
  Square,
  Layers,
  ArrowRight,
  Navigation,
  Calendar,
  X,
  XCircle,
  ChevronDown,
  Plus
} from 'lucide-react'
import { api, ApiError, normalizeDeliveryOrder } from '../api/client'
import { resolveOrderService } from '../utils/orderService'
import type { DeliveryOrder, DeliveryOrderItem, DeliveryExecutive, DeliveryPlatform, StaffRole } from '../types'

interface DispatchModuleProps {
  roleKey?: StaffRole
  permissions?: Record<string, boolean>
  currencySymbol?: string
  onNotice?: (msg: string) => void
  sourceOrders?: any[]
}

type KanbanColumnId = 'preparing' | 'ready_for_pickup' | 'out_for_delivery' | 'delivered'

interface ColumnConfig {
  id: KanbanColumnId
  label: string
  sublabel: string
  color: string
  bg: string
  border: string
  badgeBg: string
  badgeColor: string
}

const COLUMNS: ColumnConfig[] = [
  {
    id: 'preparing',
    label: 'En Preparación',
    sublabel: 'Cocina preparando pedido',
    color: '#F59E0B',
    bg: 'rgba(245, 158, 11, 0.04)',
    border: 'rgba(245, 158, 11, 0.2)',
    badgeBg: 'rgba(245, 158, 11, 0.15)',
    badgeColor: '#FBBF24',
  },
  {
    id: 'ready_for_pickup',
    label: 'Por Empacar / Listo',
    sublabel: 'En mostrador para despacho',
    color: '#3B82F6',
    bg: 'rgba(59, 130, 246, 0.04)',
    border: 'rgba(59, 130, 246, 0.2)',
    badgeBg: 'rgba(59, 130, 246, 0.15)',
    badgeColor: '#60A5FA',
  },
  {
    id: 'out_for_delivery',
    label: 'En Ruta',
    sublabel: 'Repartidor en camino',
    color: '#8B5CF6',
    bg: 'rgba(139, 92, 246, 0.04)',
    border: 'rgba(139, 92, 246, 0.2)',
    badgeBg: 'rgba(139, 92, 246, 0.15)',
    badgeColor: '#A78BFA',
  },
  {
    id: 'delivered',
    label: 'Entregados',
    sublabel: 'Completados con éxito',
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.04)',
    border: 'rgba(16, 185, 129, 0.2)',
    badgeBg: 'rgba(16, 185, 129, 0.15)',
    badgeColor: '#34D399',
  },
]

export const DispatchModule: React.FC<DispatchModuleProps> = ({
  roleKey,
  permissions,
  currencySymbol = 'RD$',
  onNotice,
  sourceOrders,
}) => {
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [executives, setExecutives] = useState<DeliveryExecutive[]>([])
  const [platforms, setPlatforms] = useState<DeliveryPlatform[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [selectedExecutiveId, setSelectedExecutiveId] = useState<number | 'all'>('all')
  const [selectedPlatformId, setSelectedPlatformId] = useState<number | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDate, setSelectedDate] = useState<string>('all')

  // Active / Selected Order for Inspection & Packing Checklist
  const [selectedOrder, setSelectedOrder] = useState<DeliveryOrder | null>(null)
  const [packedItems, setPackedItems] = useState<Record<string, boolean>>({}) // key: orderId_itemId
  const [assigningExecId, setAssigningExecId] = useState<number | ''>('')
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null)

  // New Driver Modal State
  const [showNewDriverModal, setShowNewDriverModal] = useState(false)
  const [newDriverName, setNewDriverName] = useState('')
  const [newDriverPhone, setNewDriverPhone] = useState('')
  const [creatingDriver, setCreatingDriver] = useState(false)
  const today = new Date()
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const sourceDeliveryOrders = useMemo(() => {
    if (!Array.isArray(sourceOrders)) return null
    return sourceOrders
      .filter(order => resolveOrderService(order) === 'delivery')
      .map(normalizeDeliveryOrder)
  }, [sourceOrders])

  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDriverName.trim()) return
    setCreatingDriver(true)
    try {
      const created = await api.createDeliveryExecutive('pin', {
        name: newDriverName.trim(),
        phone: newDriverPhone.trim() || undefined,
        phone_code: '1',
        status: 'active'
      })
      onNotice?.(`Repartidor ${created.name} registrado en la sucursal.`)
      setNewDriverName('')
      setNewDriverPhone('')
      setShowNewDriverModal(false)
      await loadData(true)
    } catch (err: any) {
      alert(err?.message || 'Error al crear repartidor.')
    } finally {
      setCreatingDriver(false)
    }
  }

  // Fetch Delivery Orders & Catalog
  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const sourceOrdersForFilters = sourceDeliveryOrders?.filter(order => {
        if (selectedDate !== 'all') {
          const orderDate = order.created_at ? new Date(order.created_at) : null
          const localOrderDate = orderDate && !Number.isNaN(orderDate.getTime())
            ? `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}-${String(orderDate.getDate()).padStart(2, '0')}`
            : ''
          if (localOrderDate !== selectedDate) return false
        }
        if (selectedStatus !== 'all' && order.status !== selectedStatus) return false
        if (selectedExecutiveId !== 'all' && order.delivery_executive_id !== selectedExecutiveId) return false
        if (selectedPlatformId !== 'all' && order.delivery_app_id !== selectedPlatformId) return false
        return true
      })

      const [orderRes, execRes, platRes] = await Promise.allSettled([
        sourceOrdersForFilters ?? api.deliveryOrders('pin', {
          date: selectedDate === 'all' ? 'all' : selectedDate,
          status: selectedStatus === 'all' ? undefined : selectedStatus,
          deliveryExecutiveId: selectedExecutiveId === 'all' ? undefined : selectedExecutiveId,
          deliveryAppId: selectedPlatformId === 'all' ? undefined : selectedPlatformId,
          limit: 100,
        }),
        api.deliveryExecutives('pin'),
        api.deliveryPlatforms('pin'),
      ])

      if (orderRes.status === 'fulfilled') {
        setOrders(orderRes.value)
        if (selectedOrder) {
          const updated = orderRes.value.find(o => o.id === selectedOrder.id)
          if (updated) setSelectedOrder(updated)
        }
      } else {
        console.error('Error fetching delivery orders:', orderRes.reason)
        setError('No se pudieron cargar los pedidos de despacho.')
      }

      if (execRes.status === 'fulfilled') {
        setExecutives(execRes.value)
      }
      if (platRes.status === 'fulfilled') {
        setPlatforms(platRes.value)
      }
    } catch (e: any) {
      console.error('Fatal load dispatch data error:', e)
      setError(e?.message || 'Error al comunicar con el servidor.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [selectedDate, selectedStatus, selectedExecutiveId, selectedPlatformId, selectedOrder, sourceDeliveryOrders])

  // Load initially and when filters change
  useEffect(() => {
    loadData()
  }, [loadData])

  // Listen to WebSocket events for real-time dispatch updates
  useEffect(() => {
    const handleWsUpdate = () => {
      loadData(true)
    }
    window.addEventListener('restapp:order-updated', handleWsUpdate)
    window.addEventListener('restapp:kot-updated', handleWsUpdate)
    return () => {
      window.removeEventListener('restapp:order-updated', handleWsUpdate)
      window.removeEventListener('restapp:kot-updated', handleWsUpdate)
    }
  }, [loadData])

  // Filtered orders client-side for search query
  const filteredOrders = useMemo(() => {
    let list = orders
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(o =>
        (o.order_number != null && String(o.order_number).toLowerCase().includes(q)) ||
        (o.formatted_order_number && String(o.formatted_order_number).toLowerCase().includes(q)) ||
        (o.customer?.name && o.customer.name.toLowerCase().includes(q)) ||
        (o.customer?.phone != null && String(o.customer.phone).includes(q)) ||
        (o.delivery_address && o.delivery_address.toLowerCase().includes(q)) ||
        (o.delivery_executive?.name && o.delivery_executive.name.toLowerCase().includes(q)) ||
        (o.items && o.items.some(i => i.name.toLowerCase().includes(q)))
      )
    }
    return list
  }, [orders, searchQuery])

  // Group into Kanban columns
  const columnOrders = useMemo(() => {
    const map: Record<KanbanColumnId, DeliveryOrder[]> = {
      preparing: [],
      ready_for_pickup: [],
      out_for_delivery: [],
      delivered: [],
    }
    for (const order of filteredOrders) {
      const st = (order.status || 'preparing').toLowerCase()
      if (st === 'delivered') {
        map.delivered.push(order)
      } else if (st === 'out_for_delivery') {
        map.out_for_delivery.push(order)
      } else if (st === 'ready_for_pickup' || st === 'food_ready' || st === 'ready') {
        map.ready_for_pickup.push(order)
      } else {
        map.preparing.push(order)
      }
    }
    return map
  }, [filteredOrders])

  // Handle Assign Executive
  const handleAssignExecutive = async (orderId: number, execId: number) => {
    try {
      setUpdatingStatusId(orderId)
      await api.assignDeliveryExecutive('pin', orderId, { deliveryExecutiveId: execId })
      onNotice?.('Repartidor asignado correctamente.')
      await loadData(true)
    } catch (e: any) {
      alert(e?.message || 'Error al asignar repartidor.')
    } finally {
      setUpdatingStatusId(null)
    }
  }

  // Handle Update Status
  const handleUpdateStatus = async (orderId: number, nextStatus: string) => {
    try {
      setUpdatingStatusId(orderId)
      await api.updateDeliveryStatus('pin', orderId, nextStatus)
      const label =
        nextStatus === 'ready_for_pickup' ? 'Listo para entrega' :
        nextStatus === 'out_for_delivery' ? 'En ruta con repartidor' :
        nextStatus === 'delivered' ? 'Marcado como Entregado' : nextStatus
      onNotice?.(`Estado actualizado: ${label}`)
      await loadData(true)
    } catch (e: any) {
      alert(e?.message || 'Error al cambiar estado.')
    } finally {
      setUpdatingStatusId(null)
    }
  }

  // Packing Checklist Toggle
  const toggleItemPacked = (orderId: number, itemId: number) => {
    const key = `${orderId}_${itemId}`
    setPackedItems(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const isOrderFullyPacked = (order: DeliveryOrder) => {
    if (!order.items || order.items.length === 0) return true
    return order.items.every(it => packedItems[`${order.id}_${it.id}`])
  }

  return (
    <div className="pos-dispatch-module">
      {/* Header & Controls */}
      <header className="dispatch-header">
        <div className="dispatch-title-wrap">
          <div className="dispatch-icon-badge">
            <Truck size={22} color="#5EDBAC" />
          </div>
          <div>
            <h1 className="dispatch-title">Despacho & Delivery</h1>
            <p className="dispatch-subtitle">
              Gestión y empaque de pedidos a domicilio, takeaway y plataformas
            </p>
          </div>
        </div>

        {/* Global Stats bar */}
        <div className="dispatch-stats-bar">
          <div className="dispatch-stat-pill">
            <span className="dot" style={{ background: '#F59E0B' }} />
            <span>{columnOrders.preparing.length} Preparando</span>
          </div>
          <div className="dispatch-stat-pill">
            <span className="dot" style={{ background: '#3B82F6' }} />
            <span>{columnOrders.ready_for_pickup.length} Por Empacar</span>
          </div>
          <div className="dispatch-stat-pill">
            <span className="dot" style={{ background: '#8B5CF6' }} />
            <span>{columnOrders.out_for_delivery.length} En Ruta</span>
          </div>
          <div className="dispatch-stat-pill">
            <span className="dot" style={{ background: '#10B981' }} />
            <span>{columnOrders.delivered.length} Entregados</span>
          </div>
        </div>

        <div className="dispatch-actions">
          <button
            type="button"
            className="dispatch-action-btn btn-route"
            style={{ padding: '8px 14px', width: 'auto', background: '#5EDBAC', color: '#0A0C0F' }}
            onClick={() => setShowNewDriverModal(true)}
            title="Registrar nuevo repartidor"
          >
            <Plus size={16} />
            <span>Nuevo Repartidor</span>
          </button>
          <button
            type="button"
            className="dispatch-refresh-btn"
            onClick={() => loadData(false)}
            disabled={loading || refreshing}
            title="Refrescar pedidos"
          >
            <RefreshCw size={16} className={refreshing || loading ? 'animate-spin' : ''} />
            <span>Actualizar</span>
          </button>
        </div>
      </header>

      {/* Filter toolbar */}
      <div className="dispatch-toolbar">
        {/* Search */}
        <div className="dispatch-search-box">
          <Search size={16} className="dispatch-search-icon" />
          <input
            type="text"
            placeholder="Buscar por orden, cliente, teléfono, dirección..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button type="button" className="clear-search-btn" onClick={() => setSearchQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* Date Filter */}
        <div className="dispatch-filter-item">
          <Calendar size={15} style={{ color: '#A1A5AB' }} />
          <select
            value={selectedDate === 'all' ? 'all' : selectedDate === localToday ? 'today' : 'custom'}
            onChange={e => {
              const val = e.target.value
              if (val === 'all') setSelectedDate('all')
              else if (val === 'today') setSelectedDate(localToday)
              else setSelectedDate(localToday)
            }}
            className="dispatch-select"
            style={{ minWidth: 110 }}
          >
            <option value="all">Todas las órdenes</option>
            <option value="today">Hoy ({today.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit' })})</option>
            <option value="custom">Elegir fecha...</option>
          </select>
          {selectedDate !== 'all' && (
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="dispatch-date-input"
              style={{ marginLeft: 4 }}
            />
          )}
        </div>

        {/* Rider Filter */}
        <div className="dispatch-filter-item">
          <User size={15} style={{ color: '#A1A5AB' }} />
          <select
            value={selectedExecutiveId}
            onChange={e => setSelectedExecutiveId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="dispatch-select"
          >
            <option value="all">Todos los repartidores</option>
            {executives.map(ex => (
              <option key={ex.id} value={ex.id}>
                {ex.name} ({ex.status === 'on_delivery' ? 'En ruta' : 'Disponible'})
              </option>
            ))}
          </select>
        </div>

        {/* Platform Filter */}
        {platforms.length > 0 && (
          <div className="dispatch-filter-item">
            <Store size={15} style={{ color: '#A1A5AB' }} />
            <select
              value={selectedPlatformId}
              onChange={e => setSelectedPlatformId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="dispatch-select"
            >
              <option value="all">Todas las plataformas</option>
              {platforms.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main Body (Responsive layout: Kanban on PC, Split-screen or list on Tablet/Mobile) */}
      <div className="dispatch-main-layout">
        {/* Kanban Board Area */}
        <div className="dispatch-board">
          {COLUMNS.map(col => {
            const colOrders = columnOrders[col.id] || []
            return (
              <div key={col.id} className="dispatch-column" style={{ borderTop: `3px solid ${col.color}` }}>
                <div className="dispatch-column-head">
                  <div className="dispatch-column-head-info">
                    <span className="dispatch-column-title" style={{ color: col.badgeColor }}>
                      {col.label}
                    </span>
                    <span className="dispatch-column-sub">{col.sublabel}</span>
                  </div>
                  <span className="dispatch-column-badge" style={{ background: col.badgeBg, color: col.badgeColor }}>
                    {colOrders.length}
                  </span>
                </div>

                <div className="dispatch-cards-scroll">
                  {colOrders.length === 0 ? (
                    <div className="dispatch-empty-col">
                      <Package size={28} style={{ opacity: 0.25 }} />
                      <p>Sin órdenes en esta etapa</p>
                    </div>
                  ) : (
                    colOrders.map(order => {
                      const isSelected = selectedOrder?.id === order.id
                      const fullyPacked = isOrderFullyPacked(order)
                      const isUpdating = updatingStatusId === order.id

                      return (
                        <div
                          key={order.id}
                          className={`dispatch-card ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => setSelectedOrder(order)}
                        >
                          {/* Top Row: Order number & time */}
                          <div className="dispatch-card-top">
                            <div className="dispatch-order-num">
                              #{order.order_number || order.formatted_order_number || order.id}
                              {order.delivery_platform && (
                                <span className="dispatch-platform-pill">
                                  {order.delivery_platform.name}
                                </span>
                              )}
                            </div>
                            <div className="dispatch-order-time">
                              <Clock size={12} />
                              <span>
                                {order.created_at ? new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                              </span>
                            </div>
                          </div>

                          {/* Customer info */}
                          <div className="dispatch-customer-info">
                            <div className="dispatch-customer-name">
                              <User size={13} style={{ color: '#5EDBAC', flexShrink: 0 }} />
                              <span>{order.customer?.name || 'Cliente a Domicilio'}</span>
                            </div>
                            {order.customer?.phone && (
                              <a
                                href={`tel:${order.customer.phone}`}
                                className="dispatch-phone-link"
                                onClick={e => e.stopPropagation()}
                              >
                                <Phone size={12} />
                                <span>{order.customer.phone}</span>
                              </a>
                            )}
                          </div>

                          {/* Address */}
                          {order.delivery_address && (
                            <div className="dispatch-address-row">
                              <MapPin size={13} style={{ color: '#F87171', flexShrink: 0 }} />
                              <span className="dispatch-address-text" title={order.delivery_address}>
                                {order.delivery_address}
                              </span>
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.delivery_address)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="dispatch-map-btn"
                                onClick={e => e.stopPropagation()}
                                title="Abrir en Google Maps"
                              >
                                <Navigation size={12} />
                              </a>
                            </div>
                          )}

                          {/* Items summary */}
                          <div className="dispatch-items-preview">
                            <div className="dispatch-items-count">
                              <Package size={12} />
                              <span>{order.items.reduce((sum, i) => sum + i.quantity, 0)} artículos</span>
                              {col.id === 'ready_for_pickup' && (
                                <span className={`dispatch-pack-badge ${fullyPacked ? 'packed' : 'pending'}`}>
                                  {fullyPacked ? '✓ Empacado' : 'Empaque pend.'}
                                </span>
                              )}
                            </div>
                            <span className="dispatch-order-total">
                              {currencySymbol} {order.total.toFixed(2)}
                            </span>
                          </div>

                          {/* Rider info if assigned */}
                          {order.delivery_executive && (
                            <div className="dispatch-rider-assigned">
                              <UserCheck size={13} style={{ color: '#A78BFA' }} />
                              <span>Rider: <strong>{order.delivery_executive.name}</strong></span>
                              {order.delivery_executive.phone && (
                                <a href={`tel:${order.delivery_executive.phone}`} onClick={e => e.stopPropagation()}>
                                  <Phone size={11} />
                                </a>
                              )}
                            </div>
                          )}

                          {/* Card Quick Actions based on stage */}
                          <div className="dispatch-card-actions" onClick={e => e.stopPropagation()}>
                            {col.id === 'preparing' && (
                              <button
                                type="button"
                                className="dispatch-action-btn btn-ready"
                                disabled={isUpdating}
                                onClick={() => handleUpdateStatus(order.id, 'ready_for_pickup')}
                              >
                                <span>Marcar Listo</span>
                                <ArrowRight size={13} />
                              </button>
                            )}

                            {col.id === 'ready_for_pickup' && (
                              <button
                                type="button"
                                className="dispatch-action-btn btn-route"
                                disabled={isUpdating}
                                onClick={() => {
                                  if (!order.delivery_executive_id) {
                                    setSelectedOrder(order)
                                    onNotice?.('Asigne un repartidor antes de despachar a ruta.')
                                  } else {
                                    handleUpdateStatus(order.id, 'out_for_delivery')
                                  }
                                }}
                              >
                                <span>Despachar a Ruta</span>
                                <Truck size={13} />
                              </button>
                            )}

                            {col.id === 'out_for_delivery' && (
                              <button
                                type="button"
                                className="dispatch-action-btn btn-delivered"
                                disabled={isUpdating}
                                onClick={() => handleUpdateStatus(order.id, 'delivered')}
                              >
                                <span>Marcar Entregado</span>
                                <CheckCircle2 size={13} />
                              </button>
                            )}

                            {col.id === 'delivered' && (
                              <span className="dispatch-delivered-stamp">
                                ✓ Entregado
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Right Drawer / Split Screen Details & Packing Checklist */}
        {selectedOrder && (
          <aside className="dispatch-detail-panel">
            <div className="dispatch-detail-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 className="dispatch-detail-title">
                    Orden #{selectedOrder.order_number || selectedOrder.id}
                  </h2>
                  <span className={`dispatch-status-chip status-${selectedOrder.status}`}>
                    {selectedOrder.status === 'preparing' ? 'En Cocina' :
                     selectedOrder.status === 'ready_for_pickup' ? 'Por Empacar' :
                     selectedOrder.status === 'out_for_delivery' ? 'En Ruta' :
                     selectedOrder.status === 'delivered' ? 'Entregado' : selectedOrder.status}
                  </span>
                </div>
                <p className="dispatch-detail-time">
                  Recibida: {selectedOrder.created_at ? new Date(selectedOrder.created_at).toLocaleString() : ''}
                </p>
              </div>
              <button
                type="button"
                className="dispatch-close-panel-btn"
                onClick={() => setSelectedOrder(null)}
                title="Cerrar detalle"
              >
                <X size={18} />
              </button>
            </div>

            <div className="dispatch-detail-content">
              {/* Customer Box */}
              <div className="dispatch-box">
                <div className="dispatch-box-title">
                  <User size={15} style={{ color: '#5EDBAC' }} />
                  <span>Datos del Cliente</span>
                </div>
                <div className="dispatch-customer-detail">
                  <p><strong>Nombre:</strong> {selectedOrder.customer?.name || 'Consumidor Final'}</p>
                  {selectedOrder.customer?.phone && (
                    <p style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong>Teléfono:</strong>
                      <a href={`tel:${selectedOrder.customer.phone}`} className="dispatch-tel-btn">
                        <Phone size={13} /> {selectedOrder.customer.phone}
                      </a>
                    </p>
                  )}
                  {selectedOrder.delivery_address && (
                    <div style={{ marginTop: 8 }}>
                      <strong>Dirección de Entrega:</strong>
                      <div className="dispatch-address-box">
                        <p>{selectedOrder.delivery_address}</p>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedOrder.delivery_address)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="dispatch-gps-link"
                        >
                          <Navigation size={13} /> Abrir GPS / Maps
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Rider / Motorista Assignment Box */}
              <div className="dispatch-box">
                <div className="dispatch-box-title">
                  <UserCheck size={15} style={{ color: '#A78BFA' }} />
                  <span>Repartidor Asignado</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <select
                    className="dispatch-rider-select"
                    value={selectedOrder.delivery_executive_id || assigningExecId}
                    onChange={e => {
                      const val = Number(e.target.value)
                      setAssigningExecId(val)
                      if (val > 0) {
                        handleAssignExecutive(selectedOrder.id, val)
                      }
                    }}
                  >
                    <option value="">-- Seleccionar Repartidor --</option>
                    {executives.map(ex => (
                      <option key={ex.id} value={ex.id}>
                        {ex.name} ({ex.status === 'on_delivery' ? 'En ruta' : 'Libre'}) {ex.phone ? `· ${ex.phone}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedOrder.delivery_executive && (
                  <div className="dispatch-assigned-card">
                    <div>
                      <p className="rider-name">{selectedOrder.delivery_executive.name}</p>
                      <p className="rider-phone">{selectedOrder.delivery_executive.phone || 'Sin teléfono'}</p>
                    </div>
                    {selectedOrder.delivery_executive.phone && (
                      <a href={`tel:${selectedOrder.delivery_executive.phone}`} className="rider-call-btn">
                        <Phone size={14} /> Llamar
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Packing Checklist */}
              <div className="dispatch-box">
                <div className="dispatch-box-title" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckSquare size={15} style={{ color: '#3B82F6' }} />
                    <span>Checklist de Empaque</span>
                  </div>
                  <span className="dispatch-checklist-ratio">
                    {selectedOrder.items.filter(it => packedItems[`${selectedOrder.id}_${it.id}`]).length} / {selectedOrder.items.length}
                  </span>
                </div>

                <div className="dispatch-checklist-items">
                  {selectedOrder.items.map(it => {
                    const isPacked = Boolean(packedItems[`${selectedOrder.id}_${it.id}`])
                    return (
                      <div
                        key={it.id}
                        className={`dispatch-checklist-row ${isPacked ? 'checked' : ''}`}
                        onClick={() => toggleItemPacked(selectedOrder.id, it.id)}
                      >
                        <button type="button" className="checklist-box-btn">
                          {isPacked ? (
                            <CheckSquare size={18} style={{ color: '#10B981' }} />
                          ) : (
                            <Square size={18} style={{ color: '#6C7278' }} />
                          )}
                        </button>
                        <div className="checklist-item-info">
                          <span className="checklist-qty">{it.quantity}x</span>
                          <span className="checklist-name">{it.name}</span>
                          {it.variation_name && (
                            <span className="checklist-var">({it.variation_name})</span>
                          )}
                          {it.note && (
                            <p className="checklist-note">Nota: {it.note}</p>
                          )}
                        </div>
                        <span className="checklist-price">
                          {currencySymbol} {(it.price * it.quantity).toFixed(2)}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {isOrderFullyPacked(selectedOrder) ? (
                  <div className="dispatch-packed-banner success">
                    <CheckCircle2 size={16} />
                    <span>Todos los artículos han sido verificados y empacados.</span>
                  </div>
                ) : (
                  <div className="dispatch-packed-banner warning">
                    <AlertCircle size={16} />
                    <span>Verifique cada plato antes de sellar la bolsa y entregar al rider.</span>
                  </div>
                )}
              </div>

              {/* Order financial totals */}
              <div className="dispatch-box dispatch-totals-box">
                <div className="dispatch-totals-row">
                  <span>Subtotal</span>
                  <span>{currencySymbol} {(selectedOrder.total - (selectedOrder.delivery_fee || 0)).toFixed(2)}</span>
                </div>
                <div className="dispatch-totals-row">
                  <span>Costo de Envío</span>
                  <span>{currencySymbol} {(selectedOrder.delivery_fee || 0).toFixed(2)}</span>
                </div>
                <div className="dispatch-totals-row total">
                  <span>Total a Cobrar/Pagado</span>
                  <span>{currencySymbol} {selectedOrder.total.toFixed(2)}</span>
                </div>
              </div>

              {/* Status Advance Controls in Panel */}
              <div className="dispatch-panel-actions">
                {selectedOrder.status === 'preparing' && (
                  <button
                    type="button"
                    className="dispatch-panel-btn ready"
                    onClick={() => handleUpdateStatus(selectedOrder.id, 'ready_for_pickup')}
                  >
                    <CheckCircle2 size={16} />
                    <span>Listo en Mostrador (Empacado)</span>
                  </button>
                )}

                {selectedOrder.status === 'ready_for_pickup' && (
                  <button
                    type="button"
                    className="dispatch-panel-btn route"
                    onClick={() => {
                      if (!selectedOrder.delivery_executive_id) {
                        alert('Debe seleccionar un repartidor antes de enviar a ruta.')
                      } else {
                        handleUpdateStatus(selectedOrder.id, 'out_for_delivery')
                      }
                    }}
                  >
                    <Truck size={16} />
                    <span>Entregar a Repartidor / Salir a Ruta</span>
                  </button>
                )}

                {selectedOrder.status === 'out_for_delivery' && (
                  <button
                    type="button"
                    className="dispatch-panel-btn delivered"
                    onClick={() => handleUpdateStatus(selectedOrder.id, 'delivered')}
                  >
                    <CheckCircle2 size={16} />
                    <span>Confirmar Entrega al Cliente</span>
                  </button>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Modal: Registrar Nuevo Repartidor */}
      {showNewDriverModal && (
        <div className="pos-drawer-overlay is-visible" style={{ zIndex: 1000, display: 'grid', placeItems: 'center' }}>
          <div
            className="dispatch-box"
            style={{
              width: 'min(420px, 92vw)',
              background: '#14171C',
              border: '1px solid #30363D',
              boxShadow: '0 20px 48px rgba(0,0,0,0.6)',
              borderRadius: 14,
              padding: 24,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(94, 219, 172, 0.15)', display: 'grid', placeItems: 'center', color: '#5EDBAC' }}>
                  <Truck size={20} />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Nuevo Repartidor</h3>
              </div>
              <button
                type="button"
                className="dispatch-close-panel-btn"
                onClick={() => setShowNewDriverModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateDriver} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#C9D1D9', marginBottom: 6 }}>
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Carlos Express"
                  value={newDriverName}
                  onChange={e => setNewDriverName(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    background: '#1C2128',
                    border: '1px solid #30363D',
                    borderRadius: 8,
                    color: '#FFF',
                    padding: '0 12px',
                    fontSize: '0.88rem',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#C9D1D9', marginBottom: 6 }}>
                  Teléfono / Móvil
                </label>
                <input
                  type="tel"
                  placeholder="Ej: 8095550199"
                  value={newDriverPhone}
                  onChange={e => setNewDriverPhone(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    background: '#1C2128',
                    border: '1px solid #30363D',
                    borderRadius: 8,
                    color: '#FFF',
                    padding: '0 12px',
                    fontSize: '0.88rem',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    height: 40,
                    background: '#21262D',
                    border: '1px solid #30363D',
                    borderRadius: 8,
                    color: '#C9D1D9',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  onClick={() => setShowNewDriverModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingDriver || !newDriverName.trim()}
                  style={{
                    flex: 1,
                    height: 40,
                    background: '#5EDBAC',
                    border: 'none',
                    borderRadius: 8,
                    color: '#0A0C0F',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  {creatingDriver ? 'Guardando...' : 'Crear Repartidor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
