const express=require('express');
const Parser=require('rss-parser');
const cheerio=require('cheerio');
const fs=require('fs');
const path=require('path');
const multer=require('multer');

const app=express();
const PORT=process.env.PORT||3000;
const parser=new Parser({timeout:15000,customFields:{item:[['media:content','media'],['media:thumbnail','thumbnail'],['enclosure','enclosure']]}});
const DATA=path.join(__dirname,'data'); const UP=path.join(__dirname,'uploads');
fs.mkdirSync(DATA,{recursive:true}); fs.mkdirSync(UP,{recursive:true});
const ARTICLES=path.join(DATA,'articles.json');
if(!fs.existsSync(ARTICLES)) fs.writeFileSync(ARTICLES,'[]');
const upload=multer({dest:UP});
app.use(express.json({limit:'2mb'})); app.use(express.urlencoded({extended:true})); app.use(express.static(__dirname));

let cache={items:[],updatedAt:null};
function readArticles(){try{return JSON.parse(fs.readFileSync(ARTICLES))}catch{return[]}}
function writeArticles(x){fs.writeFileSync(ARTICLES,JSON.stringify(x,null,2))}
function imageOf(i){
  return i.enclosure?.url || i.thumbnail?.url || i.media?.url || null;
}
function categoryFrom(link=''){
  const m=link.match(/\/news\/([^/]+)/); return m?m[1].replace(/[-_]/g,' '):'News';
}
async function discoverFeeds(){
  const html=await (await fetch('https://www.gmanetwork.com/news/rss/')).text();
  const $=cheerio.load(html); const urls=new Set();
  $('a[href]').each((_,a)=>{let h=$(a).attr('href'); if(!h)return; if(h.includes('/rss')){if(h.startsWith('/'))h='https://www.gmanetwork.com'+h; if(h.startsWith('http'))urls.add(h)}});
  // Public RSS index sometimes renders section links without direct feed URLs.
  urls.add('https://www.gmanetwork.com/news/breaking/rss');
  return [...urls].slice(0,40);
}
async function refresh(){
  try{
    const feeds=await discoverFeeds(); const all=[];
    for(const url of feeds){
      try{const f=await parser.parseURL(url); for(const i of f.items.slice(0,25)){
        all.push({title:i.title||'Untitled',link:i.link,pubDate:i.isoDate||i.pubDate||new Date().toISOString(),
          summary:(i.contentSnippet||i.content||'').replace(/<[^>]+>/g,'').slice(0,260),
          image:imageOf(i),category:categoryFrom(i.link),source:'GMA News Online',
          video:(i.enclosure?.type||'').startsWith('video/')?i.enclosure.url:null});
      }}catch(e){}
    }
    const seen=new Set(); cache.items=all.filter(x=>x.link&&!seen.has(x.link)&&seen.add(x.link))
      .sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate)).slice(0,120);
    cache.updatedAt=new Date().toISOString();
    console.log('Feed refresh:',cache.items.length,'items');
  }catch(e){console.error('Refresh failed:',e.message)}
}
app.get('/api/news',(req,res)=>res.json({items:cache.items,updatedAt:cache.updatedAt}));
app.get('/api/articles',(req,res)=>res.json({items:readArticles().sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate))}));
app.post('/api/articles',upload.fields([{name:'image',maxCount:1},{name:'video',maxCount:1}]),(req,res)=>{
  const {title,summary,body,category='News',author='Portal Desk',link=''}=req.body;
  if(!title)return res.status(400).json({error:'title is required'});
  const files=req.files||{};
  const item={id:Date.now().toString(),title,summary:summary||'',body:body||'',category,author,
    link:link||'#',pubDate:new Date().toISOString(),source:'Portal Report',
    image:files.image?.[0]?'/uploads/'+path.basename(files.image[0].path):req.body.image||null,
    video:files.video?.[0]?'/uploads/'+path.basename(files.video[0].path):req.body.video||null};
  const items=readArticles(); items.push(item); writeArticles(items); res.json({ok:true,item});
});
app.get('/health',(req,res)=>res.json({ok:true,updatedAt:cache.updatedAt}));
app.listen(PORT,()=>console.log(`GMA NEWS ONLINE PORTAL running on :${PORT}`));
refresh(); setInterval(refresh,5*60*1000);
