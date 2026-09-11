import React from 'react'
import {
  Tag,
  AlertCircle
} from 'lucide-react'

export const DiscountsModule: React.FC = () => {
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

      <div className="posdan-card" style={{ padding: 32, textAlign: 'center' }}>
        <AlertCircle size={36} style={{ color: '#fbbf24', marginBottom: 10 }} />
        <h4 style={{ margin: 0, color: '#f0f6fc' }}>Descuentos no disponibles en Mesero</h4>
        <p style={{ margin: '8px auto 0', maxWidth: 520, color: '#8b949e', fontSize: 13 }}>
          No se encontró un endpoint REST real de descuentos para esta sucursal. Esta vista no mostrará ni permitirá aplicar promociones inventadas.
        </p>
      </div>
    </div>
  )
}
