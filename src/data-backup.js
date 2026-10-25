const LEGACY_STORAGE_KEYS = new Set([
  "buffer-posts",
  "buffer-channels",
  "buffer-organization-name",
  "buffer-profiles",
  "buffer-done-steps",
  "buffer-templates",
]);

const BACKUP_FORMAT = "postly-local-backup";
const BACKUP_VERSION = 1;
const MEDIA_DATABASE = "buffer-local-media";

function isPostlyStorageKey(key) {
  return key.startsWith("postly-") || LEGACY_STORAGE_KEYS.has(key);
}

function openMediaDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Postly could not read the media library."));
  });
}

function readAllMedia(database) {
  if (!database) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const request = database.transaction("files", "readonly").objectStore("files").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("Postly could not read the media library."));
  });
}

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function createPostlyBackup() {
  const storage = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && isPostlyStorageKey(key)) storage[key] = localStorage.getItem(key);
  }

  const database = await openMediaDatabase();
  try {
    const media = await readAllMedia(database);
    const files = await Promise.all(media.map(async item => {
      if (!item?.id || !(item.blob instanceof Blob)) return null;
      return {
        id: item.id,
        name: typeof item.name === "string" ? item.name : "media",
        type: typeof item.type === "string" ? item.type : item.blob.type,
        size: item.blob.size,
        data: encodeBase64(await item.blob.arrayBuffer()),
      };
    }));

    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      storage,
      media: files.filter(Boolean),
    };
  } finally {
    database?.close();
  }
}

export function parsePostlyBackup(text) {
  let backup;
  try { backup = JSON.parse(text); }
  catch { throw new Error("That file is not valid JSON."); }
  if (backup?.format !== BACKUP_FORMAT || backup?.version !== BACKUP_VERSION) {
    throw new Error("This is not a backup file Postly can restore.");
  }
  if (!backup.storage || typeof backup.storage !== "object" || Array.isArray(backup.storage) || !Array.isArray(backup.media)) {
    throw new Error("The backup is missing Postly data or media.");
  }

  const storageEntries = Object.entries(backup.storage);
  if (storageEntries.some(([key, raw]) => !isPostlyStorageKey(key) || typeof raw !== "string")) {
    throw new Error("The backup contains invalid browser data.");
  }
  try { storageEntries.forEach(([, raw]) => JSON.parse(raw)); }
  catch { throw new Error("The backup contains damaged browser data."); }

  const mediaIds = new Set();
  for (const item of backup.media) {
    if (!item || typeof item.id !== "string" || !item.id || mediaIds.has(item.id)
      || typeof item.name !== "string" || typeof item.type !== "string"
      || !Number.isFinite(item.size) || item.size < 0 || typeof item.data !== "string"
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)) {
      throw new Error("The backup contains invalid media data.");
    }
    mediaIds.add(item.id);
  }

  return {
    ...backup,
    counts: {
      posts: safeArray(backup.storage["buffer-posts"]).length,
      ideas: safeArray(backup.storage["postly-ideas"]).length,
      templates: safeArray(backup.storage["postly-templates"]).length + safeArray(backup.storage["buffer-templates"]).length,
      media: backup.media.length,
    },
  };
}

function safeArray(raw) {
  if (typeof raw !== "string") return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function replaceMedia(backupMedia) {
  return openMediaDatabase().then(database => {
    if (!database) {
      if (backupMedia.length) throw new Error("This browser cannot restore uploaded media.");
      return;
    }
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("files", "readwrite");
      const store = transaction.objectStore("files");
      store.clear();
      for (const item of backupMedia) {
        const blob = new Blob([decodeBase64(item.data)], { type: item.type });
        store.put({ id: item.id, name: item.name, type: item.type, size: blob.size, blob });
      }
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Postly could not restore uploaded media."));
      transaction.onabort = () => reject(transaction.error || new Error("Postly could not restore uploaded media."));
    }).finally(() => database.close());
  });
}

export async function restorePostlyBackup(backup) {
  const previous = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && isPostlyStorageKey(key)) previous[key] = localStorage.getItem(key);
  }

  try {
    Object.keys(previous).forEach(key => localStorage.removeItem(key));
    Object.entries(backup.storage).forEach(([key, value]) => localStorage.setItem(key, value));
    await replaceMedia(backup.media);
  } catch (error) {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key && isPostlyStorageKey(key)) localStorage.removeItem(key);
    }
    for (const [key, value] of Object.entries(previous)) localStorage.setItem(key, value);
    throw error;
  }
}
