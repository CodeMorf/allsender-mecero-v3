import React from 'react'
import {
  RotateCcw,
  AlertCircle
} from 'lucide-react'

export const ReturnsModule: React.FC = () => {
  return (
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <RotateCcw style={{ color: '#f97316' }} size={24} /> Devoluciones y Anulaciones
          </h2>
          <p className="posdan-module-subtitle">Registro de órdenes canceladas, notas de crédito y reembolsos procesados</p>
        </div>
      </div>

      <div className="posdan-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, textAlign: 'center' }}>
        <AlertCircle size={48} style={{ color: '#fbbf24', opacity: 0.8, marginBottom: 12 }} />
        <h4 style={{ fontSize: 14, fontWeight: 700, color: '#f0f6fc', margin: 0 }}>Devoluciones no disponibles en Mesero</h4>
        <p style={{ fontSize: 12, color: '#8b949e', maxWidth: 420, margin: '8px 0 0' }}>No se encontró una ruta REST real para consultar o ejecutar reembolsos en esta sucursal. No se presentan resultados vacíos como si fueran una confirmación.</p>
      </div>
    </div>
  )
}
