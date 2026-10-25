# Postly workspace improvement audit

Date: 24 October 2026

## Scope

Reviewed the publishing queue and inbox on desktop and phone, plus the Insights popovers. The goal was to find everyday friction around sorting, finding, organizing, and replying to content. The app was evaluated in a clean browser profile with synthetic connected-account responses.

## Captured steps and findings

1. Queue before: [01-queue-before.png](current/improvements/01-queue-before.png). The post list had search and per-post actions, but no way to act on a selection, sort its results, identify a missed time slot, or undo a mistake.
2. Inbox on phone before: [02-inbox-mobile-before.png](current/improvements/02-inbox-mobile-before.png). The screenshot showed a useful conversation, but Comments and Mentions controls were hidden at this width. DOM inspection confirmed both controls were absent from the visible layout.
3. Insights menu before: [03-menu-before.png](current/improvements/03-menu-before.png). The Export menu was open. Pressing Escape left it open and did not return focus to its trigger.
4. Queue after: [04-queue-after.png](current/improvements/04-queue-after.png). Search covered post copy, tags, and media names; the overdue post was called out; bulk selection showed a partial selection state; Undo was tested after navigation and refresh.
5. Inbox on phone after: [05-inbox-mobile-after.png](current/improvements/05-inbox-mobile-after.png). Comments and Mentions stayed visible. Selecting a conversation opened it with a Back action, and a submitted reply appeared in the thread.
6. Insights menu after: [06-menu-after.png](current/improvements/06-menu-after.png). Only one popover could stay open, Escape closed it and returned focus, and clicking elsewhere dismissed it.
7. Queue in dark appearance: [07-queue-dark-after.png](current/improvements/07-queue-dark-after.png). The bulk toolbar and overdue state were checked in the existing dark theme.

## Strengths

- The existing workspace kept its layout and navigation while gaining queue selection actions.
- Mobile users can reach both inbox tabs and return from an opened conversation.
- Every queued post that has passed its scheduled time is identified because local scheduled posts do not send automatically.
- Confirmed deletion, duplication, and moving to drafts can be undone for five minutes. Undo retains attached media and leaves newer edits in place.
- Posts still being processed by a provider appear under Sent and expose a status check.

## Evidence limits

- Browser tests verified keyboard focus, escape and outside dismissal, native dialog cancellation, and reflow at 320, 390, 768, 1024, and 1440 pixels. Screenshots cannot establish complete screen-reader support or WCAG conformance.
- Connected accounts and replies in this audit used synthetic responses. No real provider account was connected or changed.
- OAuth credentials, platform approval, and a hosted scheduler are still required for real scheduled delivery.

## Follow-up fixes — 24 October 2026

- The mobile Back action did not reliably return keyboard focus to the selected conversation. Focus now moves after React removes the mobile detail state, when the row is visible. The full mobile inbox workflow passes.
- Copy actions depended entirely on the Clipboard API and could fail silently in restricted browser contexts. They now fall back to a temporary selection field and show an error when neither copy method is available.
- Start Page now accepts one HTTPS social link per line and displays those links on its preview. Share URLs carry a validated title, introduction, and social links, then render as a standalone responsive page without local storage. Localhost previews explain that the link is device-only; hosted links can be shared.
- The Ideas board now matches the reference's Tags filter placement. Ideas can be tagged from their editor, and tags persist and filter both board and gallery content.
- Verification: 8 product-improvement workflows, 7 copy and Start Page checks, 6 Ideas checks, and 190 route/viewport checks passed. `qa/verify-interactions.mjs` was also attempted but targets pre-refactor `.sidebar` markup and is excluded from current regression coverage.
