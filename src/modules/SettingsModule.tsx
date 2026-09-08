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
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-hidden">
      <div className="mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
          <Settings className="text-orange-500" size={24} /> Configuración del Sistema
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Parámetros de impresión nativa térmica, timbres de cocina y modo visual</p>
      </div>

      <div className="max-w-2xl space-y-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <Printer className="text-orange-500" size={20} />
            <div>
              <h4 className="font-bold text-sm text-slate-100">Impresora Térmica Nativa (Windows)</h4>
              <p className="text-xs text-slate-400">Impresión directa estándar a 80mm / 58mm vía navegador</p>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <span className="text-xs text-slate-300">Ancho de papel térmico: <strong>80mm</strong></span>
            <button
              onClick={() => {
                if (onTestPrint) onTestPrint()
                else window.print()
              }}
              className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs transition-colors"
            >
              Probar Impresión
            </button>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <Volume2 className="text-orange-500" size={20} />
            <div>
              <h4 className="font-bold text-sm text-slate-100">Alertas Sonoras y Notificaciones</h4>
              <p className="text-xs text-slate-400">Timbres sonoros para nuevos pedidos en cocina (KDS) y llamadas de mesero</p>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
            <span className="text-slate-300">Sonido de comanda activa</span>
            <span className="text-emerald-400 font-bold">Habilitado</span>
          </div>
        </div>
      </div>
    </div>
  )
}
