import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { cacheDirectory, moveAsync } from 'expo-file-system/legacy';

interface SlipData {
  month: string;
  year: number;
  basicSalary: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  status: string;
  employeeName?: string;
  companyName?: string;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

const generateHtml = (data: SlipData): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: 'DejaVu Sans', Arial, sans-serif; margin: 0; padding: 20px; color: #1e293b; }
    .header { text-align: center; border-bottom: 2px solid #FF6600; padding-bottom: 16px; margin-bottom: 20px; }
    .header h1 { margin: 0; color: #FF6600; font-size: 22px; }
    .header p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
    .title-row { display: flex; justify-content: space-between; margin-bottom: 20px; }
    .title-row h2 { margin: 0; font-size: 18px; color: #0f172a; }
    .title-row .status { padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .status-paid { background: #10b98120; color: #10b981; }
    .status-pending { background: #eab30820; color: #eab308; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 13px; }
    td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    td:last-child, th:last-child { text-align: right; }
    .total td { border-top: 2px solid #FF6600; font-weight: bold; font-size: 16px; color: #FF6600; }
    .footer { text-align: center; margin-top: 30px; color: #94a3b8; font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>INVOICE</h1>
    <p>${data.companyName || 'HR MAX'}</p>
  </div>

  <div class="title-row">
    <h2>Salary Slip — ${data.month} ${data.year}</h2>
    <span class="status status-${data.status.toLowerCase()}">${data.status}</span>
  </div>

  <p style="margin-bottom:12px;color:#475569"><strong>Employee:</strong> ${data.employeeName || 'N/A'}</p>

  <table>
    <tr><th>Description</th><th>Amount</th></tr>
    <tr><td>Basic Salary</td><td>${formatCurrency(data.basicSalary)}</td></tr>
    <tr><td>Allowances</td><td style="color:#10b981">+${formatCurrency(data.allowances)}</td></tr>
    <tr><td>Deductions</td><td style="color:#ef4444">-${formatCurrency(data.deductions)}</td></tr>
    <tr class="total"><td>Net Salary</td><td>${formatCurrency(data.netSalary)}</td></tr>
  </table>

  <div class="footer">
    <p>Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
    <p>This is a computer-generated invoice.</p>
  </div>
</body>
</html>
`;

export const generateInvoicePdf = async (data: SlipData): Promise<void> => {
  const html = generateHtml(data);
  const { uri } = await Print.printToFileAsync({ html });
  const fileName = `SalarySlip_${data.month}_${data.year}.pdf`;
  const dest = `${cacheDirectory}${fileName}`;
  await moveAsync({ from: uri, to: dest });
  await Sharing.shareAsync(dest, { mimeType: 'application/pdf' });
};
