import React, { useState } from 'react'
import {
  Receipt,
  Search,
  Printer,
  Calendar,
  DollarSign,
  FileText,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Filter
} from 'lucide-react'

export interface InvoicesModuleProps {
  orders: any[]
  onPrintInvoice: (orderId: number) => void
  currencySymbol?: string
}

export const InvoicesModule: React.FC<InvoicesModuleProps> = ({
  orders,
  onPrintInvoice,
  currencySymbol = 'RD$'
}) => {
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('ALL')

  const filteredOrders = orders.filter(o => {
    const matchSearch =
      String(o.id).includes(search) ||
      String(o.order_number || '').toLowerCase().includes(search.toLowerCase()) ||
      String(o.customer_name || '').toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filterType === 'ALL' ||
      (filterType === 'paid' && (o.status === 'paid' || o.payment_status === 'paid')) ||
      (filterType === 'billed' && (o.status === 'billed' || o.order_status === 'billed'))
    return matchSearch && matchFilter
  })

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
            <Receipt className="text-orange-500" size={24} /> Facturas y Comprobantes
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Historial de comprobantes emitidos, facturación y reimpresión térmica</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              type="text"
              placeholder="Buscar # orden, NCF, cliente..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
            <button
              onClick={() => setFilterType('ALL')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                filterType === 'ALL' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setFilterType('paid')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                filterType === 'paid' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pagados
            </button>
            <button
              onClick={() => setFilterType('billed')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                filterType === 'billed' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Por Cobrar
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-slate-900/60 rounded-2xl border border-slate-800/80 overflow-hidden flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4"># Factura / Orden</th>
                <th className="py-3 px-4">Fecha & Hora</th>
                <th className="py-3 px-4">Cliente / RNC</th>
                <th className="py-3 px-4">Tipo Comprobante</th>
                <th className="py-3 px-4">Total</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredOrders.map(order => (
                <tr key={order.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-slate-200">
                    #{order.order_number || order.id}
                  </td>
                  <td className="py-3 px-4 text-slate-400">
                    {order.created_at ? new Date(order.created_at).toLocaleString() : 'Hoy'}
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-semibold text-slate-200">{order.customer_name || 'Consumidor Final'}</p>
                    {order.customer_rnc && (
                      <span className="text-[10px] text-orange-400 font-mono">RNC: {order.customer_rnc}</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-slate-300">
                      {order.receipt_type || 'B02'}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-bold text-emerald-400 font-mono">
                    {currencySymbol} {Number(order.total || order.grand_total || order.order_total || 0).toFixed(2)}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      order.status === 'paid' || order.payment_status === 'paid'
                        ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                        : 'bg-amber-950/60 text-amber-400 border border-amber-800'
                    }`}>
                      {order.status === 'paid' || order.payment_status === 'paid' ? 'Pagado' : 'Por Cobrar'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => onPrintInvoice(order.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-colors"
                    >
                      <Printer size={13} />
                      <span>Imprimir</span>
                    </button>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No se encontraron facturas o comprobantes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
