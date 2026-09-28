/**
 * Photographs you take (photo mode), kept in this browser's IndexedDB: the
 * Archive shows them. Never throws: if storage is unavailable, a photo just
 * isn't kept.
 */
export interface Photo {
  id: string;
  at: number;
  /** where and when, for the caption */
  place: string;
  time: string;
  url: string;
}

const DB = 'nightfall-photos';
const STORE = 'photos';
const MAX = 48;

function open(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch {
      res(null);
    }
  });
}

export async function savePhoto(p: Photo): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  const all = await listPhotos();
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      st.put(p);
      // keep the newest few dozen
      for (const old of all.slice(MAX - 1)) st.delete(old.id);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    } catch {
      res(false);
    }
  });
}

export async function listPhotos(): Promise<Photo[]> {
  const db = await open();
  if (!db) return [];
  return new Promise((res) => {
    try {
      const r = db.transaction(STORE).objectStore(STORE).getAll();
      r.onsuccess = () => res((r.result as Photo[]).sort((a, b) => b.at - a.at));
      r.onerror = () => res([]);
    } catch {
      res([]);
    }
  });
}

export async function deletePhoto(id: string): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    } catch {
      res(false);
    }
  });
}
