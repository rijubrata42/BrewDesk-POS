import type {
  Bill,
  DiscountType,
  Expense,
  MenuItem,
  OrderItem,
  OrderTotals,
  PaymentMode,
  CafeSettings,
} from './types';

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatElapsed(isoStart: string, nowMs = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((nowMs - new Date(isoStart).getTime()) / 1000));
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${secs}s`;
}

export function getLineUnitPrice(item: Pick<OrderItem, 'unitPrice' | 'addons'>): number {
  const addonsSum = (item.addons || []).reduce((acc, a) => acc + (Number(a.price) || 0), 0);
  return round2(item.unitPrice + addonsSum);
}

export function calculateOrderTotals(
  items: OrderItem[],
  discountType: DiscountType,
  discountValue: number,
  defaultGstRate: number
): OrderTotals {
  const activeItems = items.filter((it) => it.qty > 0);
  const subtotal = round2(
    activeItems.reduce((sum, it) => sum + getLineUnitPrice(it) * it.qty, 0)
  );

  let discountAmount = 0;
  if (subtotal > 0 && discountValue > 0) {
    if (discountType === 'percent') {
      const pct = Math.min(100, Math.max(0, discountValue));
      discountAmount = round2((subtotal * pct) / 100);
    } else {
      discountAmount = round2(Math.min(subtotal, Math.max(0, discountValue)));
    }
  }

  const taxableAmount = round2(subtotal - discountAmount);
  const discountRatio = subtotal > 0 ? discountAmount / subtotal : 0;

  let rawGst = 0;
  for (const it of activeItems) {
    const lineTotal = getLineUnitPrice(it) * it.qty;
    const discountedLine = lineTotal * (1 - discountRatio);
    const rate = Number.isFinite(it.taxPercent) ? it.taxPercent : defaultGstRate;
    rawGst += (discountedLine * rate) / 100;
  }

  const totalGst = round2(rawGst);
  const cgstAmount = round2(totalGst / 2);
  const sgstAmount = round2(totalGst - cgstAmount);
  const grandTotal = round2(taxableAmount + totalGst);

  return {
    subtotal,
    discountAmount,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    totalGst,
    grandTotal,
  };
}

export function splitOrderEqually(grandTotal: number, peopleCount: number): number[] {
  const n = Math.max(1, Math.floor(peopleCount));
  const totalPaise = Math.round(grandTotal * 100);
  const basePaise = Math.floor(totalPaise / n);
  const remainder = totalPaise - basePaise * n;
  const shares: number[] = [];
  for (let i = 0; i < n; i++) {
    const paise = basePaise + (i < remainder ? 1 : 0);
    shares.push(paise / 100);
  }
  return shares;
}

export function splitOrderBySelectedItems(
  items: OrderItem[],
  selectedQtyById: Record<string, number>,
  orderDiscountAmount: number,
  orderSubtotal: number,
  defaultGstRate: number
): { selectedItems: OrderItem[]; totals: OrderTotals } {
  const selectedItems: OrderItem[] = [];
  for (const it of items) {
    const pick = Math.min(it.qty, Math.max(0, Math.floor(selectedQtyById[it.id] || 0)));
    if (pick > 0) {
      selectedItems.push({ ...it, qty: pick });
    }
  }
  const discountRatio = orderSubtotal > 0 ? orderDiscountAmount / orderSubtotal : 0;
  const sub = round2(
    selectedItems.reduce((sum, it) => sum + getLineUnitPrice(it) * it.qty, 0)
  );
  const allocatedDiscount = round2(sub * discountRatio);
  const totals = calculateOrderTotals(selectedItems, 'flat', allocatedDiscount, defaultGstRate);
  return { selectedItems, totals };
}

export function generateUpiUri(params: {
  upiId: string;
  cafeName: string;
  amount: number;
  billRef: string;
}): string {
  const pa = encodeURIComponent(params.upiId.trim());
  const pn = encodeURIComponent(params.cafeName.trim() || 'Cafe POS');
  const am = params.amount.toFixed(2);
  const tn = encodeURIComponent(`Bill ${params.billRef}`);
  return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=INR&tn=${tn}`;
}

export function buildWhatsAppBillLink(params: {
  phone?: string;
  bill: Bill;
  settings: CafeSettings;
}): string {
  const { bill, settings } = params;
  const lines: string[] = [
    `*${settings.cafeName}*`,
    settings.address ? settings.address : '',
    settings.gstin ? `GSTIN: ${settings.gstin}` : '',
    `Bill: ${bill.billNumber} · ${new Date(bill.createdAt).toLocaleString('en-IN')}`,
    `${bill.orderType === 'dine_in' ? bill.tableLabel : `Takeaway #${bill.tokenNumber}`}`,
    '---',
    ...bill.items.map((it) => {
      const addonsText = it.addons.length ? ` (${it.addons.map((a) => a.name).join(', ')})` : '';
      return `${it.qty}x ${it.name}${addonsText} - Rs.${round2(getLineUnitPrice(it) * it.qty).toFixed(2)}`;
    }),
    '---',
    `Subtotal: Rs.${bill.subtotal.toFixed(2)}`,
    bill.discountAmount > 0 ? `Discount: -Rs.${bill.discountAmount.toFixed(2)}` : '',
    `CGST: Rs.${bill.cgstAmount.toFixed(2)} | SGST: Rs.${bill.sgstAmount.toFixed(2)}`,
    `*Grand Total: Rs.${bill.grandTotal.toFixed(2)}*`,
    settings.receiptFooter || 'Thank you for visiting!',
  ].filter(Boolean);

  const text = encodeURIComponent(lines.join('\n'));
  const cleanPhone = (params.phone || '').replace(/[^\d]/g, '');
  return cleanPhone ? `https://wa.me/${cleanPhone}?text=${text}` : `https://wa.me/?text=${text}`;
}

export interface ReportSummary {
  totalSales: number;
  taxableSales: number;
  billCount: number;
  avgBill: number;
  gstCollected: number;
  cgstCollected: number;
  sgstCollected: number;
  totalDiscounts: number;
  totalExpenses: number;
  netProfit: number;
  voidedBillCount: number;
  voidedBillAmount: number;
  hourlySales: { hour: number; label: string; sales: number; bills: number }[];
  dailySales: { date: string; sales: number; bills: number; expenses: number }[];
  itemSales: { name: string; category: string; qty: number; revenue: number }[];
  categorySales: { category: string; qty: number; revenue: number }[];
  paymentSplit: Record<PaymentMode, number>;
  staffSales: { staffName: string; bills: number; sales: number }[];
  taxBreakdown: { rate: number; taxable: number; cgst: number; sgst: number; totalTax: number }[];
  voidedBills: Bill[];
}

export function computeReports(params: {
  bills: Bill[];
  expenses: Expense[];
  menu: MenuItem[];
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}): ReportSummary {
  const { bills, expenses, menu, startDate, endDate } = params;
  const startMs = new Date(`${startDate}T00:00:00`).getTime();
  const endMs = new Date(`${endDate}T23:59:59.999`).getTime();

  const inRangeBills = bills.filter((b) => {
    const t = new Date(b.createdAt).getTime();
    return t >= startMs && t <= endMs;
  });

  const paidBills = inRangeBills.filter((b) => b.status === 'paid');
  const voidedBills = inRangeBills.filter((b) => b.status === 'voided');

  const inRangeExpenses = expenses.filter((e) => e.date >= startDate && e.date <= endDate);

  const totalSales = round2(paidBills.reduce((s, b) => s + b.grandTotal, 0));
  const taxableSales = round2(paidBills.reduce((s, b) => s + b.taxableAmount, 0));
  const gstCollected = round2(paidBills.reduce((s, b) => s + b.totalGst, 0));
  const cgstCollected = round2(paidBills.reduce((s, b) => s + b.cgstAmount, 0));
  const sgstCollected = round2(paidBills.reduce((s, b) => s + b.sgstAmount, 0));
  const totalDiscounts = round2(paidBills.reduce((s, b) => s + b.discountAmount, 0));
  const totalExpenses = round2(inRangeExpenses.reduce((s, e) => s + e.amount, 0));
  const billCount = paidBills.length;
  const avgBill = billCount > 0 ? round2(totalSales / billCount) : 0;
  const netProfit = round2(taxableSales - totalExpenses);

  const voidedBillCount = voidedBills.length;
  const voidedBillAmount = round2(voidedBills.reduce((s, b) => s + b.grandTotal, 0));

  const hourlyMap = new Map<number, { sales: number; bills: number }>();
  for (let h = 0; h < 24; h++) hourlyMap.set(h, { sales: 0, bills: 0 });

  const dailyMap = new Map<string, { sales: number; bills: number; expenses: number }>();
  const itemMap = new Map<string, { name: string; category: string; qty: number; revenue: number }>();
  const catMap = new Map<string, { category: string; qty: number; revenue: number }>();
  const paymentSplit: Record<PaymentMode, number> = { cash: 0, upi: 0, card: 0 };
  const staffMap = new Map<string, { staffName: string; bills: number; sales: number }>();
  const taxMap = new Map<number, { rate: number; taxable: number; totalTax: number }>();

  const menuCatLookup = new Map(menu.map((m) => [m.id, m.category]));

  for (const b of paidBills) {
    const dt = new Date(b.createdAt);
    const hr = dt.getHours();
    const hEntry = hourlyMap.get(hr)!;
    hEntry.sales = round2(hEntry.sales + b.grandTotal);
    hEntry.bills += 1;

    const dateKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const dEntry = dailyMap.get(dateKey) || { sales: 0, bills: 0, expenses: 0 };
    dEntry.sales = round2(dEntry.sales + b.grandTotal);
    dEntry.bills += 1;
    dailyMap.set(dateKey, dEntry);

    for (const p of b.payments) {
      paymentSplit[p.mode] = round2((paymentSplit[p.mode] || 0) + p.amount);
    }

    const staffEntry = staffMap.get(b.closedByName) || {
      staffName: b.closedByName || 'Counter',
      bills: 0,
      sales: 0,
    };
    staffEntry.bills += 1;
    staffEntry.sales = round2(staffEntry.sales + b.grandTotal);
    staffMap.set(b.closedByName, staffEntry);

    const discountRatio = b.subtotal > 0 ? b.discountAmount / b.subtotal : 0;
    for (const it of b.items) {
      const cat = it.category || menuCatLookup.get(it.menuItemId) || 'General';
      const lineRev = round2(getLineUnitPrice(it) * it.qty * (1 - discountRatio));
      const iKey = it.name;
      const iEntry = itemMap.get(iKey) || { name: it.name, category: cat, qty: 0, revenue: 0 };
      iEntry.qty += it.qty;
      iEntry.revenue = round2(iEntry.revenue + lineRev);
      itemMap.set(iKey, iEntry);

      const cEntry = catMap.get(cat) || { category: cat, qty: 0, revenue: 0 };
      cEntry.qty += it.qty;
      cEntry.revenue = round2(cEntry.revenue + lineRev);
      catMap.set(cat, cEntry);

      const rate = Number.isFinite(it.taxPercent) ? it.taxPercent : 5;
      const tEntry = taxMap.get(rate) || { rate, taxable: 0, totalTax: 0 };
      tEntry.taxable = round2(tEntry.taxable + lineRev);
      tEntry.totalTax = round2(tEntry.totalTax + (lineRev * rate) / 100);
      taxMap.set(rate, tEntry);
    }
  }

  for (const e of inRangeExpenses) {
    const dEntry = dailyMap.get(e.date) || { sales: 0, bills: 0, expenses: 0 };
    dEntry.expenses = round2(dEntry.expenses + e.amount);
    dailyMap.set(e.date, dEntry);
  }

  const hourlySales = Array.from(hourlyMap.entries()).map(([hour, v]) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    sales: v.sales,
    bills: v.bills,
  }));

  const dailySales = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  const itemSales = Array.from(itemMap.values()).sort((a, b) => b.revenue - a.revenue);
  const categorySales = Array.from(catMap.values()).sort((a, b) => b.revenue - a.revenue);
  const staffSales = Array.from(staffMap.values()).sort((a, b) => b.sales - a.sales);
  const taxBreakdown = Array.from(taxMap.values())
    .sort((a, b) => a.rate - b.rate)
    .map((t) => ({
      ...t,
      cgst: round2(t.totalTax / 2),
      sgst: round2(t.totalTax - round2(t.totalTax / 2)),
    }));

  return {
    totalSales,
    taxableSales,
    billCount,
    avgBill,
    gstCollected,
    cgstCollected,
    sgstCollected,
    totalDiscounts,
    totalExpenses,
    netProfit,
    voidedBillCount,
    voidedBillAmount,
    hourlySales,
    dailySales,
    itemSales,
    categorySales,
    paymentSplit,
    staffSales,
    taxBreakdown,
    voidedBills,
  };
}
