import { printThermalCustomerReceipt, printThermalTestTicket } from './thermalPrinter'

export type StationPrintMode = 'auto' | 'windows_local' | 'server_agent'
export type ThermalPaperWidth = '80mm' | '58mm'

export interface StationPrinterConfig {
  mode: StationPrintMode
  paperWidth: ThermalPaperWidth
  autoPrintOnPayment: boolean
  openCashDrawerOnPayment: boolean
  printerName: string
  footerNote: string
}

const STORAGE_KEY = 'restapp:station_printer_config'

export const DEFAULT_STATION_PRINTER_CONFIG: StationPrinterConfig = {
  mode: 'auto',
  paperWidth: '80mm',
  autoPrintOnPayment: true,
  openCashDrawerOnPayment: true,
  printerName: 'Impresora Predeterminada de Windows',
  footerNote: '¡Gracias por su visita!',
}

export function getStationPrinterConfig(): StationPrinterConfig {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (!raw) return DEFAULT_STATION_PRINTER_CONFIG
    return { ...DEFAULT_STATION_PRINTER_CONFIG, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_STATION_PRINTER_CONFIG
  }
}

export function saveStationPrinterConfig(patch: Partial<StationPrinterConfig>): StationPrinterConfig {
  const current = getStationPrinterConfig()
  const updated = { ...current, ...patch }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
  } catch (e) {
    console.warn('No se pudo guardar la configuración de impresora en localStorage:', e)
  }
  return updated
}

export interface ThermalReceiptItem {
  id?: number
  name: string
  quantity: number
  price?: number
  amount?: number
  notes?: string
}

export interface ThermalReceiptData {
  restaurantName?: string
  branchName?: string
  rncCedula?: string
  fiscalName?: string
  ncf?: string
  receiptType?: string
  tableNumber?: string | number
  orderNumber?: string | number
  cashierName?: string
  waiterName?: string
  customerName?: string
  customerRnc?: string
  date?: string
  items: ThermalReceiptItem[]
  subtotal: number
  tax: number
  tip?: number
  discount?: number
  total: number
  amountPaid?: number
  changeDue?: number
  paymentMethod?: string
  currencySymbol?: string
  isPreBill?: boolean
  footerNote?: string
}

export interface RoutePrintResult {
  method: 'windows_local' | 'server_agent' | 'fallback_local'
  success: boolean
  message: string
}

/**
 * Enrutador Dinámico de Impresión:
 * 1. Si el modo es 'windows_local', usa el fallback local del navegador (80mm/58mm).
 * 2. Si el modo es 'server_agent', envía la orden al backend (desktop agent).
 * 3. Si el modo es 'auto': usa primero el backend, que es la fuente oficial del
 *    diseño del POS. Si el backend falla estando conectado, devuelve el fallo y
 *    no fabrica un segundo comprobante local.
 */
export async function routePrintReceipt(
  data: ThermalReceiptData,
  options?: {
    sendToBackend?: () => Promise<void>
    forceLocal?: boolean
  }
): Promise<RoutePrintResult> {
  const config = getStationPrinterConfig()

  // 1. Modo Forzado Local o Windows Local
  if (options?.forceLocal || config.mode === 'windows_local') {
    printThermalCustomerReceipt(data, config)
    return {
      method: 'windows_local',
      success: true,
      message: 'Ticket enviado a la impresora local de Windows.',
    }
  }

  // 2. Modo Agente de Servidor
  if (config.mode === 'server_agent') {
    if (options?.sendToBackend) {
      try {
        await options.sendToBackend()
        return {
          method: 'server_agent',
          success: true,
          message: 'Trabajo enviado a la cola del servidor para el Agente de Impresión.',
        }
      } catch (err: any) {
        console.error('Error en impresión por servidor:', err)
        return {
          method: 'server_agent',
          success: false,
          message: 'El backend no pudo encolar el comprobante oficial. No se abrió una impresión local; revise el log de impresión.',
        }
      }
    } else {
      return {
        method: 'server_agent',
        success: false,
        message: 'No hay una cola backend configurada para este comprobante.',
      }
    }
  }

  // 3. Modo AUTO: el backend es la fuente oficial y evita abrir una segunda
  // ventana cuando el agente ya recibió el comprobante.
  if (options?.sendToBackend && navigator.onLine) {
    try {
      await options.sendToBackend()
      return {
        method: 'server_agent',
        success: true,
        message: 'Comprobante enviado a la cola del servidor para el Agente de Impresión.',
      }
    } catch (e) {
      console.error('Backend direct print no disponible:', e)
      return {
        method: 'server_agent',
        success: false,
        message: 'El backend no pudo encolar el comprobante oficial. No se abrió una impresión local; revise el log de impresión.',
      }
    }
  }

  if (navigator.onLine) {
    return {
      method: 'server_agent',
      success: false,
      message: 'No se configuró la cola backend para este comprobante.',
    }
  }

  // Sin conexión, la impresión local solo es una contingencia explícita del
  // modo offline. Nunca se presenta como el comprobante oficial del backend.
  printThermalCustomerReceipt(data, config)

  return {
    method: 'fallback_local',
    success: true,
    message: 'Sin conexión: comprobante enviado a la impresora local como contingencia offline.',
  }
}

export function routePrintTest(): void {
  const config = getStationPrinterConfig()
  printThermalTestTicket(config)
}
