import bcrypt from 'bcryptjs';
import type {
  AddonOption,
  BackupMetadata,
  CafeSettings,
  Ingredient,
  MenuItem,
  TableInfo,
  UserRecord,
} from '../shared/types';

export interface FullDbState {
  settings: CafeSettings;
  ownerPinHash: string;
  jwtSecret: string;
  nextBillSeq: number;
  nextKotSeq: number;
  nextTokenSeq: number;
  tokenDate: string;
  users: UserRecord[];
  menu: MenuItem[];
  tables: TableInfo[];
  orders: import('../shared/types').Order[];
  kots: import('../shared/types').KotTicket[];
  bills: import('../shared/types').Bill[];
  expenses: import('../shared/types').Expense[];
  inventory: Ingredient[];
  purchases: import('../shared/types').StockPurchase[];
  daySessions: import('../shared/types').DaySession[];
  auditLogs: import('../shared/types').AuditLogEntry[];
  backups: BackupMetadata[];
  lastUpdatedAt: string;
}

export function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function createInitialSeedState(): FullDbState {
  const now = new Date().toISOString();
  const today = todayDateStr();

  const globalAddons: AddonOption[] = [
    { id: 'addon-cheese', name: 'Extra cheese', price: 20 },
    { id: 'addon-no-onion', name: 'No onion', price: 0 },
    { id: 'addon-mayo', name: 'Extra mayo', price: 15 },
    { id: 'addon-less-ice', name: 'Less ice', price: 0 },
    { id: 'addon-spicy', name: 'Extra spicy', price: 0 },
  ];

  const burgerAddons = [globalAddons[0], globalAddons[1], globalAddons[2]];
  const sandwichAddons = [globalAddons[0], globalAddons[1], globalAddons[2]];
  const sidesAddons = [globalAddons[0], globalAddons[2], globalAddons[4]];
  const bevAddons = [globalAddons[3]];

  const inventory: Ingredient[] = [
    { id: 'ing-bun', name: 'Burger Bun', unit: 'pcs', stock: 80, minStock: 15, costPerUnit: 8, updatedAt: now },
    { id: 'ing-chk-patty', name: 'Crispy Chicken Patty', unit: 'pcs', stock: 60, minStock: 12, costPerUnit: 32, updatedAt: now },
    { id: 'ing-veg-patty', name: 'Veg Patty', unit: 'pcs', stock: 50, minStock: 10, costPerUnit: 20, updatedAt: now },
    { id: 'ing-cheese', name: 'Cheese Slice', unit: 'pcs', stock: 100, minStock: 20, costPerUnit: 11, updatedAt: now },
    { id: 'ing-bread', name: 'Sandwich Bread', unit: 'slices', stock: 120, minStock: 24, costPerUnit: 4, updatedAt: now },
    { id: 'ing-chk-grill', name: 'Grilled Chicken Strips', unit: 'portions', stock: 45, minStock: 10, costPerUnit: 35, updatedAt: now },
    { id: 'ing-fries', name: 'Frozen French Fries', unit: 'portions', stock: 70, minStock: 15, costPerUnit: 18, updatedAt: now },
    { id: 'ing-popcorn', name: 'Chicken Popcorn', unit: 'portions', stock: 40, minStock: 10, costPerUnit: 38, updatedAt: now },
    { id: 'ing-coffee', name: 'Espresso Shot / Coffee', unit: 'shots', stock: 90, minStock: 15, costPerUnit: 12, updatedAt: now },
    { id: 'ing-milk', name: 'Chilled Milk', unit: 'ml', stock: 10000, minStock: 2000, costPerUnit: 0.06, updatedAt: now },
    { id: 'ing-oreo', name: 'Oreo Cookie Pack', unit: 'packs', stock: 35, minStock: 8, costPerUnit: 15, updatedAt: now },
    { id: 'ing-choco', name: 'Chocolate Syrup', unit: 'ml', stock: 2500, minStock: 400, costPerUnit: 0.25, updatedAt: now },
  ];

  const menu: MenuItem[] = [
    {
      id: 'item-crispy-chk-burger',
      name: 'Crispy Chicken Burger',
      category: 'Burgers',
      price: 119,
      taxPercent: 5,
      soldOut: false,
      addons: burgerAddons,
      recipe: [
        { ingredientId: 'ing-bun', quantity: 1 },
        { ingredientId: 'ing-chk-patty', quantity: 1 },
      ],
      sortOrder: 1,
    },
    {
      id: 'item-chk-cheese-burger',
      name: 'Chicken Cheese Burger',
      category: 'Burgers',
      price: 139,
      taxPercent: 5,
      soldOut: false,
      addons: burgerAddons,
      recipe: [
        { ingredientId: 'ing-bun', quantity: 1 },
        { ingredientId: 'ing-chk-patty', quantity: 1 },
        { ingredientId: 'ing-cheese', quantity: 1 },
      ],
      sortOrder: 2,
    },
    {
      id: 'item-veg-cheese-burger',
      name: 'Veg Cheese Burger',
      category: 'Burgers',
      price: 89,
      taxPercent: 5,
      soldOut: false,
      addons: burgerAddons,
      recipe: [
        { ingredientId: 'ing-bun', quantity: 1 },
        { ingredientId: 'ing-veg-patty', quantity: 1 },
        { ingredientId: 'ing-cheese', quantity: 1 },
      ],
      sortOrder: 3,
    },
    {
      id: 'item-grilled-chk-sandwich',
      name: 'Grilled Chicken Sandwich',
      category: 'Sandwiches',
      price: 119,
      taxPercent: 5,
      soldOut: false,
      addons: sandwichAddons,
      recipe: [
        { ingredientId: 'ing-bread', quantity: 2 },
        { ingredientId: 'ing-chk-grill', quantity: 1 },
      ],
      sortOrder: 4,
    },
    {
      id: 'item-chk-cheese-sandwich',
      name: 'Chicken Cheese Sandwich',
      category: 'Sandwiches',
      price: 139,
      taxPercent: 5,
      soldOut: false,
      addons: sandwichAddons,
      recipe: [
        { ingredientId: 'ing-bread', quantity: 2 },
        { ingredientId: 'ing-chk-grill', quantity: 1 },
        { ingredientId: 'ing-cheese', quantity: 1 },
      ],
      sortOrder: 5,
    },
    {
      id: 'item-veg-cheese-sandwich',
      name: 'Veg Cheese Sandwich',
      category: 'Sandwiches',
      price: 89,
      taxPercent: 5,
      soldOut: false,
      addons: sandwichAddons,
      recipe: [
        { ingredientId: 'ing-bread', quantity: 2 },
        { ingredientId: 'ing-cheese', quantity: 1 },
      ],
      sortOrder: 6,
    },
    {
      id: 'item-salted-fries',
      name: 'Salted Fries',
      category: 'Sides',
      price: 69,
      taxPercent: 5,
      soldOut: false,
      addons: sidesAddons,
      recipe: [{ ingredientId: 'ing-fries', quantity: 1 }],
      sortOrder: 7,
    },
    {
      id: 'item-peri-fries',
      name: 'Peri Peri Fries',
      category: 'Sides',
      price: 89,
      taxPercent: 5,
      soldOut: false,
      addons: sidesAddons,
      recipe: [{ ingredientId: 'ing-fries', quantity: 1 }],
      sortOrder: 8,
    },
    {
      id: 'item-chk-popcorn',
      name: 'Chicken Popcorn',
      category: 'Sides',
      price: 119,
      taxPercent: 5,
      soldOut: false,
      addons: sidesAddons,
      recipe: [{ ingredientId: 'ing-popcorn', quantity: 1 }],
      sortOrder: 9,
    },
    {
      id: 'item-cold-coffee',
      name: 'Cold Coffee',
      category: 'Beverages',
      price: 89,
      taxPercent: 5,
      soldOut: false,
      addons: bevAddons,
      recipe: [
        { ingredientId: 'ing-coffee', quantity: 1 },
        { ingredientId: 'ing-milk', quantity: 220 },
      ],
      sortOrder: 10,
    },
    {
      id: 'item-oreo-shake',
      name: 'Oreo Shake',
      category: 'Beverages',
      price: 109,
      taxPercent: 5,
      soldOut: false,
      addons: bevAddons,
      recipe: [
        { ingredientId: 'ing-oreo', quantity: 1 },
        { ingredientId: 'ing-milk', quantity: 220 },
      ],
      sortOrder: 11,
    },
    {
      id: 'item-chocolate-shake',
      name: 'Chocolate Shake',
      category: 'Beverages',
      price: 0,
      priceUnset: true,
      taxPercent: 5,
      soldOut: false,
      addons: bevAddons,
      recipe: [
        { ingredientId: 'ing-choco', quantity: 35 },
        { ingredientId: 'ing-milk', quantity: 220 },
      ],
      sortOrder: 12,
    },
  ];

  const tables: TableInfo[] = Array.from({ length: 10 }, (_, idx) => ({
    id: `table-${idx + 1}`,
    number: idx + 1,
    label: `T${idx + 1}`,
    activeOrderId: null,
  }));

  const users: UserRecord[] = [
    {
      id: 'user-owner',
      username: 'owner',
      name: 'Cafe Owner',
      role: 'owner',
      active: true,
      createdAt: now,
      passwordHash: bcrypt.hashSync('owner123', 10),
    },
    {
      id: 'user-cashier',
      username: 'cashier',
      name: 'Counter Cashier',
      role: 'cashier',
      active: true,
      createdAt: now,
      passwordHash: bcrypt.hashSync('cashier123', 10),
    },
    {
      id: 'user-waiter',
      username: 'waiter',
      name: 'Floor Waiter',
      role: 'waiter',
      active: true,
      createdAt: now,
      passwordHash: bcrypt.hashSync('waiter123', 10),
    },
  ];

  const settings: CafeSettings = {
    cafeName: 'BrewDesk Cafe',
    address: '14 Park Street, Ground Floor',
    phone: '+91 98765 43210',
    gstin: '27AABCU9603R1ZM',
    tableCount: 10,
    gstRate: 5,
    upiId: 'brewdesk@okaxis',
    receiptFooter: 'Thank you for visiting! Visit again.',
    paperSize: '80mm',
    globalAddons,
  };

  return {
    settings,
    ownerPinHash: bcrypt.hashSync('1234', 10),
    jwtSecret: process.env.JWT_SECRET || `brewdesk_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    nextBillSeq: 1,
    nextKotSeq: 1,
    nextTokenSeq: 1,
    tokenDate: today,
    users,
    menu,
    tables,
    orders: [],
    kots: [],
    bills: [],
    expenses: [],
    inventory,
    purchases: [],
    daySessions: [],
    auditLogs: [
      {
        id: `audit-${Date.now()}`,
        timestamp: now,
        userId: 'user-owner',
        username: 'owner',
        userName: 'Cafe Owner',
        role: 'owner',
        action: 'SYSTEM_INITIALIZED',
        details: 'Initialized cafe menu, 10 tables, inventory, and staff roles.',
        entityType: 'system',
        entityId: 'init',
      },
    ],
    backups: [],
    lastUpdatedAt: now,
  };
}
