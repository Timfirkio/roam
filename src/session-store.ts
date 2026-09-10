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
};

const DATABASE_NAME = 'roam-sessions';
const STORE_NAME = 'sessions';

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
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
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(session);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}
