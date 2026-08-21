import type { Printer, ReceiptSettings } from '../types'

export const RECEIPT_PROFILE_VERSION = 'receipt-profile-v1' as const

export type ReceiptPaperFormat = 'thermal' | 'a4' | 'letter' | 'custom'

export type ReceiptProfileScope = {
  restaurantId?: number
  branchId?: number
  terminalId?: number
}

export type ReceiptProfile = {
  version: typeof RECEIPT_PROFILE_VERSION
  source: 'legacy' | 'profile'
  scope: ReceiptProfileScope
  title: string
  footer: string
  theme: string
  paper: {
    format: ReceiptPaperFormat
    widthMm?: number
  }
  languages: string[]
  fields: {
    customer: {
      name: boolean
      address: boolean
      phone: boolean
    }
    order: {
      tableNumber: boolean
      waiter: boolean
      totalGuest: boolean
      orderType: boolean
    }
    restaurant: {
      logo: boolean
      name: boolean
      branchName: boolean
      branchAddress: boolean
      tax: boolean
      crNumber: boolean
      vatNumber: boolean
    }
    payment: {
      qrCode: boolean
      details: boolean
      status: boolean
    }
  }
}

export type ReceiptProfileContext = {
  scope?: ReceiptProfileScope
  restaurantName?: string
  branchName?: string
  locale?: string
  printer?: Printer | null
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'si', 'sí'].includes(normalized)) return true
    if (['false', '0', 'no'].includes(normalized)) return false
  }
  return fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function asLanguages(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) return [fallback]
  const languages = value
    .filter((language): language is string => typeof language === 'string')
    .map(language => language.trim())
    .filter(Boolean)
  return languages.length ? [...new Set(languages)] : [fallback]
}

function normalizePaper(printer?: Printer | null): ReceiptProfile['paper'] {
  const format = String(printer?.printFormat || '').toLowerCase()
  if (format === 'thermal56mm') return { format: 'thermal', widthMm: 56 }
  if (format === 'thermal112mm') return { format: 'thermal', widthMm: 112 }
  if (format === 'thermal80mm') return { format: 'thermal', widthMm: 80 }
  return { format: 'thermal', widthMm: 80 }
}

/**
 * Converts the legacy flat receipt settings returned by RestaPP into a stable
 * presentation profile. It deliberately contains no taxes, NCF, e-CF numbers
 * or calculated totals: those remain server-owned fiscal data.
 */
export function normalizeReceiptSettings(settings: ReceiptSettings | null | undefined, context: ReceiptProfileContext = {}): ReceiptProfile {
  const source = settings && typeof settings === 'object' && settings.version === RECEIPT_PROFILE_VERSION ? 'profile' : 'legacy'
  const raw = settings || {}
  const locale = asString(raw.receipt_locale || raw.locale, context.locale || 'es')

  return {
    version: RECEIPT_PROFILE_VERSION,
    source,
    scope: context.scope || {},
    title: asString(raw.title, context.restaurantName || 'Recibo'),
    footer: asString(raw.footer, ''),
    theme: asString(raw.theme, 'thermal-classic'),
    paper: normalizePaper(context.printer),
    languages: asLanguages(raw.receipt_languages, locale),
    fields: {
      customer: {
        name: asBoolean(raw.show_customer_name, false),
        address: asBoolean(raw.show_customer_address, false),
        phone: asBoolean(raw.show_customer_phone, false),
      },
      order: {
        tableNumber: asBoolean(raw.show_table_number, true),
        waiter: asBoolean(raw.show_waiter, true),
        totalGuest: asBoolean(raw.show_total_guest, false),
        orderType: asBoolean(raw.show_order_type, true),
      },
      restaurant: {
        logo: asBoolean(raw.show_restaurant_logo, true),
        name: asBoolean(raw.show_restaurant_name, true),
        branchName: asBoolean(raw.show_branch_name, true),
        branchAddress: asBoolean(raw.show_branch_address, true),
        tax: asBoolean(raw.show_tax, true),
        crNumber: asBoolean(raw.show_cr_number, false),
        vatNumber: asBoolean(raw.show_vat_number, false),
      },
      payment: {
        qrCode: asBoolean(raw.show_payment_qr_code, false),
        details: asBoolean(raw.show_payment_details, true),
        status: asBoolean(raw.show_payment_status, true),
      },
    },
  }
}
