import { describe, expect, it } from 'vitest'
import { normalizeReceiptSettings } from './profile'
import { buildReceiptDocumentViewModel } from './renderer'

describe('Receipt renderer', () => {
  it('construye una vista previa sin inventar datos fiscales', () => {
    const view = buildReceiptDocumentViewModel({
      profile: normalizeReceiptSettings({ show_table_number: true }, { restaurantName: 'Demo' }),
      tableNumber: 'T03',
      orderNumber: '39',
      items: [{ id: 1, name: 'Agua', quantity: 2, amount: 100 }],
      totals: { subtotal: 100, tax: null, tip: null, discount: null, total: 100, paid: 0, due: 100 },
    })

    expect(view).toMatchObject({ title: 'Demo', tableNumber: 'T03', orderNumber: '39', fiscal: { source: 'backend' } })
    expect(view.lines).toHaveLength(1)
    expect(view.fiscal.status).toBe('not-resolved-in-preview')
    expect(view).not.toHaveProperty('ncf')
  })
})
