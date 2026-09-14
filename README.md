# GMA NEWS ONLINE PORTAL — Updated Build

Responsive mobile-first news portal using original portal branding and linking to GMA News Online as the source for syndicated headlines.

## Updated media/navigation behavior
- Burger menu opens a mobile navigation drawer.
- HOME, NATION, METRO, WORLD, SHOWBIZ, SPORTS, BUSINESS, LIFESTYLE and VIDEOS are clickable.
- Category clicks load matching GMA News Online source items through `/api/news?category=...`.
- Image handling supports RSS enclosure/media thumbnail/media content plus Open Graph fallback from the original GMA article page.
- Video cards only appear for items detected as video; ordinary articles are no longer presented as videos.
- Uploaded portal videos can be served from `/uploads` and used by the portal's publishing endpoint.
- Broken remote images use a local fallback graphic.

## Run
npm install
npm start

## Deploy
Use Render as a Node Web Service:
Build: `npm install`
Start: `npm start`

## Source/rights note
This portal should link to the original GMA News Online pages and use only media/feed fields permitted for reuse. GMA News Online's own policies govern use of its articles, photos, audiovisual material and branding.
