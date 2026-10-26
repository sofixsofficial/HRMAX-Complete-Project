import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { cacheDirectory, moveAsync } from 'expo-file-system/legacy';
import type { SalarySlip } from '../types/user';
import type { PayslipOptions } from './payslipOptions';

const fmtMoney = (n: number) => {
  const f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `\u20B9 ${f.format(n || 0)}`;
};

const numberToWords = (num: number): string => {
  if (num === 0) return 'Indian Rupees Zero Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const convert = (n: number): string => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  };
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let result = `Indian Rupees ${convert(rupees)}`;
  if (paise > 0) result += ` and ${convert(paise)} Paise`;
  return result + ' Only';
};

const safeDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

const formatDate = (value: any): string => {
  const d = safeDate(value);
  if (!d) return '\u2014';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const escapeHtml = (text: string) =>
  text?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') || '';

export const generatePayslipPdf = async (slip: SalarySlip, options: PayslipOptions = {}): Promise<void> => {
  const c = {
    name: options.companyName || '',
    address: options.companyAddress || '',
    city: options.companyCity || '',
    state: options.companyState || '',
    country: options.companyCountry || '',
    logo: options.companyLogo || '',
  };

  const breakdown = slip.breakdown || { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0 };
  const basic = slip.basicSalary || 0;
  const hra = breakdown.hra || 0;
  const da = breakdown.da || 0;
  const tax = breakdown.tax || 0;
  const otherDed = breakdown.otherDeductions || 0;
  const overtime = breakdown.overtimePay || 0;
  const allowances = slip.allowances || 0;
  // Total must equal the itemised rows above it, absent deduction included -
  // the fallback used to drop it and the footer disagreed with the lines.
  const deductions = slip.deductions ||
    (tax + otherDed + (breakdown.pf || 0) + (breakdown.absentDeduction || 0));
  const net = slip.netSalary || 0;
  const gross = basic + allowances + (breakdown.leaveEncashment || 0) + overtime;
  const fixedAllow = Math.max(0, allowances - hra - da);

  const paidOn = safeDate(slip.paidOn) || new Date();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const payPeriod = slip.month || monthNames[paidOn.getMonth()];
  const payYear = slip.year || paidOn.getFullYear();
  const payDateStr = formatDate(slip.paidOn);

  const workingDays = (slip as any).workingDays || 30;
  const lopDays = (slip as any).lopDays || 0;
  const paidDays = (slip as any).paidDays || (workingDays - lopDays);

  const designation = escapeHtml((slip as any).designation || '\u2014');
  const doj = formatDate((slip as any).dateOfJoining);
  const employeeName = escapeHtml(slip.employeeName || '\u2014');

  const earnings: [string, number][] = [
    ['Basic', basic],
    hra > 0 ? ['House Rent Allowance', hra] : null,
    da > 0 ? ['Dearness Allowance', da] : null,
    fixedAllow > 0 ? ['Fixed Allowance', fixedAllow] : null,
    overtime > 0 ? ['Overtime Pay', overtime] : null,
    (breakdown.leaveEncashment || 0) > 0 ? ['Leave Encashment', breakdown.leaveEncashment || 0] : null,
  ].filter((r): r is [string, number] => !!r);

  const deductionsList: [string, number][] = [
    (breakdown.pf || 0) > 0 ? ['Provident Fund', breakdown.pf || 0] : null,
    tax > 0 ? ['Professional Tax', tax] : null,
    (breakdown.absentDeduction || 0) > 0 ? ['Absent Deduction', breakdown.absentDeduction || 0] : null,
    otherDed > 0 ? ['Other Deductions', otherDed] : null,
  ].filter((r): r is [string, number] => !!r);

  const hasDeductions = deductionsList.length > 0;

  let tableRowsHtml = '';
  const maxRows = Math.max(earnings.length, hasDeductions ? deductionsList.length : 0);
  for (let i = 0; i < maxRows; i++) {
    const earn = earnings[i] || (['', 0] as [string, number]);
    const ded = hasDeductions ? deductionsList[i] || (['', 0] as [string, number]) : (['', 0] as [string, number]);
    if (hasDeductions) {
      tableRowsHtml += `
        <tr>
          <td class="desc">${earn[0]}</td>
          <td class="amt currency">${fmtMoney(earn[1])}</td>
          <td class="amt currency">${fmtMoney(earn[1])}</td>
          <td class="desc">${ded[0]}</td>
          <td class="amt currency">${fmtMoney(ded[1])}</td>
          <td class="amt currency">${fmtMoney(ded[1])}</td>
        </tr>`;
    } else {
      tableRowsHtml += `
        <tr>
          <td class="desc">${earn[0]}</td>
          <td class="amt currency">${fmtMoney(earn[1])}</td>
          <td class="amt currency">${fmtMoney(earn[1])}</td>
        </tr>`;
    }
  }

  const addressLine = [c.address, c.city, c.state, c.country].filter(Boolean).join(', ');
  const logoHtml = c.logo ? `<img src="${c.logo}" class="company-logo" alt="logo" />` : '';

  const combinedTableHeader = hasDeductions
    ? `<tr><th>Earnings</th><th class="amt">Amount</th><th class="amt">YTD</th><th>Deductions</th><th class="amt">Amount</th><th class="amt">YTD</th></tr>`
    : `<tr><th>Earnings</th><th class="amt">Amount</th><th class="amt">YTD</th></tr>`;

  const combinedTableFooter = hasDeductions
    ? `<tr class="total-row"><td class="desc">Gross Earnings</td><td class="amt currency">${fmtMoney(gross)}</td><td class="amt currency">${fmtMoney(gross)}</td><td class="desc">Total Deductions</td><td class="amt currency">${fmtMoney(deductions)}</td><td class="amt currency">${fmtMoney(deductions)}</td></tr>`
    : `<tr class="total-row"><td class="desc">Gross Earnings</td><td class="amt currency">${fmtMoney(gross)}</td><td class="amt currency">${fmtMoney(gross)}</td></tr>`;

  const combinedTableClass = hasDeductions ? 'combined-table' : 'earnings-only-table';
  const tableColgroup = hasDeductions
    ? `<colgroup><col style="width:24%"><col style="width:13%"><col style="width:13%"><col style="width:24%"><col style="width:13%"><col style="width:13%"></colgroup>`
    : `<colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payslip - ${employeeName} - ${payPeriod} ${payYear}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #F97316;
      --primary-dark: #EA580C;
      --primary-light: #FFF7ED;
      --border: #D6D6D6;
      --border-strong: #BFC5CC;
      --header-bg: #FFF7ED;
      --text: #111827;
      --text-secondary: #374151;
      --muted: #6B7280;
      --footer-text: #9CA3AF;
      --bg: #FFFFFF;
      --row-alt: #FCFCFC;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
      line-height: 1.45;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 18mm 20mm;
      background: var(--bg);
      display: flex;
      flex-direction: column;
    }
    .content { flex: 1; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid var(--primary);
    }
    .header-left { flex: 1; min-width: 0; }
    .brand-right {
      flex: 1; min-width: 0; text-align: right;
      display: flex; flex-direction: column; align-items: flex-end;
    }
    .brand-name { font-size: 20px; font-weight: 800; color: var(--primary); }
    .brand-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .company-name { font-size: 15px; font-weight: 700; color: var(--text); margin-top: 6px; }
    .company-address { font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin-top: 2px; }
    .company-logo { width: auto; max-width: 80px; max-height: 40px; object-fit: contain; margin-bottom: 6px; }
    .title-wrap { text-align: left; padding: 22px 0 16px; }
    .title { font-size: 26px; font-weight: 700; color: var(--text); }
    .title-line { width: 100px; height: 3px; background: var(--primary); border-radius: 50px; margin: 10px 0 0; }
    .section-title {
      font-size: 15px; font-weight: 700; color: var(--primary-dark);
      text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.3px;
    }
    .summary-box {
      border: 2px solid #FDBA74; background: #FFFDFB; padding: 22px;
      display: flex; justify-content: space-between; align-items: center;
      gap: 40px; margin-bottom: 18px;
    }
    .summary-left { width: 50%; display: grid; grid-template-columns: auto 1fr; gap: 7px 14px; font-size: 13px; }
    .summary-left .label { color: var(--muted); }
    .summary-left .value { color: var(--text-secondary); font-weight: 500; }
    .summary-divider { width: 1px; background: var(--border); align-self: stretch; min-height: 120px; }
    .summary-right { width: 50%; text-align: right; padding-left: 18px; align-self: center; }
    .summary-right .label { font-size: 12px; color: var(--muted); margin-bottom: 6px; text-transform: uppercase; font-weight: 600; }
    .summary-right .net-pay {
      font-size: 36px; font-weight: 800; color: var(--primary-dark);
      line-height: 1; white-space: nowrap; margin-bottom: 10px;
    }
    .summary-right .days { font-size: 13px; color: var(--text-secondary); line-height: 1.7; }
    table {
      width: 100%; border-collapse: collapse; table-layout: fixed;
      font-size: 13px; margin-bottom: 18px; border: 1.5px solid var(--border-strong);
    }
    th, td { padding: 11px 12px; border: 1px solid var(--border); text-align: left; vertical-align: middle; }
    th {
      background: var(--header-bg); color: var(--primary-dark); font-weight: 700;
      text-transform: uppercase; font-size: 12px; letter-spacing: 0.3px;
      padding: 10px 12px; border-bottom: 1.5px solid var(--border-strong); height: 42px;
    }
    th.amt, td.amt { text-align: right; }
    td.desc { color: var(--text-secondary); }
    td.currency { white-space: nowrap; }
    tbody tr { height: 40px; }
    tbody tr:nth-child(even) { background: var(--row-alt); }
    tr.total-row td {
      background: var(--primary-light); color: var(--text); font-weight: 700;
      font-size: 14px; border-top: 2px solid var(--primary);
    }
    .combined-table th:nth-child(1), .combined-table td:nth-child(1) { width: 24%; }
    .combined-table th:nth-child(2), .combined-table td:nth-child(2) { width: 13%; }
    .combined-table th:nth-child(3), .combined-table td:nth-child(3) { width: 13%; }
    .combined-table th:nth-child(4), .combined-table td:nth-child(4) { width: 24%; }
    .combined-table th:nth-child(5), .combined-table td:nth-child(5) { width: 13%; }
    .combined-table th:nth-child(6), .combined-table td:nth-child(6) { width: 13%; }
    .earnings-only-table th:nth-child(1), .earnings-only-table td:nth-child(1) { width: 40%; }
    .earnings-only-table th:nth-child(2), .earnings-only-table td:nth-child(2) { width: 30%; }
    .earnings-only-table th:nth-child(3), .earnings-only-table td:nth-child(3) { width: 30%; }
    .net-table { border: 1.5px solid var(--border-strong); margin-bottom: 18px; }
    .net-table td { border: 1px solid var(--border); padding: 12px 14px; }
    .net-table td:last-child { text-align: right; font-weight: 600; white-space: nowrap; }
    .net-table tr:last-child td {
      background: var(--primary-light); color: var(--text); font-weight: 700;
      font-size: 18px; border-top: 2px solid var(--primary);
    }
    .words { text-align: center; padding: 16px 0 20px; }
    .words .amount { font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 5px; }
    .words .amount strong { color: var(--primary-dark); font-weight: 800; }
    .words .text { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
    .words .formula { font-size: 11px; color: var(--muted); }
    .footer {
      text-align: center; font-size: 11px; color: var(--footer-text);
      padding-top: 14px; border-top: 2px solid var(--primary); margin-top: auto;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="content">
      <div class="header">
        <div class="header-left">
          ${logoHtml}
          <div class="company-name">${escapeHtml(c.name)}</div>
          ${addressLine ? `<div class="company-address">${escapeHtml(addressLine)}</div>` : ''}
        </div>
        <div class="brand-right">
          <div class="brand-name">HRMAX</div>
          <div class="brand-sub">Payroll Management System</div>
        </div>
      </div>

      <div class="title-wrap">
        <div class="title">Payslip for the month of ${payPeriod} ${payYear}</div>
        <div class="title-line"></div>
      </div>

      <div class="section-title">Employee Pay Summary</div>
      <div class="summary-box">
        <div class="summary-left">
          <span class="label">Employee Name</span><span class="value">${employeeName}</span>
          <span class="label">Designation</span><span class="value">${designation}</span>
          <span class="label">Date of Joining</span><span class="value">${doj}</span>
          <span class="label">Pay Period</span><span class="value">${payPeriod} ${payYear}</span>
          <span class="label">Pay Date</span><span class="value">${payDateStr}</span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-right">
          <div class="label">Employee Net Pay</div>
          <div class="net-pay">${fmtMoney(net)}</div>
          <div class="days">Paid Days : ${paidDays}<br>LOP Days : ${lopDays}</div>
        </div>
      </div>

      <div class="section-title">Earnings</div>
      <table class="${combinedTableClass}">
        ${tableColgroup}
        <thead>${combinedTableHeader}</thead>
        <tbody>
          ${tableRowsHtml}
          ${combinedTableFooter}
        </tbody>
      </table>

      <div class="section-title">Net Pay</div>
      <table class="net-table">
        <tbody>
          <tr><td>Gross Earnings</td><td class="currency">${fmtMoney(gross)}</td></tr>
          <tr><td>Total Deductions</td><td class="currency">${fmtMoney(deductions)}</td></tr>
          <tr><td>Total Net Payable</td><td class="currency">${fmtMoney(net)}</td></tr>
        </tbody>
      </table>

      <div class="words">
        <div class="amount">Total Net Payable <strong>${fmtMoney(net)}</strong></div>
        <div class="text">(${numberToWords(net)})</div>
        <div class="formula">Total Net Payable = Gross Earnings \u2212 Total Deductions</div>
      </div>
    </div>

    <div class="footer">
      This document has been automatically generated by HRMAX Payroll System; therefore, a signature is not required.
    </div>
  </div>
</body>
</html>`;

  const fileName = `payslip-${slip.employeeName?.replace(/\s+/g, '-').toLowerCase() || 'employee'}-${payPeriod}-${payYear}.pdf`;
  const { uri } = await Print.printToFileAsync({ html });
  const dest = `${cacheDirectory}${fileName}`;
  await moveAsync({ from: uri, to: dest });
  await Sharing.shareAsync(dest, { mimeType: 'application/pdf' });
};
