import React, { useState, useEffect } from 'react'
import {
  DollarSign,
  Clock,
  Plus,
  Lock,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldCheck,
  RotateCcw,
  Printer,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
} from 'lucide-react'
import type { StaffRole } from '../types'

export interface CashRegister {
  id: number
  name: string
  branch_id?: number
  is_active?: boolean
}

export interface CashSession {
  id: number
  cash_register_id: number
  opened_by?: number
  opened_by_user?: { name: string }
  opened_at: string
  opening_float: number | string
  closed_by?: number
  closed_at?: string
  status: 'open' | 'closed' | 'pending_approval' | string
  expected_cash?: number | string
  counted_cash?: number | string
  discrepancy?: number | string
  closing_note?: string
}

export interface CashSummary {
  opening_float: number
  cash_sales: number
  card_sales: number
  bank_transfer_sales: number
  cash_in: number
  cash_out: number
  safe_drop: number
  expected_cash: number
  total_sales: number
  orders_count: number
}

interface CashModuleProps {
  registers: CashRegister[]
  activeSession: CashSession | null
  activeSummary: CashSummary | null
  currentCashierName: string
  roleKey: StaffRole
  currencySymbol?: string
  loading?: boolean
  onRefresh: () => Promise<void>
  onOpenSession: (registerId: number, openingFloat: number, note: string) => Promise<void>
  onCloseSession: (sessionId: number, countedCash: number, expectedCash: number | undefined, note: string, sendForApproval: boolean) => Promise<void>
  onCashMovement: (type: 'cash-in' | 'cash-out' | 'safe-drop', amount: number, reason: string) => Promise<void>
  onFetchHistory?: () => Promise<CashSession[]>
  onPrintReport?: (sessionId: number, type: 'x_report' | 'z_report', sessionData?: any) => void | Promise<void>
}

export const CashModule: React.FC<CashModuleProps> = ({
  registers,
  activeSession,
  activeSummary,
  currentCashierName,
  currencySymbol = 'RD$',
  loading = false,
  onRefresh,
  onOpenSession,
  onCloseSession,
  onCashMovement,
  onFetchHistory,
  onPrintReport,
}) => {
  // Modal states
  const [modalType, setModalType] = useState<'cash_in' | 'cash_out' | 'close' | 'open' | 'history' | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')

  // Form states
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [countedCash, setCountedCash] = useState('')
  const [closingNote, setClosingNote] = useState('')
  const [selectedRegisterId, setSelectedRegisterId] = useState<number>(() => registers[0]?.id || 1)
  const [openingFloat, setOpeningFloat] = useState('0.00')
  const [openingNote, setOpeningNote] = useState('')
  const [sessionsHistory, setSessionsHistory] = useState<CashSession[]>([])

  useEffect(() => {
    if (registers.length && !selectedRegisterId) {
      setSelectedRegisterId(registers[0].id)
    }
  }, [registers, selectedRegisterId])

  const isOpen = activeSession && activeSession.status === 'open'

  // Normalización robusta de totales desde activeSummary (API retorna totals: { ... }), activeSession o raíz
  const sumTotals = (activeSummary as any)?.totals || activeSummary || {}
  const effectiveCashSales = Number(
    sumTotals.cash_sales ?? sumTotals.cash_sales_total ?? (activeSession as any)?.cash_sales_total ?? 0
  )
  const effectiveCashIn = Number(
    sumTotals.cash_in ?? sumTotals.cash_in_total ?? (activeSession as any)?.cash_in_total ?? 0
  )
  const effectiveCashOut = Number(
    sumTotals.cash_out ?? sumTotals.cash_out_total ?? (activeSession as any)?.cash_out_total ?? 0
  )
  const effectiveSafeDrops = Number(
    sumTotals.safe_drops ?? sumTotals.safe_drops_total ?? (activeSession as any)?.safe_drops_total ?? 0
  )
  const effectiveOpeningFloat = Number(
    sumTotals.opening_float ?? (activeSession as any)?.opening_float ?? 0
  )
  const effectiveRunningTotal = Number(
    sumTotals.running_total ?? (activeSession as any)?.running_total ?? 0
  )
  const calculatedExpected = effectiveOpeningFloat + effectiveCashSales + effectiveCashIn - effectiveCashOut - effectiveSafeDrops
  const effectiveExpectedCash = effectiveRunningTotal > 0
    ? effectiveRunningTotal
    : (Number(activeSummary?.expected_cash) > 0 ? Number(activeSummary?.expected_cash) : calculatedExpected)

  // Format helper
  function fmt(val: number | string | undefined): string {
    const num = Number(val || 0)
    return `${currencySymbol} ${num.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  // Time format
  function formatTime(isoString?: string): string {
    if (!isoString) return '--:--'
    try {
      const d = new Date(isoString)
      return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
    } catch {
      return isoString
    }
  }

  async function handleOpenSubmit(e: React.FormEvent) {
    e.preventDefault()
    setActionLoading(true)
    setActionError('')
    try {
      const floatVal = parseFloat(openingFloat) || 0
      await onOpenSession(selectedRegisterId, floatVal, openingNote)
      setModalType(null)
      setOpeningFloat('0.00')
      setOpeningNote('')
      await onRefresh()
    } catch (err: any) {
      setActionError(err?.message || 'Error al abrir caja.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleMovementSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!modalType || (modalType !== 'cash_in' && modalType !== 'cash_out')) return
    const num = parseFloat(amount)
    if (isNaN(num) || num <= 0) {
      setActionError('Ingresa un monto válido mayor a 0.')
      return
    }
    if (!reason.trim()) {
      setActionError('Debes indicar el motivo o quién avala la operación.')
      return
    }

    setActionLoading(true)
    setActionError('')
    try {
      const movement = modalType === 'cash_in' ? 'cash-in' : 'cash-out'
      await onCashMovement(movement, num, reason.trim())
      setModalType(null)
      setAmount('')
      setReason('')
      await onRefresh()
    } catch (err: any) {
      setActionError(err?.message || 'Error al registrar movimiento.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleCloseSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!activeSession) return
    const counted = parseFloat(countedCash)
    if (isNaN(counted) || counted < 0) {
      setActionError('Ingresa el monto contado de efectivo en caja.')
      return
    }

    setActionLoading(true)
    setActionError('')
    try {
      const expected = effectiveExpectedCash
      const hasDiscrepancy = Math.abs(counted - expected) > 0.01
      await onCloseSession(activeSession.id, counted, expected, closingNote, hasDiscrepancy)
      if (onPrintReport) {
        await onPrintReport(activeSession.id, 'z_report', {
          ...activeSession,
          counted_cash: counted,
          expected_cash: expected,
          discrepancy: counted - expected,
          closing_note: closingNote,
          closed_at: new Date().toISOString(),
          totals: sumTotals,
          opening_float: effectiveOpeningFloat,
          cash_sales: effectiveCashSales,
          cash_in: effectiveCashIn,
          cash_out: effectiveCashOut + effectiveSafeDrops,
          safe_drops: effectiveSafeDrops,
          effectiveExpectedCash,
        })
      }
      setModalType(null)
      setCountedCash('')
      setClosingNote('')
      await onRefresh()
    } catch (err: any) {
      setActionError(err?.message || 'Error al cerrar el turno.')
    } finally {
      setActionLoading(false)
    }
  }

  async function openHistoryModal() {
    setModalType('history')
    if (onFetchHistory) {
      setActionLoading(true)
      try {
        const rows = await onFetchHistory()
        setSessionsHistory(rows)
      } catch (err: any) {
        setActionError(err?.message || 'Error al cargar historial.')
      } finally {
        setActionLoading(false)
      }
    }
  }

  return (
    <div className="posdan-cash-container">
      {/* Top Header */}
      <div className="posdan-cash-header">
        <div className="posdan-cash-title-group">
          <h1 className="posdan-cash-title">
            <span className="cash-symbol">$</span> Control de Cajas
          </h1>
          <p className="posdan-cash-subtitle">
            Múltiples cajas, adelantos y cierres de turno.
          </p>
        </div>

        <div className="posdan-cash-top-actions">
          <button
            type="button"
            className="posdan-btn-secondary"
            onClick={openHistoryModal}
          >
            <Clock size={16} />
            <span>Historial de Turnos</span>
          </button>

          {!isOpen ? (
            <button
              type="button"
              className="posdan-btn-primary"
              onClick={() => {
                setModalType('open')
                setActionError('')
              }}
            >
              <Plus size={16} />
              <span>+ Nueva Caja</span>
            </button>
          ) : (
            <button
              type="button"
              className="posdan-btn-secondary"
              onClick={() => onRefresh()}
              title="Refrescar datos de caja"
            >
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
              <span>Actualizar</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Register Box (POSDAN Style Card) */}
      <div className="posdan-cash-grid">
        <div className={`posdan-register-card ${isOpen ? 'is-open' : 'is-closed'}`}>
          <div className="posdan-reg-card-top">
            <div className="posdan-reg-title-wrap">
              <h3 className="posdan-reg-name">
                {registers.find(r => r.id === activeSession?.cash_register_id)?.name || 'Caja Principal'}
              </h3>
              <span className={`posdan-reg-badge ${isOpen ? 'badge-open' : 'badge-closed'}`}>
                {isOpen ? 'ABIERTA' : 'CERRADA'}
              </span>
            </div>
            <div className="posdan-reg-lock-icon">
              <Lock size={18} />
            </div>
          </div>

          {isOpen ? (
            <>
              <div className="posdan-reg-meta-rows">
                <div className="posdan-meta-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span className="meta-label">Cajero activo:&nbsp;</span>
                  <span className="meta-value bold">{currentCashierName || activeSession.opened_by_user?.name || 'Cajero'}</span>
                </div>
                <div className="posdan-meta-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span className="meta-label">Apertura:&nbsp;</span>
                  <span className="meta-value green-text bold">{fmt(effectiveOpeningFloat)}</span>
                </div>
                <div className="posdan-meta-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span className="meta-label">Desde:&nbsp;</span>
                  <span className="meta-value muted-time">{formatTime(activeSession.opened_at)}</span>
                </div>

                {isOpen && (
                  <div className="posdan-reg-summary-strip" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div className="summary-chip" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <small className="summary-chip-label">Ventas Efectivo</small>
                      <strong className="summary-chip-value">{fmt(effectiveCashSales)}</strong>
                    </div>
                    <div className="summary-chip" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <small className="summary-chip-label">Ingresos (+)</small>
                      <strong className="summary-chip-value">{fmt(effectiveCashIn)}</strong>
                    </div>
                    <div className="summary-chip" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <small className="summary-chip-label">Adelantos (-)</small>
                      <strong className="summary-chip-value">{fmt(effectiveCashOut + effectiveSafeDrops)}</strong>
                    </div>
                    <div className="summary-chip highlight" style={{ display: 'flex', flexDirection: 'column', gap: '3px', gridColumn: 'span 2' }}>
                      <small className="summary-chip-label">En Caja Estimado</small>
                      <strong className="summary-chip-value">{fmt(effectiveExpectedCash)}</strong>
                    </div>
                  </div>
                )}
              </div>

              {/* POSDAN 3 Action Buttons */}
              <div className="posdan-reg-actions-grid">
                <button
                  type="button"
                  className="posdan-action-btn btn-ingreso"
                  onClick={() => {
                    setModalType('cash_in')
                    setAmount('')
                    setReason('')
                    setActionError('')
                  }}
                >
                  <ArrowDownLeft size={16} />
                  <span>Ingreso</span>
                </button>

                <button
                  type="button"
                  className="posdan-action-btn btn-adelanto"
                  onClick={() => {
                    setModalType('cash_out')
                    setAmount('')
                    setReason('')
                    setActionError('')
                  }}
                >
                  <ArrowUpRight size={16} />
                  <span>Adelanto</span>
                </button>

                <button
                  type="button"
                  className="posdan-action-btn btn-cerrar-turno"
                  onClick={() => {
                    setModalType('close')
                    setCountedCash('')
                    setClosingNote('')
                    setActionError('')
                  }}
                >
                  <Lock size={16} />
                  <span>Cerrar Turno</span>
                </button>
              </div>
            </>
          ) : (
            <div className="posdan-reg-empty-closed">
              <p>No hay ningún turno abierto en esta caja actualmente.</p>
              <button
                type="button"
                className="posdan-btn-primary full-width"
                onClick={() => {
                  setModalType('open')
                  setActionError('')
                }}
              >
                <Plus size={16} />
                <span>Abrir Turno de Caja</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: Ingreso manual (Matches Screenshot media_1788844398217.png exactly) */}
      {modalType === 'cash_in' && (
        <div className="posdan-modal-backdrop" onClick={() => setModalType(null)}>
          <div className="posdan-modal-box" onClick={e => e.stopPropagation()}>
            <div className="posdan-modal-header">
              <div>
                <h3 className="posdan-modal-title">Ingreso manual</h3>
                <p className="posdan-modal-desc">
                  Registra ingreso de efectivo (ej. cambio extra).
                </p>
              </div>
              <button type="button" className="posdan-modal-close" onClick={() => setModalType(null)}>
                <X size={18} />
              </button>
            </div>

            {actionError && <div className="posdan-modal-error">{actionError}</div>}

            <form onSubmit={handleMovementSubmit}>
              <div className="posdan-form-group">
                <label>MONTO A INGRESAR</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  autoFocus
                  placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="posdan-input-lg"
                  required
                />
              </div>

              <div className="posdan-form-group">
                <label>MOTIVO / QUIÉN AVALA</label>
                <input
                  type="text"
                  placeholder="Ej. Pago suplidor"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  className="posdan-input"
                  required
                />
              </div>

              <div className="posdan-modal-actions">
                <button
                  type="button"
                  className="posdan-btn-cancel"
                  onClick={() => setModalType(null)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="posdan-btn-submit blue"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Registrando...' : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Adelanto manual / Egreso (Matches POSDAN style) */}
      {modalType === 'cash_out' && (
        <div className="posdan-modal-backdrop" onClick={() => setModalType(null)}>
          <div className="posdan-modal-box" onClick={e => e.stopPropagation()}>
            <div className="posdan-modal-header">
              <div>
                <h3 className="posdan-modal-title">Adelanto manual / Egreso</h3>
                <p className="posdan-modal-desc">
                  Registra salida de efectivo o retiro (ej. pago proveedor, adelanto).
                </p>
              </div>
              <button type="button" className="posdan-modal-close" onClick={() => setModalType(null)}>
                <X size={18} />
              </button>
            </div>

            {actionError && <div className="posdan-modal-error">{actionError}</div>}

            <form onSubmit={handleMovementSubmit}>
              <div className="posdan-form-group">
                <label>MONTO A RETIRAR</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  autoFocus
                  placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="posdan-input-lg"
                  required
                />
              </div>

              <div className="posdan-form-group">
                <label>MOTIVO / DESTINO</label>
                <input
                  type="text"
                  placeholder="Ej. Compra de insumos urgentes"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  className="posdan-input"
                  required
                />
              </div>

              <div className="posdan-modal-actions">
                <button
                  type="button"
                  className="posdan-btn-cancel"
                  onClick={() => setModalType(null)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="posdan-btn-submit orange"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Registrando...' : 'Registrar Salida'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Cerrar Turno */}
      {modalType === 'close' && activeSession && (
        <div className="posdan-modal-backdrop" onClick={() => setModalType(null)}>
          <div className="posdan-modal-box" onClick={e => e.stopPropagation()}>
            <div className="posdan-modal-header">
              <div>
                <h3 className="posdan-modal-title">Cerrar Turno de Caja</h3>
                <p className="posdan-modal-desc">
                  Arqueo de caja y emisión de reporte Z final.
                </p>
              </div>
              <button type="button" className="posdan-modal-close" onClick={() => setModalType(null)}>
                <X size={18} />
              </button>
            </div>

            {actionError && <div className="posdan-modal-error">{actionError}</div>}

            <form onSubmit={handleCloseSubmit}>
              <div className="posdan-close-summary-card">
                <div className="summary-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Fondo de apertura:&nbsp;</span>
                  <strong>{fmt(effectiveOpeningFloat)}</strong>
                </div>
                <div className="summary-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Ventas en efectivo (+):&nbsp;</span>
                  <strong>{fmt(effectiveCashSales)}</strong>
                </div>
                <div className="summary-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Ingresos manuales (+):&nbsp;</span>
                  <strong>{fmt(effectiveCashIn)}</strong>
                </div>
                <div className="summary-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Adelantos / Egresos (-):&nbsp;</span>
                  <strong>{fmt(effectiveCashOut + effectiveSafeDrops)}</strong>
                </div>
                <div className="summary-row total-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Efectivo esperado en caja:&nbsp;</span>
                  <strong className="orange-text">{fmt(effectiveExpectedCash)}</strong>
                </div>
              </div>

              <div className="posdan-form-group">
                <label>EFECTIVO CONTADO EN CAJA</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  placeholder="0.00"
                  value={countedCash}
                  onChange={e => setCountedCash(e.target.value)}
                  className="posdan-input-lg"
                  required
                />
              </div>

              {countedCash !== '' && (
                <div className="posdan-discrepancy-badge">
                  {(() => {
                    const expectedCash = activeSummary?.expected_cash ?? (Number(activeSession.opening_float) || 0)
                    const diff = parseFloat(countedCash) - expectedCash
                    if (Math.abs(diff) < 0.01) {
                      return <span className="diff-ok"><CheckCircle2 size={16} /> Caja cuadrada exactamente (Sin diferencia)</span>
                    } else if (diff > 0) {
                      return <span className="diff-sobrante"><AlertTriangle size={16} /> Sobrante en caja: +{fmt(diff)}</span>
                    } else {
                      return <span className="diff-faltante"><AlertTriangle size={16} /> Faltante en caja: {fmt(diff)}</span>
                    }
                  })()}
                </div>
              )}

              <div className="posdan-form-group">
                <label>NOTA DE CIERRE (OPCIONAL)</label>
                <input
                  type="text"
                  placeholder="Observaciones de entrega de turno..."
                  value={closingNote}
                  onChange={e => setClosingNote(e.target.value)}
                  className="posdan-input"
                />
              </div>

              <div className="posdan-modal-actions">
                <button
                  type="button"
                  className="posdan-btn-cancel"
                  onClick={() => setModalType(null)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="posdan-btn-submit red"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Cerrando...' : 'Confirmar Cierre de Turno'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Abrir Turno */}
      {modalType === 'open' && (
        <div className="posdan-modal-backdrop" onClick={() => setModalType(null)}>
          <div className="posdan-modal-box" onClick={e => e.stopPropagation()}>
            <div className="posdan-modal-header">
              <div>
                <h3 className="posdan-modal-title">Apertura de Caja</h3>
                <p className="posdan-modal-desc">
                  Inicia un nuevo turno indicando el fondo de caja inicial.
                </p>
              </div>
              <button type="button" className="posdan-modal-close" onClick={() => setModalType(null)}>
                <X size={18} />
              </button>
            </div>

            {actionError && <div className="posdan-modal-error">{actionError}</div>}

            <form onSubmit={handleOpenSubmit}>
              {registers.length > 1 && (
                <div className="posdan-form-group">
                  <label>SELECCIONAR CAJA</label>
                  <select
                    value={selectedRegisterId}
                    onChange={e => setSelectedRegisterId(Number(e.target.value))}
                    className="posdan-input"
                  >
                    {registers.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="posdan-form-group">
                <label>FONDO INICIAL / APERTURA</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  placeholder="0.00"
                  value={openingFloat}
                  onChange={e => setOpeningFloat(e.target.value)}
                  className="posdan-input-lg"
                  required
                />
              </div>

              <div className="posdan-form-group">
                <label>NOTA DE APERTURA (OPCIONAL)</label>
                <input
                  type="text"
                  placeholder="Ej. Fondo base para cambio en monedas y billetes"
                  value={openingNote}
                  onChange={e => setOpeningNote(e.target.value)}
                  className="posdan-input"
                />
              </div>

              <div className="posdan-modal-actions">
                <button
                  type="button"
                  className="posdan-btn-cancel"
                  onClick={() => setModalType(null)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="posdan-btn-submit green"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Abriendo...' : 'Abrir Caja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: Historial de Turnos */}
      {modalType === 'history' && (
        <div className="posdan-modal-backdrop" onClick={() => setModalType(null)}>
          <div className="posdan-modal-box large" onClick={e => e.stopPropagation()}>
            <div className="posdan-modal-header">
              <div>
                <h3 className="posdan-modal-title">Historial de Turnos y Cierres</h3>
                <p className="posdan-modal-desc">
                  Registro de sesiones anteriores y auditoría de arqueos.
                </p>
              </div>
              <button type="button" className="posdan-modal-close" onClick={() => setModalType(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="posdan-history-table-wrap">
              {sessionsHistory.length === 0 ? (
                <div className="posdan-empty-state">
                  <Clock size={32} />
                  <p>No se encontraron turnos cerrados en el historial reciente.</p>
                </div>
              ) : (
                <table className="posdan-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Fecha / Hora</th>
                      <th>Cajero</th>
                      <th>Apertura</th>
                      <th>Esperado</th>
                      <th>Contado</th>
                      <th>Descuadre</th>
                      <th>Estado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionsHistory.map(s => {
                      const diff = Number(s.discrepancy || 0)
                      return (
                        <tr key={s.id}>
                          <td>#{s.id}</td>
                          <td>{new Date(s.opened_at).toLocaleDateString('es-DO')} {formatTime(s.opened_at)}</td>
                          <td>{s.opened_by_user?.name || `Usuario ${s.opened_by}`}</td>
                          <td>{fmt(s.opening_float)}</td>
                          <td>{fmt(s.expected_cash)}</td>
                          <td>{fmt(s.counted_cash)}</td>
                          <td className={diff < 0 ? 'red-text' : diff > 0 ? 'yellow-text' : 'green-text'}>
                            {fmt(diff)}
                          </td>
                          <td>
                            <span className={`status-pill ${s.status}`}>
                              {s.status === 'closed' ? 'Cerrada' : s.status === 'open' ? 'Abierta' : 'Aprobación'}
                            </span>
                          </td>
                          <td>
                            {onPrintReport && (
                              <button
                                type="button"
                                className="posdan-btn-mini"
                                onClick={() => onPrintReport(s.id, 'z_report', s)}
                                title="Reimprimir reporte Z"
                              >
                                <Printer size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="posdan-modal-actions">
              <button
                type="button"
                className="posdan-btn-cancel"
                onClick={() => setModalType(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
