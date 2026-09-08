import React from 'react'
import {
  UserCheck,
  User,
  Shield,
  Clock,
  CheckCircle2
} from 'lucide-react'

export const UsersModule: React.FC = () => {
  const staff = [
    { id: 1, name: 'Cajero Prueba', role: 'Cajero', email: 'cajero.prueba.8@allsender.local', active: true },
    { id: 2, name: 'Mesero Prueba', role: 'Mesero', email: 'mesero.prueba.8@allsender.local', active: true },
    { id: 3, name: 'Chef Prueba', role: 'Cocina', email: 'chef.prueba.8@allsender.local', active: true },
    { id: 4, name: 'Supervisor', role: 'Supervisor', email: 'supervisor.prueba.8@allsender.local', active: true },
  ]

  return (
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <UserCheck style={{ color: '#f97316' }} size={24} /> Personal y Control de Asistencia
          </h2>
          <p className="posdan-module-subtitle">Personal activo asignado a la sucursal y registro de marcaje</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {staff.map(s => (
          <div key={s.id} className="posdan-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.2), rgba(234, 88, 12, 0.4))',
                border: '1px solid rgba(249, 115, 22, 0.4)',
                color: '#f97316',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 16
              }}>
                {s.name[0]}
              </div>
              <div style={{ minWidth: 0 }}>
                <h4 style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#f0f6fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</h4>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.role}</span>
              </div>
            </div>
            <p style={{ fontSize: 12, color: '#8b949e', margin: '0 0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.email}</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid #21262d', fontSize: 12 }}>
              <span style={{ color: '#8b949e' }}>Asistencia:</span>
              <span className="posdan-badge-success">
                <CheckCircle2 size={12} /> Presente
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
