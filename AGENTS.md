# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

User feedback: the goal is a faithful recreation of the entire authenticated Buffer publishing app, including its routes and menus, not just Home. Every visible menu and primary action must produce a usable local flow. Verify menu opening, dismissal, composition, media selection, preview, template saving, queue/draft persistence, and mobile controls before handing back. Never describe toast-only placeholder actions as fully implemented.

User renamed the app Postly. Keep Postly as the product name in its interface and local documentation; the Buffer brand is reference material only.

## Product quality priorities

- Keep the Postly design language while improving the complete workspace, not only Home. A saved post, idea, template, count, and calendar event should reflect the same local data across routes and after refresh.
- Make visible controls usable with mouse, keyboard, and touch; show accurate empty, saved, and connected states instead of implying an external service is active.
- When making product changes, run the relevant browser workflow and responsive checks, then update the QA notes with what was verified and what still depends on provider credentials or a hosted service.
