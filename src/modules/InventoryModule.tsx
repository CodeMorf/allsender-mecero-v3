import React, { useState } from 'react'
import {
  Boxes,
  Search,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  RotateCcw,
  CheckCircle2,
  Package
} from 'lucide-react'
import type { MenuItem } from '../types'

export interface InventoryModuleProps {
  menuItems: MenuItem[]
}

export const InventoryModule: React.FC<InventoryModuleProps> = ({ menuItems }) => {
  const [search, setSearch] = useState('')

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
            <Boxes className="text-orange-500" size={24} /> Control de Inventario
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Control de existencias, insumos y alertas de stock crítico</p>
        </div>

        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            type="text"
            placeholder="Buscar artículo..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-950/60 border border-emerald-800 flex items-center justify-center text-emerald-400">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Artículos en Stock Óptimo</p>
            <h4 className="text-lg font-bold text-slate-100">{menuItems.filter(i => i.available).length}</h4>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-950/60 border border-rose-800 flex items-center justify-center text-rose-400">
            <AlertTriangle size={20} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Sin Existencias / Agotados</p>
            <h4 className="text-lg font-bold text-rose-400">{menuItems.filter(i => !i.available).length}</h4>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-950/60 border border-orange-800 flex items-center justify-center text-orange-400">
            <Package size={20} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Total de Ítems en Menú</p>
            <h4 className="text-lg font-bold text-orange-400">{menuItems.length}</h4>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-slate-900/60 rounded-2xl border border-slate-800/80 overflow-hidden flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Artículo</th>
                <th className="py-3 px-4">Código</th>
                <th className="py-3 px-4">Categoría</th>
                <th className="py-3 px-4">Estado Stock</th>
                <th className="py-3 px-4 text-right">Alerta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {menuItems.map(item => (
                <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4 font-bold text-slate-200">{item.name}</td>
                  <td className="py-3 px-4 font-mono text-slate-400">{item.code || '-'}</td>
                  <td className="py-3 px-4 text-slate-300">{item.categoryName}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.available ? 'bg-emerald-950/60 text-emerald-400' : 'bg-rose-950/60 text-rose-400'
                    }`}>
                      {item.available ? 'En Existencia' : 'Agotado'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {item.available ? (
                      <span className="text-[11px] text-emerald-400 font-medium">Normal</span>
                    ) : (
                      <span className="text-[11px] text-rose-400 font-bold flex items-center justify-end gap-1">
                        <AlertTriangle size={12} /> Requiere Reposición
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
