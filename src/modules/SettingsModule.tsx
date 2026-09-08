import React, { useState, useEffect } from 'react'
import {
  Settings,
  Printer,
  Zap,
  Monitor,
  Server,
  CheckCircle2,
  Volume2,
  Sliders,
  FileText,
  Sparkles
} from 'lucide-react'
import {
  getStationPrinterConfig,
  saveStationPrinterConfig,
  routePrintTest,
  StationPrinterConfig
} from '../utils/printRouter'
import { readCache } from '../storage/offline'

export interface SettingsModuleProps {
  onTestPrint?: () => void
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({ onTestPrint }) => {
  const [config, setConfig] = useState<StationPrinterConfig>(getStationPrinterConfig())
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [testPrinting, setTestPrinting] = useState(false)

  const cached = readCache()
  const branchPrinters = cached.printers || []

  const updateConfig = (patch: Partial<StationPrinterConfig>) => {
    const updated = saveStationPrinterConfig(patch)
    setConfig(updated)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  const handleTestPrint = () => {
    setTestPrinting(true)
    try {
      if (onTestPrint) {
        onTestPrint()
      } else {
        routePrintTest()
      }
    } finally {
      setTimeout(() => setTestPrinting(false), 1200)
    }
  }

  return (
    <div className="posdan-module-container" style={{ paddingBottom: 60 }}>
      {/* Header */}
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <Settings style={{ color: '#f97316' }} size={26} /> Configuración de la Estación
          </h2>
          <p className="posdan-module-subtitle">
            Enrutador dinámico de impresión, conexión con Windows, formato térmico y automatización de cobro
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 840, display: 'flex', flexDirection: 'column', gap: 20 }}>
        
        {/* HERO STATUS BANNER */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.12) 0%, rgba(30, 41, 59, 0.7) 100%)',
          border: '1px solid rgba(249, 115, 22, 0.3)',
          borderRadius: 16,
          padding: '20px 24px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: '#f97316',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                boxShadow: '0 4px 16px rgba(249, 115, 22, 0.4)'
              }}>
                <Printer size={24} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f0f6fc' }}>
                    Enrutador Dinámico de Impresión
                  </h3>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'rgba(34, 197, 94, 0.15)',
                    color: '#4ade80',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
                    Conectado
                  </span>
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#94a3b8' }}>
                  {config.mode === 'auto'
                    ? 'Modo Backend: usa el diseño oficial y la cola de la sucursal; la impresión local solo queda como contingencia sin conexión.'
                    : config.mode === 'windows_local'
                    ? 'Modo Local: Imprime directamente en la impresora predeterminada de Windows (USB/Red).'
                    : 'Modo Servidor: Encola en el backend para Desktop Agent.'}
                </p>
              </div>
            </div>

            <button
              onClick={handleTestPrint}
              disabled={testPrinting}
              className="posdan-btn-primary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 18px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 10,
                cursor: 'pointer'
              }}
            >
              <Printer size={16} />
              {testPrinting ? 'Emitiendo ticket…' : 'Probar Impresión de Ticket'}
            </button>
          </div>

          {/* Diagnostics badges */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 10,
            paddingTop: 14,
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            fontSize: 12
          }}>
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>IMPRESORA LOCAL DE WINDOWS:</span>
              <strong style={{ color: '#e2e8f0', fontSize: 13 }}>{config.printerName || 'Predeterminada de Windows'}</strong>
            </div>
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>FORMATO TÉRMICO ACTIVO:</span>
              <strong style={{ color: '#e2e8f0', fontSize: 13 }}>{config.paperWidth} ({config.paperWidth === '80mm' ? 'Estándar 48 col' : 'Compacto 32 col'})</strong>
            </div>
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: '#64748b', display: 'block', fontSize: 11 }}>CONFIGURACIÓN EN SUCURSAL:</span>
              <strong style={{ color: '#e2e8f0', fontSize: 13 }}>
                {branchPrinters.length > 0
                  ? `${branchPrinters.length} impresora(s) configurada(s)`
                  : 'Sin impresoras en nube (Modo local activo)'}
              </strong>
            </div>
          </div>
        </div>

        {/* 1. MODO DE ENRUTAMIENTO (3 CARDS) */}
        <div className="posdan-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Sliders size={20} style={{ color: '#f97316' }} />
            <div>
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f0f6fc' }}>
                Modo de Enrutamiento para esta Terminal
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8b949e' }}>
                Selecciona cómo debe comportarse esta máquina cuando se mande a imprimir una comanda, precuenta o cobro
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
            
            {/* Card 1: Híbrido Inteligente */}
            <div
              onClick={() => updateConfig({ mode: 'auto' })}
              style={{
                border: config.mode === 'auto' ? '2px solid #f97316' : '1px solid #30363d',
                background: config.mode === 'auto' ? 'rgba(249, 115, 22, 0.08)' : '#161b22',
                borderRadius: 14,
                padding: 16,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: config.mode === 'auto' ? '#f97316' : '#21262d',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Sparkles size={18} />
                  </div>
                  <span style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: 6,
                    background: '#f97316',
                    color: '#fff',
                    letterSpacing: 0.5
                  }}>
                    RECOMENDADO
                  </span>
                </div>
                <h5 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: '#f0f6fc' }}>
                  Backend oficial (automático)
                </h5>
                <p style={{ margin: 0, fontSize: 11.5, color: '#8b949e', lineHeight: 1.45 }}>
                  Envía KOT, precuentas, comprobantes y reportes al backend para usar los diseños y parámetros configurados en la sucursal. No abre una ventana local mientras exista conexión.
                </p>
              </div>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: config.mode === 'auto' ? '#f97316' : '#64748b', fontWeight: 600 }}>
                <CheckCircle2 size={15} />
                <span>{config.mode === 'auto' ? 'Modo activo' : 'Hacer clic para activar'}</span>
              </div>
            </div>

            {/* Card 2: Windows Local */}
            <div
              onClick={() => updateConfig({ mode: 'windows_local' })}
              style={{
                border: config.mode === 'windows_local' ? '2px solid #38bdf8' : '1px solid #30363d',
                background: config.mode === 'windows_local' ? 'rgba(56, 189, 248, 0.08)' : '#161b22',
                borderRadius: 14,
                padding: 16,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: config.mode === 'windows_local' ? '#38bdf8' : '#21262d',
                    color: config.mode === 'windows_local' ? '#0f172a' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Monitor size={18} />
                  </div>
                  <span style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 6,
                    background: 'rgba(56, 189, 248, 0.2)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.4)'
                  }}>
                    WINDOWS LOCAL
                  </span>
                </div>
                <h5 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: '#f0f6fc' }}>
                  Impresora de Windows
                </h5>
                <p style={{ margin: 0, fontSize: 11.5, color: '#8b949e', lineHeight: 1.45 }}>
                  Imprime siempre por el spooler local de Windows (USB, Ethernet de Windows o WiFi). Sin programas ni agentes adicionales.
                </p>
              </div>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: config.mode === 'windows_local' ? '#38bdf8' : '#64748b', fontWeight: 600 }}>
                <CheckCircle2 size={15} />
                <span>{config.mode === 'windows_local' ? 'Modo activo' : 'Hacer clic para activar'}</span>
              </div>
            </div>

            {/* Card 3: Servidor / Agente */}
            <div
              onClick={() => updateConfig({ mode: 'server_agent' })}
              style={{
                border: config.mode === 'server_agent' ? '2px solid #a855f7' : '1px solid #30363d',
                background: config.mode === 'server_agent' ? 'rgba(168, 85, 247, 0.08)' : '#161b22',
                borderRadius: 14,
                padding: 16,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: config.mode === 'server_agent' ? '#a855f7' : '#21262d',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Server size={18} />
                  </div>
                  <span style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 6,
                    background: 'rgba(168, 85, 247, 0.2)',
                    color: '#c084fc',
                    border: '1px solid rgba(168, 85, 247, 0.4)'
                  }}>
                    DESKTOP AGENT
                  </span>
                </div>
                <h5 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: '#f0f6fc' }}>
                  Agente en Servidor
                </h5>
                <p style={{ margin: 0, fontSize: 11.5, color: '#8b949e', lineHeight: 1.45 }}>
                  Encola los trabajos en el backend. Requiere que el programa de servicio (Desktop Agent) esté ejecutándose en la PC destino.
                </p>
              </div>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: config.mode === 'server_agent' ? '#a855f7' : '#64748b', fontWeight: 600 }}>
                <CheckCircle2 size={15} />
                <span>{config.mode === 'server_agent' ? 'Modo activo' : 'Hacer clic para activar'}</span>
              </div>
            </div>

          </div>
        </div>

        {/* 2. FORMATO DE PAPEL Y PARÁMETROS */}
        <div className="posdan-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <FileText size={20} style={{ color: '#f97316' }} />
            <div>
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f0f6fc' }}>
                Formato de Papel y Diseño del Ticket
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8b949e' }}>
                Ajuste milimétrico para impresoras de 80mm (rollo estándar) o 58mm (rollo compacto)
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 16 }}>
            
            {/* Option 80mm */}
            <div
              onClick={() => updateConfig({ paperWidth: '80mm' })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: 14,
                borderRadius: 12,
                border: config.paperWidth === '80mm' ? '2px solid #f97316' : '1px solid #30363d',
                background: config.paperWidth === '80mm' ? 'rgba(249, 115, 22, 0.08)' : '#161b22',
                cursor: 'pointer'
              }}
            >
              <div style={{
                width: 40,
                height: 48,
                borderRadius: 6,
                border: '2px dashed #f97316',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 800,
                color: '#f97316'
              }}>
                80mm
              </div>
              <div>
                <strong style={{ display: 'block', fontSize: 13.5, color: '#f0f6fc' }}>80 milímetros (Estándar)</strong>
                <span style={{ fontSize: 11.5, color: '#8b949e' }}>48 columnas · Restaurantes, bares y cajas principales</span>
              </div>
            </div>

            {/* Option 58mm */}
            <div
              onClick={() => updateConfig({ paperWidth: '58mm' })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: 14,
                borderRadius: 12,
                border: config.paperWidth === '58mm' ? '2px solid #f97316' : '1px solid #30363d',
                background: config.paperWidth === '58mm' ? 'rgba(249, 115, 22, 0.08)' : '#161b22',
                cursor: 'pointer'
              }}
            >
              <div style={{
                width: 32,
                height: 48,
                borderRadius: 6,
                border: '2px dashed #94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 800,
                color: '#94a3b8'
              }}>
                58mm
              </div>
              <div>
                <strong style={{ display: 'block', fontSize: 13.5, color: '#f0f6fc' }}>58 milímetros (Compacto)</strong>
                <span style={{ fontSize: 11.5, color: '#8b949e' }}>32 columnas · Impresoras térmicas portátiles o mini-POS</span>
              </div>
            </div>

          </div>

          {/* Additional text options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: '#c9d1d9', marginBottom: 6, fontWeight: 600 }}>
                Mensaje de pie de página en tickets:
              </label>
              <input
                type="text"
                value={config.footerNote}
                onChange={e => updateConfig({ footerNote: e.target.value })}
                placeholder="¡Gracias por su visita!"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  color: '#f0f6fc',
                  fontSize: 13
                }}
              />
            </div>
          </div>
        </div>

        {/* 3. AUTOMATIZACIÓN DE COBRO Y CAJÓN */}
        <div className="posdan-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Zap size={20} style={{ color: '#f97316' }} />
            <div>
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f0f6fc' }}>
                Automatizaciones al Cobrar la Cuenta
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8b949e' }}>
                Optimiza la velocidad en caja eliminando pasos innecesarios
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            
            {/* Auto print on pay */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              background: '#161b22',
              borderRadius: 12,
              border: '1px solid #21262d'
            }}>
              <div>
                <strong style={{ display: 'block', fontSize: 13.5, color: '#f0f6fc' }}>
                  Imprimir ticket/factura automáticamente al cobrar
                </strong>
                <span style={{ fontSize: 11.5, color: '#8b949e' }}>
                  Al registrar el cobro en mesa o mostrador, emite de inmediato el ticket en la impresora de Windows sin requerir clics extra.
                </span>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.autoPrintOnPayment}
                  onChange={e => updateConfig({ autoPrintOnPayment: e.target.checked })}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{
                  position: 'absolute',
                  cursor: 'pointer',
                  top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: config.autoPrintOnPayment ? '#f97316' : '#30363d',
                  borderRadius: 24,
                  transition: '0.2s'
                }}>
                  <span style={{
                    position: 'absolute',
                    content: '""',
                    height: 18,
                    width: 18,
                    left: config.autoPrintOnPayment ? 22 : 3,
                    bottom: 3,
                    backgroundColor: '#fff',
                    borderRadius: '50%',
                    transition: '0.2s'
                  }} />
                </span>
              </label>
            </div>

            {/* Cash drawer */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              background: '#161b22',
              borderRadius: 12,
              border: '1px solid #21262d'
            }}>
              <div>
                <strong style={{ display: 'block', fontSize: 13.5, color: '#f0f6fc' }}>
                  Apertura de gaveta / cajón de dinero
                </strong>
                <span style={{ fontSize: 11.5, color: '#8b949e' }}>
                  Envía el pulso de apertura estándar RJ11 al cobrar pagos en efectivo.
                </span>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.openCashDrawerOnPayment}
                  onChange={e => updateConfig({ openCashDrawerOnPayment: e.target.checked })}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{
                  position: 'absolute',
                  cursor: 'pointer',
                  top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: config.openCashDrawerOnPayment ? '#f97316' : '#30363d',
                  borderRadius: 24,
                  transition: '0.2s'
                }}>
                  <span style={{
                    position: 'absolute',
                    content: '""',
                    height: 18,
                    width: 18,
                    left: config.openCashDrawerOnPayment ? 22 : 3,
                    bottom: 3,
                    backgroundColor: '#fff',
                    borderRadius: '50%',
                    transition: '0.2s'
                  }} />
                </span>
              </label>
            </div>

          </div>
        </div>

        {/* 4. ALERTAS Y SONIDOS */}
        <div className="posdan-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Volume2 size={20} style={{ color: '#f97316' }} />
            <div>
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f0f6fc' }}>
                Alertas Sonoras y Notificaciones
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8b949e' }}>
                Timbres sonoros para nuevos pedidos en cocina (KDS) y llamadas de mesero
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: '#c9d1d9' }}>
            <span>Sonido de comanda activa y llamada a mesero</span>
            <span className="posdan-badge-success">Habilitado</span>
          </div>
        </div>

        {/* Save confirmation toast */}
        {saveSuccess && (
          <div style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: '#16a34a',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            zIndex: 9999,
            fontSize: 13,
            fontWeight: 600
          }}>
            <CheckCircle2 size={18} />
            <span>Configuración guardada correctamente en este equipo.</span>
          </div>
        )}

      </div>
    </div>
  )
}
