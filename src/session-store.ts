export type SessionPoint = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  speed?: number | null;
  bearing?: number | null;
};

export type RideSession = {
  id: string;
  title: string;
  districtNames: string[];
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  distanceMeters: number;
  newDistanceMeters: number;
  points: SessionPoint[];
  thumbnail?: Blob;
  thumbnailStyleVersion?: number;
};

const DATABASE_NAME = 'roam-sessions';
const STORE_NAME = 'sessions';
const DELETED_STORE_NAME = 'deletedSessions';

export type DeletedSession = { id: string; deletedAt: number; synced?: boolean };

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(DELETED_STORE_NAME)) request.result.createObjectStore(DELETED_STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSessions(): Promise<RideSession[]> {
  if (!('indexedDB' in window)) return [];
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => { database.close(); resolve((request.result as RideSession[]).sort((a, b) => b.startedAt - a.startedAt)); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function saveSession(session: RideSession) {
  if (!('indexedDB' in window)) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, DELETED_STORE_NAME], 'readwrite');
    const deleted = transaction.objectStore(DELETED_STORE_NAME).get(session.id);
    deleted.onsuccess = () => { if (!deleted.result) transaction.objectStore(STORE_NAME).put(session); };
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}

export async function loadDeletedSessions(): Promise<DeletedSession[]> {
  if (!('indexedDB' in window)) return [];
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(DELETED_STORE_NAME, 'readonly').objectStore(DELETED_STORE_NAME).getAll();
    request.onsuccess = () => { database.close(); resolve(request.result as DeletedSession[]); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function recordDeletedSessions(deletions: DeletedSession[]) {
  if (!('indexedDB' in window)) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, DELETED_STORE_NAME], 'readwrite');
    for (const deletion of deletions) {
      transaction.objectStore(STORE_NAME).delete(deletion.id);
      transaction.objectStore(DELETED_STORE_NAME).put(deletion);
    }
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}

export async function deleteSession(id: string) {
  await recordDeletedSessions([{ id, deletedAt: Date.now() }]);
}

export async function replaceSessions(sessions: RideSession[]) {
  if (!('indexedDB' in window)) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, DELETED_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const deletedRequest = transaction.objectStore(DELETED_STORE_NAME).getAllKeys();
    deletedRequest.onsuccess = () => {
      const deletedIds = new Set(deletedRequest.result as string[]);
      sessions.forEach(session => { if (!deletedIds.has(session.id)) store.put(session); });
    };
    store.clear();
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}
