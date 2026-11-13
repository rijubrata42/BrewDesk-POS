import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, type Db } from 'mongodb';
import type { BackupMetadata, PosStateSnapshot, UserPublic } from '../shared/types';
import { createInitialSeedState, todayDateStr, type FullDbState } from './seed';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'pos-db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

class PosDatabase {
  private state!: FullDbState;
  private mongoClient: MongoClient | null = null;
  private mongoDb: Db | null = null;
  private storageMode: 'mongodb' | 'local-persistent' = 'local-persistent';
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private backupInterval: NodeJS.Timeout | null = null;

  async init(): Promise<void> {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const mongoUri = process.env.MONGODB_URI?.trim();
    const mongoDbName = process.env.MONGODB_DB_NAME?.trim() || 'brewdesk_pos';

    if (mongoUri) {
      try {
        this.mongoClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
        await this.mongoClient.connect();
        this.mongoDb = this.mongoClient.db(mongoDbName);
        this.storageMode = 'mongodb';
        const existingDoc = await this.mongoDb.collection('pos_snapshot').findOne({ _id: 'main' as unknown as never });
        if (existingDoc && existingDoc.data) {
          this.state = existingDoc.data as FullDbState;
        } else {
          this.state = createInitialSeedState();
          await this.persistState();
        }
        console.log(`[DB] Connected to cloud MongoDB (${mongoDbName})`);
      } catch (err) {
        console.error('[DB] MongoDB connection failed, falling back to durable local store:', err);
        this.storageMode = 'local-persistent';
        this.mongoClient = null;
        this.mongoDb = null;
      }
    }

    if (this.storageMode === 'local-persistent') {
      if (fs.existsSync(DB_FILE)) {
        try {
          const raw = fs.readFileSync(DB_FILE, 'utf-8');
          this.state = JSON.parse(raw) as FullDbState;
        } catch (err) {
          console.error('[DB] Failed to parse existing store, initializing fresh seed:', err);
          this.state = createInitialSeedState();
          await this.persistState();
        }
      } else {
        this.state = createInitialSeedState();
        await this.persistState();
      }
      console.log(`[DB] Using durable atomic server store at ${DB_FILE}`);
    }

    await this.ensureDailyBackup();
    this.backupInterval = setInterval(() => {
      void this.ensureDailyBackup();
    }, 60 * 60 * 1000);
  }

  getStorageMode(): 'mongodb' | 'local-persistent' {
    return this.storageMode;
  }

  getState(): FullDbState {
    return this.state;
  }

  getPublicSnapshot(): PosStateSnapshot {
    const s = this.state;
    const publicUsers: UserPublic[] = s.users.map(({ passwordHash: _ph, ...u }) => u);
    return {
      storageMode: this.storageMode,
      settings: s.settings,
      menu: s.menu,
      tables: s.tables,
      orders: s.orders,
      kots: s.kots,
      bills: s.bills,
      expenses: s.expenses,
      inventory: s.inventory,
      purchases: s.purchases,
      daySessions: s.daySessions,
      auditLogs: s.auditLogs,
      users: publicUsers,
      backups: s.backups,
      lastUpdatedAt: s.lastUpdatedAt,
    };
  }

  async mutate<T>(fn: (draft: FullDbState) => T | Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(async () => {
      const result = await fn(this.state);
      this.state.lastUpdatedAt = new Date().toISOString();
      await this.persistState();
      return result;
    });
    this.mutationQueue = run.catch(() => undefined);
    return run;
  }

  async replaceFullState(next: FullDbState): Promise<void> {
    await this.mutate((draft) => {
      Object.assign(draft, next);
    });
  }

  private async persistState(): Promise<void> {
    if (this.storageMode === 'mongodb' && this.mongoDb) {
      await this.mongoDb.collection('pos_snapshot').updateOne(
        { _id: 'main' as unknown as never },
        { $set: { data: this.state, updatedAt: new Date() } },
        { upsert: true }
      );
      // Also mirror key collections for direct MongoDB inspection
      const syncCol = async (name: string, docs: unknown[]) => {
        if (!this.mongoDb) return;
        const col = this.mongoDb.collection(name);
        await col.deleteMany({});
        if (docs.length > 0) {
          await col.insertMany(docs.map((d) => ({ ...(d as Record<string, unknown>) })));
        }
      };
      await Promise.all([
        syncCol('menu', this.state.menu),
        syncCol('tables', this.state.tables),
        syncCol('orders', this.state.orders),
        syncCol('kots', this.state.kots),
        syncCol('bills', this.state.bills),
        syncCol('expenses', this.state.expenses),
        syncCol('inventory', this.state.inventory),
        syncCol('audit_logs', this.state.auditLogs.slice(0, 500)),
      ]);
      return;
    }

    const tmpFile = `${DB_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  }

  async createBackup(type: 'auto' | 'manual'): Promise<BackupMetadata> {
    return this.mutate(async (draft) => {
      const now = new Date();
      const dateKey = todayDateStr();
      const id = `bkp-${dateKey}-${now.getTime()}`;
      const payload = JSON.stringify(draft, null, 2);
      const sizeBytes = Buffer.byteLength(payload, 'utf-8');

      const meta: BackupMetadata = {
        id,
        createdAt: now.toISOString(),
        dateKey,
        type,
        sizeBytes,
        counts: {
          orders: draft.orders.length,
          bills: draft.bills.length,
          menu: draft.menu.length,
          expenses: draft.expenses.length,
          inventory: draft.inventory.length,
        },
      };

      const filePath = path.join(BACKUP_DIR, `${id}.json`);
      fs.writeFileSync(filePath, payload, 'utf-8');

      if (this.storageMode === 'mongodb' && this.mongoDb) {
        await this.mongoDb.collection('backups').insertOne({ ...meta, payload: draft });
      }

      draft.backups = [meta, ...draft.backups].slice(0, 30);
      return meta;
    });
  }

  async ensureDailyBackup(): Promise<void> {
    const today = todayDateStr();
    const hasToday = this.state.backups.some((b) => b.dateKey === today && b.type === 'auto');
    if (!hasToday) {
      await this.createBackup('auto');
    }
  }

  getBackupPayload(id?: string): FullDbState | null {
    if (!id) return this.state;
    const filePath = path.join(BACKUP_DIR, `${path.basename(id)}.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FullDbState;
    }
    return null;
  }

  stop(): void {
    if (this.backupInterval) clearInterval(this.backupInterval);
  }
}

export const db = new PosDatabase();
