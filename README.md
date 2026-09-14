# GMA NEWS ONLINE PORTAL — build package

This package implements the mobile-first news-portal layout shown in the design reference, with:
- responsive homepage and navigation
- Just In ticker
- hero story
- top-story cards
- featured videos area
- Portal Reports for your own articles
- server-side RSS discovery/polling
- image/video upload endpoint for your own submissions

## Run locally

1. Install Node.js 20+.
2. Run:
   npm install
   npm start
3. Open http://localhost:3000

The server polls the public GMA News Online RSS index every 5 minutes and uses publicly exposed RSS feed data. GMA publishes an RSS feed index at:
https://www.gmanetwork.com/news/rss/

The implementation intentionally links sourced stories back to their original publisher rather than republishing full copyrighted articles. Whether particular images/videos may be reused or embedded depends on the rights/terms attached to that material.

## Add your own article

POST multipart/form-data to `/api/articles`:

- title (required)
- summary
- body
- category
- author
- link
- image (file) OR image (URL you have permission to use)
- video (file) OR video (URL you have permission to use)

Example curl:

curl -X POST http://localhost:3000/api/articles \
  -F "title=My Daily Report" \
  -F "summary=Short news brief" \
  -F "category=Nation" \
  -F "author=Portal Desk" \
  -F "image=@photo.jpg"

For production, protect the POST endpoint with authentication before exposing it publicly.

## Deployment

Deploy this Node/Express project to a host that supports persistent Node processes. A static-only host cannot perform the server-side RSS polling or accept uploads.

## Branding

The package uses an original portal wordmark and visual system inspired by fast Philippine mobile-news layouts. It does not include GMA Network's proprietary logo artwork.
