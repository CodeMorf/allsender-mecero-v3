import React from 'react'
import {
  UserCheck,
  User,
  Shield,
  Clock,
  CheckCircle2,
  AlertCircle
} from 'lucide-react'

type StaffMember = {
  id: number | string
  name?: string
  email?: string
  phone?: string
  status?: string
  type?: string
  job_title?: string
  roles?: Array<{ name?: string } | string>
  attendanceStatus?: string
}

export interface UsersModuleProps {
  staff?: StaffMember[]
}

function roleName(member: StaffMember): string {
  if (member.job_title) return member.job_title
  if (member.type) return member.type
  const role = member.roles?.[0]
  return typeof role === 'string' ? role : role?.name || 'Personal'
}

function isActive(member: StaffMember): boolean {
  return ['active', 'activo', 'enabled', '1', 'true'].includes(String(member.status ?? '').trim().toLowerCase())
}

export const UsersModule: React.FC<UsersModuleProps> = ({ staff = [] }) => {

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

      {staff.length === 0 ? (
        <div className="posdan-card" style={{ padding: 32, textAlign: 'center' }}>
          <AlertCircle size={36} style={{ color: '#fbbf24', marginBottom: 10 }} />
          <h4 style={{ margin: 0, color: '#f0f6fc' }}>Personal no disponible</h4>
          <p style={{ margin: '8px auto 0', maxWidth: 500, color: '#8b949e', fontSize: 13 }}>
            El servicio no devolvió personal real para esta sucursal. No se muestran registros de ejemplo.
          </p>
        </div>
      ) : (
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
                {(s.name || 'P').trim().charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <h4 style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#f0f6fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || 'Personal sin nombre'}</h4>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{roleName(s)}</span>
              </div>
            </div>
            <p style={{ fontSize: 12, color: '#8b949e', margin: '0 0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.email || s.phone || 'Contacto no publicado'}</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid #21262d', fontSize: 12 }}>
              <span style={{ color: '#8b949e' }}>Estado:</span>
              <span className={isActive(s) ? 'posdan-badge-success' : 'posdan-badge-danger'}>
                {isActive(s) ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />} {isActive(s) ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, fontSize: 12 }}>
              <span style={{ color: '#8b949e' }}>Asistencia:</span>
              <span style={{ color: '#8b949e' }}>{s.attendanceStatus || 'Consultar marcaje'}</span>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  )
}
