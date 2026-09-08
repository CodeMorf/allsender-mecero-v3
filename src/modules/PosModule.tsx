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
    <div className="posdan-pos-layout flex h-full w-full overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex-1 flex flex-col min-w-0 border-r border-slate-800">
        <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-slate-900/60">
          <div className="flex items-center bg-slate-800/90 p-1 rounded-xl border border-slate-700/60 shadow-inner">
            <button
              onClick={() => setOrderMode('dine_in')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                orderMode === 'dine_in' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Utensils size={16} />
              <span>Comer Aquí</span>
            </button>
            <button
              onClick={() => setOrderMode('takeaway')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                orderMode === 'takeaway' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShoppingBag size={16} />
              <span>Para Llevar</span>
            </button>
            <button
              onClick={() => setOrderMode('delivery')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                orderMode === 'delivery' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Truck size={16} />
              <span>A Domicilio</span>
            </button>
          </div>

          {orderMode === 'dine_in' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Mesa:</span>
              <select
                value={selectedTableId || ''}
                onChange={e => setSelectedTableId(Number(e.target.value) || null)}
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-orange-500 outline-none"
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

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type="text"
              placeholder="Buscar producto por nombre o código..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="px-4 py-2 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto no-scrollbar bg-slate-900/30">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedCategory === cat
                  ? 'bg-slate-700 text-orange-400 border border-orange-500/40 shadow'
                  : 'text-slate-400 bg-slate-800/40 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {cat === 'ALL' ? 'Todos los Productos' : cat}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
          {filteredItems.map(item => (
            <button
              key={item.id}
              onClick={() => addToCart(item)}
              disabled={!item.available}
              className={`group flex flex-col text-left p-3 rounded-2xl border transition-all duration-150 ${
                item.available
                  ? 'bg-slate-900/90 border-slate-800/90 hover:border-orange-500/60 hover:bg-slate-800/80 hover:shadow-lg hover:shadow-orange-950/20 active:scale-[0.98]'
                  : 'bg-slate-950/60 border-slate-900 opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="w-full aspect-[4/3] rounded-xl overflow-hidden bg-slate-800/60 mb-2.5 flex items-center justify-center relative">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={e => {
                      ;(e.currentTarget as HTMLElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <Utensils className="text-slate-600" size={32} />
                )}
                {!item.available && (
                  <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 bg-rose-950/80 px-2 py-0.5 rounded border border-rose-800">
                      Agotado
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <h4 className="font-semibold text-sm text-slate-200 line-clamp-2 leading-tight group-hover:text-orange-400 transition-colors">
                    {item.name}
                  </h4>
                  {item.categoryName && (
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      {item.categoryName}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-emerald-400">
                    {currencySymbol} {item.price.toFixed(2)}
                  </span>
                  <span className="w-6 h-6 rounded-full bg-slate-800 group-hover:bg-orange-600 text-slate-400 group-hover:text-white flex items-center justify-center transition-colors shadow-sm">
                    <Plus size={14} />
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="w-96 flex flex-col bg-slate-900 border-l border-slate-800 shadow-2xl">
        <div className="p-4 border-b border-slate-800/90 flex flex-col gap-2.5 bg-slate-900/90">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart size={18} className="text-orange-500" />
              <h3 className="font-bold text-sm tracking-wide text-slate-200 uppercase">Orden Actual</h3>
            </div>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-medium transition-colors"
              >
                <Trash2 size={13} /> Limpiar
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 bg-slate-950/60 p-2 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2 min-w-0">
              <User size={15} className="text-slate-400 shrink-0" />
              {selectedCustomer ? (
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-200 truncate">{selectedCustomer.name}</p>
                  {selectedCustomer.rncCedula && (
                    <p className="text-[10px] text-orange-400 font-mono">RNC: {selectedCustomer.rncCedula}</p>
                  )}
                </div>
              ) : (
                <span className="text-xs text-slate-400">Consumidor Final</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {selectedCustomer && (
                <button onClick={() => onSelectCustomer(null)} className="text-slate-500 hover:text-rose-400 p-1">
                  <X size={14} />
                </button>
              )}
              <button
                onClick={onOpenCustomerModal}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg font-medium border border-slate-700 transition-colors"
              >
                {selectedCustomer ? 'Cambiar' : '+ Cliente'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {cart.map(ci => (
            <div
              key={ci.item.id}
              className="p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/80 flex items-center justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <h5 className="text-xs font-semibold text-slate-200 truncate">{ci.item.name}</h5>
                <span className="text-[11px] text-emerald-400 font-bold">
                  {currencySymbol} {(ci.item.price * ci.quantity).toFixed(2)}
                </span>
                <span className="text-[10px] text-slate-500 ml-1.5">
                  ({currencySymbol} {ci.item.price.toFixed(2)} c/u)
                </span>
              </div>

              <div className="flex items-center gap-1.5 bg-slate-800/90 rounded-lg p-1 border border-slate-700/60">
                <button
                  onClick={() => updateQuantity(ci.item.id, -1)}
                  className="w-5 h-5 rounded flex items-center justify-center text-slate-300 hover:bg-slate-700 active:scale-95"
                >
                  <Minus size={12} />
                </button>
                <span className="text-xs font-bold text-slate-100 w-5 text-center">{ci.quantity}</span>
                <button
                  onClick={() => updateQuantity(ci.item.id, 1)}
                  className="w-5 h-5 rounded flex items-center justify-center text-slate-300 hover:bg-slate-700 active:scale-95"
                >
                  <Plus size={12} />
                </button>
              </div>

              <button
                onClick={() => removeFromCart(ci.item.id)}
                className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          {cart.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12">
              <ShoppingCart size={36} className="mb-2 opacity-30" />
              <p className="text-xs">No hay productos seleccionados.</p>
              <p className="text-[11px] text-slate-600 mt-1">Haga clic en un producto para agregarlo.</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900/95 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Descuento:</span>
            <div className="flex gap-1">
              {[0, 5, 10, 15, 20].map(pct => (
                <button
                  key={pct}
                  onClick={() => setDiscountPercent(pct)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    discountPercent === pct ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {pct === 0 ? '0%' : `${pct}%`}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1 text-xs text-slate-400 pt-1 border-t border-slate-800/80">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-mono text-slate-200">{currencySymbol} {subtotal.toFixed(2)}</span>
            </div>
            {discountPercent > 0 && (
              <div className="flex justify-between text-orange-400 font-semibold">
                <span>Descuento ({discountPercent}%)</span>
                <span className="font-mono">-{currencySymbol} {discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>ITBIS (18%)</span>
              <span className="font-mono text-slate-200">{currencySymbol} {itbis.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm font-extrabold text-slate-100 pt-1.5 border-t border-slate-800">
              <span className="text-orange-400 uppercase tracking-wider text-xs">Total a Pagar</span>
              <span className="font-mono text-lg text-emerald-400">{currencySymbol} {total.toFixed(2)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={handlePay}
              disabled={cart.length === 0 || isProcessing}
              className="w-full py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-950/40 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-all"
            >
              <DollarSign size={16} />
              <span>Cobrar</span>
            </button>
            <button
              onClick={handlePay}
              disabled={cart.length === 0 || isProcessing}
              className="w-full py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-950/40 hover:from-orange-500 hover:to-amber-500 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-all"
            >
              <FileText size={16} />
              <span>Comanda (KOT)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
