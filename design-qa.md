# Design QA

## Reference and scope

The user authorized a faithful recreation of the signed-in Buffer publishing app and named the product Postly. Reference screenshots were captured from the authenticated Buffer browser session at 2880×1800 (device scale factor 2), then normalized to 1440×900. Local desktop comparisons use a 1440×900 viewport; mobile comparisons use 390×844 at device scale factor 1. On 24 October, the current Chrome session no longer contained the Buffer tab, and direct navigation redirected to sign-in. Current visual review therefore uses the saved authenticated captures; fresh private account states could not be checked.

Desktop reference captures used in the current comparison are normalized to 1440×900 in `qa/normalized/buffer-*-source-1440x900.png`. Mobile reference captures cover Home, Publish, Community, Create, Insights, and Settings → Channels in `qa/buffer-*-mobile-live.png`. This latest pass used the saved authenticated reference captures and fresh local Postly captures; the current desktop screenshots and side-by-side comparisons are in `qa/current/`.

The inspected routes include Home, Publish Queue/Drafts/Sent, week/month Calendar, channel schedules/settings, Community Comments/Mentions and post/list views, Create Ideas/Board/Gallery, Templates, Feeds, Insights, and all 15 Settings sections. Visual comparisons cover the authenticated screens available in the reference captures.

## Changes in this pass

- Matched the mobile Create Ideas Gallery to Buffer’s compact icon toolbar and stacked card layout. Added the featured extension artwork treatment to the inspiration card and aligned its sample copy with the reference.
- Reworked mobile Insights controls into a date-range menu and compact filter/export actions. Removed the desktop channel-connect promo from the narrow layout to match the reference hierarchy and moved Weekly Takeaways up to the same position.
- Kept mobile date, filter, status, gallery, and new-idea controls interactive.
- Preserved the Postly brand and truthful disconnected account/analytics states.

## Verification

- Production build passed and emitted `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
- `pnpm test:sites`: 4 passed, 0 failed.
- Playwright checked 34 routes at 320, 390, 768, 1024, and 1440px: 170 route/viewport combinations, with no horizontal overflow, browser errors, or failed HTTP requests.
- Mobile interaction check passed for Create Board/Gallery switching, New Idea dialog, Insights date-range/filter menus, and Publish status menu.
- Final paired captures include Create and Insights on desktop and mobile, Publish and Community on mobile, Channels on mobile, and Home on mobile. All paired captures use the same viewport and device scale factor.

## Remaining fidelity gaps

1. **P1 — Account-specific states and content do not match.** Buffer shows the signed-in user's connected Instagram, TikTok, and YouTube profiles, a real failed Reel, and populated analytics. Postly intentionally uses local sample records and unconnected accounts. The local `/api/social/status` endpoint confirms all three providers are unconfigured and disconnected. No private post media, handles, or analytics were copied into the sample app.
2. **P1 — Live account parity still depends on provider setup.** Postly now has OAuth and provider publishing adapters for Instagram, TikTok, and YouTube, but no credentials are configured in `.env.local`, so the adapters have not been exercised against the user's accounts. See the live-publishing QA section below.
3. **P2 — Some visual content and fine details still differ.** The Ideas artwork is a locally generated, Postly-branded asset rather than Buffer's original. Connected-channel avatars, exact post media, Buffer-specific account copy, and some analytics cards are absent. Postly branding differs intentionally from the reference brand.
4. **P2 — Mobile Insights reference was captured in a loading state.** The reference displays skeleton placeholders while Postly displays useful disconnected-state prompts and metrics placeholders, so the data region is not pixel-identical.

## Result

Core page frames, navigation, responsive layouts, and visible controls are substantially closer across desktop and mobile. The app is not a one-to-one reproduction while the account-specific states, exact media, and live provider connections remain unavailable.

status: in progress; account-level parity still depends on provider setup and authenticated account data.


## Whole-app improvement pass — 23 October 2026

Kept the Postly shell and improved the cross-page planning workflow. Queue and Drafts show persisted records and accurate counts; Home's Up Next reflects scheduled records; the month and week calendars open the matching editor; personal templates are shared with the composer; and idea stages persist after refresh. Empty, disconnected, and local-only states use explicit copy.

Responsive recheck covered Home, Drafts, Calendar, Ideas, Templates, Community, Insights, and Channel Settings at 320, 390, 768, 1024, and 1440 pixels. Mobile Home and Ideas captures from this pass are in `qa/improvements/08-home-mobile-final.png` and `qa/improvements/09-ideas-mobile-final.png`.


## Latest timezone and appearance pass — 23 October 2026

Postly now applies the selected timezone to composer wall times, queue labels, calendar grouping and event times, Insights date ranges, Home dates, weekly posting goals, and streak days. “Next Available” reads the selected channels’ saved posting schedules in each channel’s timezone. The System appearance preference follows OS theme changes, with readable dark styles across the workspace.

Verification passed for daylight-saving edge cases, a scheduled post flowing from composer through the queue and calendar, a channel-schedule-derived slot, disabled scheduling when no channel slot exists, and 24-hour midnight display. The responsive smoke sweep passed 37 routes at five viewport widths (185 checks), with no overflow or page errors. The production build and all 4 Sites packaging checks passed.

At the time of this historical pass, live connections were unavailable and publishing adapters had not been implemented. The adapters have since been added; the connected account details and live analytics remain unavailable until provider credentials and account authorization are supplied. Setup is in `SOCIAL-CONNECTIONS.md`.

## Settings shell fidelity pass — 23 October 2026

Desktop Settings now uses the dedicated left navigation and a rounded content panel, with the section content centered to match Buffer's Preferences layout. Preferences shows the same seven controls and default posting action as the reference, without an extra weekly-goal row. Mobile Channels matches the reference's title/action, plan card, connection count, and channel row positions; the app drawer provides links to all 15 Settings sections. Desktop Channels retains a working Connect Channel action.

Playwright passed 75 Settings route/viewport combinations at 320, 390, 768, 1024, and 1440px without horizontal overflow or page errors. Back navigation, the mobile Settings links, a saved time-format preference, the Connect Channel dialog, and Light/Dark theme changes worked. The desktop and mobile layout captures are in `qa/improvements/33-preferences-desktop-final.png` and `qa/improvements/35-channels-mobile-reference-match.png`. The final production build passed and `pnpm test:sites` passed all 4 checks.

At the time of this historical Settings pass, `.env.local` had no provider IDs/secrets or redirect base, all 3 accounts were disconnected, and provider publishing was not implemented.

## OAuth and live publishing pass — 23 October 2026

Provider OAuth and server-side publishing adapters are now implemented for Instagram, TikTok, and YouTube. Tests cover authorization scopes/state handling, token refresh, Instagram image and carousel posts, TikTok video and photo upload flows, YouTube resumable upload, privacy defaults, partial provider failure, and retry behavior. Publishing results are saved locally only after a provider call succeeds.

This pass verified 7 OAuth/API checks, 9 mocked provider checks, and 3 Playwright composer checks. Live account verification remains pending: `.env.local` has no provider credentials and `/api/social/status` reports all providers disconnected. Public HTTPS media hosting is also needed for Instagram media and TikTok photos; future scheduled posts remain browser-local and are not automatically sent. See `SOCIAL-CONNECTIONS.md` for setup.

## Current matched visual review — 23 October 2026

Fresh local captures cover Home, Publish, Create Ideas, Community, Insights, Settings → Channels, and Settings → Preferences at 1440×900; Home, Publish, Create Ideas, Community, Insights, and Settings → Channels at 390×844. Side-by-side Buffer/Postly screenshots use the same 1440×900 desktop viewport for Home, Publish, Create, Community, and Insights. The mobile Channels comparison uses matching 390×844 captures. Evidence is in `qa/current/compare-*.png`, `qa/current/compare-settings-channels-mobile-390x844.png`, and the paired source/local images in the same folder.

The refreshed visual pass confirms that page-title sizing, the four compact idea lanes plus the New lane action, the locally stored Postly extension artwork, mobile Channels spacing, and disconnected publishing copy have improved. The mobile Channels plan card and provider rows align closely with the reference; their connection labels and actions correctly differ because no accounts are connected. The updated Publish capture also shows an explicit local-only scheduling notice instead of implying that scheduled content will be sent automatically.

The desktop comparisons still show the signed-in Buffer account's failed Reel, connected profiles, and populated insights against Postly's disconnected state. Community likewise lacks the account's live inbox content. These are material P1 parity gaps until OAuth credentials are configured, the user's accounts are authorized, and live account data is available. No live provider connection was possible in this pass. The product remains Postly-branded by request.

Current verification: production build passed; 4 Sites packaging checks, 7 OAuth API checks, 9 mocked provider checks, 5 composer publishing checks, 4 ideas-board checks, 6 workspace menu checks, and 190 responsive route/viewport checks passed. The route sweep covered 38 routes at 320, 390, 768, 1024, and 1440 pixels with no page errors, console errors, failed HTTP responses, or horizontal overflow.

## Live account data surfaces — 23 October 2026

Connected-account data now appears in Home's comment preview, Insights, and Community. Insights reads provider summaries and recent posts, applies date/channel filters, exports CSV or JSON, and displays follower totals by channel. Community reads Instagram and YouTube comments, Instagram mentions, local resolve/reopen state, and provider-backed replies. OAuth now requests the required read scopes; YouTube comment replies also request `youtube.force-ssl`.

The connected-state screenshots in `qa/current/postly-connected-{home,insights,community}-1440x900.png` and `qa/current/postly-connected-insights-mobile-390x844.png` use mocked account responses for visual and interaction review. They do not contain the user's account data. TikTok profile/video statistics are supported, but its standard creator API does not provide this comment inbox; YouTube and TikTok mentions are also unavailable through the current integrations.

Verification passed for 7 mocked provider-data checks, 10 OAuth/API checks, and Playwright workflows for Home previews, Insights metrics/date/channel filters/export, Community comments/mentions/replies/local resolution, and responsive mobile controls. The 190 route/viewport sweep also passed with no overflow, page errors, console errors, or failed requests.

Live parity is still blocked by missing provider app credentials in `.env.local` and the absence of authorized accounts. Reconnect previously linked YouTube accounts after adding `youtube.force-ssl`; actual provider analytics, permissions, and account-specific layouts remain unverified until credentials are configured.

final result: blocked

## Whole-app continuation — 24 October 2026

Fixed mobile inbox focus restoration so closing a conversation returns keyboard focus to the selected inbox row after the list becomes visible. Added a clipboard fallback used by Start Page, API key, and app-link actions. Start Page share links now carry a bounded, escaped title, introduction, and validated HTTPS social links; they open in a standalone responsive preview without requiring the recipient's local storage. The preview shows a device-only notice when copied from localhost. The Ideas board now has the reference's Tags filter; tags can be assigned to ideas, persist with them, and filter Board and Gallery views.

Verification passed: production build and Sites packaging, 190 route/viewport combinations across 38 routes and five widths, 8 queue/inbox/Insights workflows, 7 copy and Start Page checks (including HTTPS validation, a separate browser context, social-link rendering, and unsafe-text handling), 6 menu checks, 5 publishing UI checks, 6 Ideas checks, 3 connected social-view workflows, 9 mocked provider publishing checks, 7 mocked provider data checks, 6 post-action checks, and 4 worker packaging checks. The updated Create Ideas captures are in `qa/current/postly-create-ideas-1440x900.png` and `qa/current/postly-create-ideas-390x844.png`; the standalone shared page is in `qa/current/postly-start-page-shared-390x844.png`. The 24 October Buffer reference is not currently signed in; account-specific visual parity remains unverified.

## Create workspace follow-up — 24 October 2026

Added a Create-owned tag creation action to the Ideas Tags filter, linked to the existing local tag editor. The Ideas Board/Gallery, Templates, and Feeds routes were checked at 1440×900 and 390×844; all three fit at 320px without horizontal overflow. Start Page owner and shared views were checked at 390×844. This was a responsive and interaction pass, not a new pixel-match comparison.

Current Postly evidence: [Ideas desktop](qa/current/postly-create-ideas-1440x900.png), [Ideas mobile](qa/current/postly-create-ideas-390x844.png), [Feeds mobile](qa/current/postly-create-feeds-390x844.png), [Start Page owner mobile](qa/current/postly-start-page-owner-390x844.png), and [shared Start Page mobile](qa/current/postly-start-page-shared-390x844.png). The Create workflow checks and production build passed; Postly branding remains in place.


## Post composer responsive pass — 24 October 2026

The Postly composer now makes channel selection, copy entry, attachment previews, and local scheduling states easier to scan. Network-specific publishing errors appear before immediate publish, while future posts clearly identify the local queue. The saved Buffer Publish and Create screenshots were the only visual references used; the UI retains Postly branding.

Keyboard and responsive checks covered schedule choices, Escape dismissal and focus return, attached-media previews, and the composer at 320px and 390px. This was an interaction and responsive check, not a new pixel-match capture.

## Home and Insights source parity — 24 October 2026

Home's Comment Score and Insights now share the same timezone-aware `/api/social/insights` request path; Home uses its 30-day range. Home streak and weekly posting goals continue to use local post history and are labeled as local. Home's score badge and Insights' source line distinguish synthetic samples, live provider responses, partial results, disconnected accounts, and unavailable or unverified data. Missing metrics render as dashes instead of fabricated zeroes.

Insights applies the selected date range and channels to the same account summaries and returned posts shown in its summary, per-channel recent-post counts, Top Posts, and exports. CSV and JSON include the source, date range and timezone, selected providers, filtered summaries, channel rows, and filtered post rows. The saved Buffer comparisons reviewed for this pass were `qa/current/compare-home-1440x900.png`, `qa/current/compare-insights-1440x900.png`, `qa/buffer-home-mobile-live.png`, and `qa/buffer-insights-mobile-live.png`; Postly branding remains intact.

The Postly captures at `qa/current/postly-connected-home-1440x900.png`, `qa/current/postly-connected-insights-1440x900.png`, and `qa/current/postly-connected-insights-mobile-390x844.png` use synthetic fixtures and show the sample-data label. They do not represent live account metrics.

Verification passed: `node qa/verify-home-insights.mjs` (4 focused workflows) and `npm run test:social-views` (6 workflows, with its Insights fixture explicitly labeled synthetic). Home was checked at 1440×900, 390×844, and 320×844; Insights was checked at 1440×900, 390×844, and 320×844, including mobile date/channel/export controls. `npm run build` generated the production client and Sites server package.

Live provider parity remains unverified because the local provider status is disconnected. Browser responses in these checks were synthetic and intercepted; no provider credentials were requested or read, and no real social account was connected or changed.
