# Interaction QA

Tested on 19 October 2026 in Chrome through Playwright at desktop and mobile sizes, using Africa/Johannesburg time. The product is now named Postly.

## Fixes

Replaced notice-only overflow controls with menus and local forms. Added editable queue and draft records; saved personal templates; live template filters; populated previews; image and video media stored locally across refreshes; working emoji/link/hashtag insertion; channel profile setup; saved customization; no-channel and schedule-time validation; unsaved-change protection; Escape/outside dismissal; and modal focus handling.

## Browser checks

- Passed: Sidebar, New menu, Escape dismissal
- Passed: Organization menu and settings save
- Passed: Channel setup updates workspace
- Passed: First Steps completion and feedback form
- Passed: Composer opens from Create Post
- Passed: Integration menu, outside dismissal, insert link
- Passed: Emoji picker and hashtag insertion
- Passed: Upload and populated channel previews
- Passed: Template search and live filters
- Passed: Create personal template and apply it
- Passed: Writing Assistant explains that AI generation is not connected and adds a user-provided writing brief to the current post
- Passed: No-channel validation prevents scheduling
- Passed: Channel customization settings and upload chooser
- Passed: Calendar, time, and posting actions menu
- Passed: Schedule saves a real editable queue entry
- Passed: Post overflow menu copies to drafts
- Passed: Edit scheduled post and preserve customization
- Passed: Drafts, queue tabs, and persistence after refresh
- Passed: Delete scheduled post via overflow menu
- Passed: Sidebar destinations and new-menu forms
- Passed: API information and help navigation
- Passed: Mobile sidebar, New menu, and composer
- Passed: Mobile template, filter, preview, and date picker controls
- Passed: Browser runtime and resource responses
- Passed: Unsaved post supports keep editing, discard, and save
- Passed: Image bytes survive saving a draft and a page refresh
- Passed: Invalid and past times are rejected
- Passed: Selected schedule date and time restore when editing
- Passed: Character limit blocks scheduling but permits saving a draft
- Passed: Publish Now is separate from scheduled queue
- Passed: First Steps completion persists after refresh
- Passed: Repeated template names update without duplicate keys
- Passed: Modal keyboard focus stays inside the active dialog
- Passed: Responsive layouts fit 320, 390, 768, 1024, and 1440 pixel widths
- Passed: Calendar remains usable in short and landscape windows
- Passed: Storage errors are shown without crashing the application
- Passed: Malformed browser data does not crash the application

Browser console errors, uncaught exceptions, and failed HTTP responses across the passing interaction run: **0**. The edge-case run also completed without browser errors.

## OAuth API checks

- Passed: Provider status does not expose credentials
- Passed: Instagram, TikTok, and YouTube authorization URLs include their expected publishing scopes and callbacks without client secrets
- Passed: Invalid OAuth state is rejected
- OAuth API checks at the time of this original browser pass: **5 passed**.

Production build: passed. Worker and build-packaging checks: **4 passed**. Original OAuth API checks: **5 passed**. Total Playwright checks at that point: **38 passed** (25 interaction checks and 13 edge-case checks).

## Evidence

- [Desktop Home](qa/home-desktop.png)
- [Mobile Home](qa/home-mobile.png)
- [Mobile calendar](qa/mobile-calendar.png)
- [Navigation menu](qa/navigation-menu.png)
- [Organization menu](qa/organization-menu.png)
- [Populated composer preview](qa/composer-preview.png)
- [Machine-readable interaction results](qa/interaction-results.json)
- [Machine-readable edge-case results](qa/edge-results.json)
- [OAuth API verification](qa/verify-oauth-api.mjs)
- [Reproducible browser checks](qa/verify-interactions.mjs), using Playwright with Chrome. Set PLAYWRIGHT_MODULE_URL when Playwright is supplied outside the project.
- [Reproducible edge-case checks](qa/verify-edge-cases.mjs)

## Limits

Queue entries, local preview profiles, settings, templates, and forms are saved in browser storage; media bytes are stored in local IndexedDB. OAuth account linking and provider publishing adapters are implemented for Instagram, TikTok, and YouTube. Developer app credentials and any required platform reviews are still needed to connect and test the user's accounts. Live analytics, email sending, and a connected AI service are not implemented. See [SOCIAL-CONNECTIONS.md](SOCIAL-CONNECTIONS.md) for setup and limits.

Original interaction QA result: passed.

## Live publishing implementation — 23 October 2026

- Passed: 9 mocked provider-adapter checks for Instagram image/carousel publishing and unsupported Stories, TikTok token refresh, current audience lookup, chunked video upload, verified-host photo upload, and YouTube resumable upload with Private visibility by default.
- Passed: 3 browser checks for provider settings, partial success with only failed channels left selected, and retry without resending to a channel that already published.
- Passed: 7 OAuth/API checks, including denied cross-origin publish attempts and disconnected accounts returning an error instead of a published record.
- Passed: Sites build and packaging checks; the production build includes the server publishing adapters.

Live provider publishing is implemented, but has not been exercised against the user's accounts. Instagram, TikTok, and YouTube credentials are still blank in `.env.local`, and all three providers report disconnected. Instagram image/Reel and TikTok photo publishing also need a public HTTPS media host; TikTok photos need that host verified in the developer app. Future queue entries remain local and are not automatically published at their scheduled time. See [SOCIAL-CONNECTIONS.md](SOCIAL-CONNECTIONS.md).

## Latest fidelity pass

- Passed: 75 representative responsive route/viewport combinations across Home, Publish, channel schedules, Community, Create, Insights, and Settings at 320, 390, 768, 1024, and 1440px; zero horizontal overflow and zero page errors.
- Passed: page bookmark toggles, Community Comments/Mentions, Community panel collapse, Publish channel filter, Calendar route selection, and mobile navigation drawer/link.
- Passed: production build and all 4 Sites packaging tests.
- Matched screenshots include authenticated Buffer Home mobile at 390×844 and desktop route captures at 1440×900; detailed remaining visual differences are in [design-qa.md](design-qa.md).

## Latest whole-site responsive pass

- Passed: 34 routes × 5 viewport widths (320, 390, 768, 1024, 1440px), 170 route/viewport cases, including all Settings sections, channel schedules/settings, Community views, Create views, Publish views, and Insights; no horizontal overflow, browser errors, or failed requests.
- Passed: mobile Create Board/Gallery controls and New Idea dialog; Insights period and filter menus; Publish status menu.
- Passed: production build and 4 Sites packaging tests.
- Local OAuth status endpoint confirms Instagram, TikTok, and YouTube are currently unconfigured and disconnected. Provider connection setup is recorded in `SOCIAL-CONNECTIONS.md`.


## Whole-app improvement pass — 23 October 2026

- Passed: New draft saves locally, survives refresh, edits in place, duplicates with its image attachment, and requires confirmation before deletion; Cancel preserves the draft.
- Passed: Personal templates can be created, edited, used in the composer, and deleted; an empty-state view returns after the last template is removed.
- Passed: Ideas can be added, moved to Done, remain in that lane after refresh, and convert to a draft with their notes.
- Passed: A post can be scheduled for tomorrow, appears in the queue and month calendar, and opens in the composer from its calendar event.
- Passed: Eight representative routes at 320, 390, 768, 1024, and 1440 pixels (40 route/viewport combinations) had no page-width overflow or browser errors. Mobile navigation, its Escape dismissal, the Publish status menu, and the Settings section picker also worked.
- Passed: Home shows unfinished First Steps as unchecked and lets the user mark them complete; starter idea copy is complete and no longer points to a missing destination.
- Passed: `pnpm build` generated the client and Sites server package; `pnpm test:sites` passed all 4 checks.

## Timezone, channel slots, and appearance pass — 23 October 2026

- Passed: changing the app timezone to New York from an America/Los_Angeles browser timezone schedules `9:15 AM` as New York wall time and places/shows the event at `9:15 AM` on the month calendar.
- Passed: daylight-saving conversion handles a nonexistent spring-forward time as invalid, maps valid post-jump times correctly, and resolves the fall-back repeated hour consistently.
- Passed: “Next Available” uses the selected channels' saved posting schedules and their individual timezones; when every selected channel has no enabled slot, Postly blocks scheduling and explains how to fix the schedule.
- Passed: 24-hour mode preserves midnight as `00:00` in the composer and calendar.
- Passed: System appearance follows OS light/dark changes; explicit Light remains light, and the selected Settings section remains readable in dark mode.
- Passed: 37 routes at 320, 390, 768, 1024, and 1440px (185 route/viewport checks) had no horizontal page overflow or browser page errors.
- Passed: `pnpm build` created the client and Sites server package; `pnpm test:sites` passed all 4 checks.

## Settings shell and mobile fidelity pass — 23 October 2026

- Rebuilt desktop Settings as a dedicated workspace with its own back link, section navigation, centered content panel, and single section heading. This removes the regular publishing sidebar and duplicate heading from the Buffer-matched layout. Preferences now uses Buffer’s seven visible controls, including the same default posting action, without an extra weekly-goal row.
- Matched the mobile Channels screen's layout positions at 390×844 and retained access to all 15 settings sections through the mobile navigation drawer.
- Passed 75 Settings route/viewport checks across 320, 390, 768, 1024, and 1440px with no horizontal overflow or browser page errors.
- Passed Settings back navigation, the desktop Connect Channel dialog, mobile Settings → Preferences navigation, preference persistence, and Light/Dark appearance checks.
- `pnpm build` passed; `pnpm test:sites` passed all 4 checks.
- At the time of this historical Settings pass, live connections were unavailable and publishing APIs had not yet been implemented. The current status is recorded in the OAuth and live publishing pass below.

## Current Settings captures

- [Desktop Preferences](qa/improvements/33-preferences-desktop-final.png)
- [Dark Preferences](qa/improvements/34-preferences-dark-final.png)
- [Mobile Channels aligned to Buffer](qa/improvements/35-channels-mobile-reference-match.png)

## Current full-app verification — 23 October 2026

- Passed: production build and Sites packaging checks (4).
- Passed: 7 OAuth API checks and 9 mocked publishing-adapter checks for Instagram, TikTok, and YouTube.
- Passed: 5 Playwright publishing checks, including accurate disconnected-state copy, TikTok audience options, partial-failure retry, and provider-confirmed Published status.
- Passed: 4 idea-board checks, including custom columns, persistence of edits, and malformed-data handling.
- Passed: 6 current workspace menu checks for the New menu, Escape dismissal, organization/help menus, composer opening/closing, provider setup panel, Publish channel filter, and mobile navigation.
- Passed: 190 route/viewport checks across 38 routes at 320, 390, 768, 1024, and 1440px. No page errors, console errors, failed HTTP responses, or horizontal overflow were detected.
- Passed: latest screenshot review at 1440×900 for Home, Publish, Create, Community, and Insights, plus a 390×844 mobile Channels comparison. See [current visual QA](design-qa.md#current-matched-visual-review--23-october-2026).

The local `/api/social/status` endpoint still reports Instagram, TikTok, and YouTube as unconfigured and disconnected. Live OAuth and account-data parity have not been verified. Scheduled posts remain local and are not automatically published. Setup and deployment requirements are in [SOCIAL-CONNECTIONS.md](SOCIAL-CONNECTIONS.md).

The older `verify-interactions.mjs` and `verify-edge-cases.mjs` scripts target the previous `.sidebar` / `.step-card` UI and are no longer current regression checks. Their selectors fail against the current workspace. The current checks are `test:menus`, `test:publish-ui`, `test:ideas`, and `test:routes`; the relevant legacy composer scenarios are covered by the current publishing checks where applicable.

## Connected data workflows — 23 October 2026

- Passed: mocked connected Home preview loads current comments and navigates into Community.
- Passed: Insights loads live-shaped metrics, requests the selected date range, filters by channel on desktop and mobile, opens data export, and renders recent posts and follower totals.
- Passed: Community switches Comments/Mentions, filters and sorts conversations, resolves and reopens comments locally, submits provider replies, and preserves the Mentions tab when switching list view and refreshing.
- Passed: mobile Insights and Community controls work at 390×844 without horizontal overflow or browser errors.
- Passed: provider-data mocks cover Instagram metric fallback and partial comment-permission failures; OAuth API tests cover strict date validation, empty disconnected states, scopes, and cross-origin reply rejection.

All browser data is synthetic in these checks. The local API currently reports Instagram, TikTok, and YouTube disconnected because `.env.local` has no app credentials. Live account verification remains pending.

## Queue and inbox usability — 24 October 2026

- Passed: 6 post-action checks for clearing provider results from draft copies, selection eligibility, delete recovery, preserving edits made after an action, media retention, and unsupported actions.
- Passed: 8 Playwright workflows covering search across post copy/tags/media, sorting, overdue queue warnings, bulk selection/move/delete/duplicate, confirmation cancellation, Undo across navigation and refresh, live publishing status, channel filter states, popover keyboard/dismissal behavior, inbox search/resolve/reply/mobile Back, and responsive states.
- Passed: queue, Community, and Insights fit at 320, 390, 768, 1024, and 1440px in the existing light and dark themes without page errors or horizontal overflow.
- Passed: 6 existing workspace-menu checks and 3 connected social-view workflows after the changes.
- Passed: production build and Sites packaging output.
- Captured before/after screenshots and evidence limits in [the improvement audit](qa/product-improvement-audit.md).

Provider responses in this browser workflow were synthetic. Real account publishing still depends on credentials and platform authorization. Scheduled delivery continues to need a hosted scheduler.

## Copy, Start Page, and inbox focus — 24 October 2026

- Fixed keyboard focus restoration when returning from a mobile inbox conversation. Focus now moves to the selected row after the detail view closes and the row is visible.
- Added a native clipboard fallback and explicit failure feedback to copy actions. Start Page share links carry a validated title, introduction, and HTTPS social links in the URL and render in a standalone page in a clean browser context; the public preview renders user text safely as text.
- Passed: 7 copy and Start Page checks, 8 queue/inbox/Insights workflows, 6 menu workflows, 5 publishing UI workflows, 6 Ideas workflows, 3 connected social-view workflows, and 190 route/viewport checks.
- Passed: 6 post-action, 9 mocked publishing adapter, 7 mocked social-data, and 4 Sites worker checks. The production build completed successfully.
- An attempt to run legacy `qa/verify-interactions.mjs` still fails at its first mobile-sidebar selector: it assumes the previous `.sidebar` UI and requests a mobile “Open menu” control at a 1440px desktop viewport. That script is not included in the current package test suite; current workflow coverage uses the listed route, menu, publishing, ideas, social-view, and product-improvement scripts.

Buffer was signed out in the current Chrome session. The visual audit uses saved screenshots and does not claim current account-level parity. OAuth providers remain unconfigured in `.env.local`; no social account was connected or modified in these checks.

## Provider connection setup status — 24 October 2026

- The provider status API returns the exact OAuth callback URL, required environment key names, and missing key names without returning credential values. Whitespace-only credentials count as missing.
- Connect Channel shows a distinct state for connected accounts, disconnected providers ready to connect, providers missing credentials, an unreachable setup API, and an unreadable account store. Disconnect failures remain attached to the provider and preserve the last confirmed connection state. It does not classify an unavailable API or unreadable account store as missing credentials or disconnected.
- OAuth setup details stay available for every supported provider, including connected and configured accounts. The redirect URL copy control was exercised for Instagram, TikTok, and YouTube and copied each exact server-provided URL.
- Passed: 11 isolated OAuth API checks and 10 workspace-menu checks. Browser provider states used synthetic status responses; OAuth credentials and account changes were not sent to real providers.
- Passed: production build with the Sites server package output.

## Temporary public media hosting — 24 October 2026

- Passed: 9 isolated public-media checks for required HTTPS configuration, rejection of localhost/IP/reserved or malformed origins, private configurable storage, accepted MIME types, per-file and aggregate size limits, UUID links, public GET/HEAD/range responses, expiry, cleanup, and a clear Instagram failure before any provider request when the media host is missing.
- Passed: production build, including `dist/server/index.js` and `dist/.openai/hosting.json`.
- Provider fetchability was checked against the media HTTP handler with mocked bytes. No public deployment host or real social account was contacted; external DNS/TLS/proxy reachability must be checked after deployment using [MEDIA-HOSTING.md](MEDIA-HOSTING.md).

## Community Comments and Mentions — 24 October 2026

- Community channel filters now persist separately from workspace-wide filters. Search matches all terms across the full conversation, including locally added replies; newest/oldest sorting uses each conversation's latest activity.
- Conversation detail shows the full thread in chronological order. Resolve/reopen updates the whole selected conversation or an individual comment and survives refresh.
- Reply forms require a nonblank reply, enforce the 2,000-character limit, retain drafts after provider errors, and appear only when the connected account has the required provider scope. Mention replies and TikTok comment replies remain unavailable through the supported APIs.
- Mobile Back and Escape return focus to the exact selected row and bring it into view.
- Passed: `npm run test:social-views` covers search, filters, sort, filter persistence, local resolve/reopen persistence, mocked Instagram/YouTube reply success and failure, missing-scope states, mentions/TikTok limitations, and mobile focus/navigation at 320px and 390px.
- Passed: `npm run test:social-data` (7 checks) and `npm run build`, including client and Sites server output.
- All Community QA data is synthetic and every reply request was intercepted by the test mock; no real provider reply was sent. The refreshed [Community capture](qa/current/postly-connected-community-1440x900.png) shows synthetic sample data.

## Create workspace workflows — 24 October 2026

- Added `npm run test:create-workspace` to cover the Create routes end to end. Ideas can create tags from the Tags filter, assign and filter them, save custom stages and ideas, then convert an idea into a composer post and a persisted Drafts record.
- Personal templates save, edit, prefill the composer, become shared drafts, and delete; both template changes and resulting drafts remain visible after refresh.
- Feeds reject unsafe URL schemes, save user and curated sources, expose each saved source as an external link, remove sources, and preserve the collection after refresh.
- Start Page title, introduction, and HTTPS links persist after refresh. Copy share link works on desktop and mobile; the shared page opens independently of local storage and renders untrusted text safely.
- Passed: `npm run test:ideas` (6 checks), `npm run test:create-workspace` (4 workflows), `npm run test:copy-and-start-page` (7 checks), and `npm run build`.
- Browser coverage used 1440×900 desktop and 390×844 mobile; Ideas, Templates, and Feeds were checked for overflow at 320px. No browser errors occurred. Feed links used test data and were not opened; no social account was contacted.
- The Ideas Tags filter also offers quick tag creation through the existing local tag editor, so tagging does not require leaving the board.

## Calendar and channel scheduling — 24 October 2026

- Calendar week/month navigation, selected-timezone labels, channel filters, chronological event order, and event-to-composer editing now use the same saved queue instants. The composer formats an edited event with the current 12/24-hour preference.
- Channel posting slots render in the selected 12/24-hour format, reject invalid values with an inline error, normalize valid edits, and persist with the channel's selected timezone. “Next Available” continues to skip nonexistent spring-forward times and uses the earlier occurrence of a repeated fall-back time.
- Passed: `node qa/verify-calendar-scheduling.mjs` covers mocked New York DST boundaries, a Los Angeles browser with New York Postly time, slot persistence/formatting, filter behavior, event opening, skipped spring-forward slot feedback, and responsive week/month/channel-schedule routes at 320, 390, 768, 1024, and 1440px. No browser errors or page-width overflow occurred.
- Passed: `npm run build` generated the production client and Sites server package (`dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`).

Calendar and post data in this check were synthetic local records. No social account was connected or changed.

## Publish Queue, Drafts, and Sent — 24 October 2026

- Queue, Drafts, and Sent counts continue to derive from the shared persisted post records. Channel results now retain each attempted provider, channel ID, outcome, and error, so mixed success/failure posts keep their retry state after refresh and navigation. Sent cards expose per-channel outcomes; editing a partially failed post selects only failed channels. Copies to Drafts continue to clear prior provider results and retain media.
- Passed: `npm run test:post-actions` (7 checks), including media and provider-result edits made after an action remaining intact through Undo.
- Passed: `npm run test:publish-ui` (6 mocked workflows), including partial and total provider failure, navigation and refresh, visible per-channel results, search by provider error, retrying only failed channels, and merging retry results into one record.
- Passed: `POSTLY_QA_OUTPUT_DIR=/tmp/postly-queue-qa npm run test:product-improvements` (10 workflows), including status counts, channel filters, search, sorting, queue edits with media preservation, bulk move/delete/duplicate, Undo across navigation/refresh, and responsive checks at 320, 390, 768, 1024, and 1440px in light and dark themes.
- Passed: `npm run test:routes` (190 route/viewport checks) and `npm run test:sites` (4 checks).
- Passed: `npm run build`, including `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

Provider replies and publishing in these browser workflows were synthetic and intercepted by mocks. No real social account was contacted or changed.


## Post composer and media workflow — 24 October 2026

- The composer opens with focus in Post copy, shows the selected channel count, and enforces the 2,200-character limit. Media files are checked for supported types, previewed from local device storage, and removable before saving.
- Immediate publishing checks media requirements for each selected network: Instagram photos/video, TikTok Video and Photo formats, and one YouTube video. Invalid media disables Publish now before any provider request. Future schedules register durable jobs for supported channels; the local server dispatches due jobs while it runs and resumes them after restart. Hosted background delivery is not deployed.
- Save Draft persists the post and attached media across refresh. Cancel offers Keep Editing, Discard Changes, and Save Draft. Schedule actions work from keyboard, dismiss with Escape, and restore focus; the same options and composer fit 320px and 390px mobile viewports. Scheduled records appear in both Queue and Calendar.
- Passed: composer browser workflow (10 mocked workflows, including scheduled registration, per-channel status/retry, duplicate-risk confirmation, and cancellation/date clearing when saving a scheduled post as a Draft), `POSTLY_BASE_URL=http://127.0.0.1:4176 node qa/verify-live-publish-ui.mjs` (6 mocked workflows), `POSTLY_BASE_URL=http://127.0.0.1:4176 node qa/verify-workspace-menus.mjs` (10 workflows), and `npm run test:publishing` (21 mocked provider checks).
- Passed: production Vite build with an empty environment directory, Sites packaging, and `npm run test:sites` (4 checks). No `.env.local` values were read; browser API responses were intercepted and no real account was contacted.

## Home and Insights source, filter, and export checks — 24 October 2026

- Home's Comment Score uses the shared Insights endpoint, displays a `SAMPLE` badge for synthetic responses, shows `LIVE`/partial only for provider responses marked live, and shows a dash while disconnected or unavailable. Its help text was clicked and checked on desktop and at 390px; streak and posting goals are identified as local history.
- Insights date ranges and channel selections drive the same displayed summaries, per-channel recent-post counts, ranked posts, CSV rows, and JSON payload. Exports carry source, selected providers, date range, timezone, filtered summaries, and post data.
- Passed: `node qa/verify-home-insights.mjs` (4 workflows) covers Home summary/source labels, 7-day and custom ranges, channel filtering, CSV/JSON export, disconnected placeholders, and responsive controls. Home fits at 390px and 320px; Insights fits at 390px and 320px and its mobile date, filter, and export controls work at 390px.
- Passed: `npm run test:social-views` (6 workflows), including synthetic Insights source labeling, Home comments preview, Community interactions, and mobile controls/focus behavior.
- Passed: `npm run build`, including `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

All Home/Insights browser fixtures were synthetic and intercepted. Live provider metrics were not available in this environment; no social account was connected or changed.

## Provider publishing adapter hardening — 24 October 2026

- The adapter applies provider media MIME/byte limits, TikTok photo title and description limits, and phase-specific TikTok chunk response checks. TikTok retries transient 5xx responses for the same chunk. Instagram treats `FINISHED` as ready and reports `PUBLISHED` only after provider confirmation; TikTok reports completion only for `PUBLISH_COMPLETE`; YouTube waits for `uploadStatus=processed` and a non-failing processing result.
- Pending provider IDs are retained and rechecked on a matching retry instead of starting a second upload. A durable retry journal is written before provider requests; ambiguous outcomes remain blocked, while provider-confirmed failures can be retried. Successful provider outcomes stay isolated per account/channel, preserving the existing partial-success flow.
- Passed: `npm run test:publishing` (21 mocked provider checks), `node qa/verify-public-media.mjs` (9 public media checks), and syntax checks for the adapter and both publishing/media QA scripts. No provider credentials were read and no real social account was contacted.
- Passed: `npm run build`; output includes `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

Provider stream codecs, duration, frame rate, dimensions, eligibility, moderation, and quota decisions remain provider-validated; their response status and failure reason are carried through where available. External Instagram/TikTok media reachability still depends on the configured public HTTPS host described in [MEDIA-HOSTING.md](MEDIA-HOSTING.md).

## Durable scheduled delivery — 24 October 2026

- The composer registers one stable job per selected supported channel. Jobs and media are stored in the local Postly server data directory; the worker uses a file lock, persisted state, and leases so restarts and concurrent server instances do not blindly resend a claimed post. The browser can close after registration.
- Queue cards show each channel's delivery state, refresh it from the scheduler API, and offer retries for definite failures. A retry after an uncertain result requires an explicit duplicate-risk confirmation. Deleting a scheduled post or moving it to Drafts first cancels its server jobs; if cancellation cannot be confirmed, the local post stays in Queue.
- Due jobs dispatch through the existing publishing adapters with deterministic idempotency keys. Definite rate-limit responses retry with capped backoff, provider-processing responses are polled, confirmed failures can be retried, and expired in-flight leases become recoverable review states instead of automatic resend.
- Passed: `npm run test:scheduler` (13 fake-time/mock scheduler checks and 3 temp-store API checks); composer browser workflow (10 mocked workflows, including scheduled-to-Draft cancellation, per-channel state, and duplicate-risk confirmation); `npm run test:publishing` (21 mocked adapter checks); syntax checks for the server and scheduler modules. The API test disables env-file loading and uses temporary data. Provider calls were mocked; no real posts were published.
- Hosted background delivery is not deployed. It still needs an always-on worker, shared durable job/database and media storage, and authenticated per-user token isolation. See [SOCIAL-CONNECTIONS.md](SOCIAL-CONNECTIONS.md) for the current local-server limits.

## OAuth server security and token lifecycle — 24 October 2026

- Cross-checked provider scopes and token behavior against [Meta's Instagram API with Instagram Login collection](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login), [TikTok's scopes](https://developers.tiktok.com/docs/en/tiktok-api-scopes) and [token management guide](https://developers.tiktok.com/docs/en/oauth-user-access-token-management), and Google's [OAuth web-server guide](https://developers.google.com/identity/protocols/oauth2/web-server) and [YouTube OAuth scopes](https://developers.google.com/youtube/data/guides/auth/server-side-web-apps).
- OAuth callbacks use the same validated exact redirect URI for authorization and code exchange. State is random, single-use, expires after 10 minutes, and must match an HttpOnly, SameSite=Lax browser cookie. Provider denial/exchange errors return generic callback results; access and refresh tokens remain encrypted and are never included in status responses.
- Status and refresh handling report known access/refresh expiries, missing publish scopes, refresh-required and reauthorization states. A rejected TikTok `invalid_grant` refresh response is normalized to a sanitized reconnect state. Disconnect removes local credentials; TikTok and YouTube revocation results are reported separately, while Instagram is documented as local-only.
- Passed: `node qa/verify-oauth-api.mjs` (20 isolated checks), `node qa/verify-social-publishing.mjs` (21 mocked provider checks), `node qa/verify-social-data.mjs` (7 mocked checks), and `node qa/verify-workspace-menus.mjs` (10 browser checks with stubbed provider status/actions).
- Passed: production Vite build with a fresh empty environment directory, Sites packaging, and `node --test tests/sites-worker.test.mjs` (4/4), including `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
- OAuth API tests disabled env-file loading and used synthetic credentials, temporary storage, and mocked provider endpoints; the Vite build used a clean process environment and empty `envDir`. No `.env.local` values were read or emitted, and no real account was connected, published to, or replied to.
