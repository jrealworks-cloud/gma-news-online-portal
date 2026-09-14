const express = require('express');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const GMA_HOST = 'https://www.gmanetwork.com';
const GMA_RSS_INDEX = `${GMA_HOST}/news/rss/`;
const GMA_PRIMARY_FEED = 'https://data.gmanews.tv/gno/rss/news/feed.xml';

const parser = new Parser({
  timeout: 20000,
  customFields: {
    item: [
      ['media:content', 'mediaContent', {keepArray: true}],
      ['media:thumbnail', 'mediaThumbnail', {keepArray: true}],
      ['media:group', 'mediaGroup'],
      ['enclosure', 'enclosure']
    ]
  }
});

const DATA = path.join(__dirname, 'data');
const UP = path.join(__dirname, 'uploads');
const ARTICLES = path.join(DATA, 'articles.json');
fs.mkdirSync(DATA, {recursive: true});
fs.mkdirSync(UP, {recursive: true});
if (!fs.existsSync(ARTICLES)) fs.writeFileSync(ARTICLES, '[]');

const upload = multer({
  dest: UP,
  limits: {fileSize: 100 * 1024 * 1024}
});

app.use(express.json({limit: '2mb'}));
app.use(express.urlencoded({extended: true}));
app.use('/uploads', express.static(UP));
app.use(express.static(__dirname));

const CATEGORY_PAGES = {
  home: `${GMA_HOST}/news/`,
  nation: `${GMA_HOST}/news/topstories/nation/`,
  metro: `${GMA_HOST}/news/topstories/metro/`,
  world: `${GMA_HOST}/news/topstories/world/`,
  showbiz: `${GMA_HOST}/news/showbiz/`,
  sports: `${GMA_HOST}/news/sports/`,
  business: `${GMA_HOST}/news/money/`,
  lifestyle: `${GMA_HOST}/news/lifestyle/`,
  videos: `${GMA_HOST}/news/video/`,
  photos: `${GMA_HOST}/news/photos/`
};

let cache = {items: [], updatedAt: null, photos: [], videos: []};
const metaCache = new Map();
const META_TTL = 6 * 60 * 60 * 1000;

function readArticles() {
  try { return JSON.parse(fs.readFileSync(ARTICLES, 'utf8')); } catch { return []; }
}
function writeArticles(x) { fs.writeFileSync(ARTICLES, JSON.stringify(x, null, 2)); }
function absolute(u) {
  if (!u) return null;
  try { return new URL(String(u).trim(), GMA_HOST).href; } catch { return null; }
}
function cleanText(s = '') {
  return cheerio.load(`<div>${s}</div>`).text().replace(/\s+/g, ' ').trim();
}
function firstUrl(value) {
  if (!value) return null;
  if (typeof value === 'string') return absolute(value);
  if (Array.isArray(value)) {
    for (const v of value) { const u = firstUrl(v); if (u) return u; }
  }
  if (value.url) return absolute(value.url);
  if (value.href) return absolute(value.href);
  if (value['$']?.url) return absolute(value['$'].url);
  return null;
}
function categoryFrom(link = '', fallback = 'News') {
  const l = link.toLowerCase();
  if (l.includes('/topstories/nation/')) return 'Nation';
  if (l.includes('/topstories/metro/')) return 'Metro';
  if (l.includes('/topstories/world/')) return 'World';
  if (l.includes('/topstories/')) return 'News';
  if (l.includes('/sports/')) return 'Sports';
  if (l.includes('/showbiz/')) return 'Showbiz';
  if (l.includes('/lifestyle/')) return 'Lifestyle';
  if (l.includes('/money/')) return 'Business';
  if (l.includes('/video/')) return 'Videos';
  if (l.includes('/photos/')) return 'Photos';
  return fallback;
}

function mediaUrl(item) {
  const candidates = [];
  const add = (v) => { const u = firstUrl(v); if (u) candidates.push(u); };
  add(item.enclosure);
  add(item.mediaContent);
  add(item.mediaThumbnail);
  add(item.media);
  add(item.thumbnail);
  if (item.mediaGroup) {
    add(item.mediaGroup['media:content']);
    add(item.mediaGroup['media:thumbnail']);
  }
  const html = item['content:encoded'] || item.content || item.description || '';
  const $ = cheerio.load(`<div>${html}</div>`);
  $('img').each((_, img) => {
    add($(img).attr('data-src'));
    add($(img).attr('data-original'));
    add($(img).attr('src'));
  });
  return candidates.find(Boolean) || null;
}

function isVideoItem(item) {
  const link = (item.link || '').toLowerCase();
  const type = (item.enclosure?.type || '').toLowerCase();
  return type.startsWith('video/') || /\/news\/video\//.test(link);
}

function imageFromJsonLd($) {
  let result = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (result) return;
    try {
      const raw = $(el).contents().text();
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const image = node?.image;
        const u = firstUrl(image);
        if (u) { result = u; return; }
        if (node?.['@graph']) {
          for (const g of node['@graph']) {
            const gu = firstUrl(g?.image);
            if (gu) { result = gu; return; }
          }
        }
      }
    } catch {}
  });
  return result;
}

async function pageMeta(url) {
  const now = Date.now();
  const cached = metaCache.get(url);
  if (cached && now - cached.at < META_TTL) return cached.data;
  try {
    const r = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NewsPortal/3.0)',
        'accept': 'text/html,application/xhtml+xml'
      }
    });
    if (!r.ok) return {};
    const html = await r.text();
    const $ = cheerio.load(html);
    const meta = {
      image: firstUrl(
        $('meta[property="og:image"]').attr('content') ||
        $('meta[property="og:image:url"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content')
      ) || imageFromJsonLd($),
      video: firstUrl(
        $('meta[property="og:video:secure_url"]').attr('content') ||
        $('meta[property="og:video:url"]').attr('content') ||
        $('meta[property="og:video"]').attr('content')
      ),
      canonical: firstUrl($('link[rel="canonical"]').attr('href')) || url
    };
    if (!meta.image) {
      const articleImg = $('article img, .article-body img, .story-image img, .article-image img').first();
      meta.image = firstUrl(articleImg.attr('data-src')) || firstUrl(articleImg.attr('src')) || null;
    }
    metaCache.set(url, {at: now, data: meta});
    return meta;
  } catch {
    return {};
  }
}

function normalizeItem(item, source = 'GMA News Online') {
  const link = absolute(item.link);
  return {
    id: link || `${item.title}-${item.pubDate}`,
    title: cleanText(item.title || 'Untitled'),
    link,
    pubDate: item.isoDate || item.pubDate || new Date().toISOString(),
    summary: cleanText(item.contentSnippet || item.summary || item.content || '').slice(0, 300),
    image: mediaUrl(item),
    category: categoryFrom(link, 'News'),
    source,
    video: isVideoItem(item) ? firstUrl(item.enclosure) : null,
    isVideo: isVideoItem(item),
    imageVerified: false
  };
}

async function discoverFeeds() {
  const urls = new Set([
    GMA_PRIMARY_FEED,
    `${GMA_HOST}/news/breaking/rss`
  ]);
  try {
    const r = await fetch(GMA_RSS_INDEX, {headers: {'user-agent': 'Mozilla/5.0'}});
    if (r.ok) {
      const html = await r.text();
      const $ = cheerio.load(html);
      $('a[href]').each((_, a) => {
        const h = $(a).attr('href');
        if (h && /rss|feed\.xml/i.test(h)) {
          const u = absolute(h);
          if (u) urls.add(u);
        }
      });
    }
  } catch {}
  return [...urls];
}

async function enrichImages(items, limit = 100) {
  const targets = items.filter(x => x.link).slice(0, limit);
  let index = 0;
  const workers = Array.from({length: 6}, async () => {
    while (true) {
      const i = index++;
      if (i >= targets.length) return;
      const item = targets[i];
      const meta = await pageMeta(item.link);
      // Prefer the exact image exposed by the article page over an RSS thumbnail.
      if (meta.image) {
        item.image = meta.image;
        item.imageVerified = true;
      }
      if (item.isVideo && meta.video) item.video = meta.video;
    }
  });
  await Promise.all(workers);
  return items;
}

async function refresh() {
  try {
    const feeds = await discoverFeeds();
    const all = [];
    for (const url of feeds) {
      try {
        const f = await parser.parseURL(url);
        for (const item of f.items.slice(0, 60)) all.push(normalizeItem(item));
      } catch (e) {}
    }
    const seen = new Set();
    const unique = all.filter(x => x.link && !seen.has(x.link) && seen.add(x.link));
    unique.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    cache.items = await enrichImages(unique.slice(0, 180), 120);
    cache.videos = cache.items.filter(x => x.isVideo);
    cache.updatedAt = new Date().toISOString();
    console.log(`Feed refresh: ${cache.items.length} items; ${cache.items.filter(x => x.image).length} with images`);
  } catch (e) {
    console.error('Refresh failed:', e.message);
  }
}

async function scrapeCategoryPage(category) {
  const page = CATEGORY_PAGES[category];
  if (!page) return [];
  try {
    const r = await fetch(page, {headers: {'user-agent': 'Mozilla/5.0 (compatible; NewsPortal/3.0)'}});
    if (!r.ok) return [];
    const html = await r.text();
    const $ = cheerio.load(html);
    const out = [];
    const seen = new Set();
    $('a[href*="/news/"]').each((_, a) => {
      const href = absolute($(a).attr('href'));
      if (!href || !href.includes(`${GMA_HOST}/news/`) || seen.has(href)) return;
      const title = cleanText($(a).find('h1,h2,h3,h4').first().text() || $(a).text());
      if (title.length < 18) return;
      const root = $(a).closest('article,li,div').first();
      const image = firstUrl(root.find('img').first().attr('data-src')) || firstUrl(root.find('img').first().attr('src'));
      seen.add(href);
      out.push({id: href, title, link: href, pubDate: new Date().toISOString(), summary: '', image, category: category === 'videos' ? 'Videos' : category === 'photos' ? 'Photos' : categoryFrom(href, category), source: 'GMA News Online', video: null, isVideo: category === 'videos', imageVerified: false});
    });
    return enrichImages(out.slice(0, 40), 40);
  } catch { return []; }
}

async function categoryItems(category) {
  const key = (category || 'home').toLowerCase();
  if (key === 'home') return cache.items;
  const rules = {
    nation: ['/topstories/nation/'], metro: ['/topstories/metro/'], world: ['/topstories/world/'],
    showbiz: ['/showbiz/'], sports: ['/sports/'], business: ['/money/'], lifestyle: ['/lifestyle/'],
    videos: ['/video/'], photos: ['/photos/']
  };
  const fromCache = cache.items.filter(x => (rules[key] || []).some(r => (x.link || '').includes(r)) || (x.category || '').toLowerCase() === key);
  if (fromCache.length >= 6) return fromCache;
  const scraped = await scrapeCategoryPage(key);
  return scraped.length ? scraped : fromCache;
}

app.get('/api/news', async (req, res) => {
  const category = (req.query.category || 'home').toLowerCase();
  const items = await categoryItems(category);
  res.json({items, updatedAt: cache.updatedAt, category});
});
app.get('/api/articles', (req, res) => res.json({items: readArticles().sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))}));
app.get('/health', (req, res) => res.json({ok: true, updatedAt: cache.updatedAt, items: cache.items.length}));

app.post('/api/articles', upload.fields([{name: 'image', maxCount: 1}, {name: 'video', maxCount: 1}]), (req, res) => {
  const {title, summary, body, category = 'News', author = 'Portal Desk', link = ''} = req.body;
  if (!title) return res.status(400).json({error: 'title is required'});
  const files = req.files || {};
  const item = {
    id: Date.now().toString(), title, summary: summary || '', body: body || '', category, author,
    link: link || '#', pubDate: new Date().toISOString(), source: 'Portal Report',
    image: files.image?.[0] ? '/uploads/' + path.basename(files.image[0].path) : req.body.image || null,
    video: files.video?.[0] ? '/uploads/' + path.basename(files.video[0].path) : req.body.video || null,
    isVideo: !!(files.video?.[0] || req.body.video), imageVerified: true
  };
  const items = readArticles(); items.push(item); writeArticles(items); res.json({ok: true, item});
});

app.listen(PORT, '0.0.0.0', () => console.log(`GMA NEWS ONLINE PORTAL running on :${PORT}`));
refresh();
setInterval(refresh, 5 * 60 * 1000);
