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
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <Package style={{ color: '#f97316' }} size={24} /> Catálogo de Productos
          </h2>
          <p className="posdan-module-subtitle">Gestión de platillos, precios, categorías y disponibilidad</p>
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
                <th>Precio Venta</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
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
                    <span className={item.available ? 'posdan-badge-success' : 'posdan-badge-danger'}>
                      {item.available ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {item.available ? 'Disponible' : 'Agotado'}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 48, textAlign: 'center', color: '#8b949e' }}>
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
