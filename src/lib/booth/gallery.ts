const DB_NAME = "kacha-booth";
const STORE = "shots";
export const MAX_SHOTS = 10;

export type ShotRecord = {
  id: string;
  blob: Blob;
  filterName: string;
  createdAt: number;
  frameCount: number;
};

export type Shot = {
  id: string;
  url: string;
  filterName: string;
  createdAt: number;
  frameCount: number;
};

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("存储失败"));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by_time", "createdAt");
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("无法打开相册"));
  });
}

export function toShot(record: ShotRecord): Shot {
  return {
    id: record.id,
    url: URL.createObjectURL(record.blob),
    filterName: record.filterName,
    createdAt: record.createdAt,
    frameCount: record.frameCount,
  };
}

export async function listShots(): Promise<Shot[]> {
  const db = await openDb();
  const records = await request(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
  db.close();
  return (records as ShotRecord[])
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toShot);
}

export async function addShot(record: ShotRecord): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put(record);
      const allReq = store.getAll();
      allReq.onsuccess = () => {
        const extra = (allReq.result as ShotRecord[])
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(MAX_SHOTS);
        for (const item of extra) store.delete(item.id);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("保存失败"));
      tx.onabort = () => reject(tx.error ?? new Error("保存已取消"));
    });
  } finally {
    db.close();
  }
}

export async function removeShot(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("删除失败"));
    });
  } finally {
    db.close();
  }
}

export function downloadShot(shot: Shot) {
  const anchor = document.createElement("a");
  anchor.href = shot.url;
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = new Date(shot.createdAt);
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  anchor.download = `kacha-${stamp}.jpg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
