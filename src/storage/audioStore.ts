/**
 * Interview recordings are too large for localStorage, so they live in IndexedDB.
 * Audio never leaves the device; only the (user-reviewed) transcript is sent for notes.
 */
export interface AudioStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  delete(id: string): Promise<void>;
}

const DB_NAME = 'sah-assessor-audio';
const STORE = 'recordings';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

// Stored as bytes + MIME type rather than a Blob: Blob support in IndexedDB has been
// unreliable in some browsers (and in test environments).
interface StoredAudio {
  type: string;
  data: ArrayBuffer;
}

export const indexedDbAudioStore: AudioStore = {
  async put(id, blob) {
    const record: StoredAudio = { type: blob.type, data: await blob.arrayBuffer() };
    await tx('readwrite', (s) => s.put(record, id));
  },
  async get(id) {
    const record = await tx('readonly', (s) => s.get(id) as IDBRequest<StoredAudio | undefined>);
    return record ? new Blob([record.data], { type: record.type }) : undefined;
  },
  async delete(id) {
    await tx('readwrite', (s) => s.delete(id));
  },
};
