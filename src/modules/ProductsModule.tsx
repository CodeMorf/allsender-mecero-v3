import React, { useState } from 'react'
import {
  Package,
  Search,
  Plus,
  Utensils,
  Tag,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Sliders
} from 'lucide-react'
import type { MenuItem, StaffRole } from '../types'

export interface ProductsModuleProps {
  menuItems: MenuItem[]
  currencySymbol?: string
  roleKey?: StaffRole
  permissions?: Record<string, boolean>
  onToggleAvailability?: (itemId: number, available: boolean) => void
  onInspectItem?: (item: MenuItem) => void
}

export const ProductsModule: React.FC<ProductsModuleProps> = ({
  menuItems,
  currencySymbol = 'RD$',
  roleKey = 'mesero',
  permissions = {},
  onToggleAvailability,
  onInspectItem
}) => {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')

  const canManageMenu = roleKey === 'head' || !!permissions['menu.manage']

  const categories = ['ALL', ...Array.from(new Set(menuItems.map(i => i.categoryName).filter(Boolean)))]

  const filtered = menuItems.filter(item => {
    const matchCat = categoryFilter === 'ALL' || item.categoryName === categoryFilter
    const matchSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.code && item.code.toLowerCase().includes(search.toLowerCase()))
    return matchCat && matchSearch
  })

  return (
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <Package style={{ color: '#f97316' }} size={24} /> Catálogo de Productos
          </h2>
          <p className="posdan-module-subtitle">
            Gestión de platillos, precios, variaciones, modificadores y activación/desactivación
          </p>
        </div>

        <div className="posdan-module-actions">
          <div className="posdan-search-box">
            <Search className="search-icon" size={16} />
            <input
              type="text"
              placeholder="Buscar producto o código..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="posdan-search-input"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="posdan-select"
          >
            {categories.map(c => (
              <option key={c} value={c}>{c === 'ALL' ? 'Todas las Categorías' : c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="posdan-table-wrap">
        <div className="posdan-table-scroll">
          <table className="posdan-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Código / SKU</th>
                <th>Categoría</th>
                <th>Precio Base</th>
                <th>Variaciones & Modificadores</th>
                <th>Estado</th>
                {canManageMenu && <th style={{ textAlign: 'right' }}>Disponibilidad</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const varCount = item.variations?.length || 0
                const modCount = item.modifiers?.length || 0

                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt="" className="posdan-product-thumb" />
                        ) : (
                          <div className="posdan-product-placeholder">
                            <Utensils size={18} />
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 700, color: '#f0f6fc', fontSize: 13 }}>{item.name}</div>
                          {item.allergens && item.allergens.length > 0 && (
                            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>Alérgenos: {item.allergens.join(', ')}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'monospace', color: '#8b949e', fontSize: 12 }}>{item.code || '-'}</td>
                    <td>
                      <span style={{ padding: '3px 8px', borderRadius: 6, background: '#21262d', color: '#c9d1d9', fontSize: 12, fontWeight: 600 }}>
                        {item.categoryName || 'General'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 800, fontFamily: 'monospace', color: '#34d399', fontSize: 14 }}>
                      {currencySymbol} {item.price.toFixed(2)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {varCount > 0 ? (
                          <span style={{ padding: '2px 7px', borderRadius: 6, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontSize: 11, fontWeight: 700, border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                            {varCount} {varCount === 1 ? 'Variación' : 'Variaciones'}
                          </span>
                        ) : null}
                        {modCount > 0 ? (
                          <span style={{ padding: '2px 7px', borderRadius: 6, background: 'rgba(249, 115, 22, 0.15)', color: '#f97316', fontSize: 11, fontWeight: 700, border: '1px solid rgba(249, 115, 22, 0.3)' }}>
                            {modCount} {modCount === 1 ? 'Modificador' : 'Modificadores'}
                          </span>
                        ) : null}
                        {varCount === 0 && modCount === 0 && (
                          <span style={{ color: '#6e7681', fontSize: 11 }}>Estándar</span>
                        )}
                        {onInspectItem && (varCount > 0 || modCount > 0) && (
                          <button
                            onClick={() => onInspectItem(item)}
                            title="Ver opciones y modificadores"
                            style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 2 }}
                          >
                            <Sliders size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={item.available ? 'posdan-badge-success' : 'posdan-badge-danger'}>
                        {item.available ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                        {item.available ? 'Disponible' : 'Agotado'}
                      </span>
                    </td>
                    {canManageMenu && (
                      <td style={{ textAlign: 'right' }}>
                        <button
                          onClick={() => {
                            if (onToggleAvailability) {
                              onToggleAvailability(item.id, !item.available)
                            }
                          }}
                          className={item.available ? 'posdan-btn-toggle-active' : 'posdan-btn-toggle-inactive'}
                          title={item.available ? 'Desactivar producto del menú' : 'Activar producto en el menú'}
                        >
                          {item.available ? (
                            <>
                              <ToggleRight size={16} />
                              <span>Activo</span>
                            </>
                          ) : (
                            <>
                              <ToggleLeft size={16} />
                              <span>Desactivado</span>
                            </>
                          )}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={canManageMenu ? 7 : 6} style={{ padding: 48, textAlign: 'center', color: '#8b949e' }}>
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
