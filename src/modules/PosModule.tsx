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
  X
} from 'lucide-react'
import type { MenuItem, PosCustomer, RestaurantTable, StaffRole } from '../types'

export type OrderMode = 'dine_in' | 'takeaway' | 'delivery'

export interface PosModuleProps {
  menuItems: MenuItem[]
  tables: RestaurantTable[]
  customers: PosCustomer[]
  selectedCustomer: PosCustomer | null
  onSelectCustomer: (cust: PosCustomer | null) => void
  onOpenCustomerModal: () => void
  onCheckout: (orderData: any) => Promise<void>
  roleKey: StaffRole
  currencySymbol?: string
}

interface CartItem {
  item: MenuItem
  quantity: number
  notes?: string
}

export const PosModule: React.FC<PosModuleProps> = ({
  menuItems,
  tables,
  selectedCustomer,
  onSelectCustomer,
  onOpenCustomerModal,
  onCheckout,
  currencySymbol = 'RD$'
}) => {
  const [orderMode, setOrderMode] = useState<OrderMode>('dine_in')
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [cart, setCart] = useState<CartItem[]>([])
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

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existingIndex = prev.findIndex(ci => ci.item.id === item.id)
      if (existingIndex > -1) {
        const next = [...prev]
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + 1
        }
        return next
      }
      return [...prev, { item, quantity: 1 }]
    })
  }

  const updateQuantity = (itemId: number, delta: number) => {
    setCart(prev => {
      return prev
        .map(ci => {
          if (ci.item.id === itemId) {
            const newQty = ci.quantity + delta
            return newQty > 0 ? { ...ci, quantity: newQty } : null
          }
          return ci
        })
        .filter(Boolean) as CartItem[]
    })
  }

  const removeFromCart = (itemId: number) => {
    setCart(prev => prev.filter(ci => ci.item.id !== itemId))
  }

  const clearCart = () => {
    setCart([])
    setDiscountPercent(0)
    setOrderNotes('')
  }

  const subtotal = cart.reduce((sum, ci) => sum + ci.item.price * ci.quantity, 0)
  const discountAmount = (subtotal * discountPercent) / 100
  const itbis = (subtotal - discountAmount) * 0.18
  const total = subtotal - discountAmount + itbis

  const handlePay = async () => {
    if (cart.length === 0) return
    setIsProcessing(true)
    try {
      await onCheckout({
        mode: orderMode,
        tableId: orderMode === 'dine_in' ? selectedTableId : null,
        customerId: selectedCustomer?.id || null,
        items: cart.map(c => ({
          id: c.item.id,
          name: c.item.name,
          price: c.item.price,
          quantity: c.quantity,
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
      <div className="posdan-pos-main">
        <div className="posdan-pos-topbar">
          <div className="posdan-mode-selector">
            <button
              onClick={() => setOrderMode('dine_in')}
              className={`posdan-mode-btn ${orderMode === 'dine_in' ? 'active' : ''}`}
            >
              <Utensils size={15} />
              <span>Comer Aquí</span>
            </button>
            <button
              onClick={() => setOrderMode('takeaway')}
              className={`posdan-mode-btn ${orderMode === 'takeaway' ? 'active' : ''}`}
            >
              <ShoppingBag size={15} />
              <span>Para Llevar</span>
            </button>
            <button
              onClick={() => setOrderMode('delivery')}
              className={`posdan-mode-btn ${orderMode === 'delivery' ? 'active' : ''}`}
            >
              <Truck size={15} />
              <span>A Domicilio</span>
            </button>
          </div>

          {orderMode === 'dine_in' && (
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
          {filteredItems.map(item => (
            <button
              key={item.id}
              onClick={() => addToCart(item)}
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
                    <Plus size={15} />
                  </span>
                </div>
              </div>
            </button>
          ))}
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
        </div>

        <div className="posdan-cart-list">
          {cart.map(ci => (
            <div
              key={ci.item.id}
              className="posdan-cart-item"
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <h5 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#f0f6fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ci.item.name}</h5>
                <div style={{ marginTop: 2 }}>
                  <span style={{ fontSize: 12, color: '#34d399', fontWeight: 800, fontFamily: 'monospace' }}>
                    {currencySymbol} {(ci.item.price * ci.quantity).toFixed(2)}
                  </span>
                  <span style={{ fontSize: 11, color: '#8b949e', marginLeft: 6 }}>
                    ({currencySymbol} {ci.item.price.toFixed(2)} c/u)
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#0d1117', padding: '3px 6px', borderRadius: 8, border: '1px solid #21262d' }}>
                <button
                  onClick={() => updateQuantity(ci.item.id, -1)}
                  style={{ width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: '#c9d1d9', cursor: 'pointer' }}
                >
                  <Minus size={12} />
                </button>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#f0f6fc', width: 20, textAlign: 'center' }}>{ci.quantity}</span>
                <button
                  onClick={() => updateQuantity(ci.item.id, 1)}
                  style={{ width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: '#c9d1d9', cursor: 'pointer' }}
                >
                  <Plus size={12} />
                </button>
              </div>

              <button
                onClick={() => removeFromCart(ci.item.id)}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 8, borderTop: '1px solid #21262d' }}>
              <span style={{ color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 800, fontSize: 12 }}>Total a Pagar</span>
              <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 900, color: '#34d399' }}>{currencySymbol} {total.toFixed(2)}</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingTop: 4 }}>
            <button
              onClick={handlePay}
              disabled={cart.length === 0 || isProcessing}
              className="posdan-btn-action-green"
            >
              <DollarSign size={16} />
              <span>Cobrar</span>
            </button>
            <button
              onClick={handlePay}
              disabled={cart.length === 0 || isProcessing}
              className="posdan-btn-action-orange"
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
