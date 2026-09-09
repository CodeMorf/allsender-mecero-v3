import React, { useState } from 'react'
import {
  Utensils,
  ShoppingBag,
  Hotel,
  Truck,
  ArrowLeft,
  Home,
  LogOut,
  Navigation,
  Check
} from 'lucide-react'
import type { DeliveryExecutive, DeliveryPlatform, DeliverySettings, OrderMode, OrderTypeConfig } from '../types'

export interface OrderTypeSelection {
  mode: OrderMode
  orderTypeId?: number
  orderTypeName: string
  deliveryPlatformId?: number | null
  deliveryAppName?: string
  roomNumber?: string
  deliveryExecutiveId?: number
  deliveryAddress?: string
  deliveryFee?: number
  customerLat?: number
  customerLng?: number
}

export interface OrderTypeModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (selection: OrderTypeSelection) => void
  currentSelection: OrderTypeSelection
  orderTypes: OrderTypeConfig[]
  deliveryPlatforms: DeliveryPlatform[]
  deliveryExecutives: DeliveryExecutive[]
  deliverySettings?: DeliverySettings | null
}

export function translateOrderTypeName(slug?: string, rawName?: string): string {
  const s = String(slug || '').toLowerCase().trim()
  if (s === 'dine_in') return 'Comer aquí'
  if (s === 'pickup') return 'Para llevar / Recoger'
  if (s === 'room_service') return 'Servicio de habitaciones'
  if (s === 'delivery') return 'Entrega'
  const n = String(rawName || '').toLowerCase().trim()
  if (n === 'dine in' || n === 'dine_in') return 'Comer aquí'
  if (n === 'pickup' || n === 'pick up' || n === 'takeout' || n === 'take away' || n === 'para llevar' || n === 'recogida') return 'Para llevar / Recoger'
  if (n === 'room service' || n === 'room_service') return 'Servicio de habitaciones'
  if (n === 'delivery') return 'Entrega'
  return rawName || 'Comer aquí'
}

export const OrderTypeModal: React.FC<OrderTypeModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  currentSelection,
  orderTypes,
  deliveryPlatforms,
  deliveryExecutives,
  deliverySettings
}) => {
  // Step in modal: 'select' | 'room_service' | 'delivery_details'
  const [step, setStep] = useState<'select' | 'room_service' | 'delivery_details'>('select')
  const [setAsDefault, setSetAsDefault] = useState(false)

  // Room service state
  const [roomNumber, setRoomNumber] = useState(currentSelection.roomNumber || '')

  // Delivery custom details state
  const defaultFee = deliverySettings?.fixed_fee != null
    ? Number(deliverySettings.fixed_fee)
    : (deliverySettings?.fee_tiers?.[0]?.fee ?? 150)
  const [selectedDriverId, setSelectedDriverId] = useState<number | undefined>(currentSelection.deliveryExecutiveId)
  const [deliveryAddress, setDeliveryAddress] = useState(currentSelection.deliveryAddress || '')
  const [deliveryFee, setDeliveryFee] = useState<number>(currentSelection.deliveryFee ?? defaultFee)
  const [gpsCoords, setGpsCoords] = useState<{ lat?: number; lng?: number }>({
    lat: currentSelection.customerLat,
    lng: currentSelection.customerLng
  })
  const [locatingGps, setLocatingGps] = useState(false)
  const [gpsError, setGpsError] = useState('')

  if (!isOpen) return null

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setGpsError('GPS no soportado en este dispositivo')
      return
    }
    setLocatingGps(true)
    setGpsError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        })
        setLocatingGps(false)
      },
      () => {
        setGpsError('No se pudo obtener coordenadas GPS')
        setLocatingGps(false)
      },
      { timeout: 10000, enableHighAccuracy: true }
    )
  }

  // Determine available core types from backend or default
  const dineInType = orderTypes.find(t => t.slug === 'dine_in')
  const pickupType = orderTypes.find(t => t.slug === 'pickup')
  const roomServiceType = orderTypes.find(t => t.slug === 'room_service')
  const deliveryType = orderTypes.find(t => t.slug === 'delivery')

  const handleSelectDineIn = () => {
    onSelect({
      mode: 'dine_in',
      orderTypeId: dineInType?.id ?? 25,
      orderTypeName: translateOrderTypeName(dineInType?.slug, dineInType?.order_type_name || 'Comer aquí')
    })
    onClose()
  }

  const handleSelectPickup = () => {
    onSelect({
      mode: 'pickup',
      orderTypeId: pickupType?.id ?? 27,
      orderTypeName: translateOrderTypeName(pickupType?.slug, pickupType?.order_type_name || 'Recogida')
    })
    onClose()
  }

  const handleStartRoomService = () => {
    setStep('room_service')
  }

  const handleConfirmRoomService = () => {
    if (!roomNumber.trim()) return
    onSelect({
      mode: 'room_service',
      orderTypeId: roomServiceType?.id ?? 77,
      orderTypeName: translateOrderTypeName(roomServiceType?.slug, roomServiceType?.order_type_name || 'Servicio de habitaciones'),
      roomNumber: roomNumber.trim()
    })
    onClose()
  }

  const handleStartDefaultDelivery = () => {
    setStep('delivery_details')
  }

  const handleConfirmDefaultDelivery = () => {
    onSelect({
      mode: 'delivery',
      orderTypeId: deliveryType?.id ?? 26,
      orderTypeName: translateOrderTypeName(deliveryType?.slug, deliveryType?.order_type_name || 'Entrega'),
      deliveryPlatformId: null,
      deliveryAppName: 'Entrega Directa',
      deliveryExecutiveId: selectedDriverId,
      deliveryAddress: deliveryAddress.trim() || undefined,
      deliveryFee: deliveryFee,
      customerLat: gpsCoords.lat,
      customerLng: gpsCoords.lng
    })
    onClose()
  }

  const handleSelectPlatform = (platform: DeliveryPlatform) => {
    onSelect({
      mode: 'delivery',
      orderTypeId: deliveryType?.id ?? 26,
      orderTypeName: `Entrega ${platform.name}`,
      deliveryPlatformId: platform.id,
      deliveryAppName: platform.name,
      deliveryFee: 0
    })
    onClose()
  }

  return (
    <div className="posdan-modal-overlay" style={{ zIndex: 9999 }}>
      <div
        className="posdan-modal-card"
        style={{
          width: '100%',
          maxWidth: 620,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 16,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
          overflow: 'hidden'
        }}
      >
        {/* Modal Header matching media_1788873887045.png */}
        <div
          style={{
            padding: '20px 24px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 19,
                fontWeight: 700,
                color: '#f0f6fc',
                letterSpacing: '-0.01em'
              }}
            >
              Seleccionar tipo de pedido
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 13,
                color: '#8b949e'
              }}
            >
              Elija un tipo de pedido u opción de entrega con un solo toque
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {step !== 'select' && (
              <button
                type="button"
                onClick={() => setStep('select')}
                className="posdan-btn-icon"
                title="Volver"
                style={{
                  background: '#21262d',
                  border: '1px solid #30363d',
                  color: '#c9d1d9',
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="posdan-btn-icon"
              title="Inicio"
              style={{
                background: '#21262d',
                border: '1px solid #30363d',
                color: '#c9d1d9',
                width: 34,
                height: 34,
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Home size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="posdan-btn-icon"
              title="Cerrar"
              style={{
                background: '#21262d',
                border: '1px solid #30363d',
                color: '#c9d1d9',
                width: 34,
                height: 34,
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        <div style={{ padding: '20px 24px 24px' }}>
          {step === 'select' && (
            <>
              {/* Warning Banner */}
              <div
                style={{
                  background: 'rgba(234, 88, 12, 0.08)',
                  border: '1px solid rgba(234, 88, 12, 0.3)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 12.5,
                  color: '#fb923c',
                  marginBottom: 16
                }}
              >
                Al cambiar el tipo de pedido, pueden variar los precios y las opciones.
              </div>

              {/* Set as default checkbox */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  marginBottom: 20,
                  userSelect: 'none'
                }}
              >
                <input
                  type="checkbox"
                  checked={setAsDefault}
                  onChange={e => setSetAsDefault(e.target.checked)}
                  style={{
                    marginTop: 3,
                    accentColor: '#ea580c',
                    cursor: 'pointer',
                    width: 16,
                    height: 16
                  }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f6fc' }}>
                    Establecer como predeterminado
                  </div>
                  <div style={{ fontSize: 11.5, color: '#8b949e' }}>
                    Omita esta selección la próxima vez.
                  </div>
                </div>
              </label>

              {/* Top Row: Core Order Types */}
              <div
                className="order-type-core-grid"
                style={{
                  display: 'grid',
                  gap: 12,
                  marginBottom: 24
                }}
              >
                {/* 1. Comer aquí */}
                <button
                  type="button"
                  onClick={handleSelectDineIn}
                  style={{
                    background: currentSelection.mode === 'dine_in' ? '#21262d' : '#161b22',
                    border: currentSelection.mode === 'dine_in' ? '1.5px solid #ea580c' : '1px solid #30363d',
                    borderRadius: 12,
                    padding: '24px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: 'rgba(234, 88, 12, 0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ea580c'
                    }}
                  >
                    <Utensils size={22} />
                  </div>
                  <span className="order-type-choice-copy">
                    <strong>{translateOrderTypeName(dineInType?.slug, dineInType?.order_type_name || 'Comer aquí')}</strong>
                    <small>Atención en una mesa o en la barra</small>
                  </span>
                </button>

                {/* 2. Para llevar / recoger: conserva el slug pickup del backend */}
                <button
                  type="button"
                  onClick={handleSelectPickup}
                  style={{
                    background: currentSelection.mode === 'pickup' ? '#21262d' : '#161b22',
                    border: currentSelection.mode === 'pickup' ? '1.5px solid #ea580c' : '1px solid #30363d',
                    borderRadius: 12,
                    padding: '24px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: 'rgba(234, 88, 12, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ea580c'
                  }}
                >
                    <ShoppingBag size={22} />
                  </div>
                  <span className="order-type-choice-copy">
                    <strong>{translateOrderTypeName(pickupType?.slug, pickupType?.order_type_name || 'Recogida')}</strong>
                    <small>El cliente recoge su pedido; no usa mesa</small>
                  </span>
                </button>

                {/* 3. Servicio de habitaciones */}
                <button
                  type="button"
                  onClick={handleStartRoomService}
                  style={{
                    background: currentSelection.mode === 'room_service' ? '#21262d' : '#161b22',
                    border: currentSelection.mode === 'room_service' ? '1.5px solid #ea580c' : '1px solid #30363d',
                    borderRadius: 12,
                    padding: '24px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: 'rgba(234, 88, 12, 0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ea580c'
                    }}
                  >
                    <Hotel size={22} />
                  </div>
                  <span className="order-type-choice-copy">
                    <strong>{translateOrderTypeName(roomServiceType?.slug, roomServiceType?.order_type_name || 'Servicio de habitaciones')}</strong>
                    <small>Se entrega directamente en una habitación</small>
                  </span>
                </button>
              </div>

              {/* Bottom Section: Delivery */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Truck size={16} style={{ color: '#ea580c' }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#f0f6fc' }}>Entrega a domicilio</span>
                </div>
                <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 14 }}>
                  Envíe el pedido con un repartidor propio o mediante una plataforma. Estas órdenes tampoco usan mesa.
                </div>

                <div
                  className="delivery-platform-grid"
                  style={{
                    display: 'grid',
                    gap: 12
                  }}
                >
                  {/* Delivery por defecto (Directo / Repartidor propio) */}
                  <button
                    type="button"
                    onClick={handleStartDefaultDelivery}
                    style={{
                      background: currentSelection.mode === 'delivery' && !currentSelection.deliveryPlatformId ? '#21262d' : '#161b22',
                      border: currentSelection.mode === 'delivery' && !currentSelection.deliveryPlatformId ? '1.5px solid #ea580c' : '1px solid #30363d',
                      borderRadius: 12,
                      padding: '20px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        background: 'rgba(234, 88, 12, 0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ea580c'
                      }}
                    >
                      <Truck size={22} />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#8b949e' }}>Repartidor propio</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#f0f6fc' }}>Entrega directa</div>
                    </div>
                  </button>

                  {/* Dynamic SaaS delivery platforms from backend (PedidosYa, Uber Eats, etc.) */}
                  {deliveryPlatforms.map(platform => {
                    const isSelected = currentSelection.deliveryPlatformId === platform.id
                    return (
                      <button
                        key={platform.id}
                        type="button"
                        onClick={() => handleSelectPlatform(platform)}
                        style={{
                          background: isSelected ? '#21262d' : '#161b22',
                          border: isSelected ? '1.5px solid #ea580c' : '1px solid #30363d',
                          borderRadius: 12,
                          padding: '20px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 10,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 10,
                            background: '#0d1117',
                            border: '1px solid #30363d',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden'
                          }}
                        >
                          {platform.logo_url ? (
                            <img
                              src={platform.logo_url}
                              alt={platform.name}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                          ) : (
                            <Truck size={20} color="#ea580c" />
                          )}
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: '#8b949e' }}>Plataforma externa</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#f0f6fc' }}>{platform.name}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {/* Sub-view: Room Service configuration */}
          {step === 'room_service' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: 'rgba(234, 88, 12, 0.08)',
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: '1px solid rgba(234, 88, 12, 0.2)'
                }}
              >
                <Hotel size={24} style={{ color: '#ea580c' }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f6fc' }}>Servicio de Habitaciones</div>
                  <div style={{ fontSize: 12, color: '#8b949e' }}>Indique el número de habitación o suite para la entrega.</div>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 6 }}>
                  Número de Habitación *
                </label>
                <input
                  type="text"
                  placeholder="Ej. 101, 204B, Suite Presidencial..."
                  value={roomNumber}
                  onChange={e => setRoomNumber(e.target.value)}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 8,
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    color: '#f0f6fc',
                    fontSize: 15,
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 8,
                    background: '#21262d',
                    border: '1px solid #30363d',
                    color: '#c9d1d9',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRoomService}
                  disabled={!roomNumber.trim()}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 8,
                    background: roomNumber.trim() ? '#ea580c' : '#30363d',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: roomNumber.trim() ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <Check size={16} />
                  <span>Confirmar Habitación</span>
                </button>
              </div>
            </div>
          )}

          {/* Sub-view: Delivery Por Defecto (Directo / Repartidor / Dirección / GPS) */}
          {step === 'delivery_details' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: 'rgba(234, 88, 12, 0.08)',
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: '1px solid rgba(234, 88, 12, 0.2)'
                }}
              >
                <Truck size={24} style={{ color: '#ea580c' }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f6fc' }}>Entrega a Domicilio Propia</div>
                  <div style={{ fontSize: 12, color: '#8b949e' }}>Asigne repartidor, dirección y ubicación GPS.</div>
                </div>
              </div>

              {/* Asignar Repartidor */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 6 }}>
                  Repartidor Asignado (Opcional)
                </label>
                <select
                  value={selectedDriverId || ''}
                  onChange={e => setSelectedDriverId(Number(e.target.value) || undefined)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    color: '#f0f6fc',
                    fontSize: 13,
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                >
                  <option value="">-- Sin repartidor asignado aún --</option>
                  {deliveryExecutives.map(driver => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name} {driver.phone ? `(${driver.phone})` : ''} - {driver.status || 'Disponible'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dirección de entrega */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 6 }}>
                  Dirección de Entrega
                </label>
                <input
                  type="text"
                  placeholder="Calle, número, sector, referencias..."
                  value={deliveryAddress}
                  onChange={e => setDeliveryAddress(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    color: '#f0f6fc',
                    fontSize: 13,
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
                {!deliveryAddress.trim() && (
                  <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 5 }}>
                    La dirección es obligatoria para una entrega propia.
                  </div>
                )}
              </div>

              {/* Tarifa de Envío & GPS */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 6 }}>
                    Costo de Envío (RD$)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={deliveryFee}
                    onChange={e => setDeliveryFee(Math.max(0, Number(e.target.value) || 0))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: '#0d1117',
                      border: '1px solid #30363d',
                      color: '#f0f6fc',
                      fontSize: 13,
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 6 }}>
                    Ubicación GPS
                  </label>
                  <button
                    type="button"
                    onClick={handleGetLocation}
                    disabled={locatingGps}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: gpsCoords.lat ? 'rgba(52, 211, 153, 0.15)' : '#21262d',
                      border: gpsCoords.lat ? '1px solid #34d399' : '1px solid #30363d',
                      color: gpsCoords.lat ? '#34d399' : '#c9d1d9',
                      fontSize: 12,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      cursor: 'pointer'
                    }}
                  >
                    <Navigation size={14} />
                    <span>
                      {locatingGps
                        ? 'Obteniendo...'
                        : gpsCoords.lat
                        ? `GPS: ${gpsCoords.lat.toFixed(4)}, ${gpsCoords.lng?.toFixed(4)}`
                        : 'Capturar GPS actual'}
                    </span>
                  </button>
                  {gpsError && <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{gpsError}</div>}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 8,
                    background: '#21262d',
                    border: '1px solid #30363d',
                    color: '#c9d1d9',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDefaultDelivery}
                  disabled={!deliveryAddress.trim()}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 8,
                    background: '#ea580c',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: deliveryAddress.trim() ? 'pointer' : 'not-allowed',
                    opacity: deliveryAddress.trim() ? 1 : 0.55,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <Check size={16} />
                  <span>Aplicar Entrega</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
