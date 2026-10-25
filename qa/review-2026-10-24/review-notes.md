# Postly review — 24 October 2026

## Scope

Reviewed a fresh local browser profile at 1440×900 across Home, the composer, Publish Queue, weekly calendar, Create Ideas, Community, Insights, and channel settings. Also inspected the provider connection setup for Instagram, TikTok, and YouTube, and checked Community at 390×844. No real accounts were connected and no post was published.

## Steps and health

1. **Home** (`01-home.png`) — Healthy. Clear first steps, local-history metrics, and honest disconnected labels.
2. **Open composer** (`02-composer-open.png`) — Functional, visually inconsistent. It opens from Home, but uses a near-black full-screen panel inside the otherwise light app; title and several controls appear faint.
3. **Publish Queue** (`03-publish-queue.png`) — Healthy empty state. It explains device-local queue behavior and that hosted background delivery is not configured.
4. **Weekly calendar** (`04-calendar-week.png`) — Healthy structure. Date range and timezone are shown; the date and timezone labels run together with little spacing.
5. **Create Ideas** (`05-create-ideas.png`) — Healthy board layout with working route and visible starter ideas.
6. **Community** (`06-community.png`) — Honest disconnected state; replies and mentions require a connected account.
7. **Insights** (`07-insights.png`) — Honest disconnected state; performance values use dashes and are labeled unavailable.
8. **Channel settings** (`08-settings-channels.png`) — Clear 0/3 connection state and separate Instagram, TikTok, and YouTube actions.
9. **Instagram setup** (`09-connect-channel-dialog.png`) — Setup screen is present, but the dark dialog has low-contrast labels. Instagram client ID and secret are both reported missing.
10. **Community on mobile** (`10-community-mobile.png`) — Comments and Mentions remain visible at 390px; no horizontal overflow. The page continues vertically below the captured viewport.
11. **TikTok setup** (`11-tiktok-setup.png`) — OAuth instructions are present; client key and secret are both reported missing.
12. **YouTube setup** (`12-youtube-setup.png`) — OAuth instructions are present; client ID and secret are both reported missing.

## Findings

- The app looks coherent across the main routes and labels disconnected, local, and unavailable data rather than pretending the external services are live.
- The strongest visible polish issue is the dark composer and account dialogs in an otherwise light interface. Improve their text contrast and make their surface treatment consistent.
- The calendar date/timezone spacing needs a small correction.
- OAuth setup UI exists for all three requested networks, but actual sign-in cannot work until each provider's developer credentials are configured; platform approval may also be needed.
- The app's queue UI says hosted background delivery is not configured. The local server can run scheduled jobs while it is running, but this review did not verify production hosting or live delivery.

## Evidence limits

The preview rendered all inspected routes with HTTP 200 and no browser console/page errors during this capture. This is a visual and interaction spot check, not a full accessibility audit or a real-provider publishing test. Screenshots are saved in this folder; `capture-summary.json` contains the route capture metadata.
