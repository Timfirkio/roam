export type SyncEntity = 'discovery' | 'ride' | 'profile' | 'settings';
export type SyncOperationKind = 'upsert' | 'delete';

export type SyncOperation = {
  id: string;
  accountId: string;
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperationKind;
  payload: unknown;
  createdAt: number;
  attempts: number;
};

const DATABASE_NAME = 'roam-sync';
const STORE_NAME = 'outbox';

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!store.indexNames.contains('by-account-created')) store.createIndex('by-account-created', ['accountId', 'createdAt']);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueSyncOperation(operation: Omit<SyncOperation, 'id' | 'createdAt' | 'attempts'>) {
  if (!('indexedDB' in window)) return;
  const database = await openDatabase();
  const record: SyncOperation = { ...operation, id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0 };
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export async function loadSyncOperations(accountId: string): Promise<SyncOperation[]> {
  if (!('indexedDB' in window)) return [];
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).index('by-account-created').getAll(IDBKeyRange.bound([accountId, 0], [accountId, Number.MAX_SAFE_INTEGER]));
    request.onsuccess = () => { database.close(); resolve(request.result as SyncOperation[]); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function completeSyncOperations(ids: string[]) {
  if (!ids.length || !('indexedDB' in window)) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    ids.forEach(id => store.delete(id));
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}
