// ═══════════════════════════════════════════════════════════════
// MUNOWATCH PROXY ENGINE — Master Code (Search Route Fully Fixed)
// ═══════════════════════════════════════════════════════════════

const ALLOWED_SHA256 = "f1c711da128e62bbe61622956cb09b320d0d37970f4cac72cadfd271f8136188";

function normalizeSha(header) {
  if (!header) return "";
  return header.replace(/[:-\s]/g, "").toLowerCase();
}

function getBurnerUid() {
  const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  let uid = String(700000 + (day * 7919) % 299999);
  if (uid === "0") uid = "700001";
  return uid;
}

function getValidUid(uid) {
  if (!uid || uid === "0") return getBurnerUid();
  return uid;
}

const _cdnUrlCache = new Map();
const _globalCdnCache = new Map();
const CDN_CACHE_TTL = 12 * 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    const url  = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (request.method === "GET" && path === "/api/time") return jsonResponse({ ts: Date.now() });

    if (path === "/api/debug-raw") {
      const target = url.searchParams.get("path");
      if (!target) return jsonResponse({ error: "missing ?path=" }, 400);
      const h = {
        "User-Agent": BROWSER_UA, "Accept": "*/*", "Accept-Encoding": "identity",
        "Referer": "https://munowatch.org/", "Origin": "https://munowatch.org",
        "X-Requested-With": "XMLHttpRequest", "Authorization": "Bearer " + APP_API_KEY,
      };
      try {
        const cookie = await munoGetSession();
        h["Cookie"] = cookie;
        const resp = await fetch(`https://munowatch.org${target}`, { headers: h });
        const text = await resp.text();
        return new Response(text, { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    const dlMatch = /^\/api\/dl\/(\d+)\/(\d+)/.exec(path);
    if (request.method === "GET" && dlMatch)
      return handleDownloadRedirect(request, dlMatch[1], dlMatch[2], ctx);

    const sha256Header = request.headers.get("X-APK-SHA256") || "";
    if (normalizeSha(sha256Header) !== normalizeSha(ALLOWED_SHA256)) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", reason: "Invalid APK signature" }),
        { status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    const workerBase = "https://" + url.hostname;
    const fullPath   = path + url.search;

    const previewMatch = /^\/api\/preview\/v2\/(\d+)\/(\d+)/.exec(path);
    if (request.method === "GET" && previewMatch)
      return handlePreviewEnrich(request, previewMatch[1], previewMatch[2], workerBase);

    if (fullPath.startsWith("/munotek.com"))
      return proxyRequest(request, "https://munotek.com"  + fullPath.replace("/munotek.com",""),  "munotek.com",  workerBase);
    if (fullPath.startsWith("/munowatch.com"))
      return proxyRequest(request, "https://munowatch.com"+ fullPath.replace("/munowatch.com",""), "munowatch.com",workerBase);
    if (fullPath.startsWith("/munowatch.org"))
      return proxyRequest(request, "https://munowatch.org"+ fullPath.replace("/munowatch.org",""), "munowatch.org",workerBase);

    return proxyRequest(request, "https://munowatch.org" + fullPath, "munowatch.org", workerBase);
  },
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET,HEAD,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":"*",
  };
}
function jsonResponse(data, status=200) {
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json",...corsHeaders()}});
}

function encodeVideoUrl(rawUrl){
  if(!rawUrl)return rawUrl;
  try{const u=new URL(rawUrl);u.pathname=u.pathname.split("/").map(s=>encodeURIComponent(decodeURIComponent(s))).join("/");return u.toString();}
  catch{return rawUrl.replace(/ /g,"%20");}
}
function isStubUrl(url){
  if(!url||typeof url!=="string")return true;
  if(url.includes("munowatch.co/clips/")||url.includes("munowatch.org/clips/"))return true;
  if(url.trim()==="")return true;
  if(!url.includes("://")&&!url.startsWith("//"))return true;
  return false;
}
function fixPlayingUrls(node,workerBase,uid){
  if(!node||typeof node!=="object")return;
  if(Array.isArray(node)){node.forEach(i=>fixPlayingUrls(i,workerBase,uid));return;}
  for(const f of["playingurl","playingUrl","nxt_playing_url","nextUrl"]){
    if(typeof node[f]!=="string")continue;
    const raw=node[f];
    const vid=node.id||node.vid||node.video_id;
    if(vid){
      node[f]=`${workerBase}/api/dl/${vid}/${uid||0}.mp4`;
    }else if(isStubUrl(raw)){
      // skip
    }else{
      node[f]=encodeVideoUrl(raw);
    }
  }
  Object.values(node).forEach(v=>{if(v&&typeof v==="object")fixPlayingUrls(v,workerBase,uid);});
}

function fixNullArrays(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(i => fixNullArrays(i)); return; }
  for (const key of Object.keys(node)) {
    if (node[key] === null) {
      if (/^(items|dashboard|shows|list|data|videos|results|vjs|categories|episodes|related)/i.test(key)) {
        node[key] = [];
        continue;
      }
    }
    if (node[key] && typeof node[key] === "object") fixNullArrays(node[key]);
  }
}

const APP_API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6IkFuZHJvaWQgVFYiLCJhcHBuYW1lIjoiTXVub3dhdGNoIFRWIiwiaG9zdCI6Im11bm93YXRjaC5jbyIsImFwcHNlY3JldCI6IjAyMjc3OGU0MThhZDY4ZmZkYTlhYTRmYWIxODkyZmZmIiwiYWN0aXZhdGVkIjoiMSIsImV4cCI6MTcwNzM2ODQwMH0.unlPnEzptg6VFHs7WWm213bRHHNxYuAN2eZQvjtPKL0";
const BROWSER_UA="Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const MUNO_COM="https://munowatch.com";
const MUNO_EMAIL="edasaapp2026@gmail.com";
const MUNO_PASS="EdizzaApp@2026";
let _munoSession=null;

async function munoGetSession(){
  if(_munoSession&&Date.now()<_munoSession.expires)return _munoSession.cookie;
  const resp=await fetch(`${MUNO_COM}/login`,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":BROWSER_UA,"Referer":`${MUNO_COM}/login`,"Accept":"text/html,application/xhtml+xml"},
    body:`email=${encodeURIComponent(MUNO_EMAIL)}&password=${encodeURIComponent(MUNO_PASS)}`,
    redirect:"manual"
  });
  const setCookie=resp.headers.get("set-cookie")||"";
  const m=setCookie.match(/PHPSESSID=([^;]+)/);
  if(!m)throw new Error("Login failed — no PHPSESSID");
  const cookie=`PHPSESSID=${m[1]}`;
  _munoSession={cookie,expires:Date.now()+25*60*1000};
  return cookie;
}

function findVideoUrl(obj){
  if(typeof obj==="string"&&(obj.startsWith("http://")||obj.startsWith("https://")||obj.startsWith("//"))&&!isStubUrl(obj)){
    const lo=obj.toLowerCase();
    if(lo.includes(".mp4")||lo.includes(".m3u8"))return obj;
    if(lo.includes("b-cdn.net")&&!lo.includes("apposters")&&!lo.includes(".jpg")&&!lo.includes(".png")&&!lo.includes(".jpeg")&&!lo.includes(".webp"))return obj;
  }
  if(typeof obj==="object"&&obj!==null){for(const v of Object.values(obj)){const found=findVideoUrl(v);if(found)return found;}}
  return null;
}

async function resolveCdnUrl(vid, uid, h, ctx){
  const validUid = getValidUid(uid);
  const key = String(vid);
  
  const mem = _cdnUrlCache.get(key);
  if(mem && Date.now() - mem.ts < CDN_CACHE_TTL) return mem.url;
  
  const cacheHit = _globalCdnCache.get(key);
  if(cacheHit && Date.now() - cacheHit.ts < CDN_CACHE_TTL) {
    _cdnUrlCache.set(key, { url: cacheHit.url, ts: Date.now() });
    return cacheHit.url;
  }

  let url=await fetchDownloadUrl(vid, validUid, h);
  if(!url)url=await fetchViewUrl(vid, validUid, h);
  if(!url)url=await fetchPreviewUrl(vid, validUid, h);
  if(url){
    const record = { url, ts: Date.now() };
    _cdnUrlCache.set(key, record);
    _globalCdnCache.set(key, record);
  }
  return url||null;
}

async function fetchDownloadUrl(vid, uid, headers){
  const validUid = getValidUid(uid);
  try{
    const resp=await fetch("https://munowatch.org/api/download",{method:"POST",headers:{...headers,"Content-Type":"application/x-www-form-urlencoded"},body:`uid=${validUid}&vid=${vid}&state=on`});
    if(!resp.ok)return null;const d=await resp.json();const url=d&&d.playingurl;
    return!url||isStubUrl(url)?null:url;
  }catch{return null;}
}
async function fetchViewUrl(vid, uid, headers){
  const validUid = getValidUid(uid);
  try{
    const resp=await fetch("https://munowatch.org/api/view",{method:"POST",headers:{...headers,"Content-Type":"application/x-www-form-urlencoded"},body:`uid=${validUid}&vid=${vid}`});
    if(!resp.ok)return null;const d=await resp.json();const url=d&&d.nextUrl;
    return!url||isStubUrl(url)?null:url;
  }catch{return null;}
}
async function fetchPreviewUrl(vid, uid, headers){
  const validUid = getValidUid(uid);
  try{
    const resp=await fetch(`https://munowatch.org/api/preview/v2/${vid}/${validUid}`,{headers:{...headers,"Content-Type":"application/json"}});
    if(!resp.ok)return null;
    const d=await resp.json().catch(()=>null);
    return d?findVideoUrl(d):null;
  }catch{return null;}
}

async function handleDownloadRedirect(request, vid, uid, ctx){
  const burner = getBurnerUid();
  const xApiKey=request.headers.get("X-Api-Key")||"";
  const authHeader=request.headers.get("Authorization")||"";
  const userAgent=request.headers.get("User-Agent")||BROWSER_UA;
  const auth=authHeader||(xApiKey?"Bearer "+xApiKey:"")||("Bearer "+APP_API_KEY);
  const h={
    "User-Agent":BROWSER_UA, "Accept":"*/*", "Accept-Encoding":"identity",
    "Referer":"https://munowatch.org/", "Origin":"https://munowatch.org",
    "X-Requested-With":"XMLHttpRequest", "Authorization":auth, "Content-Type":"application/x-www-form-urlencoded"
  };
  let realUrl=await resolveCdnUrl(vid, burner, h, ctx);
  if(!realUrl)return new Response(JSON.stringify({error:"Download URL not found",vid,uid:burner}),{status:404,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
  realUrl=encodeVideoUrl(realUrl);
  let filename="video.mp4";
  try{const s=realUrl.split("/").pop().split("?")[0];if(s)filename=decodeURIComponent(s);}catch{}
  const rangeHeader=request.headers.get("Range");
  const proxyH={"User-Agent":userAgent,"Accept":"*/*"};
  if(rangeHeader)proxyH["Range"]=rangeHeader;
  try{
    const cdnResp=await fetch(realUrl,{headers:proxyH});
    const rh={ "Content-Type":cdnResp.headers.get("Content-Type")||"video/mp4", "Accept-Ranges":"bytes", "Access-Control-Allow-Origin":"*", "Content-Disposition":`attachment; filename="${filename}"` };
    const cl=cdnResp.headers.get("Content-Length"); const cr=cdnResp.headers.get("Content-Range");
    if(cl)rh["Content-Length"]=cl; if(cr)rh["Content-Range"]=cr;
    return new Response(cdnResp.body,{status:cdnResp.status,headers:rh});
  }catch(_){
    return new Response(null,{status:302,headers:{"Location":realUrl,"Content-Disposition":`attachment; filename="${filename}"`,"Access-Control-Allow-Origin":"*"}});
  }
}

async function handlePreviewEnrich(request, vid, uid, workerBase){
  const burner = getBurnerUid();
  const xApiKey=request.headers.get("X-Api-Key")||"";
  const authHeader=request.headers.get("Authorization")||"";
  const auth=authHeader||(xApiKey?"Bearer "+xApiKey:"")||("Bearer "+APP_API_KEY);
  const userAgent2=request.headers.get("User-Agent")||BROWSER_UA;
  const h={"User-Agent":userAgent2,"Accept":"*/*","Accept-Encoding":"identity","Referer":"https://munowatch.org/","Origin":"https://munowatch.org","X-Requested-With":"XMLHttpRequest"};
  if(auth)h["Authorization"]=auth;
  const[previewResp,downloadUrl]=await Promise.all([
    fetch(`https://munowatch.org/api/preview/v2/${vid}/${burner}`,{headers:h}),
    fetchDownloadUrl(vid, burner, h)
  ]);
  let data;
  try{data=await previewResp.json();}catch{data={};}
  if(!data||typeof data!=="object")data={};
  if(!data.preview||typeof data.preview!=="object"||!data.preview.playingUrl)data.preview={};
  let realUrl=downloadUrl?encodeVideoUrl(downloadUrl):null;
  if(!realUrl){const v=await fetchViewUrl(vid, burner, h);if(v)realUrl=encodeVideoUrl(v);}
  if(!realUrl&&data){const found=findVideoUrl(data);if(found&&!isStubUrl(found))realUrl=encodeVideoUrl(found);}
  if(data.preview){
    const p=data.preview;
    p.playingUrl=`${workerBase}/api/dl/${vid}/${burner}.mp4`;
    const nxtVid=p.nxt_eps_id||vid;
    p.nxt_playing_url=`${workerBase}/api/dl/${nxtVid}/${burner}.mp4`;
    if(p.issubscriber===false||p.issubscriber==="false")p.issubscriber=true;
    if(!p.substatus||p.substatus==="")p.substatus="ACTIVE";
    if(p.user_access==="deny"||!p.user_access)p.user_access="allow";
    if(p.mstatus===false||p.mstatus==="false"||p.mstatus===0||!p.mstatus)p.mstatus=true;
    if(p.kstatus!==undefined||!p.kstatus)p.kstatus="ACTIVE";
    if(!p.paid_for)p.paid_for="1";
    if(!p.title)p.title="Movie";
    if(!p.description)p.description="";
    if(!p.vj)p.vj="Original";
    if(!p.image)p.image="";
    if(!p.type)p.type="movie";
    if(!p.vid)p.vid=String(vid);
    if(typeof p.id!=="number")p.id=Number(vid)||0;
    if(typeof p.nxt_eps_id!=="number")p.nxt_eps_id=Number(vid)||0;
    if(typeof p.category_id!=="number")p.category_id=1;
    if(typeof p.vj_id!=="number")p.vj_id=1;
    if(typeof p.ldur!=="number")p.ldur=0;
  }
  return new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Credentials":"true"}});
}

async function proxyRequest(originalRequest, targetUrl, upstreamHost, workerBase) {
  let sessionCookie = "";
  try { sessionCookie = await munoGetSession(); } catch (e) {}

  const burner = getBurnerUid();
  const incomingPath = new URL(originalRequest.url).pathname + new URL(originalRequest.url).search;

  // ── TARGETED ROUTE-SPECIFIC PATH REWRITER ──
  try {
    const parseUrl = new URL(targetUrl);
    let segments = parseUrl.pathname.split("/");

    // 1. Shows Pagination Endpoint: /api/shows/[type]/[id]/[uid]/[page]
    if (parseUrl.pathname.startsWith("/api/shows/") && segments.length >= 7) {
      segments[5] = burner; 
      parseUrl.pathname = segments.join("/");
    } 
    // 2. Search Route Endpoint: /api/search/[query]/[uid]/[page]
    else if (parseUrl.pathname.startsWith("/api/search/") && segments.length >= 6) {
      segments[4] = burner;
      parseUrl.pathname = segments.join("/");
    }
    // 3. General Fallback handling for dashboards/details paths
    else {
      if (segments.length > 0) {
        const lastIdx = segments.length - 1;
        if (/^\d+$/.test(segments[lastIdx]) && segments[lastIdx] !== "0") {
          segments[lastIdx] = burner;
        } else if (lastIdx >= 1 && /^\d+$/.test(segments[lastIdx - 1]) && segments[lastIdx] === "") {
          segments[lastIdx - 1] = burner;
        }
        parseUrl.pathname = segments.join("/");
      }
    }

    if (parseUrl.searchParams.has("uid")) parseUrl.searchParams.set("uid", burner);
    targetUrl = parseUrl.toString();
  } catch(e) {}

  console.log(`[APP REQUEST] Path: ${incomingPath} | Method: ${originalRequest.method}`);
  console.log(`[UPSTREAM TARGET] URL: ${targetUrl}`);

  const cookieHeader = originalRequest.headers.get("Cookie") || "";
  const rangeHeader = originalRequest.headers.get("Range") || "";
  const xApiKey = originalRequest.headers.get("X-Api-Key") || "";
  const authHeader = originalRequest.headers.get("Authorization") || "";
  const userAgent = originalRequest.headers.get("User-Agent") || "Android IOS v3.0";
  const contentType = originalRequest.headers.get("Content-Type") || "";
  
  let auth = authHeader || (xApiKey ? "Bearer " + xApiKey : "") || ("Bearer " + APP_API_KEY);
  const finalCookie = sessionCookie || cookieHeader;

  const h = {
    "User-Agent": userAgent, "Accept": originalRequest.headers.get("Accept") || "*/*", "Accept-Encoding": "identity",
    "Range": rangeHeader, "Cookie": finalCookie, "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://" + upstreamHost + "/", "Origin": "https://" + upstreamHost,
  };
  if (auth) h["Authorization"] = auth;
  if (contentType) h["Content-Type"] = contentType;

  let upstream = await fetch(targetUrl, {
    method: originalRequest.method, headers: h,
    body: originalRequest.method !== "GET" && originalRequest.method !== "HEAD" ? originalRequest.body : undefined,
    redirect: "manual",
  });

  let responseText = "";
  try { responseText = await upstream.clone().text(); } catch (e) {}

  console.log(`[UPSTREAM RESPONSE] Status: ${upstream.status} | Body Length: ${responseText.length}`);
  console.log(`[UPSTREAM SNIPPET]: ${responseText.substring(0, 300)}`);

  if (responseText.includes("id 0") || responseText.includes('"User with id 0 not found!"')) {
    _munoSession = null;
    try {
      const newSession = await munoGetSession();
      h["Cookie"] = newSession;
      upstream = await fetch(targetUrl, {
        method: originalRequest.method, headers: h,
        body: originalRequest.method !== "GET" && originalRequest.method !== "HEAD" ? originalRequest.body : undefined,
        redirect: "manual",
      });
    } catch (e) {}
  }

  if (upstream.status >= 400) {
    return jsonResponse({ dashboard: [], items: [], msg: "No data available", success: false }, upstream.status);
  }

  const outHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    const lk = k.toLowerCase();
    if (lk === "location") outHeaders.set("Location", rewriteUrl(v, upstreamHost, workerBase));
    else if (lk === "set-cookie") outHeaders.append("Set-Cookie", rewriteSetCookie(v));
    else if (lk === "content-encoding" || lk === "transfer-encoding") {}
    else if (lk === "access-control-allow-origin") outHeaders.set("Access-Control-Allow-Origin", "*");
    else outHeaders.append(k, v);
  }
  outHeaders.set("Access-Control-Allow-Origin", "*");
  outHeaders.set("Access-Control-Allow-Credentials", "true");

  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json") && upstream.status < 300) {
    try {
      const json = JSON.parse(await upstream.text());
      fixNullArrays(json);
      fixPlayingUrls(json, workerBase, burner);
      outHeaders.set("Content-Type", "application/json; charset=utf-8"); outHeaders.delete("content-length");
      return new Response(JSON.stringify(json), { status: upstream.status, headers: outHeaders });
    } catch (e) {
      return jsonResponse({ dashboard: [], items: [], msg: "Invalid response", success: false }, 500);
    }
  }
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

function rewriteUrl(location, upstreamHost, workerBase) {
  try {
    const abs = location.startsWith("http") ? location : "https://" + upstreamHost + (location.startsWith("/") ? location : "/" + location);
    const u = new URL(abs); const known = ["munowatch.org", "munowatch.com", "munotek.com"];
    if (!known.includes(u.hostname)) return location;
    const prefix = u.hostname === "munowatch.org" ? "" : "/" + u.hostname;
    return workerBase + prefix + u.pathname + u.search + u.hash;
  } catch { return location; }
}
function rewriteSetCookie(v) {
  return v.split(";").map(p => p.trim()).filter(p => { const l = p.toLowerCase(); return !l.startsWith("domain=") && !l.startsWith("samesite="); }).join("; ") + "; SameSite=None";
}
