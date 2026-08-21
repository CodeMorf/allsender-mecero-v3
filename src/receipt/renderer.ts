import type { ReceiptProfile } from './profile'

export type ReceiptDocumentLine = {
  id: number
  name: string
  quantity: number
  amount?: number
}

export type ReceiptDocumentTotals = {
  subtotal: number | null
  tax: number | null
  tip: number | null
  discount: number | null
  total: number
  paid: number
  due: number
}

export type ReceiptDocumentViewModel = {
  kind: 'prebill' | 'receipt'
  title: string
  footer: string
  theme: string
  paper: ReceiptProfile['paper']
  fields: ReceiptProfile['fields']
  customer: string
  tableNumber?: string
  orderNumber?: string
  lines: ReceiptDocumentLine[]
  totals: ReceiptDocumentTotals
  /** Fiscal data is intentionally resolved by the server renderer. */
  fiscal: { source: 'backend'; status: 'not-resolved-in-preview' }
}

export function buildReceiptDocumentViewModel(input: {
  profile: ReceiptProfile
  kind?: ReceiptDocumentViewModel['kind']
  customer?: string
  tableNumber?: string
  orderNumber?: string
  items?: ReceiptDocumentLine[]
  totals: ReceiptDocumentTotals
}): ReceiptDocumentViewModel {
  return {
    kind: input.kind || 'prebill',
    title: input.profile.title,
    footer: input.profile.footer,
    theme: input.profile.theme,
    paper: input.profile.paper,
    fields: input.profile.fields,
    customer: input.customer || '',
    tableNumber: input.tableNumber,
    orderNumber: input.orderNumber,
    lines: (input.items || []).map(item => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      amount: item.amount,
    })),
    totals: input.totals,
    fiscal: { source: 'backend', status: 'not-resolved-in-preview' },
  }
}
