import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Copy, FileText, Image, Pencil, Plus, RefreshCw, Search, Trash2, Video, X } from 'lucide-react';
import { readMedia } from './local-data.js';
import { formatPostDate, localDay } from './workspace-data.js';
import { calendarDateInTimezone, dayKeyInTimezone, datePartsInTimezone, formatCalendarHour, formatInTimezone, scheduledDateInTimezone } from './local-data.js';

const overdue = record => record.status === 'scheduled' && record.scheduleAt && Date.parse(record.scheduleAt) < Date.now();

export function PostCard({ record, channels, preferences, onEdit, onDuplicate, onDelete, onRefreshPublish, onRefreshScheduledDelivery, onRetryScheduledDelivery, compact = false, selectable = false, selected = false, onSelect }) {
  const [preview, setPreview] = useState('');
  const [checking, setChecking] = useState(false);
  const attachment = record.attachments?.[0];
  useEffect(() => {
    let active = true, url;
    setPreview('');
    if (attachment?.id) readMedia(attachment.id).then(blob => {
      if (active && blob) { url = URL.createObjectURL(blob); setPreview(url); }
    }).catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [attachment?.id]);
  const publishResults = record.publishResults || [];
  const deliveryJobs = record.deliveryJobs || [];
  const publishedRemotely = publishResults.some(result => result.status === 'published');
  const processing = record.status === 'publishing';
  const late = overdue(record);
  const deliveryStatus = deliveryJobs.some(job => job.status === 'recovery_required') ? 'Needs review'
    : deliveryJobs.some(job => job.status === 'failed') ? 'Delivery failed'
      : deliveryJobs.some(job => job.status === 'retry_wait') ? 'Retrying'
        : deliveryJobs.some(job => ['processing', 'provider_processing'].includes(job.status)) ? 'Delivering'
          : deliveryJobs.some(job => job.status === 'queued') ? late ? 'Awaiting server' : 'Scheduled for delivery' : '';
  const statusLabel = record.status === 'draft' ? 'Draft'
    : processing ? 'Processing'
      : record.status === 'published' ? publishedRemotely ? 'Published' : 'Local archive'
        : deliveryStatus || (late ? 'Past scheduled time' : 'Queued locally');
  const resultForChannel = (channel, index) => publishResults.find(result => result.channelId && channel.id && result.channelId === channel.id)
    || publishResults.find(result => result.provider && result.provider.toLowerCase() === (channel.name === 'Instagram' ? 'instagram' : channel.name === 'TikTok' ? 'tiktok' : channel.name === 'YouTube' ? 'youtube' : channel.name.toLowerCase()))
    || publishResults.find(result => Number.isInteger(result.channelIndex) && result.channelIndex === index);
  const deliveryForChannel = (channel, index) => deliveryJobs.find(job => job.provider && job.provider === (channel.name === 'Instagram' ? 'instagram' : channel.name === 'TikTok' ? 'tiktok' : channel.name === 'YouTube' ? 'youtube' : channel.name.toLowerCase()))
    || deliveryJobs.find(job => Number.isInteger(job.channelIndex) && job.channelIndex === index);
  return <article className={`pw-post-card pw-real-post ${compact ? 'compact' : ''} ${selected ? 'is-selected' : ''}`}>
    <header><div className="pw-record-heading">{selectable && <input type="checkbox" className="pw-post-checkbox" aria-label={`Select post: ${record.text || 'Media post'}`} checked={selected} onChange={onSelect} disabled={processing}/>}<span className={`pw-record-status ${record.status} ${late ? 'overdue' : ''}`}>{late && <Clock3 size={12}/>} {statusLabel}</span></div><time dateTime={record.scheduleAt || record.createdAt}>{formatPostDate(record, preferences)}</time></header>
    <div className="pw-record-content">{attachment && <div className="pw-record-media">{preview ? attachment.type?.startsWith('video/') ? <video src={preview} preload="metadata" aria-label={attachment.name}/> : <img src={preview} alt={attachment.name}/> : attachment.type?.startsWith('video/') ? <Video size={24}/> : <Image size={24}/>}<span>{record.attachments.length} {record.attachments.length === 1 ? 'file' : 'files'}</span></div>}<p>{record.text || 'Media post'}</p></div>
    <footer><div className="pw-record-channels">{(record.channels || []).map(index => ({ channel: channels[index], index })).filter(item => item.channel).map(({ channel, index }) => {
      const result = resultForChannel(channel, index);
      const delivery = deliveryForChannel(channel, index);
      const deliveryLabel = ({ queued: 'Scheduled', retry_wait: 'Retrying', processing: 'Sending', provider_processing: 'Processing', published: 'Published', failed: 'Failed', recovery_required: 'Review', cancelled: 'Cancelled' })[delivery?.status] || (delivery?.status === 'failed' ? 'Failed' : '');
      const label = result?.status === 'published' ? 'Published' : result?.status === 'publishing' ? 'Processing' : result?.status === 'failed' ? 'Failed' : deliveryLabel;
      const detail = delivery ? `${channel.name}: ${deliveryLabel || delivery.status}${delivery.error ? ` — ${delivery.error}` : ''}` : result ? `${channel.name}: ${label || result.status}${result.error ? ` — ${result.error}` : ''}` : channel.name;
      const ResultIcon = result?.status === 'published' || delivery?.status === 'published' ? Check : result?.status === 'publishing' || ['retry_wait', 'processing', 'provider_processing'].includes(delivery?.status) ? Clock3 : result?.status === 'failed' || ['failed', 'recovery_required'].includes(delivery?.status) ? AlertCircle : null;
      return <span key={channel.id || channel.name} aria-label={detail} title={detail}>{channel.icon}{channel.name}{label && <small>{label}</small>}{ResultIcon && <ResultIcon size={12} aria-hidden="true" style={{ color: label === 'Published' ? '#52864a' : ['Processing', 'Retrying', 'Sending'].includes(label) ? '#5475a8' : '#b4473c' }}/>}</span>;
    })}</div><div className="pw-record-actions">{processing && onRefreshPublish ? <button className="pw-outline" disabled={checking} onClick={async () => { setChecking(true); try { await onRefreshPublish(record); } finally { setChecking(false); } }}><RefreshCw size={14} className={checking ? 'pw-spin' : ''}/>{checking ? 'Checking…' : 'Check status'}</button> : <button className="pw-outline" aria-label="Edit post" disabled={processing} onClick={() => onEdit(record)}><Pencil size={14}/><span>Edit</span></button>}{record.status === 'scheduled' && deliveryJobs.length > 0 && onRefreshScheduledDelivery && <button className="pw-outline" disabled={checking} onClick={async () => { setChecking(true); try { await onRefreshScheduledDelivery(record); } finally { setChecking(false); } }}><RefreshCw size={14} className={checking ? 'pw-spin' : ''}/>{checking ? 'Checking…' : 'Check delivery'}</button>}{deliveryJobs.filter(job => ['failed', 'recovery_required'].includes(job.status) && job.provider && onRetryScheduledDelivery).map(job => <button className="pw-outline" key={job.provider} disabled={checking} onClick={async () => { const confirmRisk = Boolean(job.mayHavePublished); if (confirmRisk && !window.confirm(`Postly cannot confirm whether ${job.channelName || job.provider} received this post. Check that channel first. Retry anyway and accept the duplicate-post risk?`)) return; setChecking(true); try { await onRetryScheduledDelivery(record, job, confirmRisk); } finally { setChecking(false); } }}>{checking ? 'Retrying…' : `Retry ${job.channelName || job.provider}`}</button>)}<button className="pw-icon-button" aria-label="Duplicate post to drafts" title="Duplicate to drafts" onClick={() => onDuplicate(record)}><Copy size={16}/></button><button className="pw-icon-button" aria-label="Delete post" disabled={processing} title={processing ? 'Wait for publishing to finish' : 'Delete post'} onClick={() => onDelete(record)}><Trash2 size={16}/></button></div></footer>
  </article>;
}

function ConfirmBulkDelete({ count, onConfirm, onClose }) {
  const dialog = useRef(null);
  useEffect(() => { const node = dialog.current; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={dialog} className="pw-bulk-dialog" aria-labelledby="bulk-delete-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <h2 id="bulk-delete-title">Delete {count} {count === 1 ? 'post' : 'posts'}?</h2><p>Remove these posts from this workspace. Published posts will stay on your social accounts.</p><p className="pw-muted">You can undo this action for 5 minutes.</p><footer><button className="pw-outline" autoFocus onClick={onClose}>Cancel</button><button className="pw-danger" onClick={onConfirm}>Delete {count} {count === 1 ? 'post' : 'posts'}</button></footer>
  </dialog>;
}

export function PublishList({ records, status, channels, preferences, onCompose, onEdit, onDuplicate, onDelete, onBulkAction, onRefreshPublish, onRefreshScheduledDelivery, onRetryScheduledDelivery, hasFilters, onClearFilters }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('default');
  const [timing, setTiming] = useState('all');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectAll = useRef(null);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const shown = records.filter(record => {
    const text = [record.text, record.firstComment, record.productTags, ...(record.files || []), ...(record.attachments || []).map(file => file.name), ...(record.channels || []).map(index => channels[index]?.name), ...(record.publishResults || []).flatMap(result => [result.provider, result.channelName, result.error])].join(' ').toLocaleLowerCase();
    return terms.every(term => text.includes(term)) && (timing !== 'overdue' || overdue(record));
  }).sort((a, b) => sort === 'newest' ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : sort === 'updated' ? Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt) : 0);
  const selectable = shown.filter(record => record.status !== 'publishing');
  const visibleIds = selectable.map(record => record.id);
  const visibleKey = JSON.stringify(visibleIds);
  const selected = selectedIds.filter(id => visibleIds.includes(id));
  const lateCount = records.filter(overdue).length;
  useEffect(() => { setSelectedIds(current => current.filter(id => visibleIds.includes(id))); setConfirmDelete(false); }, [visibleKey]);
  useEffect(() => { setSelecting(false); setSelectedIds([]); setTiming('all'); setConfirmDelete(false); }, [status]);
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selected.length > 0 && selected.length < selectable.length; }, [selected.length, selectable.length, selecting]);
  const act = action => {
    onBulkAction(action, selected);
    setConfirmDelete(false); setSelectedIds([]); setSelecting(false);
  };
  const clear = () => { setQuery(''); setTiming('all'); onClearFilters(); };
  return <section className="pw-list-content" aria-label={`${status} posts`}>
    <div className="pw-list-title"><h2>{status} <small>{shown.length}{shown.length !== records.length ? ` of ${records.length}` : ''}</small></h2><div className="pw-list-tools"><label className="pw-post-search"><Search size={15}/><input aria-label="Search posts" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search posts, media, tags…"/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14}/></button>}</label><select aria-label="Sort posts" value={sort} onChange={event => setSort(event.target.value)}><option value="default">{status === 'Queue' ? 'Scheduled first' : 'Recently updated'}</option><option value="newest">Newest created</option>{status === 'Queue' && <option value="updated">Recently updated</option>}</select>{onBulkAction && records.some(record => record.status !== 'publishing') && <button className="pw-outline" aria-pressed={selecting} onClick={() => { setSelecting(value => !value); setSelectedIds([]); }}>{selecting ? 'Cancel selection' : 'Select posts'}</button>}</div></div>
    {status === 'Queue' && lateCount > 0 && <div className="pw-queue-attention"><AlertCircle size={17}/><span><b>{lateCount} {lateCount === 1 ? 'post needs' : 'posts need'} attention</b> — the scheduled time has passed. Review the time or move to drafts.</span><button onClick={() => setTiming(value => value === 'overdue' ? 'all' : 'overdue')}>{timing === 'overdue' ? 'Show all' : 'Show overdue'}</button></div>}
    {selecting && <div className="pw-bulk-bar" aria-label="Post selection"><label><input ref={selectAll} type="checkbox" aria-label="Select all visible posts" disabled={!selectable.length} checked={selectable.length > 0 && selected.length === selectable.length} onChange={event => setSelectedIds(event.target.checked ? visibleIds : [])}/><span role="status">{selected.length ? `${selected.length} selected` : 'Select all'}</span></label><div>{status === 'Queue' && <button className="pw-outline" disabled={!selected.length} onClick={() => act('draft')}><FileText size={15}/>Move to drafts</button>}<button className="pw-outline" disabled={!selected.length} onClick={() => act('duplicate')}><Copy size={15}/>Duplicate</button><button className="pw-outline pw-delete-action" disabled={!selected.length} onClick={() => setConfirmDelete(true)}><Trash2 size={15}/>Delete</button></div></div>}
    {shown.length ? <div className="pw-post-list">{shown.map(record => <PostCard key={record.id} {...{record, channels, preferences, onEdit, onDuplicate, onDelete, onRefreshPublish, onRefreshScheduledDelivery, onRetryScheduledDelivery}} selectable={selecting} selected={selected.includes(record.id)} onSelect={() => setSelectedIds(current => current.includes(record.id) ? current.filter(id => id !== record.id) : [...current, record.id])}/>)}</div> : <div className="pw-empty pw-publishing-empty"><span className="pw-empty-icon">{status === 'Drafts' ? <FileText size={28}/> : <CalendarDays size={28}/>}</span><h3>{query || hasFilters || timing !== 'all' ? 'No posts match these filters' : status === 'Drafts' ? 'A place for your next great post' : status === 'Sent' ? 'Your published posts will appear here' : 'Your queue is ready for a fresh start'}</h3><p>{query || hasFilters || timing !== 'all' ? 'Try another search or clear the filters to see your posts.' : status === 'Drafts' ? 'Save a draft and come back when inspiration strikes.' : status === 'Sent' ? 'Posts successfully sent through connected accounts appear here.' : 'Create a post, choose a time, and keep your content organized.'}</p>{query || hasFilters || timing !== 'all' ? <button className="pw-outline" onClick={clear}>Clear filters</button> : <button className="pw-primary" onClick={() => onCompose()}><Plus size={16}/> Create Post</button>}</div>}
    {confirmDelete && selected.length > 0 && <ConfirmBulkDelete count={selected.length} onClose={() => setConfirmDelete(false)} onConfirm={() => act('delete')}/>}
  </section>;
}

export function CalendarView({ month, setMonth, range, onRange, records, preferences, onCompose, onEdit }) {
  const timezone = preferences.Timezone || 'Johannesburg';
  const timeFormat = preferences['Time Format'] === '24-hour' ? '24-hour' : '12-hour';
  const [slotError, setSlotError] = useState('');
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const monday = preferences['Start of Week'] === 'Monday';
  const offset = date => monday ? (date.getDay() + 6) % 7 : date.getDay();
  const start = new Date(range === 'Week' ? month : first); start.setDate(start.getDate() - offset(start));
  const days = Array.from({length: range === 'Week' ? 7 : 42}, (_,i) => new Date(start.getFullYear(),start.getMonth(),start.getDate()+i));
  const onDay = day => records.filter(record => record.scheduleAt && dayKeyInTimezone(record.scheduleAt, timezone) === localDay(day)).sort((a,b) => Date.parse(a.scheduleAt) - Date.parse(b.scheduleAt));
  const dayLabel = day => day.toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'});
  const composeAt = (day, hour=9) => {
    const date = scheduledDateInTimezone(day, `${String(hour).padStart(2,'0')}:00`, timezone);
    if (!date) { setSlotError(`That time is skipped when clocks move forward in ${timezone}. Choose another time.`); return; }
    setSlotError('');
    onCompose({date:date.toISOString()});
  };
  const move = direction => setMonth(range === 'Month' ? new Date(month.getFullYear(), month.getMonth()+direction, 1) : new Date(month.getFullYear(),month.getMonth(),month.getDate()+direction*7));
  const label = range === 'Month' ? month.toLocaleDateString('en-US',{month:'long',year:'numeric'}) : `${days[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${days[6].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
  const event = record => <button className="pw-calendar-event" key={record.id} title={record.text || 'Media post'} onClick={() => onEdit(record)}><b>{formatInTimezone(record.scheduleAt,{hour:'numeric',minute:'2-digit',hourCycle:timeFormat==='24-hour'?'h23':'h12'},timezone)}</b><span>{record.text || 'Media post'}</span></button>;
  return <div className="pw-calendar pw-real-calendar" aria-label={`Post calendar in ${timezone}`}><div className="pw-calendar-head"><div><button className="pw-icon-button" aria-label={`Previous ${range.toLowerCase()}`} onClick={() => { setSlotError(''); move(-1); }}><ChevronLeft size={18}/></button><button className="pw-outline" onClick={() => { setSlotError(''); setMonth(calendarDateInTimezone(new Date(), timezone)); }}>Today</button><button className="pw-icon-button" aria-label={`Next ${range.toLowerCase()}`} onClick={() => { setSlotError(''); move(1); }}><ChevronRight size={18}/></button><strong>{label}<small className="pw-calendar-timezone">Time zone: {timezone}</small></strong></div><select aria-label="Calendar view" value={range} onChange={e => { setSlotError(''); onRange(e.target.value); }}><option>Week</option><option>Month</option></select></div>
    {slotError && <p className="pw-calendar-slot-error" role="status">{slotError}</p>}
    <div className="pw-calendar-scroll">{range === 'Month' ? <div className="pw-calendar-month-grid">{days.slice(0,7).map(day => <b className="pw-calendar-day-label" key={localDay(day)}>{day.toLocaleDateString('en-US',{weekday:'short'})}</b>)}{days.map(day => <div key={localDay(day)} className={`pw-calendar-cell ${day.getMonth() !== month.getMonth() || day.getFullYear() !== month.getFullYear() ? 'outside' : ''} ${localDay(day) === localDay(calendarDateInTimezone(new Date(), timezone)) ? 'today' : ''}`}><button className="pw-calendar-day-number" aria-label={`Create post on ${dayLabel(day)}`} onClick={() => composeAt(day)}>{day.getDate()}<Plus size={12}/></button>{onDay(day).map(event)}</div>)}</div> : <div className="pw-week-grid"><div className="pw-week-days"><span/>{days.map(day => <b key={localDay(day)}>{day.toLocaleDateString('en-US',{weekday:'short',day:'numeric'})}</b>)}</div>{Array.from({length:24},(_,hour) => <div className="pw-week-row" key={hour}><span>{formatCalendarHour(hour,timeFormat)}</span>{days.map(day => <div className="pw-week-cell" key={localDay(day)}><button className="pw-week-add" aria-label={`Create post on ${dayLabel(day)} at ${formatCalendarHour(hour,timeFormat)}`} onClick={() => composeAt(day,hour)}/>{onDay(day).filter(record => datePartsInTimezone(record.scheduleAt,timezone)?.hour === hour).map(event)}</div>)}</div>)}</div>}</div></div>;
}
