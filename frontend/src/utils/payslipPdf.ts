import jsPDF, { GState } from 'jspdf'
import type { SalarySlip } from '../types/user'
import type { PayslipOptions } from './payslipOptions'

export type { PayslipOptions }
export { getCompanyPayslipOptions } from './payslipOptions'

// Embedded Unicode font (OFL, DejaVu Sans Condensed — metric-equivalent to
// Helvetica) so the rupee sign (U+20B9), em-dash (U+2014) and non-ASCII names
// render correctly in every PDF viewer. jsPDF's built-in Helvetica is limited
// to WinAnsiEncoding, which cannot represent U+20B9 (it degrades to a '1').
let fontData: { regular: string; bold: string } | null = null
const toB64 = async (url: string): Promise<string> => {
  const res = await fetch(url)
  const bytes = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    bin += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(bin)
}
async function ensureFonts(doc: jsPDF): Promise<void> {
  if (!fontData) {
    const [regular, bold] = await Promise.all([
      toB64('/fonts/DejaVuSansCondensed.ttf'),
      toB64('/fonts/DejaVuSansCondensed-Bold.ttf'),
    ])
    fontData = { regular, bold }
  }
  doc.addFileToVFS('DejaVuSansCondensed.ttf', fontData.regular)
  doc.addFileToVFS('DejaVuSansCondensed-Bold.ttf', fontData.bold)
  doc.addFont('DejaVuSansCondensed.ttf', 'dejavu', 'normal')
  doc.addFont('DejaVuSansCondensed-Bold.ttf', 'dejavu', 'bold')
}

const C = {
  white: [255, 255, 255] as [number, number, number],
  primary: [249, 115, 22] as [number, number, number],
  primaryDark: [234, 88, 12] as [number, number, number],
  primaryLight: [255, 247, 237] as [number, number, number],
  primaryBorder: [253, 186, 116] as [number, number, number],
  border: [214, 214, 214] as [number, number, number],
  borderStrong: [191, 197, 204] as [number, number, number],
  headerText: [17, 24, 39] as [number, number, number],
  bodyText: [55, 65, 81] as [number, number, number],
  mutedText: [107, 114, 128] as [number, number, number],
  footerText: [156, 163, 175] as [number, number, number],
  rowAlt: [252, 252, 252] as [number, number, number],
}

const PAGE_MARGIN = 14
const ROW_HEIGHT = 10.6
const HEADER_HEIGHT = 11.1
const NET_ROW_HEIGHT = 11
const SECTION_GAP = 12

const fmtMoney = (n: number, _currency?: string, _country?: string) => {
  const f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `\u20B9 ${f.format(n || 0)}`
}

const numberToWords = (num: number, _currency?: string, _country?: string): string => {
  if (num === 0) return `Indian Rupees Zero Only`
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const convert = (n: number): string => {
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '')
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '')
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '')
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '')
  }
  const rupees = Math.floor(num)
  const paise = Math.round((num - rupees) * 100)
  let result = `Indian Rupees ${convert(rupees)}`
  if (paise > 0) result += ` and ${convert(paise)} Paise`
  return result + ' Only'
}

const safeDate = (value: any): Date | null => {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value.toDate === 'function') return value.toDate()
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

const formatDate = (value: any): string => {
  const d = safeDate(value)
  if (!d) return '\u2014'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export const downloadPayslipPdf = async (slip: SalarySlip, options: PayslipOptions = {}) => {
  const c = {
    name: options.companyName || '',
    address: options.companyAddress || '',
    city: options.companyCity || '',
    state: options.companyState || '',
    country: options.companyCountry || '',
    zip: options.companyZip || '',
    logo: options.companyLogo || '',
    currency: options.companyCurrency || 'INR',
  }

  // Company profile logos live in S3 and arrive as an https URL, but jsPDF
  // only embeds data URIs - so the mark used to vanish from every generated
  // payslip. Inline it here; a CORS or network failure just drops the logo
  // instead of breaking the document.
  if (c.logo && !c.logo.startsWith('data:')) {
    try {
      const res = await fetch(c.logo)
      if (res.ok) {
        const type = (res.headers.get('content-type') || '').split(';')[0]
        const bytes = new Uint8Array(await res.arrayBuffer())
        let bin = ''
        for (let i = 0; i < bytes.length; i += 0x8000) {
          const chunk = bytes.subarray(i, i + 0x8000)
          bin += String.fromCharCode.apply(null, chunk as unknown as number[])
        }
        c.logo = `data:${type || 'image/png'};base64,${btoa(bin)}`
      } else {
        c.logo = ''
      }
    } catch {
      c.logo = ''
    }
  }

  const breakdown = slip.breakdown || { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0 }
  const basic = slip.basicSalary || 0
  const hra = breakdown.hra || 0
  const da = breakdown.da || 0
  const tax = breakdown.tax || 0
  const otherDed = breakdown.otherDeductions || 0
  const allowances = slip.allowances || 0
  const deductions = slip.deductions || (tax + otherDed + breakdown.pf)
  const net = slip.netSalary || 0
  const gross = basic + allowances + (breakdown.leaveEncashment || 0)
  const fixedAllow = Math.max(0, allowances - hra - da)

  const paidOn = safeDate(slip.paidOn) || new Date()
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const payPeriod = slip.month || monthNames[paidOn.getMonth()]
  const payYear = slip.year || paidOn.getFullYear()
  const payDateStr = formatDate(slip.paidOn)

  const workingDays = (slip as any).workingDays || 30
  const lopDays = (slip as any).lopDays || 0
  const paidDays = (slip as any).paidDays || (workingDays - lopDays)

  const designation = (slip as any).designation || '\u2014'
  const doj = formatDate((slip as any).dateOfJoining)
  const payPeriodStr = `${payPeriod} ${payYear}`

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  await ensureFonts(doc)
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const mg = PAGE_MARGIN
  const cw = pw - mg * 2

  let y = mg

  const setFont = (size: number, weight: 'normal' | 'bold' = 'normal', color: [number, number, number] = C.bodyText) => {
    doc.setFontSize(size)
    doc.setFont('dejavu', weight)
    doc.setTextColor(...color)
  }

  const truncate = (text: string, maxWidth: number): string => {
    let t = text
    while (doc.getTextWidth(t) > maxWidth && t.length > 1) t = t.slice(0, -1)
    if (t !== text && t.length > 3) t = t.slice(0, -3) + '...'
    return t
  }

  // Logo on left - fitted into a fixed box so a tall or wide mark both stay
  // inside the header band, then the company name starts after it.
  let logoW = 0
  if (c.logo && c.logo.startsWith('data:')) {
    try {
      const img = new Image()
      img.src = c.logo
      const maxW = 26
      const maxH = 15
      const aspect = img.width / img.height || 1
      // Fit inside the box: wide art is limited by width, tall art by height.
      const fitsWide = aspect >= maxW / maxH
      const w = fitsWide ? maxW : maxH * aspect
      const h = fitsWide ? maxW / aspect : maxH
      const format = c.logo.includes('data:image/png') ? 'PNG' : 'JPEG'
      doc.addImage(c.logo, format, mg, y + 4, w, h)
      logoW = w
    } catch { /* ignore */ }
  }

  // Header right: HRMAX brand - measured first so the company name on the
  // left can never run underneath it.
  const brandSub = 'Payroll Management System'
  setFont(7, 'normal', C.mutedText)
  const brandReserve = doc.getTextWidth(brandSub) + 6

  // Header left: company name is the primary identity on the page, so it is
  // set well above the 10pt it used to carry and sits beside its logo.
  const nameX = mg + (logoW ? logoW + 5 : 0)
  const nameW = pw - mg - brandReserve - nameX
  setFont(20, 'bold', C.headerText)
  doc.text(truncate(c.name, nameW), nameX, y + 14)
  const addressLine = [c.address, c.city, c.state, c.zip, c.country].filter(Boolean).join(', ')
  if (addressLine) {
    setFont(8, 'normal', C.bodyText)
    doc.text(truncate(addressLine, nameW), nameX, y + 18)
  }

  setFont(15, 'bold', C.primary)
  doc.text('HRMAX', pw - mg, y + 5, { align: 'right' })
  setFont(7, 'normal', C.mutedText)
  doc.text(brandSub, pw - mg, y + 9, { align: 'right' })
  y += 24

  // Orange divider
  doc.setDrawColor(...C.primary)
  doc.setLineWidth(0.7)
  doc.line(mg, y, pw - mg, y)
  y += SECTION_GAP

  // Title
  setFont(17, 'bold', C.headerText)
  doc.text(`Payslip for the month of ${payPeriod} ${payYear}`, mg, y)
  y += 4
  doc.setFillColor(...C.primary)
  doc.rect(mg, y, 26.4, 0.8, 'F')
  y += SECTION_GAP - 2

  // Employee Pay Summary
  setFont(11, 'bold', C.primaryDark)
  doc.text('EMPLOYEE PAY SUMMARY', mg, y)
  y += 5

  const leftFields = [
    ['Employee Name', slip.employeeName || '\u2014'],
    ['Designation', designation],
    ['Date of Joining', doj],
    ['Pay Period', payPeriodStr],
    ['Pay Date', payDateStr],
  ]
  const leftContentH = leftFields.length * 5.8 + 4
  const rightContentH = 30
  const summaryH = Math.max(leftContentH, rightContentH)
  const summaryY = y

  // Summary box border
  doc.setDrawColor(...C.primaryBorder)
  doc.setLineWidth(0.5)
  doc.roundedRect(mg, summaryY, cw, summaryH, 1.5, 1.5, 'S')
  doc.setFillColor(...C.primaryLight)
  doc.setGState(new GState({ opacity: 0.15 }))
  doc.rect(mg, summaryY, cw, summaryH, 'F')
  doc.setGState(new GState({ opacity: 1 }))

  // Left fields
  setFont(8, 'normal', C.mutedText)
  let ly = summaryY + (summaryH - leftContentH) / 2 + 4
  leftFields.forEach(([label, value]) => {
    doc.text(label as string, mg + 5, ly)
    setFont(8, 'normal', C.bodyText)
    doc.text(':', mg + 35, ly)
    doc.text(truncate(value as string, cw * 0.26), mg + 39, ly)
    setFont(8, 'normal', C.mutedText)
    ly += 5.8
  })

  // Net pay right side
  const rightX = mg + cw * 0.55
  const dividerTop = summaryY + 8
  const dividerBottom = summaryY + summaryH - 8
  doc.setDrawColor(...C.border)
  doc.setLineWidth(0.25)
  doc.line(rightX - 7, dividerTop, rightX - 7, dividerBottom)

  setFont(8, 'bold', C.mutedText)
  doc.text('EMPLOYEE NET PAY', rightX, summaryY + 12)

  const netStr = fmtMoney(net, c.currency, c.country)
  let netFontSize = 18 // ~48px
  const maxNetWidth = cw * 0.40
  while (netFontSize > 11) {
    doc.setFontSize(netFontSize)
    if (doc.getTextWidth(netStr) <= maxNetWidth) break
    netFontSize -= 1
  }
  doc.setFont('dejavu', 'bold')
  doc.setTextColor(...C.primaryDark)
  doc.text(netStr, pw - mg - 2, summaryY + 21, { align: 'right' })

  setFont(9, 'normal', C.bodyText)
  doc.setTextColor(...C.bodyText)
  doc.text(`Paid Days : ${paidDays}`, rightX, summaryY + 29)
  doc.text(`LOP Days : ${lopDays}`, rightX, summaryY + 34)

  y = summaryY + summaryH + SECTION_GAP

  // Earnings
  const earnings = [
    ['Basic', basic],
    hra > 0 ? ['House Rent Allowance', hra] : null,
    fixedAllow > 0 ? ['Fixed Allowance', fixedAllow] : null,
    (breakdown.leaveEncashment || 0) > 0 ? ['Leave Encashment', breakdown.leaveEncashment || 0] : null,
  ].filter((r): r is [string, number] => !!r)

  const deductionsList = [
    (breakdown.pf || 0) > 0 ? ['Provident Fund', breakdown.pf || 0] : null,
    tax > 0 ? ['Professional Tax', tax] : null,
    (breakdown.absentDeduction || 0) > 0 ? ['Absent Deduction', breakdown.absentDeduction || 0] : null,
    otherDed > 0 ? ['Other Deductions', otherDed] : null,
  ].filter((r): r is [string, number] => !!r)

  const hasDeductions = deductionsList.length > 0

  setFont(11, 'bold', C.primaryDark)
  doc.text('EARNINGS', mg, y)
  y += 5

  // Draw combined or earnings-only table
  if (hasDeductions) {
    const colWidths = [cw * 0.25, cw * 0.125, cw * 0.125, cw * 0.25, cw * 0.125, cw * 0.125]
    const rowCount = Math.max(earnings.length, deductionsList.length) + 1
    const tableH = HEADER_HEIGHT + rowCount * ROW_HEIGHT

    // Header
    doc.setFillColor(...C.primaryLight)
    doc.rect(mg, y, cw, HEADER_HEIGHT, 'F')
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.25)
    doc.rect(mg, y, cw, HEADER_HEIGHT, 'S')
    // Bottom strong border
    doc.setDrawColor(...C.borderStrong)
    doc.setLineWidth(0.4)
    doc.line(mg, y + HEADER_HEIGHT, mg + cw, y + HEADER_HEIGHT)
    setFont(8, 'bold', C.primaryDark)
    const headers = ['Earnings', 'Amount', 'YTD', 'Deductions', 'Amount', 'YTD']
    let hx = mg
    headers.forEach((h, i) => {
      const align = i === 0 || i === 3 ? 'left' : 'right'
      const x = align === 'left' ? hx + 3 : hx + colWidths[i] - 3
      doc.text(h, x, y + HEADER_HEIGHT / 2 + 1, { align })
      hx += colWidths[i]
    })

    // Rows
    const maxDataRows = rowCount - 1
    for (let i = 0; i < maxDataRows; i++) {
      const ry = y + HEADER_HEIGHT + i * ROW_HEIGHT
      doc.setFillColor(...(i % 2 === 0 ? C.white : C.rowAlt))
      doc.rect(mg, ry, cw, ROW_HEIGHT, 'F')
      doc.setDrawColor(...C.border)
      doc.setLineWidth(0.15)
      doc.line(mg, ry + ROW_HEIGHT, mg + cw, ry + ROW_HEIGHT)
      let vx = mg
      for (let j = 0; j < 5; j++) {
        vx += colWidths[j]
        doc.line(vx, ry, vx, ry + ROW_HEIGHT)
      }
      setFont(7.5, 'normal', C.bodyText)
      if (earnings[i]) {
        doc.text(truncate(earnings[i][0], colWidths[0] - 8), mg + 3, ry + ROW_HEIGHT / 2 + 1)
        const earnAmt = fmtMoney(earnings[i][1], c.currency, c.country)
        doc.text(truncate(earnAmt, colWidths[1] - 5), mg + colWidths[0] + colWidths[1] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' })
        doc.text(truncate(earnAmt, colWidths[2] - 5), mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' })
      }
      if (deductionsList[i]) {
        const dx = mg + colWidths[0] + colWidths[1] + colWidths[2]
        doc.text(truncate(deductionsList[i][0], colWidths[3] - 8), dx + 3, ry + ROW_HEIGHT / 2 + 1)
        const dedAmt = fmtMoney(deductionsList[i][1], c.currency, c.country)
        doc.text(truncate(dedAmt, colWidths[4] - 5), dx + colWidths[3] + colWidths[4] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' })
        doc.text(truncate(dedAmt, colWidths[5] - 5), dx + colWidths[3] + colWidths[4] + colWidths[5] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' })
      }
    }

    // Total row
    const totalY = y + HEADER_HEIGHT + maxDataRows * ROW_HEIGHT
    doc.setFillColor(...C.primaryLight)
    doc.rect(mg, totalY, cw, ROW_HEIGHT, 'F')
    doc.setDrawColor(...C.primary)
    doc.setLineWidth(0.5)
    doc.line(mg, totalY, mg + cw, totalY)
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.25)
    doc.line(mg, totalY + ROW_HEIGHT, mg + cw, totalY + ROW_HEIGHT)
    let vx = mg
    for (let j = 0; j < 5; j++) {
      vx += colWidths[j]
      doc.line(vx, totalY, vx, totalY + ROW_HEIGHT)
    }
    setFont(10, 'bold', C.headerText)
    doc.text('Gross Earnings', mg + 3, totalY + ROW_HEIGHT / 2 + 1.2)
    const grossAmt = fmtMoney(gross, c.currency, c.country)
    doc.text(truncate(grossAmt, colWidths[1] - 5), mg + colWidths[0] + colWidths[1] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' })
    doc.text(truncate(grossAmt, colWidths[2] - 5), mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' })
    const dx = mg + colWidths[0] + colWidths[1] + colWidths[2]
    doc.text('Total Deductions', dx + 3, totalY + ROW_HEIGHT / 2 + 1.2)
    const dedAmt = fmtMoney(deductions, c.currency, c.country)
    doc.text(truncate(dedAmt, colWidths[4] - 5), dx + colWidths[3] + colWidths[4] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' })
    doc.text(truncate(dedAmt, colWidths[5] - 5), dx + colWidths[3] + colWidths[4] + colWidths[5] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' })

    // Outer border
    doc.setDrawColor(...C.borderStrong)
    doc.setLineWidth(0.4)
    doc.rect(mg, y, cw, tableH, 'S')
    y += tableH + SECTION_GAP
  } else {
    // Earnings-only table
    const colWidths = [cw * 0.40, cw * 0.30, cw * 0.30]
    const rowCount = earnings.length + 1
    const tableW = cw * 0.70
    const tableH = HEADER_HEIGHT + rowCount * ROW_HEIGHT

    // Header
    doc.setFillColor(...C.primaryLight)
    doc.rect(mg, y, tableW, HEADER_HEIGHT, 'F')
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.25)
    doc.rect(mg, y, tableW, HEADER_HEIGHT, 'S')
    doc.setDrawColor(...C.borderStrong)
    doc.setLineWidth(0.4)
    doc.line(mg, y + HEADER_HEIGHT, mg + tableW, y + HEADER_HEIGHT)
    setFont(8, 'bold', C.primaryDark)
    doc.text('Earnings', mg + 3, y + HEADER_HEIGHT / 2 + 1)
    doc.text('Amount', mg + colWidths[0] + colWidths[1] - 3, y + HEADER_HEIGHT / 2 + 1, { align: 'right' })
    doc.text('YTD', mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, y + HEADER_HEIGHT / 2 + 1, { align: 'right' })

    // Rows
    for (let i = 0; i < earnings.length; i++) {
      const ry = y + HEADER_HEIGHT + i * ROW_HEIGHT
      doc.setFillColor(...(i % 2 === 0 ? C.white : C.rowAlt))
      doc.rect(mg, ry, tableW, ROW_HEIGHT, 'F')
      doc.setDrawColor(...C.border)
      doc.setLineWidth(0.15)
      doc.line(mg, ry + ROW_HEIGHT, mg + tableW, ry + ROW_HEIGHT)
      doc.line(mg + colWidths[0], ry, mg + colWidths[0], ry + ROW_HEIGHT)
      doc.line(mg + colWidths[0] + colWidths[1], ry, mg + colWidths[0] + colWidths[1], ry + ROW_HEIGHT)
      setFont(7.5, 'normal', C.bodyText)
      doc.text(truncate(earnings[i][0], colWidths[0] - 8), mg + 3, ry + ROW_HEIGHT / 2 + 1)
      const earnAmt = fmtMoney(earnings[i][1], c.currency, c.country)
      doc.text(truncate(earnAmt, colWidths[1] - 5), mg + colWidths[0] + colWidths[1] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' })
      doc.text(truncate(earnAmt, colWidths[2] - 5), mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' })
    }

    // Total row
    const totalY = y + HEADER_HEIGHT + earnings.length * ROW_HEIGHT
    doc.setFillColor(...C.primaryLight)
    doc.rect(mg, totalY, tableW, ROW_HEIGHT, 'F')
    doc.setDrawColor(...C.primary)
    doc.setLineWidth(0.5)
    doc.line(mg, totalY, mg + tableW, totalY)
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.25)
    doc.line(mg, totalY + ROW_HEIGHT, mg + tableW, totalY + ROW_HEIGHT)
    doc.line(mg + colWidths[0], totalY, mg + colWidths[0], totalY + ROW_HEIGHT)
    doc.line(mg + colWidths[0] + colWidths[1], totalY, mg + colWidths[0] + colWidths[1], totalY + ROW_HEIGHT)
    setFont(10, 'bold', C.headerText)
    doc.text('Gross Earnings', mg + 3, totalY + ROW_HEIGHT / 2 + 1.2)
    const grossAmt = fmtMoney(gross, c.currency, c.country)
    doc.text(truncate(grossAmt, colWidths[1] - 5), mg + colWidths[0] + colWidths[1] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' })
    doc.text(truncate(grossAmt, colWidths[2] - 5), mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' })

    // Outer border
    doc.setDrawColor(...C.borderStrong)
    doc.setLineWidth(0.4)
    doc.rect(mg, y, tableW, tableH, 'S')
    y += tableH + SECTION_GAP
  }

  // Net Pay Summary
  setFont(11, 'bold', C.primaryDark)
  doc.text('NET PAY', mg, y)
  y += 5

  const netRows = [
    ['Gross Earnings', gross],
    ['Total Deductions', deductions],
    ['Total Net Payable', net],
  ]
  const netH = netRows.length * NET_ROW_HEIGHT

  // Table with full borders
  doc.setDrawColor(...C.borderStrong)
  doc.setLineWidth(0.4)
  doc.rect(mg, y, cw, netH, 'S')
  doc.setDrawColor(...C.border)
  doc.setLineWidth(0.15)
  doc.line(mg, y + NET_ROW_HEIGHT, mg + cw, y + NET_ROW_HEIGHT)
  doc.line(mg, y + NET_ROW_HEIGHT * 2, mg + cw, y + NET_ROW_HEIGHT * 2)

  netRows.forEach(([label, amount], i) => {
    const ry = y + i * NET_ROW_HEIGHT + NET_ROW_HEIGHT / 2 + 1.5
    const isTotal = i === netRows.length - 1
    if (isTotal) {
      doc.setFillColor(...C.primaryLight)
      doc.rect(mg, y + i * NET_ROW_HEIGHT, cw, NET_ROW_HEIGHT, 'F')
      doc.setDrawColor(...C.primary)
      doc.setLineWidth(0.5)
      doc.line(mg, y + i * NET_ROW_HEIGHT, mg + cw, y + i * NET_ROW_HEIGHT)
    }
    setFont(isTotal ? 12 : 9.5, isTotal ? 'bold' : 'normal', isTotal ? C.headerText : C.bodyText)
    doc.text(label as string, mg + 4, ry)
    doc.text(fmtMoney(amount as number, c.currency, c.country), pw - mg - 4, ry, { align: 'right' })
  })

  y += netH + SECTION_GAP

  // Amount in words (no border)
  setFont(10, 'bold', C.headerText)
  const wordsLine = `Total Net Payable `
  const amountStr = fmtMoney(net, c.currency, c.country)
  const fullLine = wordsLine + amountStr
  const fullWidth = doc.getTextWidth(fullLine)
  const centerX = pw / 2
  doc.text(wordsLine, centerX - fullWidth / 2, y)
  doc.setTextColor(...C.primaryDark)
  doc.text(amountStr, centerX + fullWidth / 2, y, { align: 'right' })
  doc.setTextColor(...C.headerText)
  y += 4.5
  setFont(9, 'bold', C.headerText)
  doc.text(`(${numberToWords(net, c.currency, c.country)})`, pw / 2, y, { align: 'center' })
  y += 4.5
  setFont(8, 'normal', C.mutedText)
  doc.text('Total Net Payable = Gross Earnings \u2212 Total Deductions', pw / 2, y, { align: 'center' })
  y += SECTION_GAP

  // Footer at bottom
  const footerY = Math.max(y, ph - mg - 12)
  doc.setDrawColor(...C.primary)
  doc.setLineWidth(0.5)
  doc.line(mg, footerY, pw - mg, footerY)
  setFont(8, 'normal', C.footerText)
  doc.text('This document has been automatically generated by HRMAX Payroll System; therefore, a signature is not required.', pw / 2, footerY + 5, { align: 'center' })

  const filename = `payslip-${slip.employeeName?.replace(/\s+/g, '-').toLowerCase() || 'employee'}-${payPeriod}-${payYear}.pdf`
  doc.save(filename)
}

export const downloadPayrollItemPdf = (
  item: {
    employeeName: string; employeeId: string; department: string; employeeEmail: string;
    workingDays: number; presentDays: number; paidLeaveDays: number; unpaidLeaveDays: number;
    holidayDays: number; overtimeHours: number;
    basicSalary: number; hra: number; da: number; conveyance: number; medical: number;
    specialAllowance: number; grossSalary: number; earnedGross: number; overtimePay: number;
    pf: number; professionalTax: number; otherDeductions: number;
    totalEarnings: number; totalDeductions: number; netSalary: number;
    leaveEncashment?: number; absentDeduction?: number;
  },
  month: string,
  year: number,
  companyName: string = '',
  companyAddress?: string,
  extraOptions?: Partial<PayslipOptions>
) => {
  const slip: SalarySlip = {
    id: '',
    userId: '',
    employeeName: item.employeeName,
    employeeEmail: item.employeeEmail,
    avatar: '',
    employeeId: item.employeeId,
    department: item.department,
    departmentColor: '',
    month,
    year,
    basicSalary: item.basicSalary,
    allowances: item.hra + item.da + item.conveyance + item.medical + item.specialAllowance,
    deductions: item.pf + item.professionalTax + item.otherDeductions,
    netSalary: item.netSalary,
    status: 'Paid',
    paidOn: new Date(),
    companyId: '',
    breakdown: {
      hra: item.hra,
      da: item.da,
      pf: item.pf,
      tax: item.professionalTax,
      otherDeductions: item.otherDeductions,
      ...(item.leaveEncashment ? { leaveEncashment: item.leaveEncashment } : {}),
      ...(item.absentDeduction ? { absentDeduction: item.absentDeduction } : {}),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any

  const s = slip as any
  s.workingDays = item.workingDays
  s.presentDays = item.presentDays
  s.lopDays = item.unpaidLeaveDays || 0
  s.paidDays = item.workingDays - (item.unpaidLeaveDays || 0)
  s.designation = item.department

  const opts: PayslipOptions = { companyName, companyAddress, ...extraOptions }
  downloadPayslipPdf(slip, opts)
}
