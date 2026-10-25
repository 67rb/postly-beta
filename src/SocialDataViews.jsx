import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, BarChart3, CheckCircle2, ChevronDown, ExternalLink, Filter, LoaderCircle, MessageCircle, Radio, RefreshCw, Search, Send, X, XCircle } from "lucide-react";
import { Popover } from "./Popover.jsx";
import { dateRange } from "./workspace-data.js";
import { dayKeyInTimezone, formatInTimezone, loadLocal, writeLocal } from "./local-data.js";

const providerNames = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };
const communityScopes = { instagram: "instagram_business_manage_comments", youtube: "https://www.googleapis.com/auth/youtube.force-ssl" };
const emptySummary = () => ({ followers: null, views: null, likes: null, comments: null, shares: null, reactions: null, engagement: null, posts: null });
const commentKey = item => `${item.provider}:${item.id}`;

function number(value, compact = false) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en", { notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(Number(value));
}

function metricSummary(accounts) {
  const result = emptySummary();
  for (const key of ["followers", "views", "likes", "comments", "shares", "reactions", "posts"]) {
    const values = accounts.map(account => {
      const raw = account.summary?.[key] ?? (key === "followers" ? account.followers : undefined);
      return raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw);
    });
    result[key] = values.length && values.every(value => value !== null)
      ? values.reduce((total, value) => total + value, 0)
      : null;
  }
  if (result.reactions === null && result.likes !== null && result.comments !== null && result.shares !== null) {
    result.reactions = result.likes + result.comments + result.shares;
  }
  result.engagement = result.followers && result.reactions !== null
    ? Number((100 * result.reactions / result.followers).toFixed(2))
    : null;
  return result;
}

function statusProviders(socialStatus) {
  return Object.entries(socialStatus || {}).filter(([, status]) => status?.connected).map(([provider]) => provider);
}

function requestError(payload, response, fallback) {
  const error = new Error(payload?.error || payload?.message || fallback);
  error.status = response.status;
  return error;
}

function useProviderInsights(socialStatus, timezone, range, refreshKey = 0) {
  const [state, setState] = useState({ data: null, loading: false, error: "" });
  const connectedKey = statusProviders(socialStatus).sort().join(",");
  const since = range.valid ? dayKeyInTimezone(range.from, timezone) : "";
  const until = range.valid ? dayKeyInTimezone(range.to, timezone) : "";

  useEffect(() => {
    if (!connectedKey) {
      setState({ data: { accounts: [], summary: emptySummary(), posts: [], errors: [], source: "disconnected" }, loading: false, error: "" });
      return;
    }
    if (!range.valid) {
      setState({ data: null, loading: false, error: "" });
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: "" });
    const query = new URLSearchParams({ since, until });
    fetch("/api/social/insights?" + query, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw requestError(payload, response, "Account insights could not be loaded.");
        return payload;
      })
      .then(data => setState({ data, loading: false, error: "" }))
      .catch(error => {
        if (error.name !== "AbortError") setState({ data: null, loading: false, error: error.message || "Account insights could not be loaded." });
      });
    return () => controller.abort();
  }, [connectedKey, since, until, range.valid, refreshKey]);

  return { ...state, connected: Boolean(connectedKey), connectedProviders: connectedKey ? connectedKey.split(",") : [], since, until };
}

function insightSourceLabel({ connected, loading, error, data, accounts, errors, selectedCount }) {
  if (!connected) return "Disconnected · live metrics unavailable";
  if (selectedCount === 0) return "No channels selected";
  if (loading) return "Loading provider metrics…";
  if (error) return "Provider data unavailable";
  if (data?.source === "synthetic") return "Synthetic sample data";
  if (accounts.length && data?.source === "live") return errors.length ? "Live provider data · partial" : "Live provider data";
  if (accounts.length) return "Provider response · source unverified";
  if (errors.length) return "Provider data unavailable";
  return "No provider data returned";
}

function filteredInsights(data, selectedProviders, range, since, until, timezone) {
  const accounts = (data?.accounts || []).filter(account => selectedProviders.includes(account.provider));
  const posts = (data?.posts || []).filter(post => {
    if (!range.valid || !selectedProviders.includes(post.provider) || !post.createdAt) return false;
    const date = new Date(post.createdAt);
    if (!Number.isFinite(date.getTime())) return false;
    const postDay = dayKeyInTimezone(date, timezone);
    return postDay >= since && postDay <= until;
  }).sort((a, b) => {
    const reactionsA = Number.isFinite(Number(a.metrics?.reactions)) ? Number(a.metrics.reactions) : -1;
    const reactionsB = Number.isFinite(Number(b.metrics?.reactions)) ? Number(b.metrics.reactions) : -1;
    return reactionsB - reactionsA || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
  return { accounts, posts, summary: metricSummary(accounts) };
}

function csvCell(value) {
  return '"' + String(value ?? "").replaceAll('"', '""') + '"';
}

export function SocialHomeCommentScore({ socialStatus = {}, timezone = "Johannesburg", onExplain }) {
  const range = useMemo(() => dateRange("30 Days", "", "", timezone), [timezone]);
  const { data, loading, error, connected, since, until } = useProviderInsights(socialStatus, timezone, range);
  const selectedProviders = statusProviders(socialStatus);
  const { accounts, summary } = filteredInsights(data, selectedProviders, range, since, until, timezone);
  const errors = data?.errors || [];
  const sourceLabel = insightSourceLabel({ connected, loading, error, data, accounts, errors, selectedCount: selectedProviders.length });
  const value = loading || error || !accounts.length ? "—" : number(summary.comments, true);
  const sourceTag = !connected ? "OFF" : loading ? "…" : error ? "OFF" : data?.source === "synthetic" ? "SAMPLE" : data?.source === "live" && accounts.length ? (errors.length ? "LIVE*" : "LIVE") : accounts.length ? "DATA" : "—";

  return <span className="pw-home-score-figure" title={sourceLabel} aria-label={sourceLabel + ". " + value + " comments"} data-source={data?.source || (loading ? "loading" : error ? "unavailable" : "disconnected")}>
    <span>{value}</span><small>{sourceTag}</small>
  </span>;
}

export function SocialInsightsView({ socialStatus = {}, channels = [], timezone = "Johannesburg", onCompose, onConnect }) {
  const [period, setPeriod] = useState("30 Days");
  const [customStart, setCustomStart] = useState(() => dayKeyInTimezone(dateRange("30 Days", "", "", timezone).from, timezone));
  const [customEnd, setCustomEnd] = useState(() => dayKeyInTimezone(new Date(), timezone));
  const [channelFilter, setChannelFilter] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const range = useMemo(() => dateRange(period, customStart, customEnd, timezone), [period, customStart, customEnd, timezone]);
  const request = useProviderInsights(socialStatus, timezone, range, refreshKey);
  const { data, loading, error: loadError, connected, connectedProviders, since, until } = request;
  const selectedProviders = (channelFilter ?? connectedProviders).filter(provider => connectedProviders.includes(provider));
  const { accounts, posts, summary } = filteredInsights(data, selectedProviders, range, since, until, timezone);
  const rangeLabel = range.valid ? `${formatInTimezone(range.from, { month: "short", day: "numeric" }, timezone)} – ${formatInTimezone(range.to, { month: "short", day: "numeric", year: "numeric" }, timezone)}` : "Choose a valid date range";
  const errors = data?.errors || [];
  const sourceLabel = insightSourceLabel({ connected, loading, error: loadError, data, accounts, errors, selectedCount: selectedProviders.length });
  const hasAccountData = accounts.length > 0;
  const displayMetric = value => loading || loadError || !hasAccountData ? "—" : number(value, true);

  const exportInsights = format => {
    const exportData = {
      source: data?.source || (connected ? "unavailable" : "disconnected"),
      sourceLabel,
      dateRange: { label: rangeLabel, since, until, timezone },
      filters: { providers: selectedProviders },
      accounts,
      summary: { ...summary, posts: posts.length },
      posts,
    };
    const csvRows = [
      ["Record type", "Provider", "Name or metric", "Value", "Date range", "Published at", "Post ID", "Views", "Likes", "Comments", "Reactions", "Link", "Post text"],
      ["Metadata", "", "Data source", sourceLabel, rangeLabel],
      ["Metadata", "", "Selected channels", accounts.map(account => account.name).join("; "), rangeLabel],
      ["Summary", "All selected channels", "Recent posts", posts.length, rangeLabel],
      ["Summary", "All selected channels", "Followers", summary.followers, rangeLabel],
      ["Summary", "All selected channels", "Views", summary.views, rangeLabel],
      ["Summary", "All selected channels", "Reactions", summary.reactions, rangeLabel],
      ["Summary", "All selected channels", "Comments", summary.comments, rangeLabel],
      ["Summary", "All selected channels", "Engagement rate", summary.engagement, rangeLabel],
      ...accounts.map(account => ["Channel", account.provider, account.name, "", rangeLabel, "", "", account.summary?.views, account.summary?.likes, account.summary?.comments, account.summary?.reactions, "", ""]),
      ...posts.map(post => ["Post", post.provider, "Recent post", "", rangeLabel, post.createdAt, post.id, post.metrics?.views, post.metrics?.likes, post.metrics?.comments, post.metrics?.reactions, post.permalink, post.text]),
    ];
    const content = format === "JSON" ? JSON.stringify(exportData, null, 2) : csvRows.map(row => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([content], { type: format === "JSON" ? "application/json" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `postly-insights.${format === "JSON" ? "json" : "csv"}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const channelMenu = (mobile = false) => <Popover label={mobile ? "Filter insights by channel" : "Channels"} className="pw-social-filter-anchor" panelClassName="pw-filter-popover" trigger={<><Filter size={15}/>{!mobile && <> Channels <ChevronDown size={14}/></>}</>}>
    {close => <><strong>Channels</strong>{channels.filter(channel => socialStatus[channel.name.toLowerCase()]?.connected).map(channel => {
      const provider = channel.name.toLowerCase();
      const selected = selectedProviders.includes(provider);
      return <label key={provider}><input type="checkbox" checked={selected} onChange={() => setChannelFilter(current => { const next = new Set(current ?? statusProviders(socialStatus)); selected ? next.delete(provider) : next.add(provider); return [...next]; })}/>{channel.name}</label>;
    })}{!connected && <p className="pw-menu-empty">Connect a channel to filter its insights.</p>}<button onClick={() => { setChannelFilter(statusProviders(socialStatus)); close(); }}>Select all</button><button onClick={() => close()}>Done</button></>}
  </Popover>;
  const exportMenu = (mobile = false) => <Popover label={mobile ? "Export insights" : "Export"} className="pw-social-filter-anchor" buttonClassName={mobile ? "pw-insight-mobile-export" : ""} panelClassName="pw-export-popover" trigger={mobile ? '⋯' : <>Export <ChevronDown size={14}/></>}>
    {close => <>{["CSV", "JSON"].map(format => <button key={format} disabled={loading || !range.valid || Boolean(loadError)} onClick={() => { exportInsights(format); close(); }}>Download {format}</button>)}</>}
  </Popover>;

  return <>
    <div className="pw-toolbar pw-insight-toolbar">
      <div className="pw-tabs">{["7 Days", "30 Days", "Month to Date", "Custom"].map(option => <button key={option} aria-pressed={period === option} className={period === option ? "selected" : ""} onClick={() => setPeriod(option)}>{option}</button>)}</div>
      <div className="pw-filter-row">{channelMenu()}{exportMenu()}</div>
      <div className="pw-insight-mobile-tools"><Popover label="Insights period" className="pw-range-wrap" align="left" trigger={<>{period}<ChevronDown size={14}/></>}>
        {close => ["7 Days", "30 Days", "Month to Date", "Custom"].map(option => <button key={option} aria-pressed={period === option} onClick={() => { setPeriod(option); close(); }}>{option}</button>)}
      </Popover>{channelMenu(true)}{exportMenu(true)}</div>
    </div>
    {period === "Custom" && <div className="pw-custom-dates"><label>From<input aria-label="Insights start date" type="date" max={customEnd} value={customStart} onChange={event => setCustomStart(event.target.value)}/></label><label>To<input aria-label="Insights end date" type="date" min={customStart} value={customEnd} onChange={event => setCustomEnd(event.target.value)}/></label></div>}
    {!range.valid && <p className="pw-form-error" role="alert">The start date must be on or before the end date.</p>}
    <div className="pw-insight-date">{rangeLabel} · {sourceLabel}</div>
    {loading && <p className="pw-live-status" role="status"><LoaderCircle size={16} className="pw-spin"/> Loading account insights…</p>}
    {loadError && <div className="pw-live-error" role="alert"><span>{loadError}</span><button className="pw-outline" onClick={() => setRefreshKey(value => value + 1)}>Try again</button></div>}
    {errors.length > 0 && <div className="pw-live-warning" role="status"><b>Some data could not be loaded.</b><ul>{errors.map((error, index) => <li key={`${error.provider}-${index}`}>{providerNames[error.provider] || error.provider}: {error.message}</li>)}</ul></div>}
    {!connected && <div className="pw-insight-promo"><span>📊</span><b>Connect a social account to see your performance</b><p>Insights will show account metrics here after authorization.</p><button className="pw-outline" onClick={onConnect}>Connect a channel</button></div>}
    {connected && !loading && !loadError && accounts.length === 0 && errors.length > 0 && <div className="pw-analytics-empty">Reconnect an account or grant the required Insights permissions to load its data.</div>}
    <section className="pw-weekly-takeaways"><h2>WEEKLY TAKEAWAYS</h2><div className="pw-takeaway-grid"><article><b>Plan your remaining posts</b><p>Create a post to start filling your content calendar and build a consistent posting habit.</p><button className="pw-outline" onClick={onCompose}>Create a Post</button></article><article><b>Invite more conversations</b><p>Ask your audience a question and connect your channels to bring conversations together.</p><button className="pw-outline" onClick={() => window.location.assign("/create/templates")}>Browse Templates</button></article><article><b>Celebrate your progress</b><p>Track interactions on connected channels to see what resonates with your audience.</p></article></div></section>
    <section className="pw-insight-summary"><h2>Summary</h2><p className="pw-muted">{rangeLabel} · {sourceLabel} · {accounts.map(account => account.name).join(", ") || (selectedProviders.length ? "No account data" : "No channels selected")}</p><div className="pw-metrics">{[["Recent posts", displayMetric(posts.length)], ["Total Followers", displayMetric(summary.followers)], ["Reactions", displayMetric(summary.reactions)], ["Comments", displayMetric(summary.comments)], ["Eng. Rate", loading || loadError || !hasAccountData || summary.engagement === null ? "—" : `${summary.engagement}%`], ["Views", displayMetric(summary.views)]].map(([label, value]) => <article key={label}><span>{label}</span><b>{value}</b><small>{label === "Total Followers" ? "Current total · selected channels" : label === "Recent posts" ? "Returned provider history · selected range" : label === "Eng. Rate" ? "Interactions ÷ current followers" : "Provider summary · selected range"}</small></article>)}</div></section>
    <section className="pw-insight-section"><h2>Top Posts</h2><p className="pw-muted">{posts.length ? "Top 5 of " + posts.length + " posts available for this date range · ranked by interactions" : "Available provider posts · selected date range and channels"}</p>{posts.length ? <div className="pw-top-posts">{posts.slice(0, 5).map((post, index) => <article key={`${post.provider}-${post.id}`}><b>#{index + 1}</b><span>{providerNames[post.provider] || post.provider} · {number(post.metrics?.reactions, true)} interactions</span>{post.imageUrl && <img src={post.imageUrl} alt="" loading="lazy"/>}<p>{post.text || "Media post"}</p><div className="pw-post-metrics"><span>{number(post.metrics?.views, true)} views</span><span>{number(post.metrics?.likes, true)} likes</span><span>{number(post.metrics?.comments, true)} comments</span></div><button className="pw-outline" onClick={() => onCompose({ text: post.text || "" })}>Use as a starting point</button></article>)}</div> : <div className="pw-analytics-empty">{!connected ? "Connect a supported social account to load post performance." : selectedProviders.length === 0 ? "Select a channel to load post performance." : "No posts are available for this date range."}</div>}</section>
    <section className="pw-insight-section"><h2>Performance by channel</h2><div className="pw-table"><div><b>Channel</b><span>Recent posts　 Reactions　 Comments　 Eng. rate</span></div>{accounts.map(account => <div key={account.provider}><b>{account.name}</b><span>{number(posts.filter(post => post.provider === account.provider).length)}　 {number(account.summary?.reactions, true)}　 {number(account.summary?.comments, true)}　 {account.summary?.engagement == null ? "—" : `${account.summary.engagement}%`}</span></div>)}</div>{connected && accounts.length === 0 && <p className="pw-muted">{selectedProviders.length ? (errors.length ? "No provider metrics are available for the selected channels." : "No connected accounts match the current channel filter.") : "No channels are selected."}</p>}</section>
    <section className="pw-insight-section"><h2>Followers by channel</h2>{accounts.some(account => account.summary?.followers != null) ? <div className="pw-follower-chart" role="img" aria-label={`Follower counts: ${accounts.map(account => `${account.name} ${number(account.summary?.followers)}`).join(", ")}`}><div className="pw-follower-bars">{accounts.filter(account => account.summary?.followers != null).map(account => { const max = Math.max(...accounts.map(item => Number(item.summary?.followers) || 0), 1); return <div key={account.provider}><span style={{ height: `${Math.max(4, (Number(account.summary.followers) / max) * 100)}%` }}/><b>{number(account.summary.followers, true)}</b><small>{account.name}</small></div>; })}</div><p>Current follower totals. Historical growth requires provider history not returned by these account APIs.</p></div> : <div className="pw-analytics-empty">Follower totals are available after connecting an account with the required read permissions.</div>}</section>
    {connected && <p className="pw-data-limit">Provider APIs limit the post history and metrics available to Postly. Follower totals are current; account summaries and post lists can cover different periods by network. Exports use the selected date range and channels shown here.</p>}
  </>;
}

function groupCommunityItems(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.provider}:${item.postId || item.mediaId || item.id}`;
    const group = groups.get(key) || { key, provider: item.provider, postId: item.postId || item.mediaId, postText: item.postText || "Social post", permalink: item.permalink || "", items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function SocialCommunityView({ socialStatus = {}, channels = [], tab = "Comments", onTabChange, view = "By post", onCountChange = () => {}, onCompose, onConnect }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [communityStatus, setCommunityStatus] = useState("All");
  const [query, setQuery] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const inbox = useRef(null);
  const backButton = useRef(null);
  const listItemRefs = useRef(new Map());
  const restoreListFocus = useRef(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedRowKey, setSelectedRowKey] = useState("");
  const [sortNewest, setSortNewest] = useState(true);
  const [channelFilters, setChannelFilters] = useState(() => {
    const saved = loadLocal("postly-community-channel-filters", {});
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  });
  const [resolvedIds, setResolvedIds] = useState(() => {
    const saved = loadLocal("postly-resolved-comments", []);
    return Array.isArray(saved) ? saved.filter(id => typeof id === "string") : [];
  });
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyBusy, setReplyBusy] = useState("");
  const [replyErrors, setReplyErrors] = useState({});
  const [repliesById, setRepliesById] = useState({});
  const connectedKey = statusProviders(socialStatus).sort().join(",");
  const kind = tab === "Mentions" ? "mentions" : "comments";

  useEffect(() => { writeLocal("postly-resolved-comments", resolvedIds); }, [resolvedIds]);
  useEffect(() => { writeLocal("postly-community-channel-filters", channelFilters); }, [channelFilters]);
  useEffect(() => {
    if (!connectedKey) {
      setData({ kind, items: [], unavailable: [], errors: [], source: "disconnected" });
      setLoadError(""); setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true); setLoadError("");
    fetch(`/api/social/community?kind=${kind}`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw requestError(payload, response, "Community data could not be loaded.");
        return payload;
      })
      .then(payload => { setData(payload); setLoadError(""); })
      .catch(error => { if (error.name !== "AbortError") setLoadError(error.message || "Community data could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [connectedKey, kind, refreshKey]);

  const connectedProviders = statusProviders(socialStatus);
  const selectedProviders = connectedProviders.filter(provider => channelFilters[provider] !== false);
  const hasChannelFilter = selectedProviders.length < connectedProviders.length;
  const terms = query.trim().normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const timestamp = item => {
    const value = Date.parse(item.createdAt || "");
    return Number.isFinite(value) ? value : 0;
  };
  const compareItems = (a, b) => {
    const difference = timestamp(a) - timestamp(b);
    return (sortNewest ? -difference : difference) || String(a.id).localeCompare(String(b.id));
  };
  const channelItems = (data?.items || []).filter(item => selectedProviders.includes(item.provider)).sort(compareItems);
  const allGroups = groupCommunityItems(channelItems);
  const matchesQuery = group => {
    if (!terms.length) return true;
    const searchableText = group.items.flatMap(item => [
      item.author,
      item.text,
      item.postText,
      item.provider,
      providerNames[item.provider],
      ...(item.replies || []).map(reply => reply.text),
      ...(repliesById[commentKey(item)] || []).map(reply => reply.text),
    ]).filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
    return terms.every(term => searchableText.includes(term));
  };
  const groupIsResolved = group => group.items.length > 0 && group.items.every(item => resolvedIds.includes(commentKey(item)));
  const groups = allGroups
    .filter(matchesQuery)
    .filter(item => communityStatus === "All" || (communityStatus === "Resolved" ? groupIsResolved(item) : !groupIsResolved(item)))
    .sort((a, b) => {
      const lastActivity = group => Math.max(...group.items.map(timestamp));
      return (lastActivity(b) - lastActivity(a)) * (sortNewest ? 1 : -1) || a.key.localeCompare(b.key);
    });
  const group = groups.find(item => item.key === selectedKey) || groups[0] || null;
  const items = groups.flatMap(item => item.items).sort(compareItems);
  const conversationItems = group ? [...group.items].sort((a, b) => {
    const difference = timestamp(a) - timestamp(b);
    return difference || String(a.id).localeCompare(String(b.id));
  }) : [];
  const unsupported = data?.unavailable || [];
  const errors = data?.errors || [];
  const connected = connectedKey.length > 0;

  useEffect(() => { onCountChange(items.length); }, [items.length, onCountChange]);
  useEffect(() => { if (group && selectedKey !== group.key) setSelectedKey(group.key); }, [group?.key, selectedKey]);

  const groupResolved = groupIsResolved(group || { items: [] });
  useEffect(() => { setDetailOpen(false); }, [query, communityStatus, tab, selectedProviders.join(",")]);
  useLayoutEffect(() => {
    if (!window.matchMedia("(max-width: 650px)").matches) return;
    if (detailOpen) backButton.current?.focus({ preventScroll: true });
    else if (restoreListFocus.current) {
      restoreListFocus.current = false;
      const selectedRow = listItemRefs.current.get(selectedRowKey);
      if (selectedRow) {
        selectedRow.scrollIntoView({ block: "nearest", inline: "nearest" });
        selectedRow.focus({ preventScroll: true });
      } else {
        inbox.current?.querySelector(".pw-community-list-item.selected")?.focus({ preventScroll: true });
      }
    }
  }, [detailOpen, selectedRowKey]);
  useEffect(() => {
    if (!detailOpen || !window.matchMedia("(max-width: 650px)").matches) return;
    const handleEscape = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      restoreListFocus.current = true;
      setDetailOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [detailOpen]);
  const openConversation = (key, rowKey) => { setSelectedKey(key); setSelectedRowKey(rowKey); setDetailOpen(true); };
  const closeConversation = () => { restoreListFocus.current = true; setDetailOpen(false); };
  const changeTab = value => {
    if (value === tab) return;
    setData(null); setCommunityStatus("All"); setSelectedKey(""); setSelectedRowKey(""); setDetailOpen(false); setQuery(""); onTabChange(value);
    history.replaceState({}, "", value === "Mentions" ? `/community${view === "By post" ? "/posts" : ""}?tab=mentions` : `/community${view === "By post" ? "/posts" : ""}`);
  };
  const clearFilters = () => { setQuery(""); setCommunityStatus("All"); setChannelFilters({}); };

  const resolveGroup = () => {
    if (!group) return;
    const ids = group.items.map(commentKey);
    setResolvedIds(current => ids.every(id => current.includes(id)) ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])]);
  };

  const sendReply = async item => {
    const key = commentKey(item);
    const text = (replyDrafts[key] || "").trim();
    if (!text) {
      setReplyErrors(current => ({ ...current, [key]: "Write a reply before sending." }));
      return;
    }
    if (text.length > 2000) {
      setReplyErrors(current => ({ ...current, [key]: "Replies can contain up to 2,000 characters." }));
      return;
    }
    setReplyBusy(key); setReplyErrors(current => ({ ...current, [key]: "" }));
    try {
      const response = await fetch(`/api/social/${item.provider}/comments/${encodeURIComponent(item.id)}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw requestError(payload, response, "Reply could not be sent.");
      setRepliesById(current => ({ ...current, [key]: [...(current[key] || []), { id: payload.reply?.id || `local-${Date.now()}`, author: "You", text: payload.reply?.text || text, createdAt: new Date().toISOString() }] }));
      setReplyDrafts(current => ({ ...current, [key]: "" }));
    } catch (error) { setReplyErrors(current => ({ ...current, [key]: error.message || "Reply could not be sent." })); }
    finally { setReplyBusy(""); }
  };

  const disconnectedState = <div className="pw-community-empty-state"><div className="pw-listening-icon"><Radio size={28}/></div><h2>Connect a social account</h2><p>Connect Instagram or YouTube to load comments, replies, and mentions in this inbox.</p><button className="pw-outline" onClick={onConnect}>Connect a channel</button></div>;
  const emptyState = <div className="pw-community-empty-state"><div className="pw-listening-icon"><MessageCircle size={26}/></div><h2>{kind === "comments" ? "No comments found" : "No mentions found"}</h2><p>{communityStatus === "All" && !query && !hasChannelFilter ? `No ${kind} are available for the connected accounts yet.` : `No ${communityStatus.toLowerCase()} ${kind} match these filters.`}</p><button className="pw-outline" onClick={query || hasChannelFilter || communityStatus !== "All" ? clearFilters : () => setRefreshKey(value => value + 1)}>{query || hasChannelFilter || communityStatus !== "All" ? "Clear filters" : <><RefreshCw size={14}/> Refresh inbox</>}</button></div>;

  return <>
    <div className="pw-community-tabs"><div className="pw-inbox-tabs" aria-label="Inbox type">{["Comments", "Mentions"].map(value => <button key={value} aria-pressed={tab === value} className={tab === value ? "selected" : ""} onClick={() => changeTab(value)}>{value}</button>)}</div><div className="pw-community-tab-count">{items.length} {kind}</div><div className="pw-filter-row">
      <Popover label="Channels" className="pw-social-filter-anchor" panelClassName="pw-filter-popover" align="left" trigger={<><Filter size={15}/> Channels <ChevronDown size={14}/></>}>
        {close => <><strong>Channels</strong>{channels.filter(channel => connectedProviders.includes(channel.name.toLowerCase())).map(channel => {
          const provider = channel.name.toLowerCase();
          return <label key={channel.name}><input type="checkbox" checked={selectedProviders.includes(provider)} onChange={event => {
            const checked = event.target.checked;
            setChannelFilters(current => {
              const next = { ...current };
              if (checked) delete next[provider];
              else next[provider] = false;
              return next;
            });
          }}/>{channel.name}</label>;
        })}{!connected && <p className="pw-menu-empty">Connect a channel to filter your inbox.</p>}<button onClick={() => { setChannelFilters({}); close(); }}>All channels</button><button onClick={() => close()}>Done</button></>}
      </Popover>
      <Popover label={communityStatus} className="pw-social-filter-anchor" panelClassName="pw-filter-popover" trigger={<>{communityStatus} <ChevronDown size={14}/></>}>
        {close => <><strong>Status</strong>{["All", "Unresolved", "Resolved"].map(value => <button key={value} aria-pressed={communityStatus === value} onClick={() => { setCommunityStatus(value); close(); }}>{value}</button>)}</>}
      </Popover>
      <button className="pw-icon-button" title={sortNewest ? "Newest first · activate to sort oldest first" : "Oldest first · activate to sort newest first"} aria-label={sortNewest ? "Sort order: newest first" : "Sort order: oldest first"} aria-pressed={sortNewest} onClick={() => setSortNewest(value => !value)}><Activity size={17}/></button>
      <button type="button" className="pw-icon-button" title={groupResolved ? "Reopen selected conversation" : "Resolve selected conversation"} aria-label={groupResolved ? "Reopen selected conversation" : "Resolve selected conversation"} disabled={!group} onClick={resolveGroup}>{groupResolved ? <XCircle size={18}/> : <CheckCircle2 size={18}/>}</button>
    </div></div>
    <div className="pw-inbox-search"><label className="pw-post-search"><Search size={16}/><input aria-label="Search inbox" placeholder="Search people, comments, and posts…" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button aria-label="Clear inbox search" onClick={() => setQuery("")}><X size={15}/></button>}</label></div>
    <div className="pw-community-mobile-status"><span>{loading ? <><LoaderCircle size={14} className="pw-spin"/> Loading {kind}…</> : errors.length ? <><Activity size={14}/> Some channels need attention.</> : unsupported.length ? <><Activity size={14}/> {unsupported.map(item => `${providerNames[item.provider] || item.provider} inbox unavailable`).join(" · ")}</> : <><Activity size={14}/> {connected ? `${items.length} ${kind} from connected accounts` : "No social accounts connected"}</>}</span><button aria-label="Refresh inbox" onClick={() => setRefreshKey(value => value + 1)}><RefreshCw size={15}/></button></div>
    {loading && <p className="pw-live-status" role="status"><LoaderCircle size={16} className="pw-spin"/> Loading {kind}…</p>}
    {loadError && <div className="pw-live-error" role="alert"><span>{loadError}</span><button className="pw-outline" onClick={() => setRefreshKey(value => value + 1)}>Try again</button></div>}
    {errors.length > 0 && <div className="pw-live-warning" role="status"><b>Some channels could not load {kind}.</b><ul>{errors.map((error, index) => <li key={`${error.provider}-${index}`}>{providerNames[error.provider] || error.provider}: {error.message}</li>)}</ul></div>}
    {data?.source === "synthetic" && <p className="pw-data-limit" role="status">Showing synthetic sample data for this verification run.</p>}
    {unsupported.length > 0 && <p className="pw-data-limit">{unsupported.map(item => item.message).join(" ")}</p>}
    <div ref={inbox} className={`pw-community-layout ${view === "List" ? "community-list-view" : ""} ${groups.length ? "has-conversations" : ""} ${detailOpen && group ? "pw-mobile-detail" : ""}`}>
      <aside className="pw-community-posts"><div className="pw-community-posts-head"><h3>{kind === "comments" ? "Posts" : "Mentioned posts"} <small>{groups.length}</small></h3></div>
        {groups.length ? <div className="pw-community-list">{view === "List" ? items.map(item => {
          const key = `${item.provider}:${item.postId || item.mediaId || item.id}`;
          const rowKey = `comment:${commentKey(item)}`;
          const selected = selectedRowKey === rowKey;
          return <button key={commentKey(item)} ref={node => { if (node) listItemRefs.current.set(rowKey, node); else listItemRefs.current.delete(rowKey); }} aria-pressed={selected} className={`pw-community-list-item ${selected ? "selected" : ""}`} onClick={() => openConversation(key, rowKey)}><span className="pw-community-item-provider">{providerNames[item.provider] || item.provider}</span><b>{item.author}</b><small>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ""}</small><span>{item.text}</span></button>;
        }) : groups.map(item => {
          const rowKey = `post:${item.key}`;
          return <button key={item.key} ref={node => { if (node) listItemRefs.current.set(rowKey, node); else listItemRefs.current.delete(rowKey); }} aria-pressed={group?.key === item.key} className={`pw-community-list-item ${group?.key === item.key ? "selected" : ""}`} onClick={() => openConversation(item.key, rowKey)}><span className="pw-community-item-provider">{providerNames[item.provider] || item.provider}</span><b>{item.postText || "Social post"}</b><small>{item.items.length} {kind} · {item.items[0]?.author || ""}</small><span>{item.items[0]?.text || ""}</span></button>;
        })}</div> : <div className="pw-community-list-empty"><h3>{loading ? "Loading inbox…" : connected ? "No posts found" : "No accounts connected"}</h3><p>{connected ? `Posts with ${kind} will appear here.` : "Connect an account to load its conversations."}</p>{!connected && <button className="pw-outline" onClick={onConnect}>Connect a channel</button>}</div>}
      </aside>
      <section className="pw-community-detail" aria-label={`${kind} conversation`}>
        {group && <button ref={backButton} type="button" className="pw-community-back pw-outline" onClick={closeConversation}><ArrowLeft size={16}/>Back to inbox</button>}
        {!connected && !loading ? disconnectedState : group ? <>
          <header className="pw-community-detail-head"><div><span className="pw-community-item-provider">{providerNames[group.provider]}</span><h2>{group.postText || "Social post"}</h2></div>{group.permalink && <a href={group.permalink} target="_blank" rel="noreferrer" aria-label="Open social post"><ExternalLink size={16}/></a>}</header>
          <div className="pw-community-comments" aria-label="Conversation comments">{conversationItems.map(item => {
            const key = commentKey(item);
            const account = socialStatus[item.provider] || {};
            const canReply = kind === "comments" && Boolean(communityScopes[item.provider]) && Array.isArray(account.scopes) && account.scopes.includes(communityScopes[item.provider]);
            const isResolved = resolvedIds.includes(key);
            const replies = [...(item.replies || []), ...(repliesById[key] || [])];
            return <article className={`pw-community-comment ${isResolved ? "resolved" : ""}`} key={item.id}>
              <div className="pw-community-comment-top"><b>{item.author}</b><time dateTime={item.createdAt || undefined}>{item.createdAt ? new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : ""}</time><button type="button" className="pw-link-button" aria-pressed={isResolved} onClick={() => setResolvedIds(current => isResolved ? current.filter(id => id !== key) : [...new Set([...current, key])])}>{isResolved ? "Reopen" : "Resolve"}</button></div>
              <p>{item.text}</p>
              {replies.map(reply => <div className="pw-community-reply" key={reply.id}><b>{reply.author || "Reply"}</b><p>{reply.text}</p></div>)}
              {canReply ? <form className="pw-community-reply-form" aria-busy={replyBusy === key} onSubmit={event => { event.preventDefault(); sendReply(item); }}><textarea aria-label={`Reply to ${item.author}`} required value={replyDrafts[key] || ""} maxLength={2000} placeholder="Write a reply…" onChange={event => { setReplyDrafts(current => ({ ...current, [key]: event.target.value })); setReplyErrors(current => current[key] ? { ...current, [key]: "" } : current); }}/><button type="submit" className="pw-primary" disabled={!replyDrafts[key]?.trim() || replyDrafts[key].length > 2000 || replyBusy === key}>{replyBusy === key ? <LoaderCircle size={15} className="pw-spin"/> : <Send size={15}/>} Reply</button>{replyErrors[key] && <p className="pw-form-error" role="alert">{replyErrors[key]}</p>}</form> : <p className="pw-data-limit">{kind === "mentions" ? "Mentions are shown here for reference; open the post to respond." : item.provider === "tiktok" ? "Replies are not available through TikTok's standard creator API." : "Reconnect this account and grant comment management access to reply."}</p>}
            </article>;
          })}</div>
        </> : loading ? <div className="pw-community-empty-state"><LoaderCircle size={24} className="pw-spin"/><h2>Loading inbox…</h2></div> : emptyState}
      </section>
    </div>
  </>;
}
