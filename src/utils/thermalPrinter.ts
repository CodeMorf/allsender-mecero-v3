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
}

export function printThermalZReport(data: ZReportData) {
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

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>REPORTE Z - CIERRE #${data.sessionId}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    @media print {
      html, body {
        width: 80mm;
        margin: 0;
        padding: 0;
      }
      body {
        padding: 3mm 2mm;
      }
    }
    body {
      font-family: 'Courier New', Courier, monospace, 'DejaVu Sans', sans-serif;
      font-size: 13px;
      color: #000;
      background: #fff;
      margin: 0 auto;
      width: 76mm;
      box-sizing: border-box;
      line-height: 1.32;
    }
    .text-center { text-align: center; }
    .bold { font-weight: bold; }
    .header-title { font-size: 16px; font-weight: 800; margin-bottom: 2px; }
    .header-sub { font-size: 12px; margin-bottom: 4px; }
    .doc-type { font-size: 15px; font-weight: 800; letter-spacing: 1px; margin: 6px 0; }
    .dashed { border-top: 1px dashed #000; margin: 6px 0; }
    .double { border-top: 2px solid #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; align-items: flex-start; margin: 2px 0; font-size: 12px; }
    .row-label { max-width: 65%; word-break: break-word; }
    .row-val { text-align: right; font-weight: bold; white-space: nowrap; }
    .total-row { font-size: 13.5px; font-weight: 800; margin: 3px 0; }
    .highlight-box { border: 1.5px solid #000; padding: 5px; margin: 8px 0; text-align: center; }
    .signatures { margin-top: 30px; }
    .sig-block { margin-top: 24px; text-align: center; }
    .sig-line { border-top: 1px solid #000; width: 80%; margin: 0 auto 3px auto; }
    .footer { text-align: center; font-size: 11px; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="text-center">
    <div class="header-title">${(data.restaurantName || 'RESTAURANTE').toUpperCase()}</div>
    ${data.branchName ? `<div class="header-sub">${data.branchName}</div>` : ''}
    <div class="dashed"></div>
    <div class="doc-type">REPORTE Z - CIERRE DE CAJA</div>
    <div style="font-size: 12px; font-weight: bold;">TURNO #${data.sessionId} · ${data.registerName || 'Caja Principal'}</div>
  </div>

  <div class="dashed"></div>

  <div class="row">
    <span class="row-label">Cajero:</span>
    <span class="row-val">${data.cashierName || 'Cajero'}</span>
  </div>
  <div class="row">
    <span class="row-label">Apertura:</span>
    <span class="row-val" style="font-size: 11px;">${formatDate(data.openedAt)}</span>
  </div>
  <div class="row">
    <span class="row-label">Cierre:</span>
    <span class="row-val" style="font-size: 11px;">${formatDate(data.closedAt || new Date().toISOString())}</span>
  </div>

  <div class="double"></div>
  <div class="text-center bold" style="font-size: 12px; margin-bottom: 4px;">DESGLOSE FINANCIERO</div>
  <div class="dashed"></div>

  <div class="row">
    <span class="row-label">Fondo de Apertura:</span>
    <span class="row-val">${fmt(data.openingFloat)}</span>
  </div>
  <div class="row">
    <span class="row-label">(+) Ventas en Efectivo:</span>
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
    <span class="row-label">(+) Ingresos Manuales:</span>
    <span class="row-val">${fmt(data.cashIn)}</span>
  </div>
  <div class="row">
    <span class="row-label">(-) Adelantos / Retiros:</span>
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
    <div style="font-size: 14px; font-weight: 800; margin-top: 2px;">
      ${discrepancyLabel}
    </div>
  </div>

  ${data.note ? `
  <div style="font-size: 11px; margin-top: 6px;">
    <b>Nota de cierre:</b> ${data.note}
  </div>` : ''}

  <div class="signatures">
    <div class="sig-block">
      <div class="sig-line"></div>
      <div style="font-size: 11px;">Firma del Cajero</div>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div style="font-size: 11px;">Firma del Supervisor</div>
    </div>
  </div>

  <div class="footer">
    <div>Impreso: ${new Date().toLocaleString('es-DO')}</div>
    <div>*** REPORTE Z GENERADO ***</div>
  </div>
</body>
</html>`

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('title', 'Ticket-Impresion-Z')
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
      console.warn('Error al imprimir ticket térmico:', e)
    } finally {
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe)
        }
      }, 3000)
    }
  }, 350)
}
