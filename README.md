# Postly

> **BETA — experimental prototype.** Postly is not a production social-media publishing service. Live publishing, connected analytics, and production OAuth setup are not ready.

Postly is a responsive social publishing workspace inspired by Buffer. It recreates a broad creator workflow across Home, Publish, calendar, Community, Create, Templates, Feeds, Insights, and Settings. The product name and interface are Postly; this independent project is not affiliated with Buffer.

## What is in this beta

- Responsive navigation and local flows for queues, drafts, scheduled posts, calendar, templates, ideas, community views, and settings.
- Local persistence for queue and draft records, preferences, templates, and media previews.
- OAuth flow scaffolding for Instagram, TikTok, and YouTube, with server-side token exchange and encrypted local token storage.
- Sample/disconnected states for accounts and analytics, so the preview does not use private social account data.

## Beta limits

- Provider credentials and required reviews are not configured here; live account connections are unavailable in this snapshot.
- OAuth account linking is implemented, but provider publishing APIs are not yet wired to send scheduled posts.
- Live analytics, email sending, and a connected AI service are not implemented. Local analytics and account states are samples or disconnected prompts.
- A production release needs provider approval, production callback URLs, a secrets manager, and provider-specific media upload/storage.

## Run locally

Requirements: Node.js and npm.

```sh
npm install
npm run dev
```

For the standalone local server, use `npm start`. Copy `.env.example` to `.env.local` only if you are configuring local OAuth credentials. Keep `.env.local`, encrypted account data, and all provider secrets private; none belong in this repository. See [SOCIAL-CONNECTIONS.md](SOCIAL-CONNECTIONS.md) for setup and platform-specific limits.

The project includes local worker/build packaging code for its original preview environment. It does not configure or deploy a production service by itself.
