import { openDB } from 'idb';

export interface MapRecord {
  id: string;
  name: string;
  kmzBlob: Blob;
  createdAt: number;
}

const DB_NAME = 'custom-maps';
const STORE   = 'maps';

function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) { db.createObjectStore(STORE, { keyPath: 'id' }); },
  });
}

export const mapStore = {
  async list(): Promise<MapRecord[]> {
    return (await getDb()).getAll(STORE);
  },
  async get(id: string): Promise<MapRecord | undefined> {
    return (await getDb()).get(STORE, id);
  },
  async put(rec: MapRecord): Promise<void> {
    await (await getDb()).put(STORE, rec);
  },
  async delete(id: string): Promise<void> {
    await (await getDb()).delete(STORE, id);
  },
};
