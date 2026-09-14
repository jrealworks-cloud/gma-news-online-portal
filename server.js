const express=require('express');
const Parser=require('rss-parser');
const cheerio=require('cheerio');
const fs=require('fs');
const path=require('path');
const multer=require('multer');

const app=express();
const PORT=process.env.PORT||3000;
const parser=new Parser({timeout:15000,customFields:{item:[
  ['media:content','media'],['media:thumbnail','thumbnail'],['media:group','mediaGroup'],['enclosure','enclosure']
]}});
const DATA=path.join(__dirname,'data'); const UP=path.join(__dirname,'uploads');
fs.mkdirSync(DATA,{recursive:true}); fs.mkdirSync(UP,{recursive:true});
const ARTICLES=path.join(DATA,'articles.json');
if(!fs.existsSync(ARTICLES)) fs.writeFileSync(ARTICLES,'[]');
const upload=multer({dest:UP,limits:{fileSize:100*1024*1024}});
app.use(express.json({limit:'2mb'})); app.use(express.urlencoded({extended:true})); app.use('/uploads',express.static(UP)); app.use(express.static(__dirname));

const CATEGORY_PAGES={
  home:'https://www.gmanetwork.com/news/',
  nation:'https://www.gmanetwork.com/news/topstories/nation/',
  metro:'https://www.gmanetwork.com/news/topstories/metro/',
  world:'https://www.gmanetwork.com/news/topstories/world/',
  showbiz:'https://www.gmanetwork.com/news/showbiz/',
  sports:'https://www.gmanetwork.com/news/sports/',
  business:'https://www.gmanetwork.com/news/money/',
  lifestyle:'https://www.gmanetwork.com/news/lifestyle/',
  videos:'https://www.gmanetwork.com/news/video/'
};

let cache={items:[],updatedAt:null,byCategory:{}};
function readArticles(){try{return JSON.parse(fs.readFileSync(ARTICLES))}catch{return[]}}
function writeArticles(x){fs.writeFileSync(ARTICLES,JSON.stringify(x,null,2))}
function absolute(u){if(!u)return null; try{return new URL(u,'https://www.gmanetwork.com').href}catch{return null}}
function cleanText(s=''){return cheerio.load(`<div>${s}</div>`).text().replace(/\s+/g,' ').trim()}
function categoryFrom(link='',fallback='News'){
  const m=link.match(/\/news\/([^/]+)(?:\/([^/]+))?/);
  if(!m)return fallback;
  const first=m[1].toLowerCase();
  const map={topstories:'Nation',sports:'Sports',showbiz:'Showbiz',lifestyle:'Lifestyle',money:'Business',world:'World',video:'Videos',photos:'Photos',scitech:'SciTech',pinoyabroad:'Pinoy Abroad'};
  if(first==='topstories' && m[2]) return m[2].replace(/[-_]/g,' ');
  return map[first]||first.replace(/[-_]/g,' ');
}
function mediaUrl(x){
  const candidates=[];
  const add=v=>{if(!v)return; if(typeof v==='string')candidates.push(v); else if(v.url)candidates.push(v.url); else if(v['$']?.url)candidates.push(v['$'].url)};
  add(x.enclosure); add(x.thumbnail); add(x.media);
  if(Array.isArray(x.media)) x.media.forEach(add);
  if(x.mediaGroup){add(x.mediaGroup['media:content']);add(x.mediaGroup['media:thumbnail']);}
  const html=x.content||x['content:encoded']||x.description||'';
  const $=cheerio.load(`<div>${html}</div>`); add($('img').first().attr('src')); add($('img').first().attr('data-src'));
  return candidates.map(absolute).find(Boolean)||null;
}
function isVideoItem(i){
  const link=(i.link||'').toLowerCase(), title=(i.title||'').toLowerCase();
  return (i.enclosure?.type||'').startsWith('video/') || /\/video\//.test(link) || /\bvideo\b/.test(title) && /gmanetwork\.com/.test(link);
}
async function pageMeta(url){
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 news-portal-media-fetcher'}}); if(!r.ok)return {};
    const html=await r.text(); const $=cheerio.load(html);
    return {
      image:absolute($('meta[property="og:image"],meta[name="twitter:image"]').first().attr('content')),
      video:absolute($('meta[property="og:video"],meta[property="og:video:url"]').first().attr('content'))
    };
  }catch{return {}}
}
function normalizeItem(i,source='GMA News Online'){
  return {title:cleanText(i.title||'Untitled'),link:absolute(i.link),pubDate:i.isoDate||i.pubDate||new Date().toISOString(),summary:cleanText(i.contentSnippet||i.content||i.summary||'').slice(0,280),image:mediaUrl(i),category:categoryFrom(i.link,''),source,video:isVideoItem(i)?(i.enclosure?.url||null):null,isVideo:isVideoItem(i)};
}
async function discoverFeeds(){
  const html=await (await fetch('https://www.gmanetwork.com/news/rss/')).text();
  const $=cheerio.load(html); const urls=new Set(['https://www.gmanetwork.com/news/breaking/rss']);
  $('a[href]').each((_,a)=>{let h=$(a).attr('href'); if(!h)return; if(h.includes('/rss')){h=absolute(h);if(h)urls.add(h)}});
  return [...urls].slice(0,50);
}
async function refresh(){
  try{
    const feeds=await discoverFeeds(); const all=[];
    for(const url of feeds){
      try{const f=await parser.parseURL(url); for(const i of f.items.slice(0,40)) all.push(normalizeItem(i));}catch(e){}
    }
    const seen=new Set();
    cache.items=all.filter(x=>x.link&&!seen.has(x.link)&&seen.add(x.link)).sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate)).slice(0,180);
    // Fill missing images from the original GMA article page, limited to recent items to avoid hammering the source.
    for(const item of cache.items.slice(0,60)) if(!item.image && item.link){const m=await pageMeta(item.link); if(m.image)item.image=m.image; if(item.isVideo&&m.video)item.video=m.video;}
    cache.updatedAt=new Date().toISOString();
    console.log('Feed refresh:',cache.items.length,'items');
  }catch(e){console.error('Refresh failed:',e.message)}
}
async function categoryItems(category){
  const key=(category||'home').toLowerCase();
  if(key==='home')return cache.items;
  const fromCache=cache.items.filter(x=>{
    const c=(x.category||'').toLowerCase();
    const l=(x.link||'').toLowerCase();
    const rules={nation:['/topstories/nation/','/news/nation/'],metro:['/topstories/metro/','/news/metro/'],world:['/topstories/world/','/news/world/'],showbiz:['/showbiz/'],sports:['/sports/'],business:['/money/'],lifestyle:['/lifestyle/'],videos:['/video/']};
    return (rules[key]||[]).some(r=>l.includes(r)) || c===key;
  });
  if(fromCache.length>=6)return fromCache;
  const page=CATEGORY_PAGES[key]; if(!page)return fromCache;
  try{
    const r=await fetch(page,{headers:{'user-agent':'Mozilla/5.0 news-portal-category-fetcher'}}); if(!r.ok)return fromCache;
    const html=await r.text(); const $=cheerio.load(html); const out=[]; const seen=new Set();
    $('a[href*="/news/"]').each((_,a)=>{
      const href=absolute($(a).attr('href')); if(!href||seen.has(href)||!href.includes('gmanetwork.com/news/'))return;
      const title=cleanText($(a).find('h1,h2,h3,h4').first().text()||$(a).text());
      if(title.length<18 || /view more|see more|home|news|about us/i.test(title))return;
      const root=$(a).closest('article,li,div').first();
      const img=absolute(root.find('img').first().attr('src')||root.find('img').first().attr('data-src'));
      seen.add(href); out.push({title,link:href,pubDate:new Date().toISOString(),summary:'',image:img,category:key==='videos'?'Videos':categoryFrom(href,key),source:'GMA News Online',video:null,isVideo:key==='videos'});
    });
    const result=out.slice(0,30); for(const item of result)if(!item.image){const m=await pageMeta(item.link);item.image=m.image||null;if(item.isVideo)item.video=m.video||null;}
    return result.length?result:fromCache;
  }catch{return fromCache}
}
app.get('/api/news',async(req,res)=>{const category=(req.query.category||'home').toLowerCase(); const items=await categoryItems(category); res.json({items,updatedAt:cache.updatedAt,category})});
app.get('/api/articles',(req,res)=>res.json({items:readArticles().sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate))}));
app.post('/api/articles',upload.fields([{name:'image',maxCount:1},{name:'video',maxCount:1}]),(req,res)=>{
  const {title,summary,body,category='News',author='Portal Desk',link=''}=req.body;
  if(!title)return res.status(400).json({error:'title is required'});
  const files=req.files||{}; const item={id:Date.now().toString(),title,summary:summary||'',body:body||'',category,author,link:link||'#',pubDate:new Date().toISOString(),source:'Portal Report',image:files.image?.[0]?'/uploads/'+path.basename(files.image[0].path):req.body.image||null,video:files.video?.[0]?'/uploads/'+path.basename(files.video[0].path):req.body.video||null,isVideo:!!(files.video?.[0]||req.body.video)};
  const items=readArticles();items.push(item);writeArticles(items);res.json({ok:true,item});
});
app.get('/health',(req,res)=>res.json({ok:true,updatedAt:cache.updatedAt}));
app.listen(PORT,'0.0.0.0',()=>console.log(`GMA NEWS ONLINE PORTAL running on :${PORT}`));
refresh();setInterval(refresh,5*60*1000);
