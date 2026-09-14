# GMA NEWS ONLINE PORTAL — V3

Responsive independent news portal that displays linked headlines from GMA News Online's public feeds/pages.

## Media matching

V3 uses a two-stage media strategy:
1. Read the GMA RSS item and any media fields it exposes.
2. For each recent GMA story, fetch the original article page and prefer the exact image exposed in its `og:image`, Twitter image, JSON-LD image, or article image metadata.

If a matching image cannot be verified, the card shows **PHOTO NOT AVAILABLE** instead of substituting an unrelated photo.

Video items are detected from GMA video URLs and use the video's page image when available. Clicking a GMA item opens the original GMA page.

## Run

```bash
npm install
npm start
```

Node 20+ recommended.

## Render

Build command: `npm install`
Start command: `npm start`

## Notes

- This portal is independently operated and does not represent the official GMA News Online website.
- GMA News Online is the source for linked headlines and media metadata.
- Do not download/rehost GMA copyrighted media without permission. The site uses the public source URLs/metadata and links users to the original source.
- For production, use persistent database/object storage for Portal Reports instead of local JSON/uploads.
