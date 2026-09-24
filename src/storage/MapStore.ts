import { openDB } from 'idb';

export interface MapRecord {
  id: string;
  name: string;
  kmzBlob: Blob;
  createdAt: number;
}

// Stored shape: the KMZ as raw bytes. Safari refuses Blob values in IndexedDB in private
// browsing ("Error preparing Blob/File data"), while ArrayBuffers work everywhere.
// Records saved by older versions hold a Blob; both are read.
interface StoredRecord extends Omit<MapRecord, 'kmzBlob'> {
  kmz: ArrayBuffer | Blob;
}

const KMZ_TYPE = 'application/vnd.google-earth.kmz';

export function fromStored(r: StoredRecord & { kmzBlob?: Blob }): MapRecord {
  const { kmz, kmzBlob, ...rest } = r;
  const data = kmz ?? kmzBlob!;
  return { ...rest, kmzBlob: data instanceof Blob ? data : new Blob([data], { type: KMZ_TYPE }) };
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
    return (await (await getDb()).getAll(STORE)).map(fromStored);
  },
  async get(id: string): Promise<MapRecord | undefined> {
    const r = await (await getDb()).get(STORE, id);
    return r && fromStored(r);
  },
  async put(rec: MapRecord): Promise<void> {
    const { kmzBlob, ...rest } = rec;
    const stored: StoredRecord = { ...rest, kmz: await kmzBlob.arrayBuffer() };
    await (await getDb()).put(STORE, stored);
    // Ask the browser not to evict saved maps under storage pressure (Safari otherwise
    // clears site data after ~7 days without a visit). Best effort; granted silently or not at all.
    void navigator.storage.persist();
  },
  async delete(id: string): Promise<void> {
    await (await getDb()).delete(STORE, id);
  },
};
