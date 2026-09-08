import React, { useState } from 'react'
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  Building,
  CheckCircle2,
  ShieldCheck,
  Edit2
} from 'lucide-react'
import type { PosCustomer } from '../types'

export interface CustomersModuleProps {
  customers: PosCustomer[]
  onOpenCustomerModal: () => void
  onEditCustomer: (cust: PosCustomer) => void
}

export const CustomersModule: React.FC<CustomersModuleProps> = ({
  customers,
  onOpenCustomerModal,
  onEditCustomer
}) => {
  const [search, setSearch] = useState('')

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone && c.phone.includes(search)) ||
    (c.rncCedula && c.rncCedula.includes(search))
  )

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
            <Users className="text-orange-500" size={24} /> Directorio de Clientes
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Gestión de clientes, validación DGII de RNC y cédulas</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              type="text"
              placeholder="Buscar cliente, RNC, teléfono..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
            />
          </div>

          <button
            onClick={onOpenCustomerModal}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs uppercase px-4 py-2.5 rounded-xl transition-all shadow-md active:scale-95"
          >
            <Plus size={16} />
            <span>Nuevo Cliente</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map(cust => (
          <div
            key={cust.id}
            className="bg-slate-900/70 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all shadow-sm"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-slate-100 truncate">{cust.name}</h4>
                  {cust.rncCedula && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <ShieldCheck size={12} className="text-orange-400 shrink-0" />
                      <span className="text-xs font-mono font-bold text-orange-400 truncate">
                        RNC: {cust.rncCedula}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onEditCustomer(cust)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <Edit2 size={13} />
                </button>
              </div>

              {cust.fiscalName && (
                <p className="text-[11px] text-slate-400 mt-1 italic truncate">
                  {cust.fiscalName}
                </p>
              )}

              <div className="mt-3 space-y-1 text-xs text-slate-400 border-t border-slate-800/80 pt-2.5">
                {cust.phone && (
                  <div className="flex items-center gap-2 truncate">
                    <Phone size={12} className="text-slate-500" />
                    <span>+{cust.phoneCode || '1'} {cust.phone}</span>
                  </div>
                )}
                {cust.email && (
                  <div className="flex items-center gap-2 truncate">
                    <Mail size={12} className="text-slate-500" />
                    <span>{cust.email}</span>
                  </div>
                )}
                {cust.deliveryAddress && (
                  <div className="flex items-center gap-2 truncate">
                    <MapPin size={12} className="text-slate-500" />
                    <span>{cust.deliveryAddress}</span>
                  </div>
                )}
              </div>
            </div>

            {cust.dgiiStatus && (
              <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[10px]">
                <span className="text-slate-500">DGII:</span>
                <span className="text-emerald-400 font-bold uppercase">{cust.dgiiStatus}</span>
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-16 flex flex-col items-center justify-center text-slate-500">
            <Users size={48} className="mb-3 opacity-30" />
            <p className="text-sm font-medium">No se encontraron clientes registrados.</p>
          </div>
        )}
      </div>
    </div>
  )
}
