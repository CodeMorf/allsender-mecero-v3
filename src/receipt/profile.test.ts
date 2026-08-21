import { describe, expect, it } from 'vitest'
import { normalizeReceiptSettings, RECEIPT_PROFILE_VERSION } from './profile'

describe('Receipt Profile v1', () => {
  it('normaliza la configuración heredada sin cambiar el contrato fiscal', () => {
    const profile = normalizeReceiptSettings({
      show_customer_name: 1,
      show_table_number: 0,
      show_tax: 'false',
      receipt_languages: ['es', 'es', ''],
    }, { restaurantName: 'Kebab', locale: 'es-do' })

    expect(profile).toMatchObject({
      version: RECEIPT_PROFILE_VERSION,
      source: 'legacy',
      title: 'Kebab',
      languages: ['es'],
      fields: {
        customer: { name: true },
        order: { tableNumber: false },
        restaurant: { tax: false },
      },
    })
    expect(profile).not.toHaveProperty('ncf')
    expect(profile).not.toHaveProperty('taxes')
  })

  it('conserva el perfil versionado y deriva el ancho del agente de impresión', () => {
    const profile = normalizeReceiptSettings({
      version: RECEIPT_PROFILE_VERSION,
      title: 'Recibo de prueba',
      theme: 'modern',
      show_payment_status: false,
    }, {
      scope: { restaurantId: 8, branchId: 12 },
      printer: { id: 4, name: 'Caja', printFormat: 'thermal56mm' },
    })

    expect(profile).toMatchObject({
      source: 'profile',
      title: 'Recibo de prueba',
      theme: 'modern',
      paper: { format: 'thermal', widthMm: 56 },
      scope: { restaurantId: 8, branchId: 12 },
      fields: { payment: { status: false } },
    })
  })
})
