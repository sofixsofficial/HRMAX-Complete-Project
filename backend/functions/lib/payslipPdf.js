"use strict";
/**
 * SERVER-SIDE SALARY-SLIP PDF GENERATOR (jsPDF)
 * =============================================
 * UNIFIED PDF GENERATOR â€” this file is the SAME rendering implementation used by
 * the working "Download/Print salary slip" action in the frontend
 * (frontend/src/utils/payslipPdf.ts). The payroll-email attachment is produced
 * by this exact code path (jsPDF, embedded DejaVu Sans Condensed Unicode font,
 * A4), so the downloadable salary slip and the emailed attachment are rendered
 * identically.
 *
 * KEEP IN SYNC: the drawing/layout code below mirrors
 * frontend/src/utils/payslipPdf.ts verbatim. Only the wrapper differs:
 *   - runs on Node and RETURNS a Buffer instead of calling doc.save()
 *   - accepts `any` slip/company shapes (no frontend type dependencies)
 *   - company logo rendering is skipped (no <img> in Node); logo is not passed
 *     for email attachments
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSalarySlipPdf = generateSalarySlipPdf;
const jspdf_1 = require("jspdf");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Embedded Unicode font (OFL, DejaVu Sans Condensed — metric-equivalent to
// Helvetica) so the rupee sign (U+20B9), em-dash (U+2014) and non-ASCII names
// render correctly in every PDF viewer. jsPDF's built-in Helvetica is limited
// to WinAnsiEncoding, which cannot represent U+20B9 (it degrades to a '1').
let fontData = null;
const loadFontData = () => {
    if (fontData)
        return fontData;
    const dir = path.join(__dirname, '..', 'fonts');
    fontData = {
        regular: fs.readFileSync(path.join(dir, 'DejaVuSansCondensed.ttf')).toString('base64'),
        bold: fs.readFileSync(path.join(dir, 'DejaVuSansCondensed-Bold.ttf')).toString('base64'),
    };
    return fontData;
};
const ensureFonts = (doc) => {
    const fonts = loadFontData();
    doc.addFileToVFS('DejaVuSansCondensed.ttf', fonts.regular);
    doc.addFileToVFS('DejaVuSansCondensed-Bold.ttf', fonts.bold);
    doc.addFont('DejaVuSansCondensed.ttf', 'dejavu', 'normal');
    doc.addFont('DejaVuSansCondensed-Bold.ttf', 'dejavu', 'bold');
};
const C = {
    white: [255, 255, 255],
    primary: [249, 115, 22],
    primaryDark: [234, 88, 12],
    primaryLight: [255, 247, 237],
    primaryBorder: [253, 186, 116],
    border: [214, 214, 214],
    borderStrong: [191, 197, 204],
    headerText: [17, 24, 39],
    bodyText: [55, 65, 81],
    mutedText: [107, 114, 128],
    footerText: [156, 163, 175],
    rowAlt: [252, 252, 252],
};
const PAGE_MARGIN = 14;
const ROW_HEIGHT = 10.6;
const HEADER_HEIGHT = 11.1;
const NET_ROW_HEIGHT = 11;
const SECTION_GAP = 12;
const fmtMoney = (n, _currency, _country) => {
    const f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `\u20B9 ${f.format(n || 0)}`;
};
const numberToWords = (num, _currency, _country) => {
    if (num === 0)
        return `Indian Rupees Zero Only`;
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const convert = (n) => {
        if (n < 20)
            return ones[n];
        if (n < 100)
            return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
        if (n < 1000)
            return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
        if (n < 100000)
            return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
        if (n < 10000000)
            return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
        return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
    };
    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);
    let result = `Indian Rupees ${convert(rupees)}`;
    if (paise > 0)
        result += ` and ${convert(paise)} Paise`;
    return result + ' Only';
};
const safeDate = (value) => {
    if (!value)
        return null;
    if (value instanceof Date)
        return value;
    if (typeof value.toDate === 'function')
        return value.toDate();
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
};
const formatDate = (value) => {
    const d = safeDate(value);
    if (!d)
        return '\u2014';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
/** Generate the salary-slip PDF as a Buffer â€” identical to the frontend
 *  "Download/Print salary slip". Accepts the slip/company shapes produced by
 *  the payroll dispatch (any). */
async function generateSalarySlipPdf(slip, options = {}) {
    const c = {
        name: options.companyName || '',
        address: options.companyAddress || '',
        city: options.companyCity || '',
        state: options.companyState || '',
        country: options.companyCountry || '',
        zip: options.companyZip || '',
        logo: options.companyLogo || '',
        currency: options.companyCurrency || 'INR',
    };
    const breakdown = slip.breakdown || { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0 };
    const basic = slip.basicSalary || 0;
    const hra = breakdown.hra || 0;
    const da = breakdown.da || 0;
    const tax = breakdown.tax || 0;
    const otherDed = breakdown.otherDeductions || 0;
    const allowances = slip.allowances || 0;
    const deductions = slip.deductions || (tax + otherDed + breakdown.pf);
    const net = slip.netSalary || 0;
    const gross = basic + allowances + (breakdown.leaveEncashment || 0);
    const fixedAllow = Math.max(0, allowances - hra - da);
    const paidOn = safeDate(slip.paidOn) || new Date();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const payPeriod = slip.month || monthNames[paidOn.getMonth()];
    const payYear = slip.year || paidOn.getFullYear();
    const payDateStr = formatDate(slip.paidOn);
    const workingDays = slip.workingDays || 30;
    const lopDays = slip.lopDays || 0;
    const paidDays = slip.paidDays || (workingDays - lopDays);
    const designation = slip.designation || '\u2014';
    const doj = formatDate(slip.dateOfJoining);
    const payPeriodStr = `${payPeriod} ${payYear}`;
    const doc = new jspdf_1.jsPDF({ unit: 'mm', format: 'a4' });
    ensureFonts(doc);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const mg = PAGE_MARGIN;
    const cw = pw - mg * 2;
    let y = mg;
    const setFont = (size, weight = 'normal', color = C.bodyText) => {
        doc.setFontSize(size);
        doc.setFont('dejavu', weight);
        doc.setTextColor(...color);
    };
    const truncate = (text, maxWidth) => {
        let t = text;
        while (doc.getTextWidth(t) > maxWidth && t.length > 1)
            t = t.slice(0, -1);
        if (t !== text && t.length > 3)
            t = t.slice(0, -3) + '...';
        return t;
    };
    // Logo on left (skipped in Node â€” no <img>; logo is not passed for email attachments)
    const ImgCtor = globalThis.Image;
    if (c.logo && c.logo.startsWith('data:') && typeof ImgCtor !== 'undefined') {
        try {
            const img = new ImgCtor();
            img.src = c.logo;
            const maxW = 22;
            const aspect = img.width / img.height || 1;
            const w = aspect > 1 ? maxW : maxW * aspect;
            const h = aspect > 1 ? maxW / aspect : maxW;
            const format = c.logo.includes('data:image/png') ? 'PNG' : 'JPEG';
            doc.addImage(c.logo, format, mg, y, w, h);
        }
        catch { /* ignore */ }
    }
    // Header left: company info
    setFont(10, 'bold', C.headerText);
    doc.text(truncate(c.name, cw * 0.60), mg, y + 14);
    const addressLine = [c.address, c.city, c.state, c.country].filter(Boolean).join(', ');
    if (addressLine) {
        setFont(8, 'normal', C.bodyText);
        doc.text(truncate(addressLine, cw * 0.60), mg, y + 18);
    }
    // Header right: HRMAX brand
    setFont(15, 'bold', C.primary);
    doc.text('HRMAX', pw - mg, y + 5, { align: 'right' });
    setFont(7, 'normal', C.mutedText);
    doc.text('Payroll Management System', pw - mg, y + 9, { align: 'right' });
    y += 24;
    // Orange divider
    doc.setDrawColor(...C.primary);
    doc.setLineWidth(0.7);
    doc.line(mg, y, pw - mg, y);
    y += SECTION_GAP;
    // Title
    setFont(17, 'bold', C.headerText);
    doc.text(`Payslip for the month of ${payPeriod} ${payYear}`, mg, y);
    y += 4;
    doc.setFillColor(...C.primary);
    doc.rect(mg, y, 26.4, 0.8, 'F');
    y += SECTION_GAP - 2;
    // Employee Pay Summary
    setFont(11, 'bold', C.primaryDark);
    doc.text('EMPLOYEE PAY SUMMARY', mg, y);
    y += 5;
    const leftFields = [
        ['Employee Name', slip.employeeName || '\u2014'],
        ['Designation', designation],
        ['Date of Joining', doj],
        ['Pay Period', payPeriodStr],
        ['Pay Date', payDateStr],
    ];
    const leftContentH = leftFields.length * 5.8 + 4;
    const rightContentH = 30;
    const summaryH = Math.max(leftContentH, rightContentH);
    const summaryY = y;
    // Summary box border
    doc.setDrawColor(...C.primaryBorder);
    doc.setLineWidth(0.5);
    doc.roundedRect(mg, summaryY, cw, summaryH, 1.5, 1.5, 'S');
    // Fill: primaryLight at alpha 0.15 over white (the browser build uses
    // doc.setAlpha(0.15); the Node build has no setAlpha, so blend to the same
    // visible color: 0.15*[255,247,237] + 0.85*[255,255,255] = [255,254,252]).
    if (typeof doc.setAlpha === 'function') {
        ;
        doc.setAlpha(0.15);
        doc.setFillColor(...C.primaryLight);
        doc.rect(mg, summaryY, cw, summaryH, 'F');
        doc.setAlpha(1);
    }
    else {
        doc.setFillColor(255, 254, 252);
        doc.rect(mg, summaryY, cw, summaryH, 'F');
    }
    // Left fields
    setFont(8, 'normal', C.mutedText);
    let ly = summaryY + (summaryH - leftContentH) / 2 + 4;
    leftFields.forEach(([label, value]) => {
        doc.text(label, mg + 5, ly);
        setFont(8, 'normal', C.bodyText);
        doc.text(':', mg + 35, ly);
        doc.text(truncate(value, cw * 0.26), mg + 39, ly);
        setFont(8, 'normal', C.mutedText);
        ly += 5.8;
    });
    // Net pay right side
    const rightX = mg + cw * 0.55;
    const dividerTop = summaryY + 8;
    const dividerBottom = summaryY + summaryH - 8;
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.25);
    doc.line(rightX - 7, dividerTop, rightX - 7, dividerBottom);
    setFont(8, 'bold', C.mutedText);
    doc.text('EMPLOYEE NET PAY', rightX, summaryY + 12);
    const netStr = fmtMoney(net, c.currency, c.country);
    let netFontSize = 18; // ~48px
    const maxNetWidth = cw * 0.40;
    while (netFontSize > 11) {
        doc.setFontSize(netFontSize);
        if (doc.getTextWidth(netStr) <= maxNetWidth)
            break;
        netFontSize -= 1;
    }
    doc.setFont('dejavu', 'bold');
    doc.setTextColor(...C.primaryDark);
    doc.text(netStr, pw - mg - 2, summaryY + 21, { align: 'right' });
    setFont(9, 'normal', C.bodyText);
    doc.setTextColor(...C.bodyText);
    doc.text(`Paid Days : ${paidDays}`, rightX, summaryY + 29);
    doc.text(`LOP Days : ${lopDays}`, rightX, summaryY + 34);
    y = summaryY + summaryH + SECTION_GAP;
    // Earnings
    const earnings = [
        ['Basic', basic],
        hra > 0 ? ['House Rent Allowance', hra] : null,
        fixedAllow > 0 ? ['Fixed Allowance', fixedAllow] : null,
        (breakdown.leaveEncashment || 0) > 0 ? ['Leave Encashment', breakdown.leaveEncashment || 0] : null,
    ].filter((r) => !!r);
    const deductionsList = [
        (breakdown.pf || 0) > 0 ? ['Provident Fund', breakdown.pf || 0] : null,
        tax > 0 ? ['Professional Tax', tax] : null,
        (breakdown.absentDeduction || 0) > 0 ? ['Absent Deduction', breakdown.absentDeduction || 0] : null,
        otherDed > 0 ? ['Other Deductions', otherDed] : null,
    ].filter((r) => !!r);
    const hasDeductions = deductionsList.length > 0;
    setFont(11, 'bold', C.primaryDark);
    doc.text('EARNINGS', mg, y);
    y += 5;
    // Draw combined or earnings-only table
    if (hasDeductions) {
        const colWidths = [cw * 0.25, cw * 0.125, cw * 0.125, cw * 0.25, cw * 0.125, cw * 0.125];
        const rowCount = Math.max(earnings.length, deductionsList.length) + 1;
        const tableH = HEADER_HEIGHT + rowCount * ROW_HEIGHT;
        // Header
        doc.setFillColor(...C.primaryLight);
        doc.rect(mg, y, cw, HEADER_HEIGHT, 'F');
        doc.setDrawColor(...C.border);
        doc.setLineWidth(0.25);
        doc.rect(mg, y, cw, HEADER_HEIGHT, 'S');
        // Bottom strong border
        doc.setDrawColor(...C.borderStrong);
        doc.setLineWidth(0.4);
        doc.line(mg, y + HEADER_HEIGHT, mg + cw, y + HEADER_HEIGHT);
        setFont(8, 'bold', C.primaryDark);
        const headers = ['Earnings', 'Amount', 'YTD', 'Deductions', 'Amount', 'YTD'];
        let hx = mg;
        headers.forEach((h, i) => {
            const align = i === 0 || i === 3 ? 'left' : 'right';
            const x = align === 'left' ? hx + 3 : hx + colWidths[i] - 3;
            doc.text(h, x, y + HEADER_HEIGHT / 2 + 1, { align });
            hx += colWidths[i];
        });
        // Rows
        const maxDataRows = rowCount - 1;
        for (let i = 0; i < maxDataRows; i++) {
            const ry = y + HEADER_HEIGHT + i * ROW_HEIGHT;
            doc.setFillColor(...(i % 2 === 0 ? C.white : C.rowAlt));
            doc.rect(mg, ry, cw, ROW_HEIGHT, 'F');
            doc.setDrawColor(...C.border);
            doc.setLineWidth(0.15);
            doc.line(mg, ry + ROW_HEIGHT, mg + cw, ry + ROW_HEIGHT);
            let vx = mg;
            for (let j = 0; j < 5; j++) {
                vx += colWidths[j];
                doc.line(vx, ry, vx, ry + ROW_HEIGHT);
            }
            setFont(7.5, 'normal', C.bodyText);
            if (earnings[i]) {
                doc.text(truncate(earnings[i][0], colWidths[0] - 8), mg + 3, ry + ROW_HEIGHT / 2 + 1);
                const earnAmt = fmtMoney(earnings[i][1], c.currency, c.country);
                doc.text(truncate(earnAmt, colWidths[1] - 5), mg + colWidths[0] + colWidths[1] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' });
                doc.text(truncate(earnAmt, colWidths[2] - 5), mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' });
            }
            if (deductionsList[i]) {
                const dx = mg + colWidths[0] + colWidths[1] + colWidths[2];
                doc.text(truncate(deductionsList[i][0], colWidths[3] - 8), dx + 3, ry + ROW_HEIGHT / 2 + 1);
                const dedAmt = fmtMoney(deductionsList[i][1], c.currency, c.country);
                doc.text(truncate(dedAmt, colWidths[4] - 5), dx + colWidths[3] + colWidths[4] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' });
                doc.text(truncate(dedAmt, colWidths[5] - 5), dx + colWidths[3] + colWidths[4] + colWidths[5] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' });
            }
        }
        // Total row
        const totalY = y + HEADER_HEIGHT + maxDataRows * ROW_HEIGHT;
        doc.setFillColor(...C.primaryLight);
        doc.rect(mg, totalY, cw, ROW_HEIGHT, 'F');
        doc.setDrawColor(...C.primary);
        doc.setLineWidth(0.5);
        doc.line(mg, totalY, mg + cw, totalY);
        doc.setDrawColor(...C.border);
        doc.setLineWidth(0.25);
        doc.line(mg, totalY + ROW_HEIGHT, mg + cw, totalY + ROW_HEIGHT);
        let vx = mg;
        for (let j = 0; j < 5; j++) {
            vx += colWidths[j];
            doc.line(vx, totalY, vx, totalY + ROW_HEIGHT);
        }
        setFont(10, 'bold', C.headerText);
        doc.text('Gross Earnings', mg + 3, totalY + ROW_HEIGHT / 2 + 1.2);
        const grossAmt = fmtMoney(gross, c.currency, c.country);
        doc.text(truncate(grossAmt, colWidths[1] - 5), mg + colWidths[0] + colWidths[1] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' });
        doc.text(truncate(grossAmt, colWidths[2] - 5), mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' });
        const dx = mg + colWidths[0] + colWidths[1] + colWidths[2];
        doc.text('Total Deductions', dx + 3, totalY + ROW_HEIGHT / 2 + 1.2);
        const dedAmt = fmtMoney(deductions, c.currency, c.country);
        doc.text(truncate(dedAmt, colWidths[4] - 5), dx + colWidths[3] + colWidths[4] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' });
        doc.text(truncate(dedAmt, colWidths[5] - 5), dx + colWidths[3] + colWidths[4] + colWidths[5] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' });
        // Outer border
        doc.setDrawColor(...C.borderStrong);
        doc.setLineWidth(0.4);
        doc.rect(mg, y, cw, tableH, 'S');
        y += tableH + SECTION_GAP;
    }
    else {
        // Earnings-only table
        const colWidths = [cw * 0.40, cw * 0.30, cw * 0.30];
        const rowCount = earnings.length + 1;
        const tableW = cw * 0.70;
        const tableH = HEADER_HEIGHT + rowCount * ROW_HEIGHT;
        // Header
        doc.setFillColor(...C.primaryLight);
        doc.rect(mg, y, tableW, HEADER_HEIGHT, 'F');
        doc.setDrawColor(...C.border);
        doc.setLineWidth(0.25);
        doc.rect(mg, y, tableW, HEADER_HEIGHT, 'S');
        doc.setDrawColor(...C.borderStrong);
        doc.setLineWidth(0.4);
        doc.line(mg, y + HEADER_HEIGHT, mg + tableW, y + HEADER_HEIGHT);
        setFont(8, 'bold', C.primaryDark);
        doc.text('Earnings', mg + 3, y + HEADER_HEIGHT / 2 + 1);
        doc.text('Amount', mg + colWidths[0] + colWidths[1] - 3, y + HEADER_HEIGHT / 2 + 1, { align: 'right' });
        doc.text('YTD', mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, y + HEADER_HEIGHT / 2 + 1, { align: 'right' });
        // Rows
        for (let i = 0; i < earnings.length; i++) {
            const ry = y + HEADER_HEIGHT + i * ROW_HEIGHT;
            doc.setFillColor(...(i % 2 === 0 ? C.white : C.rowAlt));
            doc.rect(mg, ry, tableW, ROW_HEIGHT, 'F');
            doc.setDrawColor(...C.border);
            doc.setLineWidth(0.15);
            doc.line(mg, ry + ROW_HEIGHT, mg + tableW, ry + ROW_HEIGHT);
            doc.line(mg + colWidths[0], ry, mg + colWidths[0], ry + ROW_HEIGHT);
            doc.line(mg + colWidths[0] + colWidths[1], ry, mg + colWidths[0] + colWidths[1], ry + ROW_HEIGHT);
            setFont(7.5, 'normal', C.bodyText);
            doc.text(truncate(earnings[i][0], colWidths[0] - 8), mg + 3, ry + ROW_HEIGHT / 2 + 1);
            const earnAmt = fmtMoney(earnings[i][1], c.currency, c.country);
            doc.text(truncate(earnAmt, colWidths[1] - 5), mg + colWidths[0] + colWidths[1] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' });
            doc.text(truncate(earnAmt, colWidths[2] - 5), mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, ry + ROW_HEIGHT / 2 + 1, { align: 'right' });
        }
        // Total row
        const totalY = y + HEADER_HEIGHT + earnings.length * ROW_HEIGHT;
        doc.setFillColor(...C.primaryLight);
        doc.rect(mg, totalY, tableW, ROW_HEIGHT, 'F');
        doc.setDrawColor(...C.primary);
        doc.setLineWidth(0.5);
        doc.line(mg, totalY, mg + tableW, totalY);
        doc.setDrawColor(...C.border);
        doc.setLineWidth(0.25);
        doc.line(mg, totalY + ROW_HEIGHT, mg + tableW, totalY + ROW_HEIGHT);
        doc.line(mg + colWidths[0], totalY, mg + colWidths[0], totalY + ROW_HEIGHT);
        doc.line(mg + colWidths[0] + colWidths[1], totalY, mg + colWidths[0] + colWidths[1], totalY + ROW_HEIGHT);
        setFont(10, 'bold', C.headerText);
        doc.text('Gross Earnings', mg + 3, totalY + ROW_HEIGHT / 2 + 1.2);
        const grossAmt = fmtMoney(gross, c.currency, c.country);
        doc.text(truncate(grossAmt, colWidths[1] - 5), mg + colWidths[0] + colWidths[1] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' });
        doc.text(truncate(grossAmt, colWidths[2] - 5), mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, totalY + ROW_HEIGHT / 2 + 1.2, { align: 'right' });
        // Outer border
        doc.setDrawColor(...C.borderStrong);
        doc.setLineWidth(0.4);
        doc.rect(mg, y, tableW, tableH, 'S');
        y += tableH + SECTION_GAP;
    }
    // Net Pay Summary
    setFont(11, 'bold', C.primaryDark);
    doc.text('NET PAY', mg, y);
    y += 5;
    const netRows = [
        ['Gross Earnings', gross],
        ['Total Deductions', deductions],
        ['Total Net Payable', net],
    ];
    const netH = netRows.length * NET_ROW_HEIGHT;
    // Table with full borders
    doc.setDrawColor(...C.borderStrong);
    doc.setLineWidth(0.4);
    doc.rect(mg, y, cw, netH, 'S');
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.15);
    doc.line(mg, y + NET_ROW_HEIGHT, mg + cw, y + NET_ROW_HEIGHT);
    doc.line(mg, y + NET_ROW_HEIGHT * 2, mg + cw, y + NET_ROW_HEIGHT * 2);
    netRows.forEach(([label, amount], i) => {
        const ry = y + i * NET_ROW_HEIGHT + NET_ROW_HEIGHT / 2 + 1.5;
        const isTotal = i === netRows.length - 1;
        if (isTotal) {
            doc.setFillColor(...C.primaryLight);
            doc.rect(mg, y + i * NET_ROW_HEIGHT, cw, NET_ROW_HEIGHT, 'F');
            doc.setDrawColor(...C.primary);
            doc.setLineWidth(0.5);
            doc.line(mg, y + i * NET_ROW_HEIGHT, mg + cw, y + i * NET_ROW_HEIGHT);
        }
        setFont(isTotal ? 12 : 9.5, isTotal ? 'bold' : 'normal', isTotal ? C.headerText : C.bodyText);
        doc.text(label, mg + 4, ry);
        doc.text(fmtMoney(amount, c.currency, c.country), pw - mg - 4, ry, { align: 'right' });
    });
    y += netH + SECTION_GAP;
    // Amount in words (no border)
    setFont(10, 'bold', C.headerText);
    const wordsLine = `Total Net Payable `;
    const amountStr = fmtMoney(net, c.currency, c.country);
    const fullLine = wordsLine + amountStr;
    const fullWidth = doc.getTextWidth(fullLine);
    const centerX = pw / 2;
    doc.text(wordsLine, centerX - fullWidth / 2, y);
    doc.setTextColor(...C.primaryDark);
    doc.text(amountStr, centerX + fullWidth / 2, y, { align: 'right' });
    doc.setTextColor(...C.headerText);
    y += 4.5;
    setFont(9, 'bold', C.headerText);
    doc.text(`(${numberToWords(net, c.currency, c.country)})`, pw / 2, y, { align: 'center' });
    y += 4.5;
    setFont(8, 'normal', C.mutedText);
    doc.text('Total Net Payable = Gross Earnings \u2212 Total Deductions', pw / 2, y, { align: 'center' });
    y += SECTION_GAP;
    // Footer at bottom
    const footerY = Math.max(y, ph - mg - 12);
    doc.setDrawColor(...C.primary);
    doc.setLineWidth(0.5);
    doc.line(mg, footerY, pw - mg, footerY);
    setFont(8, 'normal', C.footerText);
    doc.text('This document has been automatically generated by HRMAX Payroll System; therefore, a signature is not required.', pw / 2, footerY + 5, { align: 'center' });
    return Buffer.from(doc.output('arraybuffer'));
}
//# sourceMappingURL=payslipPdf.js.map