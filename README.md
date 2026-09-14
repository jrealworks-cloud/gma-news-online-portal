# GMA NEWS ONLINE PORTAL — V4

Independent portal that links to GMA News Online stories and uses publicly exposed article media metadata where available.

## Deploy
- Build: `npm install`
- Start: `npm start`
- Node: 20+

The server uses GMA RSS where available and falls back to GMA section pages so the homepage does not remain empty when a feed endpoint changes. It then resolves each story's exact article page metadata (`og:image`, Twitter image, JSON-LD, article image) and associates it with that story.

## Important
Do not replace `data/articles.json` if it contains your own portal submissions. Do not present the site as the official GMA News Online website or rehost copyrighted GMA articles/media without permission. The portal links to original GMA pages.
