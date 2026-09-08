import React from 'react'
import {
  BarChart2,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Users,
  Calendar,
  ArrowUpRight
} from 'lucide-react'

export interface AnalyticsModuleProps {
  orders: any[]
  currencySymbol?: string
}

export const AnalyticsModule: React.FC<AnalyticsModuleProps> = ({
  orders,
  currencySymbol = 'RD$'
}) => {
  const totalSales = orders.reduce((sum, o) => sum + Number(o.total || o.grand_total || 0), 0)
  const paidOrders = orders.filter(o => o.status === 'paid' || o.payment_status === 'paid')
  const avgTicket = orders.length > 0 ? totalSales / orders.length : 0

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 p-6 overflow-hidden">
      <div className="mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
          <BarChart2 className="text-orange-500" size={24} /> Métricas y Analítica de Ventas
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Resumen de desempeño operativo, ventas totales y ticket promedio</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Ventas Totales</span>
            <DollarSign size={18} className="text-emerald-400" />
          </div>
          <h3 className="text-2xl font-extrabold text-emerald-400 font-mono">
            {currencySymbol} {totalSales.toFixed(2)}
          </h3>
          <span className="text-[10px] text-emerald-500 font-semibold flex items-center gap-0.5 mt-1">
            <ArrowUpRight size={12} /> Ventas del periodo actual
          </span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Órdenes Realizadas</span>
            <ShoppingCart size={18} className="text-orange-400" />
          </div>
          <h3 className="text-2xl font-extrabold text-slate-100 font-mono">
            {orders.length}
          </h3>
          <span className="text-[10px] text-slate-400 mt-1 block">
            {paidOrders.length} completadas con pago
          </span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Ticket Promedio</span>
            <TrendingUp size={18} className="text-amber-400" />
          </div>
          <h3 className="text-2xl font-extrabold text-amber-400 font-mono">
            {currencySymbol} {avgTicket.toFixed(2)}
          </h3>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Promedio por mesa/pedido
          </span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Tasa de Conversión</span>
            <Users size={18} className="text-teal-400" />
          </div>
          <h3 className="text-2xl font-extrabold text-teal-400 font-mono">
            {orders.length > 0 ? Math.round((paidOrders.length / orders.length) * 100) : 100}%
          </h3>
          <span className="text-[10px] text-teal-400 mt-1 block">
            Eficiencia de cobro
          </span>
        </div>
      </div>
    </div>
  )
}
