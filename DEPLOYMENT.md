# Postly hosted publishing

This deployment is for one owner's private Postly instance. It runs the existing Node API and scheduled-delivery worker as one always-on process, stores encrypted accounts, scheduled jobs, and temporary media on a persistent Docker volume, terminates HTTPS with Caddy, and protects the app/API with a password. The temporary-media endpoint is the only unauthenticated route so Instagram and TikTok can fetch files needed for publishing.

For local browser data, use **Settings → General → Local data backup** to download or restore posts, drafts, ideas, templates, preferences, and uploaded media. Restoring replaces the Postly data stored in that browser. Social account tokens and server-side scheduler data are not included in the browser backup.

The Sites worker in this repository serves the frontend only. It does not run the Node API or persistent scheduler, so use this Docker deployment for real publishing.

## Recommended hosted option: Render

The repository includes a Render Blueprint in `render.yaml`. It deploys the Docker app as one always-on web service in Singapore, assigns a public HTTPS URL, attaches a 10 GB persistent disk for accounts/jobs/media, and configures app-level Basic Auth. The provider media route remains public so social networks can retrieve uploaded files. The health route is also public for Render's deployment checks and returns only an `ok` status.

The Blueprint uses Render's Standard compute plan because Postly buffers video uploads while processing them. Current listed pricing is about $25/month for the service plus $2.50/month for the 10 GB disk; provider usage and any custom domain are separate. Do not choose a Free instance: it sleeps while idle and does not support persistent disks, which would stop scheduled publishing and risk account/job data. Check current [Render pricing](https://render.com/pricing) before creating the service.

To deploy, connect a private GitHub repository containing this project to Render and create a Blueprint from its `render.yaml`. During setup, enter the Postly Basic Auth username/password and any social provider credentials directly in Render's environment-variable form. Render generates and stores the encryption key. Do not put secret values in this file, commit them, or send them in chat. The Blueprint derives the OAuth and media origins from Render's assigned HTTPS URL.

After the first deployment, copy the three callback URLs shown in Postly's channel settings into each provider app. A custom domain can be added later in Render and the same URL references update with it. TikTok photo publishing requires a domain that you control and can verify; video publishing can be tested on the Render hostname while provider apps remain in development mode.

This project currently has no Git remote. Keep the repository private when connecting it to Render so the full app source is not made public. A local working copy or repository must contain `render.yaml`, `Dockerfile`, `package-lock.json`, `server/`, `src/`, `public/`, and `scripts/` for the build to succeed.

## Requirements

- A Linux host with Docker Engine and Docker Compose.
- A domain you control, with an A record for POSTLY_DOMAIN pointing to the host's public IPv4 address.
- Inbound TCP ports 80 and 443 open so Caddy can obtain and renew an HTTPS certificate.
- Developer apps and credentials for the social platforms you want to connect.

Run one Postly replica. OAuth state is held in that process and accounts/jobs use its persistent filesystem volume. Do not enable scale-to-zero or run multiple Postly replicas with this file-backed store.

For the managed Render setup above, use the Blueprint instead of these Linux host, DNS, and Caddy steps. Render provides TLS and the app enforces Basic Auth itself; the Compose deployment continues to use Caddy as its external password gate.

## Configure production secrets

On the host, copy .env.production.example to .env.production, then fill in the domain and credentials. Generate values on the host:

    openssl rand -hex 32
    docker run --rm caddy:2-alpine caddy hash-password --plaintext 'choose-a-long-unique-password'

Put the first result in TOKEN_ENCRYPTION_KEY; keep it stable because it encrypts connected account tokens. Put the second in POSTLY_BASIC_AUTH_HASH, keeping it single-quoted in .env.production. Set restrictive file permissions:

    chmod 600 .env.production

Do not commit .env.production or send its values in chat. The Compose file sets these production origins automatically:

- APP_BASE_URL=https://<POSTLY_DOMAIN>
- OAUTH_REDIRECT_BASE=https://<POSTLY_DOMAIN>
- PUBLIC_MEDIA_BASE_URL=https://<POSTLY_DOMAIN>

## Register OAuth callbacks

Register these exact callback URLs in each provider developer app, replacing the hostname:

- https://<POSTLY_DOMAIN>/api/social/instagram/callback
- https://<POSTLY_DOMAIN>/api/social/tiktok/callback
- https://<POSTLY_DOMAIN>/api/social/youtube/callback

Add each provider's client ID and secret to .env.production. The Postly server stores exchanged tokens encrypted in its persistent data volume. TikTok also requires the media domain to be verified for photo posts; provider review and audit rules still apply.

## Start Postly

From the project directory on the host:

    docker compose --env-file .env.production up -d --build

Caddy routes normal app/API traffic through password authentication and leaves /api/social/media/<random-id> available for provider downloads. Caddy manages the HTTPS certificate for POSTLY_DOMAIN. After startup, visit https://<POSTLY_DOMAIN>, sign in with the Basic Auth username/password, and use Connect a channel for each provider.

The scheduled worker runs in the same always-on Postly process. Keep and back up the named postly_data volume. docker compose down preserves it; docker compose down -v deletes it. Do not make the app publicly reachable without the Caddy password gate.

## Local validation snapshot

On 2026-10-24, `npm run build`, `npm run test:deployment-auth`, `npm run test:publishing` (21 simulated provider checks), and `npm run test:scheduler` (13 scheduler checks plus 3 API checks) passed. The Render Blueprint and Compose YAML parse locally. This does not confirm a live Render deploy or real social publishing; those require a signed-in Render account, a private source repository, provider credentials, and provider app setup. Docker is not installed in the local environment, so the container image has not been built locally.

## Scope

This is a protected single-owner deployment. Supporting multiple Postly users or multiple server replicas needs user-isolated account records, shared OAuth state, and a database-backed job queue. Provider review requirements, quotas, and posting rules cannot be removed by Postly's plan settings.
