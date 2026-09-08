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
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-hidden">
      <div className="mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
          <UserCheck className="text-orange-500" size={24} /> Personal y Control de Asistencia
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Personal activo asignado a la sucursal y registro de marcaje</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {staff.map(s => (
          <div key={s.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-orange-600/20 border border-orange-500/40 text-orange-400 flex items-center justify-center font-bold">
                {s.name[0]}
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-100">{s.name}</h4>
                <span className="text-[10px] font-semibold text-orange-400 uppercase tracking-wider">{s.role}</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 truncate mb-3">{s.email}</p>
            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px]">
              <span className="text-slate-500">Asistencia:</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 size={12} /> Presente
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
