const express = require('express');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const GMA = 'https://www.gmanetwork.com';
const DATA = path.join(__dirname, 'data');
const UP = path.join(__dirname, 'uploads');
const ARTICLES = path.join(DATA, 'articles.json');
fs.mkdirSync(DATA, {recursive:true}); fs.mkdirSync(UP,{recursive:true});
if(!fs.existsSync(ARTICLES)) fs.writeFileSync(ARTICLES,'[]');

const parser = new Parser({timeout:20000, customFields:{item:[['media:content','mediaContent',{keepArray:true}],['media:thumbnail','mediaThumbnail',{keepArray:true}],['enclosure','enclosure']]}});
const upload = multer({dest:UP,limits:{fileSize:100*1024*1024}});
app.use(express.json({limit:'2mb'})); app.use(express.urlencoded({extended:true}));
app.use('/uploads',express.static(UP)); app.use(express.static(__dirname));

const PAGES={
 home:'/news/', nation:'/news/topstories/nation/', metro:'/news/topstories/metro/', world:'/news/topstories/world/',
 showbiz:'/news/showbiz/', sports:'/news/sports/', business:'/news/money/', lifestyle:'/news/lifestyle/',
 videos:'/news/video/', photos:'/news/photo/'
};
const FEEDS=[
 'https://data.gmanews.tv/gno/rss/news/feed.xml',
 'https://www.gmanetwork.com/news/breaking/rss'
];
const cache={items:[],updatedAt:null};
const metaCache=new Map(); const META_TTL=6*60*60*1000;
let refreshPromise=null;

const abs=u=>{if(!u)return null;try{return new URL(String(u).trim(),GMA).href}catch{return null}};
const text=s=>cheerio.load(`<div>${s||''}</div>`).text().replace(/\s+/g,' ').trim();
function firstUrl(v){
 if(!v)return null; if(typeof v==='string')return abs(v); if(Array.isArray(v)){for(const x of v){const u=firstUrl(x);if(u)return u}return null}
 if(v.url)return abs(v.url); if(v.href)return abs(v.href); if(v.$?.url)return abs(v.$.url); if(v['@id'])return abs(v['@id']); return null;
}
function cat(link,f='News'){
 const l=(link||'').toLowerCase();
 if(l.includes('/topstories/nation/'))return 'Nation'; if(l.includes('/topstories/metro/'))return 'Metro'; if(l.includes('/topstories/world/'))return 'World';
 if(l.includes('/showbiz/'))return 'Showbiz'; if(l.includes('/sports/'))return 'Sports'; if(l.includes('/money/'))return 'Business'; if(l.includes('/lifestyle/'))return 'Lifestyle';
 if(l.includes('/video/'))return 'Videos'; if(l.includes('/photo/'))return 'Photos'; return f;
}
function feedImage(i){
 const vals=[i.mediaContent,i.mediaThumbnail,i.enclosure,i.thumbnail,i.media];
 for(const v of vals){const u=firstUrl(v);if(u)return u}
 const html=i['content:encoded']||i.content||i.description||''; const $=cheerio.load(`<div>${html}</div>`);
 for(const img of $('img').toArray()) for(const a of ['data-src','data-original','src']){const u=abs($(img).attr(a));if(u)return u}
 return null;
}
function isVideo(i){return /\/news\/video\//i.test(i.link||'') || String(i.enclosure?.type||'').startsWith('video/')}

function jsonLdImage($){
 let found=null;
 $('script[type="application/ld+json"]').each((_,el)=>{
  if(found)return; try{
   const raw=$(el).contents().text().trim(); if(!raw)return; const data=JSON.parse(raw); const nodes=[];
   const walk=x=>{if(!x||found)return; if(Array.isArray(x)){x.forEach(walk);return} if(typeof x==='object'){nodes.push(x); if(x['@graph'])walk(x['@graph'])}}; walk(data);
   for(const n of nodes){const u=firstUrl(n.image);if(u){found=u;break}}
  }catch{}
 }); return found;
}
async function pageMeta(url){
 const old=metaCache.get(url); if(old&&Date.now()-old.at<META_TTL)return old.data;
 try{
  const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; NewsPortal/4.0)','Accept':'text/html,application/xhtml+xml'}});
  if(!r.ok) return {};
  const html=await r.text(); const $=cheerio.load(html);
  let image=null;
  for(const sel of ['meta[property="og:image"]','meta[property="og:image:url"]','meta[name="twitter:image"]','meta[itemprop="image"]']){image=abs($(sel).first().attr('content'));if(image)break}
  image=image||jsonLdImage($);
  if(!image){
   const selectors=['article img','main img','.article-body img','.story-image img','.article-image img','img[src*="gmanetwork"]'];
   for(const sel of selectors){const el=$(sel).first(); image=abs(el.attr('data-src'))||abs(el.attr('data-original'))||abs(el.attr('src')); if(image)break}
  }
  const video=abs($('meta[property="og:video:secure_url"]').attr('content'))||abs($('meta[property="og:video:url"]').attr('content'))||abs($('meta[property="og:video"]').attr('content'))||null;
  const title=text($('meta[property="og:title"]').attr('content')||$('title').text());
  const description=text($('meta[property="og:description"]').attr('content')||$('meta[name="description"]').attr('content')||'');
  let bodyText='';
  for(const sel of ['article .article-body p','article .story-body p','article p','.article-body p','main article p']){const ps=$(sel).toArray().map(el=>text($(el).text())).filter(t=>t.length>=35);if(ps.length){bodyText=ps.slice(0,4).join(' ');break}}
  const data={image,video,title,description,bodyText,canonical:abs($('link[rel="canonical"]').attr('href'))||url}; metaCache.set(url,{at:Date.now(),data}); return data;
 }catch{return {}}
}

function normalize(i){const link=abs(i.link); return {id:link||`${i.title}-${i.pubDate}`,title:text(i.title||'Untitled'),link,pubDate:i.isoDate||i.pubDate||new Date().toISOString(),summary:text(i.contentSnippet||i.summary||'').slice(0,260),image:feedImage(i),category:cat(link),source:'GMA News Online',isVideo:isVideo(i),video:isVideo(i)?firstUrl(i.enclosure):null,imageVerified:false}}
function twoSentences(value=''){const s=text(value).replace(/\s+/g,' ').trim();if(!s)return '';const parts=s.match(/[^.!?]+[.!?](?:['”’\"])?/g)||[s];return parts.slice(0,2).join(' ').trim().slice(0,420)}

async function parseFeed(url){try{const f=await parser.parseURL(url);return f.items.map(normalize)}catch(e){return[]}}

function listingCandidates($, kind){
 const out=[]; const seen=new Set();
 $('a[href]').each((_,a)=>{
  const href=abs($(a).attr('href')); if(!href||!href.startsWith(GMA+'/news/'))return;
  const l=href.toLowerCase();
  const ok=kind==='videos'?l.includes('/news/video/'):kind==='photos'?l.includes('/news/photo/'):(/\/story\//i.test(l)||/\/video\//i.test(l));
  if(!ok||seen.has(href))return;
  const title=text($(a).find('h1,h2,h3,h4,h5').first().text()||$(a).attr('title')||$(a).text()); if(title.length<18||title.length>300)return;
  let root=$(a).closest('article,li').first(); if(!root.length) root=$(a).parent().parent();
  let image=null; const img=root.find('img').first(); image=abs(img.attr('data-src'))||abs(img.attr('data-original'))||abs(img.attr('src'));
  seen.add(href); out.push({id:href,title,link:href,pubDate:new Date().toISOString(),summary:'',image,category:kind==='videos'?'Videos':kind==='photos'?'Photos':cat(href),source:'GMA News Online',isVideo:kind==='videos'||/\/video\//.test(l),video:null,imageVerified:false});
 }); return out;
}

async function scrapePage(kind){
 try{
  const r=await fetch(GMA+PAGES[kind],{headers:{'User-Agent':'Mozilla/5.0 (compatible; NewsPortal/4.0)','Accept':'text/html'}}); if(!r.ok)return[];
  const $=cheerio.load(await r.text()); return listingCandidates($,kind).slice(0,50);
 }catch{return[]}
}

async function enrich(items,limit=120){
 const targets=items.filter(x=>x.link).slice(0,limit); let n=0;
 const workers=Array.from({length:8},async()=>{while(true){const i=n++;if(i>=targets.length)return;const x=targets[i];const m=await pageMeta(x.link);if(m.image){x.image=m.image;x.imageVerified=true} if(m.video)x.video=m.video; if(m.title&&x.title.length<10)x.title=m.title;}});
 await Promise.all(workers); return items;
}

async function refresh(){
 if(refreshPromise)return refreshPromise;
 refreshPromise=(async()=>{
  try{
   let all=[]; for(const f of FEEDS)all.push(...await parseFeed(f));
   // The category pages are the authoritative fallback when RSS is unavailable or incomplete.
   const keys=['home','nation','metro','world','showbiz','sports','business','lifestyle','videos'];
   const pages=await Promise.all(keys.map(k=>scrapePage(k)));
   pages.forEach(p=>all.push(...p));
   const map=new Map(); for(const x of all){if(x.link&&!map.has(x.link))map.set(x.link,x)}
   let items=[...map.values()]; items=await enrich(items.sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate)),160);
   // Listing-page timestamps are fetch time; preserve RSS dates where available. Sort verified/current content first by date.
   items.sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate));
   if(items.length){cache.items=items.slice(0,220);cache.updatedAt=new Date().toISOString()}
   console.log(`Refresh complete: ${cache.items.length} items; ${cache.items.filter(x=>x.imageVerified).length} exact images`);
  }catch(e){console.error('Refresh failed',e.message)} finally{refreshPromise=null}
 })(); return refreshPromise;
}

function rulesFor(k){return {nation:'/topstories/nation/',metro:'/topstories/metro/',world:'/topstories/world/',showbiz:'/showbiz/',sports:'/sports/',business:'/money/',lifestyle:'/lifestyle/',videos:'/video/',photos:'/photo/'}[k]}
async function getCategory(k){
 if(k==='home')return cache.items;
 const rule=rulesFor(k); let found=cache.items.filter(x=>rule&&x.link?.includes(rule));
 if(found.length<6){const extra=await scrapePage(k); found=await enrich(extra,50);}
 return found.slice(0,80);
}

app.get('/api/news',async(req,res)=>{const k=String(req.query.category||'home').toLowerCase(); if(!cache.items.length)await refresh(); const items=await getCategory(k);res.json({items,updatedAt:cache.updatedAt,category:k});});
app.get('/api/articles',(req,res)=>{let a=[];try{a=JSON.parse(fs.readFileSync(ARTICLES,'utf8'))}catch{} res.json({items:a.sort((x,y)=>new Date(y.pubDate)-new Date(x.pubDate))})});
app.get('/health',(req,res)=>res.json({ok:true,updatedAt:cache.updatedAt,items:cache.items.length,images:cache.items.filter(x=>x.imageVerified).length}));
app.post('/api/articles',upload.fields([{name:'image',maxCount:1},{name:'video',maxCount:1}]),(req,res)=>{const {title,summary='',body='',category='News',author='Portal Desk',link=''}=req.body;if(!title)return res.status(400).json({error:'title is required'});const f=req.files||{};const item={id:Date.now().toString(),title,summary,body,category,author,link:link||'#',pubDate:new Date().toISOString(),source:'Portal Report',image:f.image?.[0]?'/uploads/'+path.basename(f.image[0].path):req.body.image||null,video:f.video?.[0]?'/uploads/'+path.basename(f.video[0].path):req.body.video||null,isVideo:!!(f.video?.[0]||req.body.video),imageVerified:true};let a=[];try{a=JSON.parse(fs.readFileSync(ARTICLES,'utf8'))}catch{} a.push(item);fs.writeFileSync(ARTICLES,JSON.stringify(a,null,2));res.json({ok:true,item})});
app.listen(PORT,'0.0.0.0',()=>console.log(`GMA NEWS ONLINE PORTAL listening on ${PORT}`));
refresh(); setInterval(refresh,5*60*1000);
