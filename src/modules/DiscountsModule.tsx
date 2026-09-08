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
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
            <Tag className="text-orange-500" size={24} /> Configuración de Descuentos
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Políticas de descuento por porcentaje o monto fijo autorizados</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {discounts.map(d => (
          <div key={d.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <h4 className="font-bold text-sm text-slate-200">{d.name}</h4>
              <span className="text-xs font-mono text-orange-400">Código: {d.code}</span>
            </div>
            <div className="text-right">
              <span className="text-lg font-extrabold text-emerald-400 font-mono">-{d.percent}%</span>
              <span className="block text-[10px] text-emerald-500 font-semibold uppercase">Activo</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
