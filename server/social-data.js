import { PublishError, refreshAccountToken } from "./social-publishing.js";

const metaApiVersion = env => {
  const value = String(env.META_GRAPH_API_VERSION || "v26.0").replace(/^v/i, "");
  if (!/^\d+\.\d+$/.test(value)) throw new PublishError("META_GRAPH_API_VERSION must look like 26.0.", 503, "invalid_configuration");
  return `v${value}`;
};
const metricKeys = new Set(["followers", "views", "likes", "comments", "shares", "reactions", "engagement", "posts"]);

function providerError(provider, response, body) {
  const detail = body?.error?.message || body?.error_description || body?.message || body?.error?.log_id || "";
  const code = body?.error?.code;
  const failed = !response.ok || (code && code !== "ok" && code !== 0);
  if (!failed) return;
  const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502;
  const reason = status === 401 ? "reconnect_required" : status === 403 ? "permission_required" : "provider_error";
  throw new PublishError(`${provider} data could not be loaded${detail ? `: ${String(detail).slice(0, 300)}` : "."}`, status, reason);
}

async function requestJson(fetchImpl, provider, url, init = {}) {
  let response;
  try { response = await fetchImpl(url, init); }
  catch { throw new PublishError(`Could not reach ${provider}. Check the server connection and try again.`, 502, "network_error"); }
  let body = {};
  try { body = await response.json(); } catch { /* The provider may return an empty body. */ }
  providerError(provider, response, body);
  return body;
}

function bearer(token, init = {}) {
  return { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}` } };
}

function queryUrl(endpoint, params) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

function num(value) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function makeSummary() {
  return { followers: null, views: 0, likes: 0, comments: 0, shares: 0, reactions: 0, engagement: null, posts: 0 };
}

function mergeSummary(target, source = {}) {
  for (const key of metricKeys) {
    if (key === "engagement") continue;
    const value = num(source[key]);
    if (value === null) continue;
    if (key === "followers") target.followers = (target.followers || 0) + value;
    else target[key] += value;
  }
  if (target.engagement === null && source.engagement !== undefined) target.engagement = num(source.engagement);
  return target;
}

function postRecord(provider, post, fields = {}) {
  const likes = num(fields.likes ?? post.like_count ?? post.statistics?.likeCount) || 0;
  const comments = num(fields.comments ?? post.comments_count ?? post.comment_count ?? post.statistics?.commentCount) || 0;
  const shares = num(fields.shares ?? post.share_count) || 0;
  const views = num(fields.views ?? post.view_count ?? post.statistics?.viewCount) || 0;
  return {
    id: String(post.id || post.videoId || ""),
    provider,
    text: post.caption || post.video_description || post.snippet?.title || post.title || "",
    description: post.snippet?.description || post.video_description || "",
    imageUrl: post.thumbnail_url || post.cover_image_url || post.snippet?.thumbnails?.high?.url || post.snippet?.thumbnails?.medium?.url || post.media_url || "",
    permalink: post.permalink || post.share_url || (post.id ? `https://www.youtube.com/watch?v=${post.id}` : ""),
    createdAt: post.timestamp || post.create_time && new Date(Number(post.create_time) * 1000).toISOString() || post.snippet?.publishedAt || "",
    mediaType: post.media_product_type || post.media_type || (post.duration ? "VIDEO" : "POST"),
    metrics: { likes, comments, shares, views, reactions: likes + comments + shares, engagement: null },
  };
}

function computeEngagement(summary) {
  const denominator = num(summary.followers);
  summary.engagement = denominator ? Number((100 * summary.reactions / denominator).toFixed(2)) : null;
  return summary;
}

async function instagramGet(fetchImpl, endpoint, token, params = {}) {
  const url = queryUrl(endpoint, params);
  return requestJson(fetchImpl, "Instagram", url, bearer(token));
}

async function instagramMedia(fetchImpl, account, env) {
  const version = metaApiVersion(env);
  const userId = account.userId || "me";
  const body = await instagramGet(fetchImpl, `https://graph.instagram.com/${version}/${userId}/media`, account.accessToken, {
    fields: "id,caption,media_type,media_product_type,media_url,permalink,timestamp,thumbnail_url,like_count,comments_count",
    limit: 25,
  });
  return Array.isArray(body.data) ? body.data : [];
}

async function instagramInsights(account, { env, fetchImpl, since, until }) {
  const refreshed = await refreshAccountToken("instagram", account, { env, fetchImpl });
  const version = metaApiVersion(env);
  const profile = await instagramGet(fetchImpl, `https://graph.instagram.com/${version}/me`, refreshed.accessToken, { fields: "id,username" });
  const userId = profile.id || refreshed.userId;
  if (!userId) throw new PublishError("Instagram did not return an account ID. Reconnect the account.", 401, "reconnect_required");
  const nextAccount = { ...refreshed, userId, profile: profile.username || refreshed.profile };
  const media = await instagramMedia(fetchImpl, nextAccount, env);
  const params = { metric: "views,reach,profile_views,accounts_engaged,total_interactions,follower_count", period: "day", metric_type: "total_value" };
  if (since) params.since = Math.floor(new Date(`${since}T00:00:00Z`).getTime() / 1000);
  if (until) params.until = Math.floor(new Date(`${until}T23:59:59Z`).getTime() / 1000);
  let accountMetrics = [];
  const insightErrors = [];
  try {
    const body = await instagramGet(fetchImpl, `https://graph.instagram.com/${version}/${userId}/insights`, nextAccount.accessToken, params);
    accountMetrics = Array.isArray(body.data) ? body.data : [];
  } catch (combinedError) {
    const metricNames = params.metric.split(",");
    const fallbacks = await Promise.all(metricNames.map(async metric => {
      try {
        const body = await instagramGet(fetchImpl, `https://graph.instagram.com/${version}/${userId}/insights`, nextAccount.accessToken, { ...params, metric });
        return { data: Array.isArray(body.data) ? body.data : [], error: null };
      } catch (error) { return { data: [], error: { provider: "instagram", code: error.code || "insights_unavailable", message: `${metric}: ${error.message}` } }; }
    }));
    accountMetrics = fallbacks.flatMap(result => result.data);
    const errors = fallbacks.flatMap(result => result.error ? [result.error] : []);
    if (errors.length === metricNames.length) insightErrors.push({ provider: "instagram", code: combinedError.code || "insights_unavailable", message: combinedError.message });
    else insightErrors.push(...errors);
  }
  const total = name => {
    const item = accountMetrics.find(metric => metric.name === name);
    if (item?.total_value?.value !== undefined) return num(item.total_value.value);
    if (Array.isArray(item?.values)) return item.values.reduce((sum, entry) => sum + (num(entry.value) || 0), 0);
    return null;
  };
  const summary = makeSummary();
  summary.followers = total("follower_count");
  summary.views = total("views") ?? 0;
  summary.reactions = total("total_interactions") ?? 0;
  summary.posts = media.length;
  for (const post of media) {
    const record = postRecord("instagram", post);
    summary.likes += record.metrics.likes;
    summary.comments += record.metrics.comments;
    record.metrics.views = 0;
  }
  computeEngagement(summary);
  return {
    account: nextAccount,
    profile: { provider: "instagram", name: nextAccount.profile, followers: summary.followers, posts: media.length },
    summary,
    posts: media.map(post => postRecord("instagram", post)),
    errors: insightErrors,
    source: "live",
  };
}

async function tiktokInsights(account, { env, fetchImpl }) {
  const refreshed = await refreshAccountToken("tiktok", account, { env, fetchImpl });
  const infoUrl = queryUrl("https://open.tiktokapis.com/v2/user/info/", { fields: "open_id,username,display_name,avatar_url,follower_count,following_count,likes_count,video_count" });
  const info = await requestJson(fetchImpl, "TikTok", infoUrl, bearer(refreshed.accessToken));
  const user = info.data?.user || {};
  const videoUrl = queryUrl("https://open.tiktokapis.com/v2/video/list/", { fields: "id,create_time,cover_image_url,share_url,video_description,title,like_count,comment_count,share_count,view_count" });
  const videos = await requestJson(fetchImpl, "TikTok", videoUrl, bearer(refreshed.accessToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ max_count: 20 }) }));
  const videoRows = videos.data?.videos || videos.data?.video_list || [];
  const summary = makeSummary();
  summary.followers = num(user.follower_count);
  summary.posts = num(user.video_count) ?? videoRows.length;
  const posts = videoRows.map(video => postRecord("tiktok", video));
  for (const post of posts) {
    summary.views += post.metrics.views;
    summary.likes += post.metrics.likes;
    summary.comments += post.metrics.comments;
    summary.shares += post.metrics.shares;
  }
  summary.reactions = summary.likes + summary.comments + summary.shares;
  computeEngagement(summary);
  const nextAccount = { ...refreshed, userId: user.open_id || refreshed.userId, profile: user.display_name || user.username || refreshed.profile };
  return { account: nextAccount, profile: { provider: "tiktok", name: nextAccount.profile, followers: summary.followers, posts: summary.posts }, summary, posts, errors: [], source: "live" };
}

async function youtubeGet(fetchImpl, endpoint, token, params = {}) {
  return requestJson(fetchImpl, "YouTube", queryUrl(endpoint, params), bearer(token));
}

async function youtubeInsights(account, { env, fetchImpl, since, until }) {
  const refreshed = await refreshAccountToken("youtube", account, { env, fetchImpl });
  const channels = await youtubeGet(fetchImpl, "https://www.googleapis.com/youtube/v3/channels", refreshed.accessToken, { part: "snippet,statistics,contentDetails", mine: "true" });
  const channel = channels.items?.[0];
  if (!channel) throw new PublishError("YouTube did not return a channel for this account.", 404, "channel_not_found");
  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  const playlist = uploads ? await youtubeGet(fetchImpl, "https://www.googleapis.com/youtube/v3/playlistItems", refreshed.accessToken, { part: "contentDetails,snippet", playlistId: uploads, maxResults: 25 }) : { items: [] };
  const videoIds = [...new Set((playlist.items || []).map(item => item.contentDetails?.videoId).filter(Boolean))];
  const videos = videoIds.length ? await youtubeGet(fetchImpl, "https://www.googleapis.com/youtube/v3/videos", refreshed.accessToken, { part: "snippet,statistics,contentDetails", id: videoIds.join(",") }) : { items: [] };
  let reportRows = [];
  let analyticsError = null;
  if (since && until) {
    try {
      const report = await youtubeGet(fetchImpl, "https://youtubeanalytics.googleapis.com/v2/reports", refreshed.accessToken, {
        ids: "channel==MINE", startDate: since, endDate: until, metrics: "views,likes,comments,subscribersGained", dimensions: "day", sort: "day",
      });
      reportRows = Array.isArray(report.rows) ? report.rows : [];
    } catch (error) { analyticsError = { provider: "youtube", code: error.code || "analytics_unavailable", message: error.message }; }
  }
  const summary = makeSummary();
  summary.followers = num(channel.statistics?.subscriberCount);
  summary.views = num(channel.statistics?.viewCount) || 0;
  summary.posts = num(channel.statistics?.videoCount) || videos.items?.length || 0;
  const posts = (videos.items || []).map(video => postRecord("youtube", video));
  for (const post of posts) {
    summary.likes += post.metrics.likes;
    summary.comments += post.metrics.comments;
  }
  if (reportRows.length) {
    const totals = reportRows.reduce((out, row) => {
      for (let index = 1; index < row.length; index++) out[index - 1] = (out[index - 1] || 0) + (num(row[index]) || 0);
      return out;
    }, []);
    summary.views = totals[0] ?? summary.views;
    summary.likes = totals[1] ?? summary.likes;
    summary.comments = totals[2] ?? summary.comments;
  }
  summary.reactions = summary.likes + summary.comments;
  computeEngagement(summary);
  const nextAccount = { ...refreshed, userId: channel.id, profile: channel.snippet?.title || refreshed.profile };
  return {
    account: nextAccount,
    profile: { provider: "youtube", name: nextAccount.profile, followers: summary.followers, posts: summary.posts },
    summary,
    posts,
    errors: analyticsError ? [analyticsError] : [],
    source: "live",
  };
}

export async function fetchProviderInsights(provider, account, options = {}) {
  if (!account?.accessToken) throw new PublishError(`${provider} is not connected.`, 401, "account_not_connected");
  const dependencies = { env: options.env || process.env, fetchImpl: options.fetchImpl || fetch, since: options.since, until: options.until };
  if (provider === "instagram") return instagramInsights(account, dependencies);
  if (provider === "tiktok") return tiktokInsights(account, dependencies);
  if (provider === "youtube") return youtubeInsights(account, dependencies);
  throw new PublishError("This social provider is not supported.", 400, "unsupported_provider");
}

async function instagramCommunity(account, { env, fetchImpl, kind }) {
  const refreshed = await refreshAccountToken("instagram", account, { env, fetchImpl });
  const version = metaApiVersion(env);
  const profile = await instagramGet(fetchImpl, `https://graph.instagram.com/${version}/me`, refreshed.accessToken, { fields: "id,username" });
  const nextAccount = { ...refreshed, userId: profile.id || refreshed.userId, profile: profile.username || refreshed.profile };
  const endpoint = kind === "mentions" ? `https://graph.instagram.com/${version}/${nextAccount.userId}/mentioned_media` : `https://graph.instagram.com/${version}/${nextAccount.userId}/media`;
  const mediaBody = await instagramGet(fetchImpl, endpoint, nextAccount.accessToken, { fields: "id,caption,media_type,media_product_type,media_url,permalink,timestamp,thumbnail_url,comments_count", limit: 20 });
  const media = Array.isArray(mediaBody.data) ? mediaBody.data : [];
  if (kind === "mentions") return { account: nextAccount, items: media.map(post => ({ id: post.id, provider: "instagram", mediaId: post.id, author: post.username || "Instagram user", text: post.caption || "Mentioned your account", createdAt: post.timestamp || "", permalink: post.permalink || "", postText: post.caption || "" })), source: "live" };
  const candidates = media.filter(post => (num(post.comments_count) || 0) > 0).slice(0, 10);
  const commentResults = await Promise.all(candidates.map(async post => {
    try {
      const comments = await instagramGet(fetchImpl, `https://graph.instagram.com/${version}/${post.id}/comments`, nextAccount.accessToken, { fields: "id,text,username,timestamp,like_count,hidden", limit: 25 });
      return { items: (comments.data || []).map(comment => ({ id: comment.id, provider: "instagram", mediaId: post.id, postId: post.id, author: comment.username || "Instagram user", text: comment.text || "", createdAt: comment.timestamp || "", permalink: post.permalink || "", postText: post.caption || "", replies: [] })), error: null };
    } catch (error) { return { items: [], error: { provider: "instagram", code: error.code || "comments_unavailable", message: error.message } }; }
  }));
  return { account: nextAccount, items: commentResults.flatMap(result => result.items).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)), errors: commentResults.flatMap(result => result.error ? [result.error] : []), source: "live" };
}

async function youtubeCommunity(account, { env, fetchImpl }) {
  const refreshed = await refreshAccountToken("youtube", account, { env, fetchImpl });
  const channel = await youtubeGet(fetchImpl, "https://www.googleapis.com/youtube/v3/channels", refreshed.accessToken, { part: "snippet", mine: "true" });
  const channelRow = channel.items?.[0];
  if (!channelRow) return { account: refreshed, items: [], source: "live" };
  const threads = await youtubeGet(fetchImpl, "https://www.googleapis.com/youtube/v3/commentThreads", refreshed.accessToken, {
    part: "snippet,replies", allThreadsRelatedToChannelId: channelRow.id, maxResults: 100, order: "time", textFormat: "plainText",
  });
  const items = (threads.items || []).map(thread => {
    const snippet = thread.snippet?.topLevelComment?.snippet || {};
    const videoId = thread.snippet?.videoId || "";
    return {
      id: thread.snippet?.topLevelComment?.id || thread.id,
      threadId: thread.id,
      provider: "youtube",
      mediaId: videoId,
      postId: videoId,
      author: snippet.authorDisplayName || "YouTube user",
      avatarUrl: snippet.authorProfileImageUrl || "",
      text: snippet.textDisplay || "",
      createdAt: snippet.publishedAt || "",
      permalink: videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(thread.snippet?.topLevelComment?.id || thread.id)}` : "",
      postText: thread.snippet?.videoTitle || "",
      replies: (thread.replies?.comments || []).map(reply => ({ id: reply.id, author: reply.snippet?.authorDisplayName || "YouTube user", text: reply.snippet?.textDisplay || "", createdAt: reply.snippet?.publishedAt || "" })),
    };
  });
  return { account: { ...refreshed, userId: channelRow.id, profile: channelRow.snippet?.title || refreshed.profile }, items, source: "live" };
}

export async function fetchProviderCommunity(provider, account, options = {}) {
  if (!account?.accessToken) throw new PublishError(`${provider} is not connected.`, 401, "account_not_connected");
  const dependencies = { env: options.env || process.env, fetchImpl: options.fetchImpl || fetch, kind: options.kind === "mentions" ? "mentions" : "comments" };
  if (provider === "instagram") return instagramCommunity(account, dependencies);
  if (provider === "youtube" && dependencies.kind === "comments") return youtubeCommunity(account, dependencies);
  if (provider === "tiktok") return { account, items: [], source: "unsupported", message: "TikTok's standard creator API does not provide comment inbox access." };
  if (provider === "youtube") return { account, items: [], source: "unsupported", message: "YouTube mentions are not available through the channel comment feed." };
  throw new PublishError("This social provider is not supported.", 400, "unsupported_provider");
}

export async function replyToProviderComment(provider, account, commentId, text, options = {}) {
  if (!account?.accessToken) throw new PublishError(`${provider} is not connected.`, 401, "account_not_connected");
  if (typeof commentId !== "string" || !/^[\w.-]{1,180}$/.test(commentId)) throw new PublishError("Select a valid comment before replying.", 400, "invalid_comment");
  if (typeof text !== "string" || !text.trim() || text.trim().length > 2000) throw new PublishError("Enter a reply with up to 2,000 characters.", 400, "invalid_reply");
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const refreshed = await refreshAccountToken(provider, account, { env, fetchImpl });
  if (provider === "instagram") {
    const version = metaApiVersion(env);
    const url = `https://graph.instagram.com/${version}/${commentId}/replies`;
    const body = await requestJson(fetchImpl, "Instagram", url, bearer(refreshed.accessToken, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ message: text.trim() }) }));
    return { account: refreshed, reply: { id: body.id || "", provider, text: text.trim() } };
  }
  if (provider === "youtube") {
    const body = await requestJson(fetchImpl, "YouTube", "https://www.googleapis.com/youtube/v3/comments?part=snippet", bearer(refreshed.accessToken, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ snippet: { parentId: commentId, textOriginal: text.trim() } }),
    }));
    return { account: refreshed, reply: { id: body.id || "", provider, text: body.snippet?.textDisplay || text.trim() } };
  }
  throw new PublishError("Comment replies are not available for this provider.", 400, "unsupported_action");
}

export function addProviderSummary(target, summary) { return mergeSummary(target, summary); }
