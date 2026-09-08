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
    <div className="posdan-module-container">
      <div className="posdan-module-header">
        <div className="posdan-module-title-wrap">
          <h2 className="posdan-module-title">
            <BarChart2 style={{ color: '#f97316' }} size={24} /> Métricas y Analítica de Ventas
          </h2>
          <p className="posdan-module-subtitle">Resumen de desempeño operativo, ventas totales y ticket promedio</p>
        </div>
      </div>

      <div className="posdan-stat-grid">
        <div className="posdan-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#8b949e', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Ventas Totales</span>
            <DollarSign size={18} style={{ color: '#34d399' }} />
          </div>
          <h3 style={{ fontSize: 24, fontWeight: 800, color: '#34d399', fontFamily: 'monospace', margin: 0 }}>
            {currencySymbol} {totalSales.toFixed(2)}
          </h3>
          <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <ArrowUpRight size={13} /> Ventas del periodo actual
          </span>
        </div>

        <div className="posdan-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#8b949e', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Órdenes Realizadas</span>
            <ShoppingCart size={18} style={{ color: '#f97316' }} />
          </div>
          <h3 style={{ fontSize: 24, fontWeight: 800, color: '#f0f6fc', fontFamily: 'monospace', margin: 0 }}>
            {orders.length}
          </h3>
          <span style={{ fontSize: 11, color: '#8b949e', marginTop: 6, display: 'block' }}>
            {paidOrders.length} completadas con pago
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
            Promedio por mesa/pedido
          </span>
        </div>

        <div className="posdan-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#8b949e', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Tasa de Cobro</span>
            <Users size={18} style={{ color: '#38bdf8' }} />
          </div>
          <h3 style={{ fontSize: 24, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace', margin: 0 }}>
            {orders.length > 0 ? Math.round((paidOrders.length / orders.length) * 100) : 100}%
          </h3>
          <span style={{ fontSize: 11, color: '#38bdf8', marginTop: 6, display: 'block' }}>
            Eficiencia operativa
          </span>
        </div>
      </div>
    </div>
  )
}
