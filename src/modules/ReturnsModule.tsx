import React from 'react'
import {
  RotateCcw,
  Search,
  AlertCircle,
  Clock
} from 'lucide-react'

export const ReturnsModule: React.FC = () => {
  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-hidden">
      <div className="mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
          <RotateCcw className="text-orange-500" size={24} /> Devoluciones y Anulaciones
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Registro de órdenes canceladas, notas de crédito y reembolsos procesados</p>
      </div>

      <div className="flex-1 bg-slate-900/60 rounded-2xl border border-slate-800/80 flex flex-col items-center justify-center p-8 text-center">
        <RotateCcw size={48} className="text-slate-600 mb-3 opacity-40" />
        <h4 className="text-sm font-bold text-slate-300">No hay devoluciones registradas hoy</h4>
        <p className="text-xs text-slate-500 max-w-sm mt-1">Todas las órdenes cobradas se mantienen en estado firme sin reembolsos pendientes.</p>
      </div>
    </div>
  )
}
