# Postly

> **Beta.** Postly is a social publishing workspace for creating, scheduling, and managing social content. This independent project is inspired by Buffer and is not affiliated with Buffer.

The app includes a responsive creator workflow for drafts, queues, calendar, community, templates, feeds, insights, ideas, and settings. It persists local workspace data and includes server-side connection and publishing adapters for Instagram, TikTok, and YouTube.

## Run locally

Requirements: Node.js and npm.

```sh
npm install
npm run dev
```

For the standalone server, run `npm start`. See [SOCIAL-CONNECTIONS.md](SOCIAL-CONNECTIONS.md) for provider setup, capabilities, and publishing constraints. Copy `.env.example` to `.env.local` only when configuring local provider credentials. Keep `.env.local`, encrypted provider account data, and secrets private; they do not belong in this repository.

## Deployment

The app is designed for a single-owner hosted installation. See [DEPLOYMENT.md](DEPLOYMENT.md) and [MEDIA-HOSTING.md](MEDIA-HOSTING.md) for deployment, authentication, and media requirements. A public host and provider credentials must be configured before live hosted use. Do not expose this single-owner installation as a multi-user service without adding app authentication and per-user token isolation.

Provider actions depend on each platform's credentials, scopes, review status, account eligibility, media rules, and quotas. The UI reports provider-confirmed outcomes and keeps local/demo states distinct from connected account data.
