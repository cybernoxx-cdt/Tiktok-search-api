# TikTok Search API (Vercel)

Self-hosted TikTok keyword video search — scrapes TikTok's public search
page and extracts the embedded `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON.
No login, no signing (X-Bogus / msToken) required.

## Endpoint

```
GET /api/tiktok/search?text=<query>&limit=10&apitoken=<optional>
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "title": "Video description",
      "author": "username",
      "duration": "34s",
      "link": "https://www.tiktok.com/@username/video/123...",
      "nowm": "https://... (direct video URL)"
    }
  ]
}
```

This shape plugs directly into SHAVIYA-XMD's `tt-search.js`
(`.tiktoksearch` / `.ts`) plugin — just swap the API base URL there.

## Deploy

```bash
npm install -g vercel
vercel login
vercel --prod
```

Vercel auto-detects the `api/` folder as serverless functions. No extra
config needed beyond what's in `vercel.json` (raises the function
timeout/memory since Chromium needs both).

## Optional: protect with a token

Set an environment variable in the Vercel dashboard:

```
API_TOKEN=your-secret-here
```

Then requests must include `?apitoken=your-secret-here` or they get a
401.

## Notes

- TikTok's internal JSON structure (`__DEFAULT_SCOPE__` path) changes
  periodically — if results stop coming back, check
  `api/tiktok/search.js` and update the `scopes["webapp.search-detail"]`
  lookup to match the new structure.
- Vercel's default serverless function memory/timeout limits are tight
  for a full Chromium launch — the `vercel.json` here already requests
  1024MB / 60s, which needs a **Pro plan** on Vercel (Hobby plan caps at
  10s duration and 1024MB, which may not be enough headroom in
  practice — test on your account's tier).
