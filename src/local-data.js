export function loadLocal(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (value == null || typeof value !== typeof fallback || Array.isArray(value) !== Array.isArray(fallback)) return fallback;
    return value;
  } catch { return fallback; }
}

export function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { window.dispatchEvent(new Event('buffer-storage-error')); return false; }
}

let database;
function mediaDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('buffer-local-media', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { database = undefined; throw error; });
  return database;
}

export async function saveMedia(file) {
  const db = await mediaDatabase();
  const entry = { id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, blob: file };
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    transaction.objectStore('files').put(entry);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  const { blob, ...metadata } = entry;
  return metadata;
}

export async function readMedia(id) {
  const db = await mediaDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(id);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(request.error);
  });
}

export function nextSlot() {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date;
}

export function nextQuarter() { return new Date(Math.ceil((Date.now() + 60000) / 900000) * 900000); }

export function scheduledDate(day, time) {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]), period = match[3]?.toUpperCase();
  if (minutes > 59 || (period ? hours < 1 || hours > 12 : hours > 23)) return null;
  if (period) hours = hours % 12 + (period === 'PM' ? 12 : 0);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
}

export async function pruneMedia(keepIds) {
  const db = await mediaDatabase();
  const keys = await new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const unused = keys.filter(key => !keepIds.has(key));
  if (!unused.length) return;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');
    unused.forEach(id => store.delete(id));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}
