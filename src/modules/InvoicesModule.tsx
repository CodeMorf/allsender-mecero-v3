import React, { useState } from 'react'
import {
  Receipt,
  Search,
  Printer,
  Calendar,
  DollarSign,
  FileText,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Filter
} from 'lucide-react'

export interface InvoicesModuleProps {
  orders: any[]
  onPrintInvoice: (orderId: number) => void
  currencySymbol?: string
}

export const InvoicesModule: React.FC<InvoicesModuleProps> = ({
  orders,
  onPrintInvoice,
  currencySymbol = 'RD$'
}) => {
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('ALL')

  const filteredOrders = orders.filter(o => {
    const matchSearch =
      String(o.id).includes(search) ||
      String(o.order_number || '').toLowerCase().includes(search.toLowerCase()) ||
      String(o.customer_name || '').toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filterType === 'ALL' ||
      (filterType === 'paid' && (o.status === 'paid' || o.payment_status === 'paid')) ||
      (filterType === 'billed' && (o.status === 'billed' || o.order_status === 'billed'))
    return matchSearch && matchFilter
  })

  return (
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <Receipt style={{ color: '#f97316' }} size={24} /> Facturas y Comprobantes
          </h2>
          <p className="posdan-module-subtitle">Historial de comprobantes emitidos, facturación y reimpresión térmica</p>
        </div>

        <div className="posdan-module-actions">
          <div className="posdan-search-box">
            <Search className="search-icon" size={16} />
            <input
              type="text"
              placeholder="Buscar # orden, NCF, cliente..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="posdan-search-input"
            />
          </div>

          <div style={{ display: 'flex', background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: 3, gap: 2 }}>
            <button
              onClick={() => setFilterType('ALL')}
              style={{
                padding: '6px 12px',
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                background: filterType === 'ALL' ? '#ea580c' : 'transparent',
                color: filterType === 'ALL' ? '#ffffff' : '#8b949e'
              }}
            >
              Todos
            </button>
            <button
              onClick={() => setFilterType('paid')}
              style={{
                padding: '6px 12px',
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                background: filterType === 'paid' ? '#ea580c' : 'transparent',
                color: filterType === 'paid' ? '#ffffff' : '#8b949e'
              }}
            >
              Pagados
            </button>
            <button
              onClick={() => setFilterType('billed')}
              style={{
                padding: '6px 12px',
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                background: filterType === 'billed' ? '#ea580c' : 'transparent',
                color: filterType === 'billed' ? '#ffffff' : '#8b949e'
              }}
            >
              Por Cobrar
            </button>
          </div>
        </div>
      </div>

      <div className="posdan-table-wrap">
        <div className="posdan-table-scroll">
          <table className="posdan-table">
            <thead>
              <tr>
                <th># Factura / Orden</th>
                <th>Fecha & Hora</th>
                <th>Cliente / RNC</th>
                <th>Tipo Comprobante</th>
                <th>Total</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(order => (
                <tr key={order.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#f0f6fc', fontSize: 13 }}>
                    #{order.order_number || order.id}
                  </td>
                  <td style={{ color: '#8b949e', fontSize: 12 }}>
                    {order.created_at ? new Date(order.created_at).toLocaleString() : 'Hoy'}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: '#f0f6fc' }}>{order.customer_name || 'Consumidor Final'}</div>
                    {order.customer_rnc && (
                      <span style={{ fontSize: 11, color: '#f97316', fontFamily: 'monospace', display: 'block', marginTop: 2 }}>RNC: {order.customer_rnc}</span>
                    )}
                  </td>
                  <td>
                    <span style={{ padding: '3px 8px', borderRadius: 6, background: '#21262d', border: '1px solid #30363d', fontFamily: 'monospace', fontSize: 11, color: '#c9d1d9' }}>
                      {order.receipt_type || 'B02'}
                    </span>
                  </td>
                  <td style={{ fontWeight: 800, fontFamily: 'monospace', color: '#34d399', fontSize: 14 }}>
                    {currencySymbol} {Number(order.total || order.grand_total || order.order_total || 0).toFixed(2)}
                  </td>
                  <td>
                    <span className={order.status === 'paid' || order.payment_status === 'paid' ? 'posdan-badge-success' : 'posdan-badge-danger'}>
                      {order.status === 'paid' || order.payment_status === 'paid' ? 'Pagado' : 'Por Cobrar'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      onClick={() => onPrintInvoice(order.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        borderRadius: 8,
                        background: '#21262d',
                        border: '1px solid #30363d',
                        color: '#f0f6fc',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      <Printer size={13} />
                      <span>Imprimir</span>
                    </button>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 48, textAlign: 'center', color: '#8b949e' }}>
                    No se encontraron facturas o comprobantes.
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
