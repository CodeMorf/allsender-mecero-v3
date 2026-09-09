import React from 'react'
import {
  Store,
  UtensilsCrossed,
  ChefHat,
  DollarSign,
  Users,
  Package,
  Boxes,
  Receipt,
  BarChart2,
  Tag,
  RotateCcw,
  UserCheck,
  Settings,
  Sun,
  Moon,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
} from 'lucide-react'
import type { StaffRole } from '../types'

export type PosDanModule =
  | 'pos'
  | 'orders'
  | 'tables'
  | 'menu'
  | 'ops'
  | 'kds'
  | 'cash'
  | 'customers'
  | 'products'
  | 'inventory'
  | 'invoices'
  | 'analytics'
  | 'discounts'
  | 'returns'
  | 'users'
  | 'settings'

interface NavItemDef {
  id: PosDanModule
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  permissionKey?: string | string[]
  allowedRoles?: StaffRole[]
  badge?: number | string
}

interface PosDanSidebarProps {
  activeModule: PosDanModule
  onSelectModule: (module: PosDanModule) => void
  userName: string
  roleKey: StaffRole
  brandName: string
  permissions: Record<string, boolean>
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
  kdsPendingCount?: number
  waiterCallsCount?: number
  ordersCount?: number
}

export const POSDAN_MODULES: NavItemDef[] = [
  { id: 'pos', label: 'Punto de venta', icon: Store, permissionKey: ['orders.create', 'orders.view'] },
  { id: 'orders', label: 'Órdenes', icon: ClipboardList, permissionKey: ['orders.view', 'orders.create'] },
  { id: 'tables', label: 'Mesas', icon: UtensilsCrossed, permissionKey: 'tables.view' },
  { id: 'kds', label: 'Cocina (KDS)', icon: ChefHat, permissionKey: 'kitchen.manage', allowedRoles: ['chef', 'head', 'cajero', 'mesero'] },
  { id: 'cash', label: 'Cajas/Turnos', icon: DollarSign, permissionKey: ['cash.view', 'cash.open', 'cash.close', 'cash.movement', 'payments.charge'], allowedRoles: ['cajero', 'head'] },
  { id: 'customers', label: 'Clientes', icon: Users, permissionKey: ['customers.view', 'customers.manage'] },
  { id: 'products', label: 'Productos', icon: Package, permissionKey: ['menu.view', 'menu.manage'] },
  { id: 'inventory', label: 'Inventario', icon: Boxes, permissionKey: ['menu.view', 'reports.view'] },
  { id: 'invoices', label: 'Facturas', icon: Receipt, permissionKey: ['orders.view', 'payments.view'] },
  { id: 'analytics', label: 'Analítica', icon: BarChart2, permissionKey: 'reports.view', allowedRoles: ['head', 'cajero'] },
  { id: 'discounts', label: 'Descuentos', icon: Tag, permissionKey: 'orders.discount', allowedRoles: ['head', 'cajero'] },
  { id: 'returns', label: 'Devoluciones', icon: RotateCcw, permissionKey: ['payments.refund', 'orders.delete'], allowedRoles: ['head', 'cajero'] },
  { id: 'users', label: 'Usuarios', icon: UserCheck, permissionKey: ['staff.view', 'staff.manage'], allowedRoles: ['head', 'cajero'] },
  { id: 'settings', label: 'Configuración', icon: Settings },
]

export function roleLabel(role: StaffRole): string {
  switch (role) {
    case 'head': return 'Administrador'
    case 'cajero': return 'Cajero'
    case 'mesero': return 'Mesero'
    case 'chef': return 'Cocina'
    case 'repartidor': return 'Repartidor'
    default: return 'Personal'
  }
}

export function isModuleAllowed(item: NavItemDef, permissions: Record<string, boolean>, role: StaffRole): boolean {
  if (role === 'head') return true

  if (item.allowedRoles && !item.allowedRoles.includes(role)) {
    return false
  }

  if (!item.permissionKey) return true

  if (Array.isArray(item.permissionKey)) {
    return item.permissionKey.some(k => permissions[k] === true)
  }

  return permissions[item.permissionKey] === true
}

export const PosDanSidebar: React.FC<PosDanSidebarProps> = ({
  activeModule,
  onSelectModule,
  userName,
  roleKey,
  brandName,
  permissions,
  theme,
  onToggleTheme,
  onLogout,
  collapsed = false,
  onToggleCollapse,
  kdsPendingCount = 0,
  waiterCallsCount = 0,
  ordersCount = 0,
}) => {
  const visibleModules = POSDAN_MODULES.filter(item => isModuleAllowed(item, permissions, roleKey))

  return (
    <aside className={`posdan-sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Top Header / Branding */}
      <div className="posdan-sidebar-header">
        <div className="posdan-brand-container">
          <div className="posdan-brand-avatar">
            <span>{brandName ? brandName.charAt(0).toUpperCase() : 'P'}</span>
          </div>
          {!collapsed && (
            <div className="posdan-brand-info">
              <h2 className="posdan-brand-name">{brandName || 'POSDAN'}</h2>
              <span className="posdan-system-tag">Sistema POS</span>
            </div>
          )}
        </div>

        {onToggleCollapse && (
          <button
            type="button"
            className="posdan-collapse-toggle"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expandir barra' : 'Contraer barra'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}
      </div>

      {/* User Info Block */}
      {!collapsed && (
        <div className="posdan-user-pill">
          <div className="posdan-user-dot" />
          <div className="posdan-user-details">
            <span className="posdan-user-name">{userName || 'Administrador'}</span>
            <span className="posdan-user-role">{roleLabel(roleKey)}</span>
          </div>
        </div>
      )}

      {/* Navigation Items (13 POSDAN Modules) */}
      <nav className="posdan-nav-list">
        {visibleModules.map(item => {
          const Icon = item.icon
          const isActive = activeModule === item.id

          let dynamicBadge: number | undefined
          if (item.id === 'kds' && kdsPendingCount > 0) dynamicBadge = kdsPendingCount
          if (item.id === 'tables' && waiterCallsCount > 0) dynamicBadge = waiterCallsCount
          if (item.id === 'orders' && ordersCount > 0) dynamicBadge = ordersCount

          return (
            <button
              key={item.id}
              type="button"
              className={`posdan-nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelectModule(item.id)}
              title={item.label}
            >
              <span className="posdan-nav-icon">
                <Icon size={19} />
              </span>
              {!collapsed && <span className="posdan-nav-label">{item.label}</span>}
              {dynamicBadge !== undefined && (
                <span className={`posdan-nav-badge ${item.id === 'tables' ? 'badge-alert' : ''}`}>
                  {dynamicBadge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Bottom Controls */}
      <div className="posdan-sidebar-footer">
        <button
          type="button"
          className="posdan-footer-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          {!collapsed && <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>}
        </button>

        <button
          type="button"
          className="posdan-footer-btn logout"
          onClick={onLogout}
          title="Cerrar sesión"
        >
          <LogOut size={17} />
          {!collapsed && <span>Cerrar sesión</span>}
        </button>
      </div>
    </aside>
  )
}
