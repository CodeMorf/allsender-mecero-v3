import { useState, useEffect, useRef } from 'react'
import { Search, UserPlus, ChevronDown, ChevronUp, Check, X, Building, Phone, Mail, FileText, Pencil, UserCircle2 } from 'lucide-react'
import type { PosCustomer, FiscalCapabilities } from './types'
import { api } from './api/client'

export interface CustomerModalProps {
  currentCustomer?: {
    id?: number
    name?: string
    phone?: string
    email?: string
    rncCedula?: string
    fiscalName?: string
    commercialName?: string
    deliveryAddress?: string
    receiptType?: string
  }
  canManageFiscal?: boolean
  fiscalCapabilities?: FiscalCapabilities | null
  offline: boolean
  onClose: () => void
  onSelect: (customer: PosCustomer, receiptType?: string) => void
}

export function CustomerModal({ currentCustomer, canManageFiscal = true, fiscalCapabilities, offline, onClose, onSelect }: CustomerModalProps) {
  // `enabled` only means that the module is switched on. The backend is the
  // source of truth for whether a document can actually be issued.
  const isElectronicReady = Boolean(fiscalCapabilities?.electronic?.ready)
  const isTraditionalReady = Boolean(fiscalCapabilities?.traditional?.ready)
  const defaultFinalConsumer = isElectronicReady ? 'E32' : 'B02'
  const defaultFiscalCredit = isElectronicReady ? 'E31' : 'B01'

  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<PosCustomer[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null)
  const [showBilling, setShowBilling] = useState(false)
  const [receiptType, setReceiptType] = useState(() => {
    if (currentCustomer?.receiptType) return currentCustomer.receiptType
    if (currentCustomer?.rncCedula) return defaultFiscalCredit
    return defaultFinalConsumer
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Auto-switch to fiscal credit when customer has RNC
  useEffect(() => {
    if (currentCustomer?.rncCedula && !currentCustomer?.receiptType) {
      setReceiptType(defaultFiscalCredit)
      setShowBilling(true)
    }
  }, [currentCustomer?.rncCedula, currentCustomer?.receiptType, defaultFiscalCredit])


  // Create / Edit form state
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [rncCedula, setRncCedula] = useState('')
  const [fiscalName, setFiscalName] = useState('')
  const [commercialName, setCommercialName] = useState('')
  const [dgiiStatus, setDgiiStatus] = useState<string | undefined>()
  const [dgiiTaxRegime, setDgiiTaxRegime] = useState<string | undefined>()
  const [dgiiIsElectronicBiller, setDgiiIsElectronicBiller] = useState<boolean | undefined>()

  const [searchingRnc, setSearchingRnc] = useState(false)
  const [rncStatusMsg, setRncStatusMsg] = useState('')

  const searchTimerRef = useRef<any>(null)

  function startCreating() {
    setEditingCustomerId(null)
    const rawSearch = searchTerm.trim()
    const digitsOnly = rawSearch.replace(/\D/g, '')
    const isLikelyRnc = digitsOnly.length === 9 || digitsOnly.length === 11
    setName(isLikelyRnc ? '' : rawSearch)
    setPhone('')
    setEmail('')
    setDeliveryAddress('')
    setRncCedula(isLikelyRnc ? rawSearch : '')
    setFiscalName('')
    setCommercialName('')
    setDgiiStatus(undefined)
    setDgiiTaxRegime(undefined)
    setDgiiIsElectronicBiller(undefined)
    setShowBilling(isLikelyRnc)
    setError('')
    setShowCreate(true)
    if (isLikelyRnc) {
      setTimeout(() => {
        handleVerifyRnc(rawSearch)
      }, 50)
    }
  }

  function startEditing(c: Partial<PosCustomer> | any) {
    setEditingCustomerId(c.id && c.id > 0 ? c.id : null)
    setName(c.name || '')
    setPhone(c.phone || '')
    setEmail(c.email || '')
    setDeliveryAddress(c.deliveryAddress || c.address || '')
    setRncCedula(c.rncCedula || c.rnc_cedula || '')
    setFiscalName(c.fiscalName || c.fiscal_name || '')
    setCommercialName(c.commercialName || c.commercial_name || '')
    setDgiiStatus(c.dgiiStatus || c.dgii_status)
    setDgiiTaxRegime(c.dgiiTaxRegime || c.dgii_tax_regime)
    setDgiiIsElectronicBiller(c.dgiiIsElectronicBiller !== undefined ? c.dgiiIsElectronicBiller : (c.dgii_is_electronic_biller === 1 || c.dgii_is_electronic_biller === true))
    if (c.receiptType) {
      setReceiptType(c.receiptType)
    }
    if (c.rncCedula || c.fiscalName || c.rnc_cedula || c.fiscal_name) {
      setShowBilling(true)
    }
    setError('')
    setShowCreate(true)
  }

  // Verify and auto-fill from RNC / Cédula (Local Database + DGII Live Lookup)
  async function handleVerifyRnc(overrideRnc?: string) {
    const rawVal = (overrideRnc !== undefined ? overrideRnc : rncCedula).trim()
    const digits = rawVal.replace(/\D/g, '')
    if (digits.length !== 9 && digits.length !== 11) {
      setRncStatusMsg('Ingrese un RNC (9 dígitos) o Cédula (11 dígitos)')
      return
    }
    setSearchingRnc(true)
    setRncStatusMsg('Consultando DGII…')
    try {
      // 1. Primero buscar si ya existe en el sistema local
      const res = await api.customers('pin', digits)
      const found = res?.find(c => (c.rncCedula || '').replace(/\D/g, '') === digits)
      if (found && (found.fiscalName || found.name)) {
        if (!name.trim() && found.name) setName(found.name)
        if (!fiscalName.trim() && found.fiscalName) setFiscalName(found.fiscalName)
        if (!commercialName.trim() && (found.commercialName || found.name)) setCommercialName(found.commercialName || found.name)
        if (!phone.trim() && found.phone) setPhone(found.phone)
        if (!email.trim() && found.email) setEmail(found.email)
        if (found.rncCedula) setRncCedula(found.rncCedula)
        setDgiiStatus(found.dgiiStatus || 'ACTIVO')
        setDgiiTaxRegime(found.dgiiTaxRegime || 'NORMAL')
        setDgiiIsElectronicBiller(found.dgiiIsElectronicBiller)
        setReceiptType(defaultFiscalCredit)
        setShowBilling(true)
        setRncStatusMsg(`✓ Registrado en sistema: ${found.fiscalName || found.name}`)
        return
      }

      // 2. Si no está en la base local, consultar en vivo en el padrón oficial de la DGII vía proxy
      const dgii = await api.lookupDgiiRnc(digits)
      if (dgii.found && (dgii.fiscalName || dgii.name)) {
        const displayName = dgii.commercialName || dgii.fiscalName || dgii.name || ''
        if (!name.trim() || name === digits) setName(displayName)
        setFiscalName(dgii.fiscalName || displayName)
        if (dgii.commercialName) setCommercialName(dgii.commercialName)
        if (dgii.rncCedula) setRncCedula(dgii.rncCedula)
        setDgiiStatus(dgii.status || 'ACTIVO')
        setDgiiTaxRegime(dgii.regime || 'NORMAL')
        setDgiiIsElectronicBiller(dgii.isElectronic)
        setReceiptType(defaultFiscalCredit)
        setShowBilling(true)
        setRncStatusMsg(`✓ Verificado DGII: ${dgii.fiscalName || displayName} (${dgii.status || 'ACTIVO'})`)
      } else {
        setReceiptType(defaultFiscalCredit)
        setShowBilling(true)
        setRncStatusMsg(dgii.message || 'RNC/Cédula no encontrado en la DGII.')
      }
    } catch (err: any) {
      setRncStatusMsg(err?.message || 'No se pudo verificar el RNC. Puede ingresar los datos manualmente.')
    } finally {
      setSearchingRnc(false)
    }
  }

  // Load initial/recent customers
  useEffect(() => {
    if (offline) return
    setLoading(true)
    api.customers('pin', '')
      .then(res => setSearchResults(res || []))
      .catch(() => setSearchResults([]))
      .finally(() => setLoading(false))
  }, [offline])

  // Debounced search
  useEffect(() => {
    if (offline || showCreate) return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setLoading(true)
      api.customers('pin', searchTerm)
        .then(res => setSearchResults(res || []))
        .catch(() => setSearchResults([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchTerm, offline, showCreate])

  async function handleCreateCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('El nombre del cliente es obligatorio.')
      return
    }
    setError('')
    setSaving(true)
    try {
      const payload: Partial<PosCustomer> = {
        id: editingCustomerId || undefined,
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        rncCedula: rncCedula.trim() || undefined,
        fiscalName: fiscalName.trim() || undefined,
        commercialName: commercialName.trim() || undefined,
        dgiiStatus: dgiiStatus || undefined,
        dgiiTaxRegime: dgiiTaxRegime || undefined,
        dgiiIsElectronicBiller: dgiiIsElectronicBiller,
      }
      let saved: PosCustomer
      if (!offline) {
        saved = await api.saveCustomer('pin', payload)
      } else {
        saved = {
          id: editingCustomerId || -Date.now(),
          name: payload.name!,
          phone: payload.phone,
          email: payload.email,
          deliveryAddress: payload.deliveryAddress,
          rncCedula: payload.rncCedula,
          fiscalName: payload.fiscalName,
          commercialName: payload.commercialName,
          dgiiStatus: payload.dgiiStatus,
          dgiiTaxRegime: payload.dgiiTaxRegime,
          dgiiIsElectronicBiller: payload.dgiiIsElectronicBiller,
        }
      }
      // Update local search results list
      setSearchResults(prev => {
        const idx = prev.findIndex(item => item.id === saved.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = saved
          return next
        }
        return [saved, ...prev]
      })
      onSelect(saved, receiptType)
    } catch (err: any) {
      setError(err?.message || 'Error al guardar el cliente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop customer-modal-backdrop" onClick={onClose}>
      <div className="modal customer-modal" onClick={e => e.stopPropagation()}>
        <header className="customer-modal-header">
          <div>
            <p className="eyebrow">VENTA / COMANDA</p>
            <h2>{showCreate ? (editingCustomerId ? 'Actualizar cliente' : 'Nuevo cliente') : 'Cliente de la mesa'}</h2>
            <small>
              {showCreate
                ? (editingCustomerId ? 'Modifique los datos de contacto o facturación fiscal.' : 'Ingrese los datos para registrar el cliente.')
                : 'Seleccione un cliente registrado o actualice sus datos para la comanda.'}
            </small>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar modal">
            <X size={20} />
          </button>
        </header>

        <div className="customer-modal-body">
          {error && <div className="alert error">{error}</div>}

          {!showCreate ? (
            <div className="customer-search-view">
              {/* Highlight card for current table customer */}
              {currentCustomer?.name && (
                <div className="customer-current-card">
                  <div className="customer-current-info">
                    <span className="customer-current-badge">Cliente asignado a la mesa</span>
                    <div className="customer-current-name">
                      <UserCircle2 size={16} />
                      <strong>{currentCustomer.name}</strong>
                      {currentCustomer.rncCedula && (
                        <span className="customer-badge-rnc">
                          <FileText size={11} /> {currentCustomer.rncCedula}
                        </span>
                      )}
                    </div>
                    {(currentCustomer.phone || currentCustomer.email || currentCustomer.fiscalName) && (
                      <div className="customer-meta-row" style={{ marginTop: 2 }}>
                        {currentCustomer.phone && <span><Phone size={11} /> {currentCustomer.phone}</span>}
                        {currentCustomer.email && <span><Mail size={11} /> {currentCustomer.email}</span>}
                        {currentCustomer.fiscalName && <span><Building size={11} /> {currentCustomer.fiscalName}</span>}
                      </div>
                    )}
                  </div>
                  <div className="customer-current-actions">
                    <button
                      type="button"
                      className="button outline small customer-item-edit-btn"
                      onClick={() => startEditing(currentCustomer)}
                      title="Editar datos de este cliente"
                    >
                      <Pencil size={13} /> Editar datos
                    </button>
                  </div>
                </div>
              )}

              <div className="customer-search-bar">
                <Search size={18} className="search-icon" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, teléfono, correo o RNC/cédula..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  autoFocus
                />
                {searchTerm && (
                  <button className="clear-search" onClick={() => setSearchTerm('')}>
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="customer-actions-bar">
                <button
                  type="button"
                  className="button secondary create-customer-btn"
                  onClick={startCreating}
                >
                  <UserPlus size={16} /> Crear nuevo cliente
                </button>
              </div>

              <div className="customer-results-list">
                {loading ? (
                  <div className="customer-loading">Buscando clientes…</div>
                ) : searchResults.length === 0 ? (
                  <div className="customer-empty">
                    <p>No se encontraron clientes coincidentes en la base local.</p>
                    {searchTerm.replace(/\D/g, '').length >= 9 ? (
                      <button
                        type="button"
                        className="button primary small"
                        style={{ marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        onClick={startCreating}
                      >
                        <Building size={14} /> Consultar DGII con "{searchTerm}"
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button outline small"
                      onClick={startCreating}
                    >
                      <UserPlus size={14} /> Registrar como nuevo cliente
                    </button>
                  </div>
                ) : (
                  searchResults.map(c => {
                    const isSelected = currentCustomer?.id === c.id || (currentCustomer?.name && currentCustomer.name === c.name)
                    return (
                      <div
                        key={c.id}
                        className={`customer-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          const targetReceipt = c.rncCedula
                            ? (receiptType === 'B02' || receiptType === 'E32' ? defaultFiscalCredit : receiptType)
                            : receiptType
                          onSelect(c, targetReceipt)
                        }}
                      >
                        <div className="customer-item-info">
                          <div className="customer-name-row">
                            <strong>{c.name}</strong>
                            {c.rncCedula && (
                              <span className="customer-badge-rnc">
                                <FileText size={12} /> {c.rncCedula}
                              </span>
                            )}
                          </div>
                          <div className="customer-meta-row">
                            {c.phone && <span><Phone size={12} /> {c.phone}</span>}
                            {c.email && <span><Mail size={12} /> {c.email}</span>}
                            {c.fiscalName && <span><Building size={12} /> {c.fiscalName}</span>}
                          </div>
                        </div>

                        <div className="customer-item-actions">
                          <button
                            type="button"
                            className="button outline small customer-item-edit-btn"
                            title="Editar datos de este cliente"
                            onClick={e => {
                              e.stopPropagation()
                              startEditing(c)
                            }}
                          >
                            <Pencil size={13} /> Editar
                          </button>
                          <button
                            type="button"
                            className={`button ${isSelected ? 'primary' : 'outline'} small`}
                            onClick={e => {
                              e.stopPropagation()
                              onSelect(c, c.rncCedula ? (receiptType === 'B02' ? 'B01' : receiptType) : receiptType)
                            }}
                          >
                            {isSelected ? <Check size={14} /> : 'Seleccionar'}
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateCustomer} className="customer-create-form">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                  {editingCustomerId ? 'Modificando cliente existente' : 'Nuevo registro de cliente'}
                </span>
                {editingCustomerId && (
                  <span style={{ fontSize: '11px', background: 'rgba(8, 127, 140, 0.12)', color: 'var(--primary)', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
                    ID: #{editingCustomerId}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label>
                  Nombre completo *
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Ej. María López o Comercial García SRL"
                    autoFocus
                  />
                </label>
              </div>

              <div className="form-row-2">
                <label>
                  Teléfono
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="809-000-0000"
                  />
                </label>
                <label>
                  Correo electrónico
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="cliente@ejemplo.com"
                  />
                </label>
              </div>

              <div className="form-group">
                <label>
                  Dirección
                  <input
                    type="text"
                    value={deliveryAddress}
                    onChange={e => setDeliveryAddress(e.target.value)}
                    placeholder="Calle, número, sector"
                  />
                </label>
              </div>

              {/* Collapsible Fiscal / Invoicing Section - Only for Cashier / Admin */}
              {canManageFiscal && (
                <div className="fiscal-collapsible">
                  <button
                    type="button"
                    className="fiscal-collapse-btn"
                    onClick={() => setShowBilling(!showBilling)}
                  >
                    <div className="fiscal-collapse-title">
                      <Building size={16} />
                      <span>Comprobante Fiscal / Factura Electrónica (DGII / e-CF)</span>
                    </div>
                    {showBilling ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>

                  {showBilling && (
                    <div className="fiscal-collapse-content">
                      <div className="form-group">
                        <label>
                          Tipo de Comprobante / Factura Electrónica
                          <select
                            value={receiptType}
                            onChange={e => setReceiptType(e.target.value)}
                            style={{ marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)' }}
                          >
                            {isElectronicReady && (
                              <optgroup label="Factura Electrónica (e-CF) · Lista en esta sucursal">
                                <option value="E32">E32 - Factura de Consumo Electrónica (Consumidor Final)</option>
                                <option value="E31">E31 - Factura de Crédito Fiscal Electrónica</option>
                                <option value="E44">E44 - Régimen Especial Electrónico</option>
                                <option value="E45">E45 - Gubernamental Electrónico</option>
                              </optgroup>
                            )}
                            {isTraditionalReady && (
                              <optgroup label="Comprobantes Tradicionales (NCF Serie B) · Listos en esta sucursal">
                                <option value="B02">B02 - Factura de Consumo (Consumidor Final)</option>
                                <option value="B01">B01 - Factura de Crédito Fiscal</option>
                                <option value="B14">B14 - Régimen Especial de Tributación</option>
                                <option value="B15">B15 - Comprobante Gubernamental</option>
                              </optgroup>
                            )}
                            {!isElectronicReady && !isTraditionalReady && (
                              <option value="B02">Recibo de venta (fiscalidad no disponible en esta sucursal)</option>
                            )}
                          </select>
                        </label>
                      </div>

                    <div className="form-group">
                      <label>
                        RNC / Cédula
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <input
                            type="text"
                            value={rncCedula}
                            onChange={e => {
                              setRncCedula(e.target.value)
                              setRncStatusMsg('')
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handleVerifyRnc()
                              }
                            }}
                            placeholder="Ej. 131-68569-2 o 402-5765807-6"
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            className="button outline small"
                            disabled={searchingRnc || offline}
                            onClick={() => handleVerifyRnc()}
                            title="Consultar RNC en la base de datos fiscal"
                          >
                            {searchingRnc ? 'Verificando…' : 'Verificar DGII'}
                          </button>
                        </div>
                        {rncStatusMsg && (
                          <small style={{ display: 'block', marginTop: 4, color: rncStatusMsg.startsWith('✓') ? '#16a34a' : '#ea580c', fontWeight: 500 }}>
                            {rncStatusMsg}
                          </small>
                        )}
                      </label>
                    </div>
                    <div className="form-group">
                      <label>
                        Razón Social / Nombre Fiscal
                        <input
                          type="text"
                          value={fiscalName}
                          onChange={e => setFiscalName(e.target.value)}
                          placeholder="Nombre formal registrado ante DGII"
                        />
                      </label>
                    </div>
                    <div className="form-group">
                      <label>
                        Nombre Comercial
                        <input
                          type="text"
                          value={commercialName}
                          onChange={e => setCommercialName(e.target.value)}
                          placeholder="Nombre comercial (opcional)"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
              )}

              <div className="customer-form-actions">
                <button
                  type="button"
                  className="button outline"
                  onClick={() => {
                    setShowCreate(false)
                    setEditingCustomerId(null)
                  }}
                  disabled={saving}
                >
                  Volver a lista
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={saving || !name.trim()}
                >
                  {saving ? 'Guardando…' : (editingCustomerId ? 'Guardar cambios y Seleccionar' : 'Guardar y Seleccionar')}
                </button>
              </div>
            </form>
          )}
        </div>

        <footer className="customer-modal-footer">
          <button type="button" className="button outline" onClick={onClose}>
            Cancelar
          </button>
          {currentCustomer?.name && !showCreate && (
            <div className="current-selection-label">
              Seleccionado actualmente: <strong>{currentCustomer.name}</strong>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}
