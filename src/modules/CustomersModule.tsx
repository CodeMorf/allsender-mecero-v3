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
  Edit2
} from 'lucide-react'
import type { PosCustomer } from '../types'

export interface CustomersModuleProps {
  customers: PosCustomer[]
  onOpenCustomerModal: () => void
  onEditCustomer: (cust: PosCustomer) => void
}

export const CustomersModule: React.FC<CustomersModuleProps> = ({
  customers,
  onOpenCustomerModal,
  onEditCustomer
}) => {
  const [search, setSearch] = useState('')

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone && c.phone.includes(search)) ||
    (c.rncCedula && c.rncCedula.includes(search))
  )

  return (
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <Users style={{ color: '#f97316' }} size={24} /> Directorio de Clientes
          </h2>
          <p className="posdan-module-subtitle">Gestión de clientes, validación DGII de RNC y cédulas</p>
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

      <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, alignContent: 'start' }}>
        {filtered.map(cust => (
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
                <button
                  onClick={() => onEditCustomer(cust)}
                  style={{ background: '#21262d', border: '1px solid #30363d', color: '#8b949e', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', flexShrink: 0 }}
                  title="Editar cliente"
                >
                  <Edit2 size={13} />
                </button>
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

            {cust.dgiiStatus && (
              <div style={{ marginTop: 12, borderTop: '1px solid #21262d', paddingTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#6e7681' }}>DGII:</span>
                <span className="posdan-badge-success">{cust.dgiiStatus}</span>
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '64px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
            <Users size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p style={{ fontSize: 14, fontWeight: 600 }}>No se encontraron clientes registrados.</p>
          </div>
        )}
      </div>
    </div>
  )
}
