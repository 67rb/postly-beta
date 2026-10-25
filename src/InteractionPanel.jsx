import { useEffect, useState } from 'react';
import { loadLocal, writeLocal } from './local-data.js';
import { X, Plus, FileText, CalendarDays, Trash2, Check, Copy } from 'lucide-react';
import { copyText } from './local-data.js';

const socialSetup = {
  instagram: { keys: ['INSTAGRAM_CLIENT_ID', 'INSTAGRAM_CLIENT_SECRET'], requirement: 'A Meta app with Instagram Login and the required publishing permissions. Meta may require app review.' },
  tiktok: { keys: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'], requirement: 'A TikTok developer app with Content Posting API access. Public posting can require an app audit.' },
  youtube: { keys: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'], requirement: 'A Google OAuth web client with YouTube Data API v3 enabled and an approved consent screen.' },
};

export function InteractionPanel({ title, onClose, posts, onEdit, onDelete, onConnect, connected, onNotify, onSave, onRefreshPublish, initialNetwork = 'Instagram' }) {
  const [value, setValue] = useState(title === 'Organization settings' ? loadLocal('buffer-organization-name', 'My organization') : '');
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState(title === 'Drafts' ? 'Drafts' : 'Queue');
  const [network, setNetwork] = useState(initialNetwork);
  const [profile, setProfile] = useState('');
  const [socialAccounts, setSocialAccounts] = useState({});
  const [socialStatus, setSocialStatus] = useState('loading');
  const [socialError, setSocialError] = useState('');
  const [socialActionError, setSocialActionError] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copiedCallback, setCopiedCallback] = useState('');
  const queue = posts.filter(post => post.status === 'scheduled');
  const published = posts.filter(post => post.status === 'published');
  const publishing = posts.filter(post => post.status === 'publishing');
  const displayedPosts = tab === 'Drafts' ? posts.filter(post => post.status === 'draft') : tab === 'Published' ? published : tab === 'Publishing' ? publishing : queue;
  const drafts = posts.filter(post => post.status === 'draft');
  const isQueue = ['Publish', 'Scheduled posts', 'Drafts'].includes(title);
  useEffect(() => {
    if (title !== 'Connect Channel' && title !== 'Manage channels') return;
    let active = true;
    setSocialStatus('loading');
    setSocialError('');
    setSocialActionError(null);
    setSocialAccounts({});
    (async () => {
      try {
        const response = await fetch('/api/social/status');
        if (!response.ok) {
          if (active) {
            setSocialStatus('error');
            setSocialError(`The Postly OAuth setup API returned HTTP ${response.status}. Provider credentials were not checked.`);
          }
          return;
        }
        const data = await response.json();
        const providerKeys = ['instagram', 'tiktok', 'youtube'];
        if (!data?.providers || !providerKeys.every(key => data.providers[key] && typeof data.providers[key] === 'object')) {
          throw new Error('incomplete_provider_status');
        }
        if (active) {
          setSocialAccounts(data.providers);
          setSocialStatus('ready');
        }
      } catch (error) {
        if (!active) return;
        setSocialStatus('error');
        setSocialError(error.message === 'incomplete_provider_status'
          ? 'Postly returned incomplete provider status. Credentials and redirect URLs were not checked.'
          : 'Could not reach Postly’s local OAuth setup API. Credentials and redirect URLs were not checked.');
      }
    })();
    return () => { active = false; };
  }, [title]);
  const socialProvider = ({ Instagram: 'instagram', TikTok: 'tiktok', YouTube: 'youtube' })[network];
  const accountStatus = socialProvider && socialAccounts[socialProvider];
  const setupKeys = Array.isArray(accountStatus?.requiredEnvironmentKeys)
    ? accountStatus.requiredEnvironmentKeys
    : socialProvider ? socialSetup[socialProvider].keys : [];
  const missingKeys = Array.isArray(accountStatus?.missingEnvironmentKeys)
    ? accountStatus.missingEnvironmentKeys
    : accountStatus?.configured ? [] : setupKeys;
  const providerStatusError = accountStatus?.error === 'account_store_unavailable';
  const connectedProvider = socialStatus === 'ready' && Boolean(accountStatus?.connected);
  const canConnectProvider = socialStatus === 'ready' && Boolean(accountStatus?.configured) && !accountStatus?.connected && !providerStatusError;
  const connectionLabel = socialStatus === 'loading' ? 'Checking connection settings…'
    : socialStatus === 'error' ? 'Connection status unavailable'
      : !accountStatus ? 'Provider status unavailable'
        : providerStatusError ? 'Connection status unavailable'
        : accountStatus.connected ? `Connected as ${accountStatus.profile || network}`
          : accountStatus.configured ? 'Disconnected · Ready to connect' : 'Disconnected · Setup required';
  const disconnectAccount = async () => {
    if (!socialProvider || disconnecting) return;
    setSocialActionError(null);
    setDisconnecting(true);
    try {
      const response = await fetch(`/api/social/${socialProvider}/disconnect`, { method: 'POST' });
      if (!response.ok) {
        setSocialActionError({ provider: socialProvider, message: `Postly could not disconnect ${network} (HTTP ${response.status}). The last confirmed connection status is still shown.` });
        return;
      }
      setSocialAccounts(current => ({ ...current, [socialProvider]: { ...current[socialProvider], connected: false, profile: '' } }));
      setSaved(false);
    } catch {
      setSocialActionError({ provider: socialProvider, message: `Could not reach Postly to disconnect ${network}. The last confirmed connection status is still shown.` });
    } finally {
      setDisconnecting(false);
    }
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
          <div className="interaction-tabs"><button className={tab === 'Queue' ? 'current' : ''} onClick={() => setTab('Queue')}>Queue ({queue.length})</button><button className={tab === 'Drafts' ? 'current' : ''} onClick={() => setTab('Drafts')}>Drafts ({drafts.length})</button><button className={tab === 'Published' ? 'current' : ''} onClick={() => setTab('Published')}>Published ({published.length})</button><button className={tab === 'Publishing' ? 'current' : ''} onClick={() => setTab('Publishing')}>Publishing ({publishing.length})</button></div>
          {displayedPosts.length ? displayedPosts.map(post => <article className="saved-post" key={post.id}><div><span className="saved-post-status">{post.status === 'draft' ? <FileText size={14}/> : <CalendarDays size={14}/>} {post.status} · {post.summary}</span><p>{post.text || 'Media post'}</p>{post.files?.map((file, i) => <small key={i}>{file}</small>)}</div><div className="saved-post-actions">{post.status === 'publishing' && <button onClick={() => onRefreshPublish?.(post)}>Check status</button>}{post.status !== 'publishing' && <button onClick={() => onEdit(post)}>Edit</button>}<button aria-label="Delete post" onClick={() => onDelete(post.id)}><Trash2 size={15}/></button></div></article>) : <div className="panel-empty"><CalendarDays size={28}/><h3>{tab === 'Publishing' ? 'No posts are processing' : 'No posts here yet'}</h3><p>{tab === 'Publishing' ? 'Posts that a social network is processing will appear here.' : 'Saved drafts and scheduled posts will appear here.'}</p><button className="panel-action" onClick={() => onEdit(null)}><Plus size={15}/> Create Post</button></div>}
        </> : title === 'Connect Channel' || title === 'Manage channels' ? <>
          <p className="panel-intro">Connect an account to authorize Postly with that network. Your sign-in stays on the network’s secure page.</p>
          <div className="network-grid">{['Instagram','TikTok','LinkedIn','Threads','Bluesky','Facebook','YouTube','Pinterest'].map(name => <button key={name} className={network === name ? 'selected' : ''} onClick={() => { setNetwork(name); setSaved(false); setCopiedCallback(''); setSocialActionError(null); setProfile(loadLocal("buffer-profiles", {})[name] || ''); }}>{name}{socialAccounts[({ Instagram: 'instagram', TikTok: 'tiktok', YouTube: 'youtube' })[name]]?.connected && <Check size={14}/>}</button>)}</div>
          {socialProvider ? <section className="social-connect-card" aria-label={`${network} account connection`}>
            <div className={`social-connect-status${socialStatus === 'error' || providerStatusError ? ' is-error' : connectedProvider ? ' is-connected' : ''}`} role="status">
              <span className={`connection-dot${socialStatus === 'error' || providerStatusError ? ' is-error' : connectedProvider || canConnectProvider ? ' is-ready' : ''}`} aria-hidden="true" />
              <span>{connectionLabel}</span>
            </div>
            {connectedProvider
              ? <button className="panel-action secondary-connect" disabled={disconnecting} onClick={disconnectAccount}>{disconnecting ? `Disconnecting ${network}…` : `Disconnect ${network}`}</button>
              : <>
                {!providerStatusError && <button className="panel-action" disabled={!canConnectProvider} onClick={() => { window.location.assign(`/api/social/${socialProvider}/connect`); }}>{socialStatus === 'error' ? 'Connection unavailable' : `Connect ${network} account`}</button>}
                {providerStatusError && <p className="panel-note" role="alert">Postly could not read the saved account connection, so connection actions are unavailable until the local account store can be read.</p>}
                {socialStatus === 'ready' && accountStatus && !accountStatus.configured && <p className="panel-note">Add the missing developer app credentials to the server’s <code>.env.local</code> file to enable sign-in.</p>}
              </>}
            <details className="social-setup-details" open={socialStatus === 'ready' && (!accountStatus?.configured || providerStatusError)}>
              <summary>{network} OAuth setup details</summary>
              <p>{socialSetup[socialProvider].requirement}</p>
              <p>Register this exact OAuth redirect URL in the provider’s developer console:</p>
              {accountStatus?.redirectUri
                ? <div className="social-setup-uri"><code>{accountStatus.redirectUri}</code><button type="button" className="pw-icon-button" aria-label={`Copy ${network} redirect URL`} title="Copy redirect URL" onClick={async () => { const copied = await copyText(accountStatus.redirectUri); setCopiedCallback(copied ? socialProvider : 'error'); }}><Copy size={15}/></button></div>
                : <p className="panel-note" role="status">The exact redirect URL is unavailable until Postly’s OAuth setup API responds. Do not register a guessed URL.</p>}
              <p>Required environment key names for <code>.env.local</code>:</p>
              <ul className="social-setup-keys">{setupKeys.map(key => <li key={key}><code>{key}</code><span>{socialStatus !== 'ready' || !accountStatus ? 'Not checked' : missingKeys.includes(key) ? 'Missing' : 'Set'}</span></li>)}</ul>
              {socialStatus === 'ready' && accountStatus?.configured && <p className="panel-note">Credentials are present on this server. Restart Postly after changing <code>.env.local</code>.</p>}
              {copiedCallback === socialProvider && <p className="panel-success" role="status">Redirect URL copied.</p>}
              {copiedCallback === 'error' && <p className="composer-error" role="alert">Clipboard access is unavailable. Select and copy the URL above.</p>}
            </details>
            {socialError && <p className="composer-error" role="alert">{socialError}</p>}
            {socialActionError?.provider === socialProvider && <p className="composer-error" role="alert">{socialActionError.message}</p>}
          </section> : <p className="panel-note">Sign-in is currently supported for Instagram, TikTok, and YouTube.</p>}
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
