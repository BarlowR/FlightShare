/**
 * IndexedDB draft store. There is no backend in this build, so a draft (bundle
 * JSON + photo blobs) is persisted locally and handed from the upload page to
 * the edit page by slug (?draft=<slug>). IndexedDB — not localStorage — because
 * drafts hold several MB of image bytes.
 */

import type { Draft } from "./bundle";

const DB = "peregrination-drafts";
const STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: "slug" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const saveDraft = (d: Draft) =>
  tx("readwrite", (s) => s.put({ ...d, updated: Date.now() }));

export const loadDraft = (slug: string) =>
  tx<Draft | undefined>("readonly", (s) => s.get(slug));

export const deleteDraft = (slug: string) =>
  tx("readwrite", (s) => s.delete(slug));

export const listDrafts = () =>
  tx<Draft[]>("readonly", (s) => s.getAll());
