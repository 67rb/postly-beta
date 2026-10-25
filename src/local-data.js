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

export async function copyText(text, { navigatorObject = globalThis.navigator, documentObject = globalThis.document } = {}) {
  if (typeof text !== 'string' || !text) return false;
  try {
    if (typeof navigatorObject?.clipboard?.writeText === 'function') {
      await navigatorObject.clipboard.writeText(text);
      return true;
    }
  } catch { /* Try the selection-based fallback below. */ }

  if (!documentObject?.body || typeof documentObject.execCommand !== 'function') return false;
  const field = documentObject.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  Object.assign(field.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
  const activeElement = documentObject.activeElement;
  documentObject.body.appendChild(field);
  let copied = false;
  try {
    field.focus();
    field.select();
    field.setSelectionRange?.(0, field.value.length);
    copied = documentObject.execCommand('copy');
  } catch { copied = false; }
  finally {
    if (typeof field.remove === 'function') field.remove();
    else field.parentNode?.removeChild(field);
    if (activeElement?.isConnected) {
      try { activeElement.focus({ preventScroll: true }); }
      catch { activeElement.focus?.(); }
    }
  }
  return copied;
}

const timezoneAliases = { Johannesburg: 'Africa/Johannesburg' };

export function resolveTimezone(timezone = 'Johannesburg') {
  const resolved = timezoneAliases[timezone] || timezone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: resolved }); return resolved; }
  catch { return 'Africa/Johannesburg'; }
}

export function datePartsInTimezone(date, timezone = 'Johannesburg') {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimezone(timezone), year: 'numeric', month: 'numeric', day: 'numeric',
    weekday: 'long', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(value);
  const result = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(result.year), month: Number(result.month), day: Number(result.day),
    weekday: result.weekday, hour: Number(result.hour) % 24, minute: Number(result.minute), second: Number(result.second),
  };
}

export function calendarDateInTimezone(date, timezone = 'Johannesburg') {
  const parts = datePartsInTimezone(date, timezone);
  return parts ? new Date(parts.year, parts.month - 1, parts.day) : new Date(NaN);
}

export function dayKeyInTimezone(date, timezone = 'Johannesburg') {
  const parts = datePartsInTimezone(date, timezone);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` : '';
}

export function formatInTimezone(date, options, timezone = 'Johannesburg') {
  if (date == null) return '';
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return '';
  return value.toLocaleString('en-US', { ...options, timeZone: resolveTimezone(timezone) });
}

export function parseScheduleTime(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]), period = match[3]?.toUpperCase();
  if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (period) hour = hour % 12 + (period === 'PM' ? 12 : 0);
  return { hour, minute };
}

export function formatScheduleTime(value, timeFormat = '12-hour') {
  const parsed = parseScheduleTime(value);
  if (!parsed) return '';
  const minute = String(parsed.minute).padStart(2, '0');
  if (timeFormat === '24-hour') return `${String(parsed.hour).padStart(2, '0')}:${minute}`;
  return `${parsed.hour % 12 || 12}:${minute} ${parsed.hour < 12 ? 'AM' : 'PM'}`;
}

export function formatCalendarHour(hour, timeFormat = '12-hour') {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return '';
  if (timeFormat === '24-hour') return String(hour).padStart(2, '0');
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function scheduledDateInTimezone(day, time, timezone = 'Johannesburg') {
  if (!(day instanceof Date) || !Number.isFinite(day.getTime())) return null;
  const parsed = parseScheduleTime(time);
  if (!parsed) return null;
  const { hour: hours, minute: minutes } = parsed;

  const target = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
  let timestamp = target;
  for (let attempt = 0; attempt < 5; attempt++) {
    const parts = datePartsInTimezone(new Date(timestamp), timezone);
    if (!parts) return null;
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const adjustment = target - represented;
    timestamp += adjustment;
    if (adjustment === 0) break;
  }

  const result = new Date(timestamp);
  const actual = datePartsInTimezone(result, timezone);
  if (!actual || actual.year !== day.getFullYear() || actual.month !== day.getMonth() + 1 || actual.day !== day.getDate() || actual.hour !== hours || actual.minute !== minutes) return null;
  // When a fall-back transition repeats a wall time, this conversion consistently resolves to its earlier occurrence.
  return result;
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

export function nextSlot(timezone = 'Johannesburg') {
  const date = calendarDateInTimezone(new Date(), timezone);
  let slot = scheduledDateInTimezone(date, '9:00 AM', timezone);
  if (!slot || slot.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
    slot = scheduledDateInTimezone(date, '9:00 AM', timezone);
  }
  return slot || new Date(NaN);
}

export function nextAvailableSlot(schedules, timezone = 'Johannesburg') {
  const now = Date.now();
  const slots = [];
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const schedule of schedules || []) {
    const zone = schedule.timezone || timezone;
    const today = calendarDateInTimezone(new Date(now), zone);
    for (let offset = 0; offset < 14; offset++) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      const daySchedule = schedule.days?.find(item => item.day === weekdays[day.getDay()]);
      if (!daySchedule?.enabled) continue;
      for (const time of daySchedule.times || []) {
        const slot = scheduledDateInTimezone(day, time, zone);
        if (slot && slot.getTime() > now) slots.push(slot);
      }
    }
  }
  return slots.length ? new Date(Math.min(...slots.map(slot => slot.getTime()))) : null;
}

export function nextQuarter() { return new Date(Math.ceil((Date.now() + 60000) / 900000) * 900000); }

export function scheduledDate(day, time) {
  return scheduledDateInTimezone(day, time, Intl.DateTimeFormat().resolvedOptions().timeZone || 'Johannesburg');
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
