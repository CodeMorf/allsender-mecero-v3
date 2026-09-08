import React from 'react'
import {
  Settings,
  Printer,
  Bell,
  Monitor,
  Shield,
  Moon,
  Volume2
} from 'lucide-react'

export interface SettingsModuleProps {
  onTestPrint?: () => void
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({ onTestPrint }) => {
  return (
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <Settings style={{ color: '#f97316' }} size={24} /> Configuración del Sistema
          </h2>
          <p className="posdan-module-subtitle">Parámetros de impresión nativa térmica, timbres de cocina y modo visual</p>
        </div>
      </div>

      <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="posdan-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Printer style={{ color: '#f97316' }} size={22} />
            <div>
              <h4 style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#f0f6fc' }}>Impresora Térmica Nativa (Windows)</h4>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8b949e' }}>Impresión directa estándar a 80mm / 58mm vía navegador</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid #21262d' }}>
            <span style={{ fontSize: 12, color: '#c9d1d9' }}>Ancho de papel térmico: <strong style={{ color: '#f0f6fc' }}>80mm</strong></span>
            <button
              onClick={() => {
                if (onTestPrint) onTestPrint()
                else window.print()
              }}
              className="posdan-btn-primary"
              style={{ padding: '8px 14px' }}
            >
              Probar Impresión
            </button>
          </div>
        </div>

        <div className="posdan-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Volume2 style={{ color: '#f97316' }} size={22} />
            <div>
              <h4 style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#f0f6fc' }}>Alertas Sonoras y Notificaciones</h4>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8b949e' }}>Timbres sonoros para nuevos pedidos en cocina (KDS) y llamadas de mesero</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid #21262d', fontSize: 12 }}>
            <span style={{ color: '#c9d1d9' }}>Sonido de comanda activa</span>
            <span className="posdan-badge-success">Habilitado</span>
          </div>
        </div>
      </div>
    </div>
  )
}
