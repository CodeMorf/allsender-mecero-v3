import React, { useState } from 'react'
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  Building,
  CheckCircle2,
  ShieldCheck,
  Edit2,
  Clock,
  History,
  X,
  Receipt,
  FileText
} from 'lucide-react'
import type { PosCustomer } from '../types'

export interface CustomersModuleProps {
  customers: PosCustomer[]
  loading?: boolean
  orders?: any[]
  onOpenCustomerModal: () => void
  onEditCustomer: (cust: PosCustomer) => void
  currencySymbol?: string
}

export const CustomersModule: React.FC<CustomersModuleProps> = ({
  customers,
  loading = false,
  orders = [],
  onOpenCustomerModal,
  onEditCustomer,
  currencySymbol = 'RD$'
}) => {
  const [search, setSearch] = useState('')
  const [historyModalCustomer, setHistoryModalCustomer] = useState<PosCustomer | null>(null)

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone && c.phone.includes(search)) ||
    (c.rncCedula && c.rncCedula.includes(search))
  )

  const customerOrders = historyModalCustomer
    ? orders.filter(o => o.customer_id === historyModalCustomer.id || (o.customer_name && o.customer_name.toLowerCase() === historyModalCustomer.name.toLowerCase()))
    : []

  const totalCustomerSpent = customerOrders.reduce((sum, o) => sum + Number(o.total || o.grand_total || 0), 0)

  return (
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <Users style={{ color: '#f97316' }} size={24} /> Directorio de Clientes
          </h2>
          <p className="posdan-module-subtitle">Gestión de clientes, historial de pedidos y validación DGII de RNC</p>
        </div>

        <div className="posdan-module-actions">
          <div className="posdan-search-box">
            <Search className="search-icon" size={16} />
            <input
              type="text"
              placeholder="Buscar cliente, RNC, teléfono..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="posdan-search-input"
            />
          </div>

          <button
            onClick={onOpenCustomerModal}
            className="posdan-btn-primary"
          >
            <Plus size={16} />
            <span>Nuevo Cliente</span>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, alignContent: 'start' }}>
        {filtered.map(cust => {
          const custOrders = orders.filter(o => o.customer_id === cust.id || (o.customer_name && o.customer_name.toLowerCase() === cust.name.toLowerCase()))
          const totalSpent = custOrders.reduce((sum, o) => sum + Number(o.total || o.grand_total || 0), 0)

          return (
            <div
              key={cust.id}
              className="posdan-card"
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <h4 style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#f0f6fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cust.name}</h4>
                    {cust.rncCedula && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        <ShieldCheck size={13} style={{ color: '#f97316', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#f97316', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          RNC: {cust.rncCedula}
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => setHistoryModalCustomer(cust)}
                      style={{ background: '#21262d', border: '1px solid #30363d', color: '#38bdf8', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', flexShrink: 0 }}
                      title="Ver historial de compras"
                    >
                      <History size={13} />
                    </button>
                    <button
                      onClick={() => onEditCustomer(cust)}
                      style={{ background: '#21262d', border: '1px solid #30363d', color: '#8b949e', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', flexShrink: 0 }}
                      title="Editar cliente"
                    >
                      <Edit2 size={13} />
                    </button>
                  </div>
                </div>

                {cust.fiscalName && (
                  <p style={{ fontSize: 11, color: '#8b949e', fontStyle: 'italic', margin: '6px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cust.fiscalName}
                  </p>
                )}

                <div style={{ marginTop: 12, borderTop: '1px solid #21262d', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#8b949e' }}>
                  {cust.phone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <Phone size={12} style={{ color: '#6e7681', flexShrink: 0 }} />
                      <span>+{cust.phoneCode || '1'} {cust.phone}</span>
                    </div>
                  )}
                  {cust.email && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <Mail size={12} style={{ color: '#6e7681', flexShrink: 0 }} />
                      <span>{cust.email}</span>
                    </div>
                  )}
                  {cust.deliveryAddress && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <MapPin size={12} style={{ color: '#6e7681', flexShrink: 0 }} />
                      <span>{cust.deliveryAddress}</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 12, borderTop: '1px solid #21262d', paddingTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#8b949e' }}>
                  <strong>{custOrders.length}</strong> {custOrders.length === 1 ? 'pedido' : 'pedidos'} · <span style={{ color: '#34d399', fontFamily: 'monospace', fontWeight: 700 }}>{currencySymbol} {totalSpent.toFixed(2)}</span>
                </span>
                <button
                  onClick={() => setHistoryModalCustomer(cust)}
                  style={{ background: 'transparent', border: 'none', color: '#f97316', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                >
                  Historial &rarr;
                </button>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '64px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
            <Users size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p style={{ fontSize: 14, fontWeight: 600 }}>{loading ? 'Cargando clientes…' : 'No se encontraron clientes registrados.'}</p>
          </div>
        )}
      </div>

      {/* Customer History Modal */}
      {historyModalCustomer && (
        <div className="posdan-modal-overlay">
          <div className="posdan-modal-content" style={{ maxWidth: 640 }}>
            <div className="posdan-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <History size={18} style={{ color: '#f97316' }} />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#f0f6fc' }}>
                  Historial de {historyModalCustomer.name}
                </h3>
              </div>
              <button
                onClick={() => setHistoryModalCustomer(null)}
                style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 12 }}>
                  <span style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', fontWeight: 700 }}>Total de Pedidos</span>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#f0f6fc', marginTop: 4 }}>{customerOrders.length}</div>
                </div>
                <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 12 }}>
                  <span style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', fontWeight: 700 }}>Consumo Total Acumulado</span>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#34d399', fontFamily: 'monospace', marginTop: 4 }}>
                    {currencySymbol} {totalCustomerSpent.toFixed(2)}
                  </div>
                </div>
              </div>

              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="posdan-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th># Orden</th>
                      <th>Fecha</th>
                      <th>Total</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerOrders.map(o => (
                      <tr key={o.id}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#f0f6fc' }}>
                          #{o.order_number || o.id}
                        </td>
                        <td style={{ color: '#8b949e', fontSize: 12 }}>
                          {o.created_at ? new Date(o.created_at).toLocaleDateString() : 'Hoy'}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#34d399' }}>
                          {currencySymbol} {Number(o.total || o.grand_total || 0).toFixed(2)}
                        </td>
                        <td>
                          <span className={o.status === 'paid' || o.payment_status === 'paid' ? 'posdan-badge-success' : 'posdan-badge-danger'}>
                            {o.status === 'paid' || o.payment_status === 'paid' ? 'Pagado' : 'Pendiente'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {customerOrders.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#8b949e' }}>
                          Este cliente aún no tiene pedidos registrados en el sistema.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
