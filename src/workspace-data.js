import { calendarDateInTimezone, formatInTimezone, loadLocal, scheduledDateInTimezone, writeLocal } from './local-data.js';

// Consolidate templates created in the original composer and the workspace.
export function loadTemplates() {
  const current = loadLocal('postly-templates', []);
  const legacy = loadLocal('postly-templates-migrated', false) ? [] : loadLocal('buffer-templates', []);
  const seen = new Set();
  const templates = [...current, ...legacy].filter(item => {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) return false;
    const key = item.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(item => ({ ...item, id: item.id || crypto.randomUUID(), description: item.description || '' }));
  writeLocal('postly-templates', templates);
  writeLocal('postly-templates-migrated', true);
  return templates;
}

export function localDay(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatPostDate(record, preferences = {}) {
  const date = new Date(record.status === "draft" ? record.updatedAt || record.createdAt : record.scheduleAt || record.updatedAt || record.createdAt);
  if (!Number.isFinite(date.getTime())) return 'Unscheduled';
  return formatInTimezone(date, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: preferences['Time Format'] === '24-hour' ? 'h23' : 'h12' }, preferences.Timezone || 'Johannesburg');
}

export function dateRange(period, start, end, timezone = 'Johannesburg') {
  const today = calendarDateInTimezone(new Date(), timezone);
  const endOfDay = day => {
    const date = scheduledDateInTimezone(day, '11:59 PM', timezone);
    if (date) date.setSeconds(59, 999);
    return date;
  };
  const startOfDay = day => scheduledDateInTimezone(day, '12:00 AM', timezone);
  const to = endOfDay(today);
  let from = startOfDay(today);
  if (period === 'Month to Date') { today.setDate(1); from = startOfDay(today); }
  else if (period === 'Custom') {
    const customFrom = Number.isFinite(Date.parse(`${start}T12:00:00`)) ? startOfDay(new Date(`${start}T12:00:00`)) : new Date(NaN);
    const customTo = Number.isFinite(Date.parse(`${end}T12:00:00`)) ? endOfDay(new Date(`${end}T12:00:00`)) : new Date(NaN);
    return { from: customFrom, to: customTo, valid: Number.isFinite(customFrom.getTime()) && Number.isFinite(customTo.getTime()) && customFrom <= customTo };
  } else { today.setDate(today.getDate() - (period === '7 Days' ? 6 : 29)); from = startOfDay(today); }
  return { from, to, valid: Boolean(from && to && Number.isFinite(from.getTime()) && Number.isFinite(to.getTime())) };
}
