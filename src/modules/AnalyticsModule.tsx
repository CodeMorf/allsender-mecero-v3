import React, { useMemo } from 'react'
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

function localDate(value: unknown): string | null {
  if (!value) return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export const AnalyticsModule: React.FC<AnalyticsModuleProps> = ({
  orders,
  currencySymbol = 'RD$'
}) => {
  const today = localDate(new Date())
  const ordersToday = useMemo(() => orders.filter(order => localDate(order.created_at || order.date_time || order.createdAt) === today), [orders, today])
  const totalSales = ordersToday.reduce((sum, o) => sum + Number(o.total || o.grand_total || 0), 0)
  const paidOrders = ordersToday.filter(o => ['paid', 'billed'].includes(String(o.status || o.order_status || o.payment_status || '').toLowerCase()))
  const avgTicket = ordersToday.length > 0 ? totalSales / ordersToday.length : 0

  return (
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <BarChart2 style={{ color: '#f97316' }} size={24} /> Métricas y Analítica de Ventas
          </h2>
          <p className="posdan-module-subtitle">Resumen de ventas de hoy para esta sucursal, según la fecha local del dispositivo</p>
        </div>
      </div>

      <div className="posdan-stat-grid">
        <div className="posdan-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#8b949e', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Ventas de hoy</span>
            <DollarSign size={18} style={{ color: '#34d399' }} />
          </div>
          <h3 style={{ fontSize: 24, fontWeight: 800, color: '#34d399', fontFamily: 'monospace', margin: 0 }}>
            {currencySymbol} {totalSales.toFixed(2)}
          </h3>
          <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <ArrowUpRight size={13} /> {ordersToday.length} órdenes con fecha local de hoy
          </span>
        </div>

        <div className="posdan-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#8b949e', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Órdenes Realizadas</span>
            <ShoppingCart size={18} style={{ color: '#f97316' }} />
          </div>
          <h3 style={{ fontSize: 24, fontWeight: 800, color: '#f0f6fc', fontFamily: 'monospace', margin: 0 }}>
            {ordersToday.length}
          </h3>
          <span style={{ fontSize: 11, color: '#8b949e', marginTop: 6, display: 'block' }}>
            {paidOrders.length} con pago confirmado
          </span>
        </div>

        <div className="posdan-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#8b949e', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Ticket Promedio</span>
            <TrendingUp size={18} style={{ color: '#fbbf24' }} />
          </div>
          <h3 style={{ fontSize: 24, fontWeight: 800, color: '#fbbf24', fontFamily: 'monospace', margin: 0 }}>
            {currencySymbol} {avgTicket.toFixed(2)}
          </h3>
          <span style={{ fontSize: 11, color: '#8b949e', marginTop: 6, display: 'block' }}>
            Promedio por orden de hoy
          </span>
        </div>

        <div className="posdan-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#8b949e', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Tasa de Cobro</span>
            <Users size={18} style={{ color: '#38bdf8' }} />
          </div>
          <h3 style={{ fontSize: 24, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace', margin: 0 }}>
            {ordersToday.length > 0 ? Math.round((paidOrders.length / ordersToday.length) * 100) : 0}%
          </h3>
          <span style={{ fontSize: 11, color: '#38bdf8', marginTop: 6, display: 'block' }}>
            Cobro confirmado sobre órdenes de hoy
          </span>
        </div>
      </div>
    </div>
  )
}
