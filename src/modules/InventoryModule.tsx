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

  const filteredItems = menuItems.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.code && i.code.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <Boxes style={{ color: '#f97316' }} size={24} /> Disponibilidad del menú
          </h2>
          <p className="posdan-module-subtitle">Disponibilidad publicada de artículos; no representa existencias de ingredientes</p>
        </div>

        <div className="posdan-module-actions">
          <div className="posdan-search-box">
            <Search className="search-icon" size={16} />
            <input
              type="text"
              placeholder="Buscar artículo o código..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="posdan-search-input"
            />
          </div>
        </div>
      </div>

      <div className="posdan-stat-grid">
        <div className="posdan-stat-card">
          <div className="posdan-stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <CheckCircle2 size={22} />
          </div>
          <div>
            <p className="posdan-stat-label">Disponibles en menú</p>
            <h4 className="posdan-stat-value" style={{ color: '#34d399' }}>{menuItems.filter(i => i.available).length}</h4>
          </div>
        </div>

        <div className="posdan-stat-card">
          <div className="posdan-stat-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <AlertTriangle size={22} />
          </div>
          <div>
            <p className="posdan-stat-label">No disponibles en menú</p>
            <h4 className="posdan-stat-value" style={{ color: '#f87171' }}>{menuItems.filter(i => !i.available).length}</h4>
          </div>
        </div>

        <div className="posdan-stat-card">
          <div className="posdan-stat-icon" style={{ background: 'rgba(249, 115, 22, 0.15)', color: '#f97316', border: '1px solid rgba(249, 115, 22, 0.3)' }}>
            <Package size={22} />
          </div>
          <div>
            <p className="posdan-stat-label">Total publicado en menú</p>
            <h4 className="posdan-stat-value" style={{ color: '#f97316' }}>{menuItems.length}</h4>
          </div>
        </div>
      </div>

      <div className="posdan-table-wrap">
        <div className="posdan-table-scroll">
          <table className="posdan-table">
            <thead>
              <tr>
                <th>Artículo</th>
                <th>Código</th>
                <th>Categoría</th>
                <th>Disponibilidad publicada</th>
                <th style={{ textAlign: 'right' }}>Fuente</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(item => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 700, color: '#f0f6fc' }}>{item.name}</td>
                  <td style={{ fontFamily: 'monospace', color: '#8b949e', fontSize: 12 }}>{item.code || '-'}</td>
                  <td>
                    <span style={{ padding: '3px 8px', borderRadius: 6, background: '#21262d', color: '#c9d1d9', fontSize: 12, fontWeight: 600 }}>
                      {item.categoryName || 'General'}
                    </span>
                  </td>
                  <td>
                    <span className={item.available ? 'posdan-badge-success' : 'posdan-badge-danger'}>
                      {item.available ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                      {item.available ? 'Disponible' : 'No disponible'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {item.available ? (
                      <span style={{ fontSize: 12, color: '#8b949e', fontWeight: 600 }}>Catálogo del menú</span>
                    ) : (
                      <span style={{ fontSize: 12, color: '#f87171', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={12} /> Catálogo del menú
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 48, textAlign: 'center', color: '#8b949e' }}>
                    No se encontraron artículos que coincidan con la búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="posdan-card" style={{ marginTop: 16, padding: '12px 16px', color: '#fbbf24', fontSize: 12 }} role="note">
        La API actual publica disponibilidad del menú, pero no existencias, consumo ni reposición de ingredientes.
      </div>
    </div>
  )
}
