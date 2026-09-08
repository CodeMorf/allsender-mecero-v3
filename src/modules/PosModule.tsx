import React, { useState, useMemo } from 'react'
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  User,
  Utensils,
  ShoppingBag,
  Truck,
  FileText,
  DollarSign,
  X,
  Sliders,
  Sparkles,
  Hotel,
  ChevronDown
} from 'lucide-react'
import type { DeliveryExecutive, DeliveryPlatform, DeliverySettings, MenuItem, PosCustomer, RestaurantTable, StaffRole, OrderTypeConfig } from '../types'
import { OrderTypeModal, type OrderTypeSelection } from '../components/OrderTypeModal'
import { orderServiceLabel } from '../utils/orderService'

export interface PosModuleProps {
  menuItems: MenuItem[]
  tables: RestaurantTable[]
  customers: PosCustomer[]
  selectedCustomer: PosCustomer | null
  onSelectCustomer: (cust: PosCustomer | null) => void
  onOpenCustomerModal: () => void
  onCheckout: (orderData: any) => Promise<void>
  onCustomizeItem?: (item: MenuItem) => void
  roleKey: StaffRole
  currencySymbol?: string
  orderTypes?: OrderTypeConfig[]
  deliveryPlatforms?: DeliveryPlatform[]
  deliveryExecutives?: DeliveryExecutive[]
  deliverySettings?: DeliverySettings | null
}


export interface PosCartItem {
  id: string
  itemId: number
  name: string
  price: number
  quantity: number
  variationName?: string
  variationId?: number
  modifiers?: Array<{ id: number; name: string; price: number }>
  notes?: string
}

export function cartItemUnitPrice(item: Pick<PosCartItem, 'price' | 'modifiers'>) {
  return item.price + (item.modifiers || []).reduce((sum, modifier) => sum + Number(modifier.price || 0), 0)
}

export const PosModule: React.FC<PosModuleProps> = ({
  menuItems,
  tables,
  selectedCustomer,
  onSelectCustomer,
  onOpenCustomerModal,
  onCheckout,
  onCustomizeItem,
  currencySymbol = 'RD$',
  orderTypes = [],
  deliveryPlatforms = [],
  deliveryExecutives = [],
  deliverySettings = null
}) => {
  const [orderTypeModalOpen, setOrderTypeModalOpen] = useState(false)
  const [orderSelection, setOrderSelection] = useState<OrderTypeSelection>(() => ({
    mode: 'dine_in',
    orderTypeId: orderTypes.find(t => t.slug === 'dine_in')?.id ?? 25,
    orderTypeName: 'Comer aquí'
  }))
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [cart, setCart] = useState<PosCartItem[]>([])
  const [discountPercent, setDiscountPercent] = useState<number>(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [orderNotes, setOrderNotes] = useState('')

  const categories = useMemo(() => {
    const set = new Set<string>()
    menuItems.forEach(item => {
      if (item.categoryName) set.add(item.categoryName)
    })
    return ['ALL', ...Array.from(set)]
  }, [menuItems])

  const filteredItems = useMemo(() => {
    return menuItems.filter(item => {
      const matchCat = selectedCategory === 'ALL' || item.categoryName === selectedCategory
      const matchSearch =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.code && item.code.toLowerCase().includes(searchQuery.toLowerCase()))
      return matchCat && matchSearch
    })
  }, [menuItems, selectedCategory, searchQuery])

  const handleProductClick = (item: MenuItem) => {
    const hasVars = Array.isArray(item.variations) && item.variations.length > 0
    const hasMods = Array.isArray(item.modifiers) && item.modifiers.length > 0
    if ((hasVars || hasMods) && onCustomizeItem) {
      onCustomizeItem(item)
    } else {
      addToCartDirect(item)
    }
  }

  const addToCartDirect = (item: MenuItem) => {
    setCart(prev => {
      const existingIndex = prev.findIndex(ci => ci.itemId === item.id && !ci.variationId && (!ci.modifiers || ci.modifiers.length === 0))
      if (existingIndex > -1) {
        const next = [...prev]
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + 1
        }
        return next
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
          itemId: item.id,
          name: item.name,
          price: item.price,
          quantity: 1
        }
      ]
    })
  }

  // Listen for customized item additions from the customization modal
  React.useEffect(() => {
    const handleLineAdded = (e: any) => {
      const line = e.detail
      if (!line) return
      setCart(prev => [
        ...prev,
        {
          id: line.clientId || crypto.randomUUID(),
          itemId: line.itemId,
          name: line.name,
          // Keep the base/variation price separate from supplements. The
          // checkout payload sends modifiers independently and the backend
          // adds them exactly once to the item total.
          price: Number(line.price || 0),
          quantity: line.quantity || 1,
          variationName: line.variationName,
          variationId: line.variationId,
          modifiers: line.modifiers,
          notes: line.note
        }
      ])
    }
    window.addEventListener('restapp:pos-add-line', handleLineAdded)
    return () => window.removeEventListener('restapp:pos-add-line', handleLineAdded)
  }, [])

  const updateQuantity = (cartItemId: string, delta: number) => {
    setCart(prev => {
      return prev
        .map(ci => {
          if (ci.id === cartItemId) {
            const newQty = ci.quantity + delta
            return newQty > 0 ? { ...ci, quantity: newQty } : null
          }
          return ci
        })
        .filter(Boolean) as PosCartItem[]
    })
  }

  const removeFromCart = (cartItemId: string) => {
    setCart(prev => prev.filter(ci => ci.id !== cartItemId))
  }

  const clearCart = () => {
    setCart([])
    setDiscountPercent(0)
    setOrderNotes('')
  }

  const subtotal = useMemo(() => {
    return cart.reduce((sum, ci) => sum + cartItemUnitPrice(ci) * ci.quantity, 0)
  }, [cart])

  const discountAmount = useMemo(() => {
    return (subtotal * discountPercent) / 100
  }, [subtotal, discountPercent])

  const discountedSubtotal = subtotal - discountAmount
  const itbis = discountedSubtotal * 0.18
  const defaultDeliveryFee = deliverySettings?.fixed_fee != null
    ? Number(deliverySettings.fixed_fee)
    : (deliverySettings?.fee_tiers?.[0]?.fee ?? 150)
  const currentDeliveryFee = orderSelection.mode === 'delivery'
    ? (orderSelection.deliveryFee !== undefined ? Number(orderSelection.deliveryFee) : defaultDeliveryFee)
    : 0
  const total = discountedSubtotal + itbis + currentDeliveryFee
  const selectedTable = tables.find(table => table.id === selectedTableId)
  const selectedDeliveryExecutive = deliveryExecutives.find(driver => driver.id === orderSelection.deliveryExecutiveId)
  const directDeliveryMissingAddress = orderSelection.mode === 'delivery'
    && !orderSelection.deliveryPlatformId
    && !orderSelection.deliveryAddress?.trim()
  const serviceTitle = orderServiceLabel(orderSelection.mode)
  const serviceDetail = orderSelection.mode === 'dine_in'
    ? selectedTable
      ? `${selectedTable.name || `Mesa ${selectedTable.number}`} · atención en el salón`
      : 'Seleccione una mesa o use la barra'
    : orderSelection.mode === 'pickup'
    ? selectedCustomer
      ? `Recoge: ${selectedCustomer.name}${selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ''}`
      : 'Sin mesa · asigne el cliente para identificar la orden'
    : orderSelection.mode === 'room_service'
    ? `Habitación ${orderSelection.roomNumber || 'sin indicar'}`
    : [
        orderSelection.deliveryAppName || 'Entrega directa',
        orderSelection.deliveryAddress?.trim()
          || (orderSelection.deliveryPlatformId ? 'Dirección administrada por la plataforma' : 'Falta dirección de entrega'),
        selectedDeliveryExecutive ? `Repartidor: ${selectedDeliveryExecutive.name}` : undefined,
      ].filter(Boolean).join(' · ')

  const handlePay = async () => {
    if (cart.length === 0 || directDeliveryMissingAddress) return
    setIsProcessing(true)
    try {
      await onCheckout({
        mode: orderSelection.mode,
        orderTypeId: orderSelection.orderTypeId,
        orderTypeName: orderSelection.orderTypeName,
        deliveryPlatformId: orderSelection.deliveryPlatformId,
        deliveryAppName: orderSelection.deliveryAppName,
        roomNumber: orderSelection.roomNumber,
        deliveryExecutiveId: orderSelection.deliveryExecutiveId,
        deliveryAddress: orderSelection.deliveryAddress,
        deliveryFee: orderSelection.mode === 'delivery' ? currentDeliveryFee : undefined,
        customerLat: orderSelection.customerLat,
        customerLng: orderSelection.customerLng,
        tableId: orderSelection.mode === 'dine_in' ? selectedTableId : null,
        customerId: selectedCustomer?.id || null,
        items: cart.map(c => ({
          id: c.itemId,
          name: c.name,
          price: c.price,
          quantity: c.quantity,
          variationId: c.variationId,
          variationName: c.variationName,
          modifiers: c.modifiers,
          notes: c.notes
        })),
        subtotal,
        discountPercent,
        discountAmount,
        tax: itbis,
        total,
        notes: orderNotes
      })
      clearCart()
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="posdan-pos-layout">
      {/* Modal for Order Types and Delivery Platforms */}
      <OrderTypeModal
        isOpen={orderTypeModalOpen}
        onClose={() => setOrderTypeModalOpen(false)}
        onSelect={(selection) => {
          setOrderSelection(selection)
          if (selection.mode !== 'dine_in') {
            setSelectedTableId(null)
          }
        }}
        currentSelection={orderSelection}
        orderTypes={orderTypes}
        deliveryPlatforms={deliveryPlatforms}
        deliveryExecutives={deliveryExecutives}
        deliverySettings={deliverySettings}
      />

      <div className="posdan-pos-main">
        <div className="posdan-pos-topbar">
          <div className="posdan-mode-selector" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Primary button opening OrderTypeModal */}
            <button
              type="button"
              onClick={() => setOrderTypeModalOpen(true)}
              className="posdan-mode-btn active"
              style={{
                background: '#ea580c',
                color: '#ffffff',
                borderColor: '#ea580c',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px'
              }}
              title="Haz clic para cambiar tipo de pedido o plataforma de entrega"
            >
              {orderSelection.mode === 'dine_in' && <Utensils size={16} />}
              {orderSelection.mode === 'pickup' && <ShoppingBag size={16} />}
              {orderSelection.mode === 'room_service' && <Hotel size={16} />}
              {orderSelection.mode === 'delivery' && <Truck size={16} />}
              <span>
                {orderSelection.orderTypeName}
                {orderSelection.roomNumber ? ` (${orderSelection.roomNumber})` : ''}
              </span>
              <ChevronDown size={14} style={{ opacity: 0.8 }} />
            </button>
          </div>

          {orderSelection.mode === 'dine_in' && (
            <div className="posdan-table-picker">
              <span style={{ fontSize: 12, fontWeight: 600, color: '#8b949e' }}>Mesa:</span>
              <select
                value={selectedTableId || ''}
                onChange={e => setSelectedTableId(Number(e.target.value) || null)}
                className="posdan-select"
                style={{ padding: '7px 12px', fontSize: 13 }}
              >
                <option value="">-- Sin mesa / Barra --</option>
                {tables.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.status === 'available' ? 'Libre' : 'Ocupada'})
                  </option>
                ))}
              </select>
            </div>
          )}

          {orderSelection.mode === 'pickup' && (
            <button
              type="button"
              className="posdan-service-context service-pickup"
              onClick={() => setOrderTypeModalOpen(true)}
              title="Recogida en el local: esta orden no utiliza mesa"
            >
              <ShoppingBag size={15} />
              <span><strong>Recogida en el local</strong> · Sin mesa</span>
            </button>
          )}

          {orderSelection.mode === 'room_service' && (
            <div
              onClick={() => setOrderTypeModalOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#21262d',
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid #30363d',
                fontSize: 12.5,
                color: '#f0f6fc',
                cursor: 'pointer'
              }}
            >
              <Hotel size={15} color="#ea580c" />
              <span>Habitación: <strong>{orderSelection.roomNumber || 'Sin indicar'}</strong></span>
            </div>
          )}

          {orderSelection.mode === 'delivery' && (
            <button
              type="button"
              className="posdan-service-context service-delivery"
              onClick={() => setOrderTypeModalOpen(true)}
              title="Ver o cambiar los datos de entrega"
            >
              <Truck size={15} />
              <span>
                <strong>{orderSelection.deliveryAppName || 'Entrega directa'}</strong>
                {' · '}
                {orderSelection.deliveryAddress?.trim()
                  || (orderSelection.deliveryPlatformId ? 'Dirección en plataforma' : 'Falta dirección')}
              </span>
            </button>
          )}

          <div className="posdan-search-box" style={{ width: 280 }}>
            <Search className="search-icon" size={16} />
            <input
              type="text"
              placeholder="Buscar platillo o código..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="posdan-search-input"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer' }}
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        <div className="posdan-cat-bar">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`posdan-cat-btn ${selectedCategory === cat ? 'active' : ''}`}
            >
              {cat === 'ALL' ? 'Todos los Productos' : cat}
            </button>
          ))}
        </div>

        <div className="posdan-products-grid">
          {filteredItems.map(item => {
            const hasOptions = (item.variations && item.variations.length > 0) || (item.modifiers && item.modifiers.length > 0)

            return (
              <button
                key={item.id}
                onClick={() => handleProductClick(item)}
                disabled={!item.available}
                className="posdan-item-card"
              >
                <div className="posdan-item-image-wrap">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      onError={e => {
                        ;(e.currentTarget as HTMLElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <Utensils style={{ color: '#484f58' }} size={28} />
                  )}
                  {!item.available && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(9, 13, 20, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="posdan-badge-danger" style={{ fontSize: 10 }}>Agotado</span>
                    </div>
                  )}
                  {hasOptions && item.available && (
                    <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(249, 115, 22, 0.9)', color: '#fff', borderRadius: 6, padding: '2px 5px', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Sliders size={10} /> Opciones
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#f0f6fc', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.name}
                    </h4>
                    {item.categoryName && (
                      <span style={{ fontSize: 11, color: '#8b949e', display: 'block', marginTop: 3 }}>
                        {item.categoryName}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: '#34d399' }}>
                      {currencySymbol} {item.price.toFixed(2)}
                    </span>
                    <span style={{ width: 26, height: 26, borderRadius: 8, background: '#21262d', color: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {hasOptions ? <Sliders size={14} /> : <Plus size={15} />}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="posdan-cart-sidebar">
        <div className="posdan-cart-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShoppingCart size={18} style={{ color: '#f97316' }} />
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#f0f6fc' }}>Orden Actual</h3>
            </div>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                style={{ background: 'transparent', border: 'none', color: '#f87171', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
              >
                <Trash2 size={13} /> Limpiar
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#161b22', padding: '8px 12px', borderRadius: 12, border: '1px solid #30363d' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <User size={15} style={{ color: '#8b949e', flexShrink: 0 }} />
              {selectedCustomer ? (
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#f0f6fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedCustomer.name}</p>
                  {selectedCustomer.rncCedula && (
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#f97316', fontFamily: 'monospace' }}>RNC: {selectedCustomer.rncCedula}</p>
                  )}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: '#8b949e' }}>Consumidor Final</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {selectedCustomer && (
                <button onClick={() => onSelectCustomer(null)} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 4 }}>
                  <X size={14} />
                </button>
              )}
              <button
                onClick={onOpenCustomerModal}
                style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                {selectedCustomer ? 'Cambiar' : '+ Cliente'}
              </button>
            </div>
          </div>

          <button
            type="button"
            className={`posdan-service-summary service-${orderSelection.mode}`}
            onClick={() => setOrderTypeModalOpen(true)}
            title="Ver o cambiar el tipo de servicio"
          >
            <span className="posdan-service-summary-icon">
              {orderSelection.mode === 'dine_in' && <Utensils size={18} />}
              {orderSelection.mode === 'pickup' && <ShoppingBag size={18} />}
              {orderSelection.mode === 'delivery' && <Truck size={18} />}
              {orderSelection.mode === 'room_service' && <Hotel size={18} />}
            </span>
            <span className="posdan-service-summary-copy">
              <small>TIPO DE SERVICIO</small>
              <strong>{serviceTitle}</strong>
              <span>{serviceDetail}</span>
            </span>
            <span className="posdan-service-summary-action">Cambiar</span>
          </button>

          {directDeliveryMissingAddress && (
            <div className="posdan-service-warning" role="alert">
              La entrega propia necesita una dirección antes de enviar o cobrar.
            </div>
          )}
        </div>

        <div className="posdan-cart-list">
          {cart.map(ci => (
            <div
              key={ci.id}
              className="posdan-cart-item"
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <h5 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#f0f6fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ci.name}</h5>
                {ci.variationName && (
                  <span style={{ fontSize: 11, color: '#38bdf8', display: 'block', marginTop: 1 }}>
                    Variación: {ci.variationName}
                  </span>
                )}
                {ci.modifiers && ci.modifiers.length > 0 && (
                  <div style={{ fontSize: 11, color: '#f97316', marginTop: 1 }}>
                    + {ci.modifiers.map(m => m.name).join(', ')}
                  </div>
                )}
                {ci.notes && (
                  <div style={{ fontSize: 11, color: '#8b949e', fontStyle: 'italic', marginTop: 1 }}>
                    Nota: {ci.notes}
                  </div>
                )}
                <div style={{ marginTop: 2 }}>
                  <span style={{ fontSize: 12, color: '#34d399', fontWeight: 800, fontFamily: 'monospace' }}>
                    {currencySymbol} {(cartItemUnitPrice(ci) * ci.quantity).toFixed(2)}
                  </span>
                  <span style={{ fontSize: 11, color: '#8b949e', marginLeft: 6 }}>
                    ({currencySymbol} {cartItemUnitPrice(ci).toFixed(2)} c/u)
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#0d1117', padding: '3px 6px', borderRadius: 8, border: '1px solid #21262d' }}>
                <button
                  onClick={() => updateQuantity(ci.id, -1)}
                  style={{ width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: '#c9d1d9', cursor: 'pointer' }}
                >
                  <Minus size={12} />
                </button>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#f0f6fc', width: 20, textAlign: 'center' }}>{ci.quantity}</span>
                <button
                  onClick={() => updateQuantity(ci.id, 1)}
                  style={{ width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: '#c9d1d9', cursor: 'pointer' }}
                >
                  <Plus size={12} />
                </button>
              </div>

              <button
                onClick={() => removeFromCart(ci.id)}
                style={{ background: 'transparent', border: 'none', color: '#6e7681', cursor: 'pointer', padding: 4 }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          {cart.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#8b949e', padding: '48px 0' }}>
              <ShoppingCart size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p style={{ fontSize: 13, margin: 0 }}>No hay productos seleccionados.</p>
              <p style={{ fontSize: 11, color: '#6e7681', margin: '4px 0 0' }}>Haga clic en un platillo para agregarlo.</p>
            </div>
          )}
        </div>

        <div className="posdan-cart-footer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#8b949e' }}>
            <span>Descuento:</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 5, 10, 15, 20].map(pct => (
                <button
                  key={pct}
                  onClick={() => setDiscountPercent(pct)}
                  style={{
                    padding: '3px 7px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    background: discountPercent === pct ? '#ea580c' : '#21262d',
                    color: discountPercent === pct ? '#ffffff' : '#8b949e'
                  }}
                >
                  {pct === 0 ? '0%' : `${pct}%`}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#8b949e', paddingTop: 8, borderTop: '1px solid #21262d' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal</span>
              <span style={{ fontFamily: 'monospace', color: '#f0f6fc' }}>{currencySymbol} {subtotal.toFixed(2)}</span>
            </div>
            {discountPercent > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f97316', fontWeight: 600 }}>
                <span>Descuento ({discountPercent}%)</span>
                <span style={{ fontFamily: 'monospace' }}>-{currencySymbol} {discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>ITBIS (18%)</span>
              <span style={{ fontFamily: 'monospace', color: '#f0f6fc' }}>{currencySymbol} {itbis.toFixed(2)}</span>
            </div>
            {currentDeliveryFee > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#60a5fa', fontWeight: 600 }}>
                <span>Costo de Envío</span>
                <span style={{ fontFamily: 'monospace' }}>{currencySymbol} {currentDeliveryFee.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 8, borderTop: '1px solid #21262d' }}>
              <span style={{ color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 800, fontSize: 12 }}>Total a Pagar</span>
              <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 900, color: '#34d399' }}>{currencySymbol} {total.toFixed(2)}</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingTop: 4 }}>
            <button
              onClick={handlePay}
              disabled={cart.length === 0 || isProcessing || directDeliveryMissingAddress}
              className="posdan-btn-action-green"
              title={directDeliveryMissingAddress ? 'Complete la dirección de entrega antes de continuar' : 'Cobrar la orden'}
            >
              <DollarSign size={16} />
              <span>Cobrar</span>
            </button>
            <button
              onClick={handlePay}
              disabled={cart.length === 0 || isProcessing || directDeliveryMissingAddress}
              className="posdan-btn-action-orange"
              title={directDeliveryMissingAddress ? 'Complete la dirección de entrega antes de continuar' : 'Enviar la comanda'}
            >
              <FileText size={16} />
              <span>Comanda</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
