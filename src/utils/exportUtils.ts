import type { Bill, Expense, Ingredient } from '../shared/types';

function escapeCsv(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const lines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((r) => r.map(escapeCsv).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportSalesCsv(bills: Bill[], filename = 'brewdesk-sales.csv'): void {
  const headers = [
    'Bill Number',
    'Date',
    'Order Type',
    'Table / Token',
    'Status',
    'Subtotal',
    'Discount',
    'Taxable',
    'CGST',
    'SGST',
    'Total GST',
    'Grand Total',
    'Payments',
    'Cashier',
    'Void Reason',
  ];
  const rows = bills.map((b) => [
    b.billNumber,
    new Date(b.createdAt).toLocaleString('en-IN'),
    b.orderType,
    b.tableLabel,
    b.status,
    b.subtotal.toFixed(2),
    b.discountAmount.toFixed(2),
    b.taxableAmount.toFixed(2),
    b.cgstAmount.toFixed(2),
    b.sgstAmount.toFixed(2),
    b.totalGst.toFixed(2),
    b.grandTotal.toFixed(2),
    b.payments.map((p) => `${p.mode.toUpperCase()}:${p.amount.toFixed(2)}`).join(' | '),
    b.closedByName,
    b.voidReason || '',
  ]);
  downloadCsv(filename, headers, rows);
}

export function exportExpensesCsv(expenses: Expense[], filename = 'brewdesk-expenses.csv'): void {
  const headers = ['Date', 'Category', 'Description', 'Amount', 'Payment Mode', 'Logged By'];
  const rows = expenses.map((e) => [
    e.date,
    e.category,
    e.description,
    e.amount.toFixed(2),
    e.paymentMode.toUpperCase(),
    e.createdByName,
  ]);
  downloadCsv(filename, headers, rows);
}

export function exportInventoryCsv(inventory: Ingredient[], filename = 'brewdesk-inventory.csv'): void {
  const headers = ['Ingredient', 'Unit', 'Current Stock', 'Min Stock Alert', 'Cost Per Unit', 'Updated At'];
  const rows = inventory.map((i) => [
    i.name,
    i.unit,
    i.stock,
    i.minStock,
    i.costPerUnit.toFixed(2),
    new Date(i.updatedAt).toLocaleString('en-IN'),
  ]);
  downloadCsv(filename, headers, rows);
}
