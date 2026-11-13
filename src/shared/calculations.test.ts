import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateOrderTotals,
  splitOrderEqually,
  splitOrderBySelectedItems,
  generateUpiUri,
  computeReports,
} from './calculations';
import type { Bill, Expense, MenuItem, OrderItem } from './types';

const sampleItems: OrderItem[] = [
  {
    id: 'oi-1',
    menuItemId: 'm-1',
    name: 'Crispy Chicken Burger',
    category: 'Burgers',
    unitPrice: 119,
    taxPercent: 5,
    qty: 2,
    sentQty: 2,
    addons: [{ id: 'a-1', name: 'Extra cheese', price: 20 }],
    notes: '',
    voidedQty: 0,
    voidReasons: [],
  },
  {
    id: 'oi-2',
    menuItemId: 'm-10',
    name: 'Cold Coffee',
    category: 'Beverages',
    unitPrice: 89,
    taxPercent: 5,
    qty: 1,
    sentQty: 1,
    addons: [],
    notes: 'Less ice',
    voidedQty: 0,
    voidReasons: [],
  },
];

test('calculateOrderTotals computes add-ons, flat discount, and CGST/SGST split accurately', () => {
  // Line 1: (119 + 20) * 2 = 278; Line 2: 89 * 1 = 89 -> Subtotal = 367
  const totals = calculateOrderTotals(sampleItems, 'flat', 17, 5);
  assert.equal(totals.subtotal, 367);
  assert.equal(totals.discountAmount, 17);
  assert.equal(totals.taxableAmount, 350);
  // 5% of 350 = 17.50 -> CGST 8.75, SGST 8.75
  assert.equal(totals.totalGst, 17.5);
  assert.equal(totals.cgstAmount, 8.75);
  assert.equal(totals.sgstAmount, 8.75);
  assert.equal(totals.grandTotal, 367.5);
});

test('calculateOrderTotals clamps percent discount between 0 and 100', () => {
  const totals = calculateOrderTotals(sampleItems, 'percent', 150, 5);
  assert.equal(totals.discountAmount, 367);
  assert.equal(totals.taxableAmount, 0);
  assert.equal(totals.grandTotal, 0);
});

test('splitOrderEqually distributes paise with zero rounding drift', () => {
  const shares = splitOrderEqually(100, 3);
  assert.equal(shares.length, 3);
  assert.deepEqual(shares, [33.34, 33.33, 33.33]);
  const sum = shares.reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum * 100) / 100, 100);
});

test('splitOrderBySelectedItems calculates partial item bill cleanly', () => {
  const { selectedItems, totals } = splitOrderBySelectedItems(
    sampleItems,
    { 'oi-1': 1, 'oi-2': 0 },
    0,
    367,
    5
  );
  assert.equal(selectedItems.length, 1);
  assert.equal(selectedItems[0].qty, 1);
  assert.equal(totals.subtotal, 139);
  assert.equal(totals.totalGst, 6.95);
  assert.equal(totals.grandTotal, 145.95);
});

test('generateUpiUri builds valid NPCI UPI payment link', () => {
  const uri = generateUpiUri({
    upiId: 'cafe@okaxis',
    cafeName: 'BrewDesk Cafe',
    amount: 367.5,
    billRef: 'INV-0001',
  });
  assert.ok(uri.startsWith('upi://pay?'));
  assert.ok(uri.includes('pa=cafe%40okaxis'));
  assert.ok(uri.includes('am=367.50'));
  assert.ok(uri.includes('cu=INR'));
});

test('computeReports aggregates paid sales, excludes voided bills from sales, and calculates net profit', () => {
  const today = '2026-11-13';
  const menu: MenuItem[] = [];
  const bills: Bill[] = [
    {
      id: 'b-1',
      billNumber: 'INV-0001',
      billSeq: 1,
      orderId: 'o-1',
      orderType: 'dine_in',
      tableLabel: 'T1',
      tokenNumber: null,
      items: sampleItems,
      subtotal: 367,
      discountAmount: 0,
      taxableAmount: 367,
      cgstAmount: 9.18,
      sgstAmount: 9.17,
      totalGst: 18.35,
      grandTotal: 385.35,
      payments: [{ mode: 'upi', amount: 385.35 }],
      status: 'paid',
      createdAt: '2026-11-13T10:15:00.000Z',
      closedBy: 'u-1',
      closedByName: 'Owner',
    },
    {
      id: 'b-2',
      billNumber: 'INV-0002',
      billSeq: 2,
      orderId: 'o-2',
      orderType: 'takeaway',
      tableLabel: 'Takeaway',
      tokenNumber: 1,
      items: sampleItems,
      subtotal: 367,
      discountAmount: 0,
      taxableAmount: 367,
      cgstAmount: 9.18,
      sgstAmount: 9.17,
      totalGst: 18.35,
      grandTotal: 385.35,
      payments: [{ mode: 'cash', amount: 385.35 }],
      status: 'voided',
      voidReason: 'Test entry',
      createdAt: '2026-11-13T11:00:00.000Z',
      closedBy: 'u-1',
      closedByName: 'Owner',
    },
  ];
  const expenses: Expense[] = [
    {
      id: 'e-1',
      date: today,
      category: 'Dairy & Milk',
      description: 'Daily milk',
      amount: 120,
      paymentMode: 'cash',
      createdByName: 'Owner',
      createdAt: '2026-11-13T08:00:00.000Z',
    },
  ];

  const report = computeReports({ bills, expenses, menu, startDate: today, endDate: today });
  assert.equal(report.billCount, 1);
  assert.equal(report.totalSales, 385.35);
  assert.equal(report.voidedBillCount, 1);
  assert.equal(report.totalExpenses, 120);
  assert.equal(report.netProfit, 247); // 367 taxable - 120 expenses
  assert.equal(report.paymentSplit.upi, 385.35);
  assert.equal(report.paymentSplit.cash, 0);
});
