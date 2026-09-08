import React, { useState } from 'react'
import {
  Package,
  Search,
  Plus,
  Utensils,
  Tag,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react'
import type { MenuItem } from '../types'

export interface ProductsModuleProps {
  menuItems: MenuItem[]
  currencySymbol?: string
}

export const ProductsModule: React.FC<ProductsModuleProps> = ({
  menuItems,
  currencySymbol = 'RD$'
}) => {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')

  const categories = ['ALL', ...Array.from(new Set(menuItems.map(i => i.categoryName).filter(Boolean)))]

  const filtered = menuItems.filter(item => {
    const matchCat = categoryFilter === 'ALL' || item.categoryName === categoryFilter
    const matchSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.code && item.code.toLowerCase().includes(search.toLowerCase()))
    return matchCat && matchSearch
  })

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
            <Package className="text-orange-500" size={24} /> Catálogo de Productos
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Gestión de platillos, precios, categorías y disponibilidad</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              type="text"
              placeholder="Buscar producto..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
          >
            {categories.map(c => (
              <option key={c} value={c}>{c === 'ALL' ? 'Todas las Categorías' : c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 bg-slate-900/60 rounded-2xl border border-slate-800/80 overflow-hidden flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Producto</th>
                <th className="py-3 px-4">Código / SKU</th>
                <th className="py-3 px-4">Categoría</th>
                <th className="py-3 px-4">Precio Venta</th>
                <th className="py-3 px-4">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filtered.map(item => (
                <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-800 flex items-center justify-center shrink-0">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Utensils size={18} className="text-slate-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-slate-200">{item.name}</p>
                        {item.allergens && item.allergens.length > 0 && (
                          <p className="text-[10px] text-slate-500">Alérgenos: {item.allergens.join(', ')}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-400">{item.code || '-'}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                      {item.categoryName || 'General'}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-bold font-mono text-emerald-400">
                    {currencySymbol} {item.price.toFixed(2)}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      item.available
                        ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                        : 'bg-rose-950/60 text-rose-400 border border-rose-800'
                    }`}>
                      {item.available ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                      {item.available ? 'Disponible' : 'Agotado'}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    No se encontraron productos en el catálogo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
