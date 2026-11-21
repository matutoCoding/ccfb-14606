// 轻量 IndexedDB 封装（Promise 化、带类型）
import type { DBSchema, StoreName } from '../types';

const DB_NAME = 'fiber-splice-sim';
const DB_VERSION = 1;
export const STORES: StoreName[] = [
  'routes',
  'boxes',
  'splices',
  'splicers',
  'orders',
  'traces',
  'settings',
];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' });
          if (name === 'splices') {
            store.createIndex('boxId', 'boxId', { unique: false });
            store.createIndex('splicerId', 'splicerId', { unique: false });
          }
          if (name === 'orders') store.createIndex('boxId', 'boxId', { unique: false });
          if (name === 'traces') store.createIndex('routeId', 'routeId', { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function getAll<K extends StoreName>(store: K): Promise<DBSchema[K]> {
  return tx<DBSchema[K]>(store, 'readonly', (s) => s.getAll());
}

export async function get<K extends StoreName>(store: K, id: string): Promise<DBSchema[K][number] | undefined> {
  return tx<DBSchema[K][number] | undefined>(store, 'readonly', (s) => s.get(id));
}

export async function put<K extends StoreName>(store: K, value: DBSchema[K][number]): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(value));
}

export async function putMany<K extends StoreName>(store: K, values: DBSchema[K][number][]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const v of values) s.put(v);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function remove(store: StoreName, id: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(id));
}

export async function clearStore(store: StoreName): Promise<void> {
  await tx(store, 'readwrite', (s) => s.clear());
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await tx<{ key: string; value: T } | undefined>('settings', 'readonly', (s) => s.get(key));
  return row ? row.value : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await put('settings', { key, value });
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
