# Postly social account connections and publishing

Postly has server-side OAuth flows and publishing adapters for Instagram, TikTok, and YouTube. OAuth credentials and tokens are never stored in browser storage. The local server stores exchanged tokens encrypted with AES-256-GCM in `.postly-data/accounts.enc`; that directory and `.env.local` are ignored by Git. A local encryption key is created with owner-only file permissions the first time a connection is saved.

## Configure provider apps

`.env.local` is ready for provider credentials. Generate a 32-byte token encryption key with `openssl rand -hex 32`. Register the exact callback URL returned by **Connect a channel** in each provider app:

- `pnpm dev`: `http://localhost:4175/api/social/instagram/callback`, `http://localhost:4175/api/social/tiktok/callback`, and `http://localhost:4175/api/social/youtube/callback`
- Standalone `pnpm start`: `http://localhost:4174/api/social/instagram/callback`, `http://localhost:4174/api/social/tiktok/callback`, and `http://localhost:4174/api/social/youtube/callback`
- Hosted installation: `https://<your-origin>/api/social/<provider>/callback`; set `APP_BASE_URL` to the Postly origin and `OAUTH_REDIRECT_BASE` if the callback has a separate public origin.

Callback origins must be absolute HTTP or HTTPS origins without a path, query, or credentials. Non-local HTTP origins are rejected. Keep `APP_BASE_URL` and `OAUTH_REDIRECT_BASE` stable between authorization and callback; the server uses the same exact redirect URI for both code exchange and the initial authorization request. OAuth state is one-time, expires after 10 minutes, and is tied to an HttpOnly, SameSite=Lax browser cookie. State is held in the server process, so each OAuth flow must return to the same instance; use shared state storage before running multiple app instances. Do not commit `.env.local`, token files, or production secrets.

The local OAuth and publishing server listens on loopback for one Postly installation. Do not expose it directly to a public network. The single-owner Docker deployment in [DEPLOYMENT.md](DEPLOYMENT.md) keeps the Node process on a private container network behind HTTPS and password authentication, and exposes only the temporary-media route to provider fetchers. Multi-user hosting still needs per-user token isolation and a database-backed shared queue/state store.

### Instagram

Create a Meta developer app, add Instagram API with Instagram Login, and configure `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, and `instagram_business_manage_insights`. Those are the scope names Postly requests for profile, publishing, comments, and insights. The API is for eligible professional accounts; Meta app review may be required for people outside the app's roles. See [Meta's Instagram API with Instagram Login collection](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login).

The callback exchanges the one-use code for a short-lived token and immediately exchanges that for a long-lived token. If either exchange fails or Meta does not return a valid expiry, Postly does not save the short-lived token. Long-lived tokens are refreshed before expiry when they are still valid; an expired token requires reconnecting. The status API reports the saved expiry and whether reconnection is required.

Postly can load recent Instagram comments and mentions and reply to comments when those permissions are approved. Reconnect an account after changing its requested permissions so its saved authorization includes them.

Postly can publish one image, a Reel, or a carousel of up to 10 image/video files. Stories are not supported by this connection. Instagram must be able to fetch media from a public HTTPS URL. Set `PUBLIC_MEDIA_BASE_URL` to the public root URL serving this Postly server. Media URLs use random identifiers and remain available for up to 24 hours while Meta fetches them. A localhost preview cannot be fetched by Instagram.

### TikTok

Create a TikTok developer app, add Login Kit and Content Posting API, request `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, and `video.publish`, and configure the exact redirect URL. TikTok may require those scopes to be added and approved in the developer portal. See [TikTok's scope reference](https://developers.tiktok.com/docs/en/tiktok-api-scopes) and [token management guide](https://developers.tiktok.com/docs/en/oauth-user-access-token-management).

TikTok access tokens expire after 24 hours; its token response also includes the refresh-token lifetime. Postly records both expiries, refreshes the access token when it approaches expiry, and stores any rotated refresh token. If TikTok revokes or expires the refresh grant, reconnect the account. TikTok requires the app to be audited before API posts can be publicly visible; unaudited direct posts are private-only.

Postly uploads videos directly using the Content Posting API. TikTok photos need `PUBLIC_MEDIA_BASE_URL` and a public URL/domain verified in the TikTok developer app. Before publishing, Postly queries the connected creator's current audience options and requires an explicit audience choice. TikTok's current file-size, format, duration, and posting limits still apply. Public visibility can require TikTok's app audit.

### YouTube

Create a Google Cloud OAuth web client, enable YouTube Data API v3 and YouTube Analytics API, add the callback URL as an authorized redirect URI, and configure the OAuth consent screen for `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`, and `yt-analytics.readonly`. The read and Analytics scopes enable channel metrics; `youtube.force-ssl` enables replying to comments. The server requests offline access and refreshes short-lived access tokens while the refresh grant remains valid. Google may require verification before the app can be used by people outside its test-user list. See [Google's OAuth web-server guide](https://developers.google.com/identity/protocols/oauth2/web-server) and [YouTube OAuth scope reference](https://developers.google.com/youtube/data/guides/auth/server-side-web-apps).

Postly can load recent channel videos, date-range Analytics, and comments on channel videos. Reconnect YouTube after adding `youtube.force-ssl` so the account can reply from Community.

YouTube videos upload through the resumable upload API. New uploads default to **Private**; choose Unlisted or Public in the channel settings before publishing if desired. The first non-empty line becomes the title, up to 100 characters; remaining text becomes its description. YouTube classifies Shorts from the uploaded media rather than a Postly setting.

## Run locally

Start Postly with `pnpm dev`. The Vite app runs on port 4174 and proxies API calls to the OAuth server on port 4175. After saving `.env.local`, restart the process and open **Connect a channel**. Postly redirects to each provider's sign-in page; it never asks for a social password.

For a single-owner hosted installation, use [DEPLOYMENT.md](DEPLOYMENT.md). It runs the Node API and scheduled worker continuously with persistent account/job/media storage, HTTPS, and a password gate.

## Publishing behavior and limits

Choosing **Now → Publish now** sends each selected post to its connected provider. If one provider succeeds and another fails, Postly saves the successful result and leaves only the failed channels selected, so retrying will not resend to successful accounts. TikTok may take longer to finish processing; check the Publishing tab for its final status.

Scheduled posts are saved in the browser queue and as durable per-channel jobs in the local Postly server's `.postly-data/scheduled/jobs.json` store, with uploaded media kept in its `media/` subdirectory. The server dispatches due jobs through the existing provider adapters while it is running and resumes persisted jobs after restart; the browser does not need to stay open. Each channel keeps its own delivery state. Definite rate limits retry with backoff; confirmed provider or setup failures can be retried from Queue, while uncertain outcomes require checking the social channel and explicitly accepting duplicate-post risk. Posting still requires a connected, configured provider app and any permissions or reviews the provider requires. Local server limits remain 250 MB of media per post and 256 MB per request. Hosted delivery is ready for the single-owner Docker deployment described in [DEPLOYMENT.md](DEPLOYMENT.md); it is not live until a host, domain, and provider credentials are configured.

The composer saves some options that the live provider APIs do not receive yet, including first comments, collaborators, Instagram music, and product tags. The channel customization panel marks these as local-only. The AI-generated disclosure is sent only to TikTok.

Insights and Community load account data on demand after a provider is connected. Community comment replies are supported for Instagram and YouTube when the matching comment permissions are granted. TikTok's standard creator API can return profile and video statistics but does not provide the comment inbox/reply flow used here. YouTube and TikTok mentions are not available from these account APIs.

Instagram and TikTok photo media is hosted briefly at `PUBLIC_MEDIA_BASE_URL` so those providers can retrieve it. The local preview cannot provide a public media address. Instagram photo/video publishing and TikTok photo publishing therefore require a public HTTPS server; TikTok also requires a verified media URL domain. YouTube video and TikTok video uploads transfer directly from the server to the provider.

OAuth tokens remain encrypted in `.postly-data/accounts.enc` with AES-256-GCM; the directory and account file use owner-only permissions. `TOKEN_ENCRYPTION_KEY` must encode exactly 32 bytes, and production requires it to be configured. Status reports provider scopes and token expiry but never returns token values. Disconnect removes the local encrypted account; TikTok and YouTube also receive a provider revocation request, and the response distinguishes a confirmed provider revocation from a local-only or failed revocation. Instagram disconnect currently removes the local token only; revoke Postly's grant from Instagram's connected-app settings if you also want to remove the remote authorization.

Before hosting Postly for other users, add app-level authentication and per-user token isolation instead of exposing this local single-user server.

For the exact temporary media storage settings, public HTTPS route, retention behavior, and deployment checks, see [MEDIA-HOSTING.md](MEDIA-HOSTING.md).

## Provider media constraints and delivery status

The adapter checks file MIME types and byte limits before upload. Providers also validate stream codecs, duration, frame rate, dimensions, account eligibility, moderation, and posting quotas; their current rejection reason is returned when available.

- **Instagram:** Images are JPEG up to 8 MB. Carousels contain 2–10 image/video items. Reels accept MOV or MP4 up to 1 GB; Meta's documented stream constraints include H.264 or HEVC video, AAC audio, 23–60 FPS, and 3 seconds–15 minutes. The adapter polls a media container once per minute for up to five minutes. `FINISHED` means ready for `media_publish`; only the publish response or container status `PUBLISHED` is reported as published. A timed-out or uncertain result retains the same container ID for a later status check. See Meta's [Instagram API publishing collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) and [Reels requirements](https://www.postman.com/meta/instagram/folder/y6xustx/reels-publishing).
- **TikTok:** Direct video posts accept MP4, MOV, or WebM up to 4 GB. TikTok documents H.264/H.265/VP8/VP9, 23–60 FPS, 360–4096 pixel dimensions, and up to 10 minutes sent to the API; the connected creator's `max_video_post_duration_sec` can be lower. Chunk uploads are sequential, use 5–64 MB chunks (the final chunk may be larger), and expect HTTP 206 for intermediate chunks and 201 for the last chunk. Transient 5xx responses retry the same chunk. Photo posts accept JPEG/WebP up to 20 MB each, up to 35 images, with a 90-unit title and 4,000-unit description. TikTok's `PUBLISH_COMPLETE` is the completion signal. A public post ID may be absent for private posts or while public moderation is pending, so Postly keeps the publish ID and does not invent a remote post ID. `FAILED` and `fail_reason` are surfaced. See TikTok's [direct post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post), [photo post](https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post), [media transfer guide](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide), and [status and failure reasons](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status).
- **YouTube:** `videos.insert` accepts `video/*` and `application/octet-stream` media up to 256 GB. Postly's current multipart request limit is 250 MiB total. A resumable upload response ID confirms receipt, not processing or public visibility. Postly polls `status.uploadStatus` and `processingDetails.processingStatus`; upload/processing failures and their provider reason are returned, and `published` is reported only after YouTube returns `processed` without a processing failure. Timed-out uploads keep their video ID so a retry can check processing without uploading again. See Google's [videos.insert reference](https://developers.google.com/youtube/v3/docs/videos/insert), [video processing guide](https://developers.google.com/youtube/data/guides/implementation/videos), and [video resource status fields](https://developers.google.com/youtube/v3/docs/videos).

For retry protection, Postly writes a provider/account/content fingerprint and provider IDs to `publishing-idempotency.json` in the local data directory before sending a request. Matching retries return the saved confirmed result or recheck a pending provider ID; uncertain in-flight outcomes are blocked from being sent again. The fallback fingerprint is retained for 24 hours. The adapter also accepts an explicit idempotency key for workflows that need to distinguish a deliberate repeat of identical content.
