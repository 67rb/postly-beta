import assert from "node:assert/strict";
import { fetchProviderCommunity, fetchProviderInsights, replyToProviderComment } from "../server/social-data.js";

const checks = [];
const account = { accessToken: "private-test-token", refreshToken: "refresh-token", userId: "account-1", profile: "studio", expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const check = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };

await check("Instagram Insights reads profile, recent media, audience, and interactions", async () => {
  const requests = [];
  const result = await fetchProviderInsights("instagram", account, {
    env: { META_GRAPH_API_VERSION: "v26.0" }, since: "2026-10-01", until: "2026-10-23",
    fetchImpl: async (url, init = {}) => {
      const target = new URL(String(url)); requests.push({ target, init });
      if (target.pathname.endsWith("/me")) return response({ id: "ig-account", username: "studio" });
      if (target.pathname.endsWith("/media")) return response({ data: [{ id: "ig-post", caption: "Instagram post", media_type: "IMAGE", permalink: "https://instagram.com/p/one", timestamp: "2026-10-10T12:00:00+0000", like_count: 8, comments_count: 2 }] });
      if (target.pathname.endsWith("/insights")) return response({ data: [
        { name: "follower_count", total_value: { value: 400 } },
        { name: "views", total_value: { value: 1200 } },
        { name: "total_interactions", total_value: { value: 24 } },
      ] });
      throw new Error(`Unexpected Instagram endpoint ${target}`);
    },
  });
  assert.equal(result.account.profile, "studio");
  assert.equal(result.account.userId, "ig-account");
  assert.equal(result.summary.followers, 400);
  assert.equal(result.summary.views, 1200);
  assert.equal(result.posts[0].metrics.likes, 8);
  assert.equal(result.posts[0].metrics.comments, 2);
  const insightRequest = requests.find(item => item.target.pathname.endsWith("/insights"));
  assert.equal(insightRequest.target.searchParams.get("since"), String(Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000)));
  assert.equal(insightRequest.init.headers.authorization, "Bearer private-test-token");
});

await check("TikTok reads only requested profile statistics and public video metrics", async () => {
  const requests = [];
  const result = await fetchProviderInsights("tiktok", account, {
    fetchImpl: async (url, init = {}) => {
      const target = new URL(String(url)); requests.push({ target, init });
      if (target.pathname.endsWith("/user/info/")) return response({ data: { user: { open_id: "tt-account", username: "studio.tt", display_name: "Studio", follower_count: 800, video_count: 2 } }, error: { code: "ok" } });
      if (target.pathname.endsWith("/video/list/")) return response({ data: { videos: [{ id: "tt-1", title: "First clip", create_time: 1791633600, like_count: 13, comment_count: 4, share_count: 2, view_count: 500 }] }, error: { code: "ok" } });
      throw new Error(`Unexpected TikTok endpoint ${target}`);
    },
  });
  assert.equal(result.profile.followers, 800);
  assert.equal(result.profile.name, "Studio");
  assert.equal(result.summary.views, 500);
  assert.equal(result.summary.reactions, 19);
  const listRequest = requests.find(item => item.target.pathname.endsWith("/video/list/"));
  assert.equal(listRequest.init.method, "POST");
  assert.deepEqual(JSON.parse(listRequest.init.body), { max_count: 20 });
  assert.ok(listRequest.target.searchParams.get("fields").includes("comment_count"));
});

await check("Instagram retries individual metrics when one Insights scope is unsupported", async () => {
  const result = await fetchProviderInsights("instagram", account, {
    env: { META_GRAPH_API_VERSION: "v26.0" }, since: "2026-10-01", until: "2026-10-23",
    fetchImpl: async url => {
      const target = new URL(String(url));
      if (target.pathname.endsWith("/me")) return response({ id: "ig-account", username: "studio" });
      if (target.pathname.endsWith("/media")) return response({ data: [] });
      if (target.pathname.endsWith("/insights")) {
        const metric = target.searchParams.get("metric");
        if (metric.includes(",")) return response({ error: { message: "One requested metric is unavailable" } }, 400);
        if (metric === "views") return response({ data: [{ name: "views", total_value: { value: 600 } }] });
        if (metric === "follower_count") return response({ data: [{ name: "follower_count", total_value: { value: 400 } }] });
        return response({ error: { message: `${metric} is unavailable` } }, 400);
      }
      throw new Error(`Unexpected Instagram endpoint ${target}`);
    },
  });
  assert.equal(result.summary.views, 600);
  assert.equal(result.summary.followers, 400);
  assert.equal(result.errors.length, 4);
});

await check("YouTube combines channel and date-range Analytics without double-counting views", async () => {
  const requests = [];
  const result = await fetchProviderInsights("youtube", account, {
    since: "2026-10-01", until: "2026-10-23",
    fetchImpl: async (url, init = {}) => {
      const target = new URL(String(url)); requests.push({ target, init });
      if (target.pathname.endsWith("/channels")) return response({ items: [{ id: "yt-channel", snippet: { title: "Studio YouTube" }, statistics: { subscriberCount: "900", viewCount: "30000", videoCount: "12" }, contentDetails: { relatedPlaylists: { uploads: "uploads-list" } } }] });
      if (target.pathname.endsWith("/playlistItems")) return response({ items: [{ contentDetails: { videoId: "yt-video" } }] });
      if (target.pathname.endsWith("/videos")) return response({ items: [{ id: "yt-video", snippet: { title: "A video", description: "Description", publishedAt: "2026-10-12T09:00:00Z" }, statistics: { viewCount: "1500", likeCount: "80", commentCount: "6" } }] });
      if (target.hostname === "youtubeanalytics.googleapis.com") return response({ rows: [["2026-10-10", 700, 35, 3, 1]] });
      throw new Error(`Unexpected YouTube endpoint ${target}`);
    },
  });
  assert.equal(result.account.userId, "yt-channel");
  assert.equal(result.profile.followers, 900);
  assert.equal(result.summary.views, 700);
  assert.equal(result.summary.likes, 35);
  assert.equal(result.posts[0].text, "A video");
  assert.equal(requests.find(item => item.target.hostname === "youtubeanalytics.googleapis.com").target.searchParams.get("ids"), "channel==MINE");
});

await check("Instagram and YouTube Community reads normalize incoming comments", async () => {
  const instagram = await fetchProviderCommunity("instagram", account, {
    fetchImpl: async url => {
      const target = new URL(String(url));
      if (target.pathname.endsWith("/me")) return response({ id: "ig-account", username: "studio" });
      if (target.pathname.endsWith("/media")) return response({ data: [{ id: "ig-post", caption: "Post caption", permalink: "https://instagram.com/p/one", comments_count: 1 }] });
      if (target.pathname.endsWith("/comments")) return response({ data: [{ id: "ig-comment", username: "viewer", text: "Nice work", timestamp: "2026-10-22T12:00:00+0000" }] });
      throw new Error(`Unexpected Instagram endpoint ${target}`);
    },
  });
  assert.equal(instagram.items[0].author, "viewer");
  assert.equal(instagram.items[0].postText, "Post caption");

  const youtube = await fetchProviderCommunity("youtube", account, {
    fetchImpl: async url => {
      const target = new URL(String(url));
      if (target.pathname.endsWith("/channels")) return response({ items: [{ id: "yt-channel", snippet: { title: "Studio YouTube" } }] });
      if (target.pathname.endsWith("/commentThreads")) return response({ items: [{ id: "thread-1", snippet: { videoId: "yt-video", topLevelComment: { id: "yt-comment", snippet: { authorDisplayName: "Viewer", textDisplay: "Hello there", publishedAt: "2026-10-21T12:00:00Z" } } }, replies: { comments: [] } }] });
      throw new Error(`Unexpected YouTube endpoint ${target}`);
    },
  });
  assert.equal(youtube.items[0].id, "yt-comment");
  assert.equal(youtube.items[0].provider, "youtube");
  assert.equal(youtube.items[0].permalink, "https://www.youtube.com/watch?v=yt-video&lc=yt-comment");
});

await check("Instagram Community reports missing comment permissions instead of hiding failures", async () => {
  const result = await fetchProviderCommunity("instagram", account, {
    fetchImpl: async url => {
      const target = new URL(String(url));
      if (target.pathname.endsWith("/me")) return response({ id: "ig-account", username: "studio" });
      if (target.pathname.endsWith("/media")) return response({ data: [{ id: "ig-post", caption: "Post caption", comments_count: 1 }] });
      if (target.pathname.endsWith("/comments")) return response({ error: { message: "Missing instagram_business_manage_comments permission" } }, 403);
      throw new Error(`Unexpected Instagram endpoint ${target}`);
    },
  });
  assert.deepEqual(result.items, []);
  assert.equal(result.errors[0].code, "permission_required");
  assert.match(result.errors[0].message, /manage_comments/);
});

await check("Replies use official provider endpoints and reject unsupported TikTok replies", async () => {
  const ig = await replyToProviderComment("instagram", account, "ig-comment", "Thanks!", {
    env: { META_GRAPH_API_VERSION: "v26.0" },
    fetchImpl: async (url, init = {}) => {
      assert.equal(String(url), "https://graph.instagram.com/v26.0/ig-comment/replies");
      assert.equal(new URLSearchParams(init.body).get("message"), "Thanks!");
      return response({ id: "ig-reply" });
    },
  });
  assert.equal(ig.reply.id, "ig-reply");
  const yt = await replyToProviderComment("youtube", account, "yt-comment", "Thanks!", {
    fetchImpl: async (url, init = {}) => {
      assert.equal(String(url), "https://www.googleapis.com/youtube/v3/comments?part=snippet");
      assert.equal(JSON.parse(init.body).snippet.parentId, "yt-comment");
      return response({ id: "yt-reply", snippet: { textDisplay: "Thanks!" } });
    },
  });
  assert.equal(yt.reply.id, "yt-reply");
  assert.equal((await fetchProviderCommunity("tiktok", account, { fetchImpl: async () => { throw new Error("Should not call TikTok comments"); } })).source, "unsupported");
  await assert.rejects(() => replyToProviderComment("tiktok", account, "tt-comment", "Thanks!"), /not available/);
});

console.log(`SUCCESS ${checks.length} social data checks`);
