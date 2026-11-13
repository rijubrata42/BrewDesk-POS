export type Role = 'owner' | 'cashier' | 'waiter';

export interface UserPublic {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface UserRecord extends UserPublic {
  passwordHash: string;
}

export interface AddonOption {
  id: string;
  name: string;
  price: number;
}

export interface RecipeIngredient {
  ingredientId: string;
  quantity: number;
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  priceUnset?: boolean;
  taxPercent: number;
  soldOut: boolean;
  addons: AddonOption[];
  recipe: RecipeIngredient[];
  defaultNotes?: string;
  sortOrder: number;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  category: string;
  unitPrice: number;
  taxPercent: number;
  qty: number;
  sentQty: number;
  addons: AddonOption[];
  notes: string;
  voidedQty: number;
  voidReasons: string[];
}

export type OrderType = 'dine_in' | 'takeaway';
export type DiscountType = 'flat' | 'percent';

export interface Order {
  id: string;
  orderType: OrderType;
  tableId: string | null;
  tableLabel: string;
  tokenNumber: number | null;
  status: 'open' | 'billed' | 'voided';
  items: OrderItem[];
  discountType: DiscountType;
  discountValue: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName: string;
  voidReason?: string;
}

export interface TableInfo {
  id: string;
  number: number;
  label: string;
  activeOrderId: string | null;
}

export type KotStatus = 'new' | 'preparing' | 'ready';

export interface KotTicketItem {
  name: string;
  qty: number;
  addons: string[];
  notes: string;
}

export interface KotTicket {
  id: string;
  kotNumber: number;
  orderId: string;
  orderType: OrderType;
  tableLabel: string;
  tokenNumber: number | null;
  status: KotStatus;
  items: KotTicketItem[];
  createdAt: string;
  updatedAt: string;
  createdByName: string;
}

export type PaymentMode = 'cash' | 'upi' | 'card';

export interface PaymentEntry {
  mode: PaymentMode;
  amount: number;
}

export interface Bill {
  id: string;
  billNumber: string;
  billSeq: number;
  orderId: string;
  orderType: OrderType;
  tableLabel: string;
  tokenNumber: number | null;
  items: OrderItem[];
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalGst: number;
  grandTotal: number;
  payments: PaymentEntry[];
  status: 'paid' | 'voided';
  voidReason?: string;
  voidedAt?: string;
  voidedByName?: string;
  splitLabel?: string;
  createdAt: string;
  closedBy: string;
  closedByName: string;
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMode: PaymentMode;
  createdByName: string;
  createdAt: string;
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  costPerUnit: number;
  updatedAt: string;
}

export interface StockPurchase {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantity: number;
  totalCost: number;
  supplier: string;
  date: string;
  createdByName: string;
  createdAt: string;
}

export interface DaySession {
  id: string;
  date: string;
  status: 'open' | 'closed';
  openingCash: number;
  expectedCash: number;
  countedCash: number | null;
  cashDifference: number | null;
  openedByName: string;
  openedAt: string;
  closedByName?: string;
  closedAt?: string;
  notes?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  username: string;
  userName: string;
  role: Role;
  action: string;
  details: string;
  entityType: string;
  entityId: string;
}

export interface CafeSettings {
  cafeName: string;
  address: string;
  phone: string;
  gstin: string;
  tableCount: number;
  gstRate: number;
  upiId: string;
  receiptFooter: string;
  paperSize: '58mm' | '80mm';
  globalAddons: AddonOption[];
}

export interface BackupMetadata {
  id: string;
  createdAt: string;
  dateKey: string;
  type: 'auto' | 'manual';
  sizeBytes: number;
  counts: {
    orders: number;
    bills: number;
    menu: number;
    expenses: number;
    inventory: number;
  };
}

export interface PosStateSnapshot {
  storageMode: 'mongodb' | 'local-persistent';
  settings: CafeSettings;
  menu: MenuItem[];
  tables: TableInfo[];
  orders: Order[];
  kots: KotTicket[];
  bills: Bill[];
  expenses: Expense[];
  inventory: Ingredient[];
  purchases: StockPurchase[];
  daySessions: DaySession[];
  auditLogs: AuditLogEntry[];
  users: UserPublic[];
  backups: BackupMetadata[];
  lastUpdatedAt: string;
}

export interface OrderTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalGst: number;
  grandTotal: number;
}
