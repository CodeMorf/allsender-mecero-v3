import { StationPrinterConfig, ThermalReceiptData, getStationPrinterConfig } from './printRouter'

export interface ZReportData {
  restaurantName: string
  branchName?: string
  registerName?: string
  sessionId: number | string
  cashierName?: string
  openedAt?: string
  closedAt?: string
  openingFloat: number
  cashSales: number
  cardSales?: number
  transferSales?: number
  cashIn: number
  cashOut: number
  safeDrops?: number
  expectedCash: number
  countedCash: number
  discrepancy: number
  currencySymbol?: string
  note?: string
  transactions?: Array<{
    type?: string
    amount?: number
    running_amount?: number
    reason?: string
    reference?: string
    payment_method?: string
    happened_at?: string
  }>
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function getPaperStyles(width: '80mm' | '58mm' = '80mm') {
  const is58 = width === '58mm'
  const pageWidth = is58 ? '58mm' : '80mm'
  const bodyWidth = is58 ? '52mm' : '76mm'
  const baseFontSize = is58 ? '11px' : '13px'
  const titleSize = is58 ? '14px' : '16px'

  return `
    @page {
      size: ${pageWidth} auto;
      margin: 0;
    }
    @media print {
      html, body {
        width: ${pageWidth};
        margin: 0;
        padding: 0;
      }
      body {
        padding: 2mm 1mm;
      }
    }
    body {
      font-family: 'Courier New', Courier, monospace, 'DejaVu Sans', sans-serif;
      font-size: ${baseFontSize};
      color: #000;
      background: #fff;
      margin: 0 auto;
      width: ${bodyWidth};
      box-sizing: border-box;
      line-height: 1.28;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .header-title { font-size: ${titleSize}; font-weight: 800; margin-bottom: 2px; }
    .header-sub { font-size: 11px; margin-bottom: 3px; }
    .doc-type { font-size: 13.5px; font-weight: 800; letter-spacing: 0.5px; margin: 5px 0; }
    .dashed { border-top: 1px dashed #000; margin: 5px 0; }
    .double { border-top: 2px solid #000; margin: 5px 0; }
    .row { display: flex; justify-content: space-between; align-items: flex-start; margin: 2px 0; font-size: 11.5px; }
    .row-label { max-width: 65%; word-break: break-word; }
    .row-val { text-align: right; font-weight: bold; white-space: nowrap; }
    .total-row { font-size: 14px; font-weight: 800; margin: 3px 0; }
    .highlight-box { border: 1.5px solid #000; padding: 4px; margin: 6px 0; text-align: center; }
    .item-table { width: 100%; border-collapse: collapse; margin: 4px 0; }
    .item-table th { text-align: left; font-size: 11px; border-bottom: 1px solid #000; padding-bottom: 2px; }
    .item-table td { font-size: 11.5px; padding: 2px 0; vertical-align: top; }
    .item-qty { width: 22px; font-weight: bold; }
    .item-name { word-break: break-word; padding-right: 4px; }
    .item-price { text-align: right; font-weight: bold; white-space: nowrap; }
    .signatures { margin-top: 24px; }
    .sig-block { margin-top: 20px; text-align: center; }
    .sig-line { border-top: 1px solid #000; width: 80%; margin: 0 auto 3px auto; }
    .footer { text-align: center; font-size: 10.5px; margin-top: 14px; line-height: 1.35; }
    .cut-margin { height: 18mm; }
  `
}

function printHtmlViaIframe(html: string, title = 'Ticket-Termico') {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('title', title)
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) {
    const win = window.open('', '_blank', 'width=380,height=600')
    if (win) {
      win.document.write(html)
      win.document.close()
      win.focus()
      setTimeout(() => { win.print() }, 300)
    }
    return
  }

  doc.open()
  doc.write(html)
  doc.close()

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch (e) {
      console.warn('Error al imprimir via iframe:', e)
    } finally {
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe)
        }
      }, 3500)
    }
  }, 350)
}

export function printThermalZReport(data: ZReportData, config?: StationPrinterConfig) {
  const cfg = config || getStationPrinterConfig()
  const sym = data.currencySymbol || 'RD$'
  const fmt = (val: number | undefined) =>
    `${sym} ${Number(val || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const formatDate = (iso?: string) => {
    if (!iso) return '--/--/---- --:--'
    try {
      const d = new Date(iso)
      return `${d.toLocaleDateString('es-DO')} ${d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: true })}`
    } catch {
      return iso
    }
  }

  const discrepancy = Number(data.discrepancy || 0)
  const discrepancyLabel = Math.abs(discrepancy) < 0.01
    ? 'CUADRADA (0.00)'
    : discrepancy > 0
    ? `SOBRANTE (+${fmt(discrepancy)})`
    : `FALTANTE (${fmt(discrepancy)})`

  const transactionLabel = (type?: string) => ({
    opening_float: 'Apertura',
    cash_sale: 'Venta efectivo',
    order_payment: 'Pago de orden',
    cash_in: 'Ingreso manual',
    cash_out: 'Salida / adelanto',
    safe_drop: 'Caja fuerte',
    refund: 'Reembolso',
    change_given: 'Cambio entregado',
  } as Record<string, string>)[String(type || '')] || String(type || 'Movimiento').replace(/[_-]+/g, ' ')

  const formatTransactionTime = (value?: string) => {
    if (!value) return '--/-- --:--:--'
    try {
      const date = new Date(value)
      return `${date.toLocaleDateString('es-DO')} ${date.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
    } catch {
      return value
    }
  }

  const transactionHistoryHtml = (data.transactions || []).map(transaction => {
    const type = String(transaction.type || '')
    const credit = ['opening_float', 'cash_sale', 'order_payment', 'cash_in'].includes(type)
    const detail = [transaction.reason, transaction.reference, transaction.payment_method ? `Pago: ${transaction.payment_method}` : '']
      .filter(Boolean)
      .join(' · ')
    return `
      <div class="dashed"></div>
      <div class="row" style="font-size: 10px;">
        <span class="row-label">${escapeHtml(formatTransactionTime(transaction.happened_at))} · <b>${escapeHtml(transactionLabel(type))}</b></span>
        <span class="row-val">${credit ? '+' : '-'}${fmt(Number(transaction.amount || 0))}</span>
      </div>
      ${detail ? `<div style="font-size: 10px; word-break: break-word;">${escapeHtml(detail)}</div>` : ''}
      <div style="font-size: 10px; text-align: right;">Saldo: ${fmt(Number(transaction.running_amount || 0))}</div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>REPORTE Z - CIERRE #${data.sessionId}</title>
  <style>${getPaperStyles(cfg.paperWidth)}</style>
</head>
<body>
  <div class="text-center">
    <div class="header-title">${(data.restaurantName || 'RESTAURANTE').toUpperCase()}</div>
    ${data.branchName ? `<div class="header-sub">${data.branchName}</div>` : ''}
    <div class="dashed"></div>
    <div class="doc-type">REPORTE Z - CIERRE DE CAJA</div>
    <div style="font-size: 11.5px; font-weight: bold;">TURNO #${data.sessionId} · ${data.registerName || 'Caja Principal'}</div>
  </div>

  <div class="dashed"></div>

  <div class="row">
    <span class="row-label">Cajero:</span>
    <span class="row-val">${data.cashierName || 'Cajero'}</span>
  </div>
  <div class="row">
    <span class="row-label">Apertura:</span>
    <span class="row-val" style="font-size: 10.5px;">${formatDate(data.openedAt)}</span>
  </div>
  <div class="row">
    <span class="row-label">Cierre:</span>
    <span class="row-val" style="font-size: 10.5px;">${formatDate(data.closedAt || new Date().toISOString())}</span>
  </div>

  <div class="double"></div>
  <div class="text-center bold" style="font-size: 11.5px; margin-bottom: 3px;">DESGLOSE FINANCIERO</div>
  <div class="dashed"></div>

  <div class="row">
    <span class="row-label">Fondo Apertura:</span>
    <span class="row-val">${fmt(data.openingFloat)}</span>
  </div>
  <div class="row">
    <span class="row-label">(+) Ventas Efectivo:</span>
    <span class="row-val">${fmt(data.cashSales)}</span>
  </div>
  ${data.cardSales && data.cardSales > 0 ? `
  <div class="row">
    <span class="row-label">(+) Ventas Tarjeta:</span>
    <span class="row-val">${fmt(data.cardSales)}</span>
  </div>` : ''}
  ${data.transferSales && data.transferSales > 0 ? `
  <div class="row">
    <span class="row-label">(+) Transferencias:</span>
    <span class="row-val">${fmt(data.transferSales)}</span>
  </div>` : ''}
  <div class="row">
    <span class="row-label">(+) Entradas Caja:</span>
    <span class="row-val">${fmt(data.cashIn)}</span>
  </div>
  <div class="row">
    <span class="row-label">(-) Salidas / Gastos:</span>
    <span class="row-val">${fmt(data.cashOut)}</span>
  </div>
  ${data.safeDrops && data.safeDrops > 0 ? `
  <div class="row">
    <span class="row-label">(-) Caja Fuerte:</span>
    <span class="row-val">${fmt(data.safeDrops)}</span>
  </div>` : ''}

  <div class="double"></div>

  <div class="row total-row">
    <span class="row-label">EFECTIVO ESPERADO:</span>
    <span class="row-val">${fmt(data.expectedCash)}</span>
  </div>
  <div class="row total-row">
    <span class="row-label">EFECTIVO CONTADO:</span>
    <span class="row-val">${fmt(data.countedCash)}</span>
  </div>

  <div class="dashed"></div>

  <div class="highlight-box">
    <div style="font-size: 11px; font-weight: bold;">RESULTADO DE ARQUEO</div>
    <div style="font-size: 13.5px; font-weight: 800; margin-top: 2px;">
      ${discrepancyLabel}
    </div>
  </div>

  ${data.note ? `
  <div style="font-size: 10.5px; margin-top: 5px;">
    <b>Nota:</b> ${data.note}
  </div>` : ''}

  ${transactionHistoryHtml ? `
  <div class="double"></div>
  <div class="text-center bold" style="font-size: 11.5px; margin-bottom: 3px;">HISTORIAL DE MOVIMIENTOS</div>
  ${transactionHistoryHtml}` : ''}

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-line"></div>
      <div style="font-size: 10.5px;">Firma del Cajero</div>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div style="font-size: 10.5px;">Firma del Supervisor</div>
    </div>
  </div>

  <div class="footer">
    <div>Impreso: ${new Date().toLocaleString('es-DO')}</div>
    <div>*** REPORTE Z GENERADO ***</div>
  </div>
  <div class="cut-margin"></div>
</body>
</html>`

  printHtmlViaIframe(html, `Reporte-Z-${data.sessionId}`)
}

export function printThermalCustomerReceipt(data: ThermalReceiptData, config?: StationPrinterConfig) {
  const cfg = config || getStationPrinterConfig()
  const sym = data.currencySymbol || 'RD$'
  const fmt = (val: number | undefined) =>
    `${sym} ${Number(val || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const isPre = Boolean(data.isPreBill)
  const docTitle = isPre ? 'PRE-CUENTA (SIN VALOR FISCAL)' : (data.ncf ? 'FACTURA CON COMPROBANTE FISCAL' : 'RECIBO DE PAGO / FACTURA')

  const now = new Date()
  const dateStr = data.date || `${now.toLocaleDateString('es-DO')} ${now.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: true })}`

  const itemsHtml = data.items.map(item => `
    <tr>
      <td class="item-qty">${item.quantity}x</td>
      <td class="item-name">
        ${item.name}
        ${item.notes ? `<div style="font-size: 10px; color: #333;">${item.notes}</div>` : ''}
      </td>
      <td class="item-price">${fmt(item.amount ?? (item.price ? item.price * item.quantity : 0))}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>${docTitle} - #${data.orderNumber || ''}</title>
  <style>${getPaperStyles(cfg.paperWidth)}</style>
</head>
<body>
  <div class="text-center">
    <div class="header-title">${(data.restaurantName || 'RESTAURANTE').toUpperCase()}</div>
    ${data.branchName ? `<div class="header-sub">${data.branchName}</div>` : ''}
    ${data.rncCedula ? `<div class="header-sub bold">RNC: ${data.rncCedula}</div>` : ''}
    ${data.fiscalName ? `<div class="header-sub">${data.fiscalName}</div>` : ''}
    <div class="dashed"></div>
    <div class="doc-type">${docTitle}</div>
    <div style="font-size: 11.5px; font-weight: bold;">
      ${data.tableNumber ? `MESA: ${data.tableNumber}` : 'VENTA DIRECTA'} · ORDEN #${data.orderNumber || ''}
    </div>
  </div>

  <div class="dashed"></div>

  <div class="row">
    <span class="row-label">Fecha/Hora:</span>
    <span class="row-val" style="font-size: 10.5px;">${dateStr}</span>
  </div>
  ${data.cashierName ? `
  <div class="row">
    <span class="row-label">Cajero:</span>
    <span class="row-val">${data.cashierName}</span>
  </div>` : ''}
  ${data.waiterName ? `
  <div class="row">
    <span class="row-label">Mesero:</span>
    <span class="row-val">${data.waiterName}</span>
  </div>` : ''}
  ${data.customerName ? `
  <div class="row">
    <span class="row-label">Cliente:</span>
    <span class="row-val">${data.customerName}</span>
  </div>` : ''}
  ${data.customerRnc ? `
  <div class="row">
    <span class="row-label">RNC/Cédula:</span>
    <span class="row-val">${data.customerRnc}</span>
  </div>` : ''}
  ${data.ncf ? `
  <div class="row bold" style="font-size: 12px; margin-top: 3px;">
    <span class="row-label">NCF:</span>
    <span class="row-val">${data.ncf}</span>
  </div>` : ''}
  ${data.receiptType ? `
  <div class="row">
    <span class="row-label">Tipo Comprobante:</span>
    <span class="row-val">${data.receiptType}</span>
  </div>` : ''}

  <div class="dashed"></div>

  <table class="item-table">
    <thead>
      <tr>
        <th style="width: 22px;">Cant</th>
        <th>Descripción</th>
        <th style="text-align: right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <div class="dashed"></div>

  <div class="row">
    <span class="row-label">Subtotal:</span>
    <span class="row-val">${fmt(data.subtotal)}</span>
  </div>
  ${data.discount && data.discount > 0 ? `
  <div class="row">
    <span class="row-label">Descuento:</span>
    <span class="row-val">-${fmt(data.discount)}</span>
  </div>` : ''}
  <div class="row">
    <span class="row-label">Impuestos / ITBIS (18%):</span>
    <span class="row-val">${fmt(data.tax)}</span>
  </div>
  ${data.tip && data.tip > 0 ? `
  <div class="row">
    <span class="row-label">Propina de Ley (10%):</span>
    <span class="row-val">${fmt(data.tip)}</span>
  </div>` : ''}

  <div class="double"></div>

  <div class="row total-row">
    <span class="row-label">TOTAL A PAGAR:</span>
    <span class="row-val">${fmt(data.total)}</span>
  </div>

  ${!isPre ? `
  <div class="dashed"></div>
  <div class="row">
    <span class="row-label">Método de Pago:</span>
    <span class="row-val">${(data.paymentMethod || 'Efectivo').toUpperCase()}</span>
  </div>
  ${data.amountPaid !== undefined ? `
  <div class="row">
    <span class="row-label">Monto Pagado:</span>
    <span class="row-val">${fmt(data.amountPaid)}</span>
  </div>` : ''}
  ${data.changeDue && data.changeDue > 0 ? `
  <div class="row bold">
    <span class="row-label">Cambio:</span>
    <span class="row-val">${fmt(data.changeDue)}</span>
  </div>` : ''}
  ` : ''}

  <div class="footer">
    <div>${cfg.footerNote || '¡Gracias por su visita!'}</div>
    <div style="font-size: 9.5px; color: #555; margin-top: 4px;">
      ${isPre ? '*** CUENTA PREVIA · NO VÁLIDA COMO CRÉDITO FISCAL ***' : '*** COPIA CLIENTE · SISTEMA ALLSENDER ***'}
    </div>
  </div>
  <div class="cut-margin"></div>
</body>
</html>`

  printHtmlViaIframe(html, `Ticket-Orden-${data.orderNumber || '0'}`)
}

export function printThermalTestTicket(config?: StationPrinterConfig) {
  const cfg = config || getStationPrinterConfig()
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>TEST DE IMPRESORA TÉRMICA</title>
  <style>${getPaperStyles(cfg.paperWidth)}</style>
</head>
<body>
  <div class="text-center">
    <div class="header-title">ANTIGRAVITY POS</div>
    <div class="header-sub">PRUEBA DE IMPRESIÓN TÉRMICA</div>
    <div class="dashed"></div>
    <div class="doc-type">TEST DE CONEXIÓN WINDOWS</div>
    <div style="font-size: 11.5px; font-weight: bold;">ESTADO: 100% OPERATIVO</div>
  </div>

  <div class="dashed"></div>

  <div class="row">
    <span class="row-label">Modo del Router:</span>
    <span class="row-val">${cfg.mode.toUpperCase()}</span>
  </div>
  <div class="row">
    <span class="row-label">Ancho de Papel:</span>
    <span class="row-val">${cfg.paperWidth}</span>
  </div>
  <div class="row">
    <span class="row-label">Auto-Impresión Cobro:</span>
    <span class="row-val">${cfg.autoPrintOnPayment ? 'ACTIVADO' : 'DESACTIVADO'}</span>
  </div>
  <div class="row">
    <span class="row-label">Apertura Cajón:</span>
    <span class="row-val">${cfg.openCashDrawerOnPayment ? 'HABILITADO' : 'DESHABILITADO'}</span>
  </div>
  <div class="row">
    <span class="row-label">Impresora:</span>
    <span class="row-val">${cfg.printerName}</span>
  </div>
  <div class="row">
    <span class="row-label">Fecha/Hora:</span>
    <span class="row-val" style="font-size: 10.5px;">${new Date().toLocaleString('es-DO')}</span>
  </div>

  <div class="double"></div>

  <div class="text-center bold" style="font-size: 11.5px; margin: 4px 0;">ALINEACIÓN Y COLUMNAS</div>
  <div class="row">
    <span>IZQUIERDA</span>
    <span style="text-align: center;">CENTRO</span>
    <span class="row-val">DERECHA</span>
  </div>
  <div style="font-size: 10px; text-align: center; margin: 4px 0;">
    ========================================<br/>
    1234567890123456789012345678901234567890<br/>
    ABCDEFGHIJKLMNOPQRSTUVWXYZ
  </div>

  <div class="highlight-box">
    <div style="font-size: 11px; font-weight: bold;">¡CONFIGURACIÓN EXITOSA!</div>
    <div style="font-size: 10px; margin-top: 2px;">
      El enrutador dinámico de impresión está listo para cobrar e imprimir automáticamente.
    </div>
  </div>

  <div class="footer">
    <div>${cfg.footerNote}</div>
    <div style="font-size: 9.5px; margin-top: 4px;">*** TEST DE IMPRESIÓN FINALIZADO ***</div>
  </div>
  <div class="cut-margin"></div>
</body>
</html>`

  printHtmlViaIframe(html, 'Test-Impresora-Termica')
}
