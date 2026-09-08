import React from 'react'
import {
  Tag,
  Percent,
  Plus,
  CheckCircle2
} from 'lucide-react'

export const DiscountsModule: React.FC = () => {
  const discounts = [
    { id: 1, name: 'Descuento Empleados', percent: 15, code: 'EMP15', active: true },
    { id: 2, name: 'Cortesía Casa', percent: 100, code: 'CORTESIA', active: true },
    { id: 3, name: 'Promoción Familiar', percent: 10, code: 'FAM10', active: true },
    { id: 4, name: 'Cliente Frecuente', percent: 5, code: 'VIP05', active: true },
  ]

  return (
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <Tag style={{ color: '#f97316' }} size={24} /> Configuración de Descuentos
          </h2>
          <p className="posdan-module-subtitle">Políticas de descuento por porcentaje o monto fijo autorizados</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        {discounts.map(d => (
          <div key={d.id} className="posdan-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h4 style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#f0f6fc' }}>{d.name}</h4>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#f97316', display: 'block', marginTop: 4 }}>Código: {d.code}</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#34d399', fontFamily: 'monospace', display: 'block' }}>-{d.percent}%</span>
              <span className="posdan-badge-success" style={{ marginTop: 4 }}>Activo</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
