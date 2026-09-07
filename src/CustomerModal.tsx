import { useState, useEffect, useRef } from 'react'
import { Search, UserPlus, ChevronDown, ChevronUp, Check, X, Building, Phone, Mail, FileText } from 'lucide-react'
import type { PosCustomer } from './types'
import { api } from './api/client'

export interface CustomerModalProps {
  currentCustomer?: {
    id?: number
    name?: string
    phone?: string
    email?: string
    rncCedula?: string
    fiscalName?: string
    receiptType?: string
  }
  offline: boolean
  onClose: () => void
  onSelect: (customer: PosCustomer, receiptType?: string) => void
}

export function CustomerModal({ currentCustomer, offline, onClose, onSelect }: CustomerModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<PosCustomer[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showBilling, setShowBilling] = useState(false)
  const [receiptType, setReceiptType] = useState(currentCustomer?.receiptType || 'B02')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Create form state
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [rncCedula, setRncCedula] = useState('')
  const [fiscalName, setFiscalName] = useState('')
  const [commercialName, setCommercialName] = useState('')

  const [searchingRnc, setSearchingRnc] = useState(false)
  const [rncStatusMsg, setRncStatusMsg] = useState('')

  const searchTimerRef = useRef<any>(null)

  // Verify and auto-fill from RNC / Cédula
  async function handleVerifyRnc() {
    const rawRnc = rncCedula.replace(/\D/g, '').trim()
    if (rawRnc.length < 9) {
      setRncStatusMsg('Ingrese un RNC (9 dígitos) o Cédula (11 dígitos)')
      return
    }
    setSearchingRnc(true)
    setRncStatusMsg('')
    try {
      const res = await api.customers('pin', rawRnc)
      const found = res?.find(c => (c.rncCedula || '').replace(/\D/g, '') === rawRnc)
      if (found) {
        if (!name.trim() && found.name) setName(found.name)
        if (!fiscalName.trim() && found.fiscalName) setFiscalName(found.fiscalName)
        if (!commercialName.trim() && (found.commercialName || found.name)) setCommercialName(found.commercialName || found.name)
        if (!phone.trim() && found.phone) setPhone(found.phone)
        if (!email.trim() && found.email) setEmail(found.email)
        setRncStatusMsg(`✓ Registrado: ${found.fiscalName || found.name}`)
      } else {
        setRncStatusMsg('RNC/Cédula no registrado previamente en el sistema.')
      }
    } catch {
      setRncStatusMsg('No se pudo verificar el RNC con el servidor.')
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
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        rncCedula: rncCedula.trim() || undefined,
        fiscalName: fiscalName.trim() || undefined,
        commercialName: commercialName.trim() || undefined,
      }
      let saved: PosCustomer
      if (!offline) {
        saved = await api.saveCustomer('pin', payload)
      } else {
        saved = {
          id: -Date.now(),
          name: payload.name!,
          phone: payload.phone,
          email: payload.email,
          deliveryAddress: payload.deliveryAddress,
          rncCedula: payload.rncCedula,
          fiscalName: payload.fiscalName,
          commercialName: payload.commercialName,
        }
      }
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
            <h2>Cliente del pedido</h2>
            <small>Identifique el cliente o agregue sus datos fiscales para comprobante.</small>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar modal">
            <X size={20} />
          </button>
        </header>

        <div className="customer-modal-body">
          {error && <div className="alert error">{error}</div>}

          {!showCreate ? (
            <div className="customer-search-view">
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
                  onClick={() => {
                    setName(searchTerm)
                    setShowCreate(true)
                  }}
                >
                  <UserPlus size={16} /> Crear nuevo cliente
                </button>
              </div>

              <div className="customer-results-list">
                {loading ? (
                  <div className="customer-loading">Buscando clientes…</div>
                ) : searchResults.length === 0 ? (
                  <div className="customer-empty">
                    <p>No se encontraron clientes coincidentes.</p>
                    <button
                      type="button"
                      className="button outline small"
                      onClick={() => {
                        setName(searchTerm)
                        setShowCreate(true)
                      }}
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
                        onClick={() => onSelect(c, c.rncCedula ? (receiptType === 'B02' ? 'B01' : receiptType) : receiptType)}
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
                    )
                  })
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateCustomer} className="customer-create-form">
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

              {/* Collapsible Fiscal / Invoicing Section */}
              <div className="fiscal-collapsible">
                <button
                  type="button"
                  className="fiscal-collapse-btn"
                  onClick={() => setShowBilling(!showBilling)}
                >
                  <div className="fiscal-collapse-title">
                    <Building size={16} />
                    <span>Datos de facturación (DGII / Fiscal)</span>
                  </div>
                  {showBilling ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {showBilling && (
                  <div className="fiscal-collapse-content">
                    <div className="form-group">
                      <label>
                        Tipo de Comprobante Fiscal
                        <select
                          value={receiptType}
                          onChange={e => setReceiptType(e.target.value)}
                          style={{ marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)' }}
                        >
                          <option value="B02">B02 - Consumidor Final</option>
                          <option value="B01">B01 - Factura de Crédito Fiscal</option>
                          <option value="B14">B14 - Régimen Especial de Tributación</option>
                          <option value="B15">B15 - Comprobante Gubernamental</option>
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
                            placeholder="Ej. 101000000 o 001-0000000-0"
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            className="button outline small"
                            disabled={searchingRnc || offline}
                            onClick={handleVerifyRnc}
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

              <div className="customer-form-actions">
                <button
                  type="button"
                  className="button outline"
                  onClick={() => setShowCreate(false)}
                  disabled={saving}
                >
                  Volver a búsqueda
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={saving || !name.trim()}
                >
                  {saving ? 'Guardando…' : 'Guardar y Seleccionar'}
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
