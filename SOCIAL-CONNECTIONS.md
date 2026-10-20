> **BETA:** This guide describes an experimental prototype; the integration is not production-ready.

# Postly social account connections

Postly now has server-side OAuth flows for Instagram, TikTok, and YouTube. OAuth credentials and tokens are never stored in browser storage. The local server stores exchanged tokens encrypted with AES-256-GCM in `.postly-data/accounts.enc`; that directory and `.env.local` are ignored by Git. A local encryption key is created with owner-only file permissions the first time a connection is saved. Production requires a `TOKEN_ENCRYPTION_KEY` secret instead.

## Configure provider apps

`.env.local` is ready for provider credentials. Generate a 32-byte token encryption key (`openssl rand -hex 32`). For the current standalone preview (`pnpm start`), register these exact callback URLs with each provider:

- Instagram: `http://localhost:4174/api/social/instagram/callback`
- TikTok: `http://localhost:4174/api/social/tiktok/callback`
- YouTube: `http://localhost:4174/api/social/youtube/callback`

For Vite development (`pnpm dev`), the callback API uses port 4175 instead. For a deployed app, set `APP_BASE_URL` and `OAUTH_REDIRECT_BASE` to the public HTTPS origin, register the corresponding HTTPS callback URLs in each developer console, and provide all secrets through the hosting provider's secret manager. Do not commit `.env.local`, token files, or production secrets.

### Instagram

Create a Meta developer app, add Instagram API with Instagram Login, and configure the `instagram_business_basic` and `instagram_business_content_publish` permissions. Publishing is available for eligible professional accounts and may require Meta app review for accounts outside the app's roles.

### TikTok

Create a TikTok developer app, add Content Posting API, request `user.info.basic` and `video.publish`, and configure the redirect URL. TikTok requires the app to be audited before API posts can be publicly visible; unaudited direct posts are private-only.

### YouTube

Create a Google Cloud OAuth web client, enable YouTube Data API v3, add the callback URL as an authorized redirect URI, and configure the OAuth consent screen for the `youtube.upload` scope. Google may require verification before the app can be used by people outside its test-user list.

## Run locally

Start Postly with `pnpm dev`. The Vite app runs on port 4174 and proxies API calls to the OAuth server on port 4175. After saving `.env.local`, restart the process and open **Connect a channel**. The app redirects to the provider so you can sign in and grant access; it never asks for your social password.

This work implements OAuth account linking and encrypted local token storage. It does not yet send scheduled posts through provider publishing APIs. Publishing media requires provider-specific upload handling and, for Instagram and TikTok URL-based media uploads, publicly reachable media storage and approved developer app configuration.
