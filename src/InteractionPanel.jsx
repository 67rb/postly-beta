import { useEffect, useState } from 'react';
import { loadLocal, writeLocal } from './local-data.js';
import { X, Plus, FileText, CalendarDays, Trash2, Check } from 'lucide-react';

export function InteractionPanel({ title, onClose, posts, onEdit, onDelete, onConnect, connected, onNotify, onSave }) {
  const [value, setValue] = useState(title === 'Organization settings' ? loadLocal('buffer-organization-name', 'My organization') : '');
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState(title === 'Drafts' ? 'Drafts' : 'Queue');
  const [network, setNetwork] = useState('Instagram');
  const [profile, setProfile] = useState('');
  const [socialAccounts, setSocialAccounts] = useState({});
  const [socialReady, setSocialReady] = useState(false);
  const [socialError, setSocialError] = useState('');
  const queue = posts.filter(post => post.status === 'scheduled');
  const published = posts.filter(post => post.status === 'published');
  const displayedPosts = tab === 'Drafts' ? posts.filter(post => post.status === 'draft') : tab === 'Published' ? published : queue;
  const drafts = posts.filter(post => post.status === 'draft');
  const isQueue = ['Publish', 'Scheduled posts', 'Drafts'].includes(title);
  useEffect(() => {
    if (title !== 'Connect Channel' && title !== 'Manage channels') return;
    fetch('/api/social/status').then(response => response.ok ? response.json() : Promise.reject()).then(data => setSocialAccounts(data.providers || {})).catch(() => setSocialError('Start Postly with its local server to use account sign-in.')).finally(() => setSocialReady(true));
  }, [title]);
  const socialProvider = ({ Instagram: 'instagram', TikTok: 'tiktok', YouTube: 'youtube' })[network];
  const accountStatus = socialProvider && socialAccounts[socialProvider];
  const disconnectAccount = async () => {
    if (!socialProvider) return;
    const response = await fetch(`/api/social/${socialProvider}/disconnect`, { method: 'POST' });
    if (response.ok) {
      setSocialAccounts(current => ({ ...current, [socialProvider]: { ...current[socialProvider], connected: false, profile: '' } }));
      setSaved(false);
    } else setSocialError('Could not disconnect this account. Try again.');
  };
  const formTitles = ['Idea', 'Invite a Team Member', 'Create a Start Page', 'Share Feedback', 'Organization settings', 'Add a link', 'Hashtag Manager'];
  const submit = event => {
    event.preventDefault();
    if (!value.trim()) return;
    if (title === 'Add a link' || title === 'Hashtag Manager') { onNotify(value.trim(), true); onClose(); return; }
    const key = `buffer-${title.toLowerCase().replaceAll(' ', '-')}`;
    const existing = loadLocal(key, []);
    if (!writeLocal(key, [...existing, { value: value.trim(), createdAt: new Date().toISOString() }])) return;
    onSave?.(title, value.trim());
    setSaved(true);
  };
  return <div className="interaction-layer">
    <button className="scrim" aria-label={`Close ${title}`} onClick={onClose} />
    <section className="interaction-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="icon-button" aria-label="Close panel" onClick={onClose}><X size={19} /></button></header>
      <div className="interaction-content">
        {isQueue ? <>
          <div className="interaction-tabs"><button className={tab === 'Queue' ? 'current' : ''} onClick={() => setTab('Queue')}>Queue ({queue.length})</button><button className={tab === 'Drafts' ? 'current' : ''} onClick={() => setTab('Drafts')}>Drafts ({drafts.length})</button><button className={tab === 'Published' ? 'current' : ''} onClick={() => setTab('Published')}>Published ({published.length})</button></div>
          {displayedPosts.length ? displayedPosts.map(post => <article className="saved-post" key={post.id}><div><span className="saved-post-status">{post.status === 'draft' ? <FileText size={14}/> : <CalendarDays size={14}/>} {post.status} · {post.summary}</span><p>{post.text || 'Media post'}</p>{post.files?.map((file, i) => <small key={i}>{file}</small>)}</div><div className="saved-post-actions"><button onClick={() => onEdit(post)}>Edit</button><button aria-label="Delete post" onClick={() => onDelete(post.id)}><Trash2 size={15}/></button></div></article>) : <div className="panel-empty"><CalendarDays size={28}/><h3>No posts here yet</h3><p>Saved drafts and scheduled posts will appear here.</p><button className="panel-action" onClick={() => onEdit(null)}><Plus size={15}/> Create Post</button></div>}
        </> : title === 'Connect Channel' || title === 'Manage channels' ? <>
          <p className="panel-intro">Connect an account to authorize Postly with that network. Your sign-in stays on the network’s secure page.</p>
          <div className="network-grid">{['Instagram','TikTok','LinkedIn','Threads','Bluesky','Facebook','YouTube','Pinterest'].map(name => <button key={name} className={network === name ? 'selected' : ''} onClick={() => { setNetwork(name); setSaved(false); setProfile(loadLocal("buffer-profiles", {})[name] || ''); }}>{name}{socialAccounts[({ Instagram: 'instagram', TikTok: 'tiktok', YouTube: 'youtube' })[name]]?.connected && <Check size={14}/>}</button>)}</div>
          {socialProvider ? <section className="social-connect-card" aria-label={`${network} account connection`}>
            {accountStatus?.connected ? <><div className="social-connect-status"><span className="online-dot"/><span>Connected as <strong>{accountStatus.profile || network}</strong></span></div><button className="panel-action secondary-connect" onClick={disconnectAccount}>Disconnect {network}</button></> : <>
              <div className="social-connect-status"><span className="connection-dot"/><span>{socialReady ? accountStatus?.configured ? 'Ready to connect' : 'Developer app setup required' : 'Checking connection settings…'}</span></div>
              <button className="panel-action" disabled={!socialReady || !accountStatus?.configured} onClick={() => { window.location.assign(`/api/social/${socialProvider}/connect`); }}>Connect {network} account</button>
              {!accountStatus?.configured && socialReady && !socialError && <p className="panel-note">Add the {network} developer app credentials to the server’s <code>.env.local</code> file to enable sign-in.</p>}
            </>}
          </section> : <p className="panel-note">Sign-in is currently supported for Instagram, TikTok, and YouTube.</p>}
          {socialError && <p className="composer-error" role="alert">{socialError}</p>}
          <details className="local-profile-details" open={!socialProvider}><summary>Set a local preview profile</summary><form onSubmit={event => { event.preventDefault(); onConnect(network, profile.trim() || 'studio.notes'); setSaved(true); }}><label>Profile name<input value={profile} onChange={event => { setProfile(event.target.value); setSaved(false); }} placeholder="studio.notes"/></label><button className="panel-action" type="submit">{connected.includes(network) ? 'Update profile' : 'Add channel'}</button></form>{saved && <p className="panel-success" role="status">{network} preview profile saved locally.</p>}</details>
        </> : formTitles.includes(title) ? saved ? <div className="panel-empty"><Check size={28}/><h3>{title === 'Invite a Team Member' ? 'Invitation saved' : 'Saved'}</h3><p>Your changes are stored in this browser.</p><button className="panel-action" onClick={() => { setSaved(false); setValue(''); }}>Add another</button></div> : <form onSubmit={submit}>
          <label>{title === 'Invite a Team Member' ? 'Email address' : title === 'Add a link' ? 'Website URL' : title === 'Organization settings' ? 'Organization name' : title === 'Hashtag Manager' ? 'Hashtags' : title === 'Create a Start Page' ? 'Page title and introduction' : title === 'Share Feedback' ? 'Your feedback' : 'Your idea'}
          {['Add a link','Invite a Team Member','Organization settings'].includes(title) ? <input type={title === 'Invite a Team Member' ? 'email' : title === 'Add a link' ? 'url' : 'text'} required value={value} onChange={e => setValue(e.target.value)} placeholder={title === 'Add a link' ? 'https://' : ''}/> : <textarea required value={value} onChange={e => setValue(e.target.value)} rows={5}/>}</label>
          <button type="submit" className="panel-action" disabled={!value.trim()}>{title === 'Add a link' || title === 'Hashtag Manager' ? 'Insert into post' : 'Save'}</button>
          {title === 'Invite a Team Member' && <p className="panel-note">This saves a local invitation record; no email is sent.</p>}
        </form> : title === 'Community' || title === 'Comments' ? <div className="panel-empty"><FileText size={28}/><h3>No comments yet</h3><p>Comments from connected social accounts will appear here when integrations are enabled.</p></div> : title === 'Insights' ? <><p className="panel-intro">Your activity in this workspace</p><div className="local-metrics"><div><strong>{queue.length}</strong><span>Queued posts</span></div><div><strong>{drafts.length}</strong><span>Drafts</span></div><div><strong>{connected.length}</strong><span>Channels</span></div></div><p className="panel-note">Audience analytics need live social account integrations.</p></> : title === 'Explore Postly API' ? <><h3>Connect your publishing workflow</h3><p className="panel-intro">Postly can authorize social accounts through their official sign-in flows. Publishing still requires the corresponding developer app to be approved and configured.</p><button className="panel-action" onClick={() => onEdit(null)}>Create a post</button></> : <><h3>How can we help?</h3><div className="help-topics"><button onClick={() => onEdit(null)}>Create and schedule a post</button><button onClick={() => onNotify('Connect Channel')}>Manage connected channels</button><button onClick={() => onNotify('Publish')}>Find saved drafts and posts</button></div></>}
      </div>
    </section>
  </div>;
}
