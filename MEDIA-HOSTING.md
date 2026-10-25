# Temporary public media hosting

Instagram image/video posts and TikTok photo posts need a media URL their servers can fetch. Postly writes temporary copies to a private filesystem directory and serves them from `/api/social/media/<uuid>`. Missing or invalid public-host configuration returns a clear publishing error; it never falls back to localhost.

## Required deployment settings

Set these in the Postly server environment (or `.env.local` for a local single-user installation):

```dotenv
APP_BASE_URL=https://postly.your-domain.com
POSTLY_DATA_DIR=/var/lib/postly/data
PUBLIC_MEDIA_BASE_URL=https://media.your-domain.com
PUBLIC_MEDIA_STORAGE_DIR=/var/lib/postly/media
```

Replace `your-domain.com` with domains you control. `PUBLIC_MEDIA_BASE_URL` must be a public DNS hostname on HTTPS port 443, with no path, query, fragment, username, or password. The media directory must be an absolute, private, writable path outside the static client/web root. If `PUBLIC_MEDIA_STORAGE_DIR` is omitted, Postly uses `<POSTLY_DATA_DIR>/media` (or `.postly-data/media` when `POSTLY_DATA_DIR` is omitted).

Keep the configured media directory persistent for at least 24 hours and shared by every Postly server instance that may handle the publishing request or media fetch. The current storage backend is a local filesystem directory; it does not write to S3 or another object store. Use a shared mounted filesystem for a multi-instance deployment.

## Public HTTPS route

Create a public DNS record for the media hostname and install a valid TLS certificate. In the single-owner Docker setup, [DEPLOYMENT.md](DEPLOYMENT.md) configures Caddy to allow the temporary-media endpoint while password-protecting the rest of Postly. For another deployment, route only the media endpoint to the Postly process, which listens on `127.0.0.1:4174` by default. For example, an Nginx media-only virtual host can use:

```nginx
server {
    listen 443 ssl;
    server_name media.your-domain.com;

    # Configure the certificate and key for media.your-domain.com here.

    location ^~ /api/social/media/ {
        limit_except GET HEAD { deny all; }
        proxy_pass http://127.0.0.1:4174;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        return 404;
    }
}
```

The proxy must preserve `/api/social/media/<uuid>`, return the file bytes directly without a sign-in page or redirect, and allow provider fetchers to make unauthenticated `GET` and `HEAD` requests. Postly returns the stored MIME type and length, supports byte ranges, and sends `X-Content-Type-Options: nosniff`. No listing or upload endpoint is exposed on the media hostname.

Keep OAuth, publish, account, and other API routes private behind the application's authentication or network boundary. The local single-user server does not add multi-user authentication. Do not expose its full API publicly just to make this one media path reachable.

## Limits and retention

- Supported stored types are JPEG, PNG, WebP, MP4, QuickTime, and WebM. Provider adapters apply narrower per-provider/type checks; TikTok photos are limited to 20 MB each.
- One publishing request may store at most 250 MB of media in total. The HTTP request body is capped at 256 MB.
- Each asset receives a random UUID and expires after 24 hours. Expired links return 404. Expired assets are removed when fetched, before a later media upload, and by the server's hourly cleanup.
- Store no long-lived public originals in this directory. These files are temporary provider-fetch copies.
- Verify the media hostname or URL prefix in TikTok for Developers before publishing TikTok photos.

The server validates that the configured base is HTTPS on port 443 and rejects IP literals, localhost/private-style hostnames, reserved test domains, and URL paths or credentials. It cannot prove your DNS record, TLS certificate, firewall, or reverse-proxy route from configuration alone. Check the media host from outside the deployment network and confirm it returns media bytes rather than an app page before enabling provider publishing.

Do not put OAuth credentials or encryption keys in this file, in `.env.example`, or in source control. Secret names and OAuth setup are documented in [SOCIAL-CONNECTIONS.md](SOCIAL-CONNECTIONS.md).
