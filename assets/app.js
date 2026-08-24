(() => {
'use strict';

const $ = id => document.getElementById(id);
const state = {
  events: [], sources: [], activeCats: new Set(), hours: 168, minSeverity: 1, query: '',
  map: null, cluster: null, markers: new Map(), selectedId: null, lastRefresh: null, loading: false
};

const CAT = {
  earthquake:{label:'Earthquakes',color:'#e5b85b'}, wildfire:{label:'Wildfires',color:'#ff736b'}, storm:{label:'Tropical systems',color:'#70aee6'},
  weather:{label:'Weather alerts',color:'#71c0df'}, volcano:{label:'Volcanoes',color:'#df8d66'}, flood:{label:'Floods',color:'#6ca9dc'},
  security:{label:'Security reporting',color:'#aa96ea'}, space:{label:'Space launches',color:'#63c9b7'}, spaceweather:{label:'Space weather',color:'#c896ea'},
  landslide:{label:'Landslides',color:'#b49c76'}, drought:{label:'Drought',color:'#c8aa61'}, ice:{label:'Ice',color:'#a9d8e0'},
  natural:{label:'Natural events',color:'#77bd88'}, incident:{label:'Incidents',color:'#d696a2'}, temperature:{label:'Temperature',color:'#d99a70'},
  atmosphere:{label:'Atmosphere',color:'#84b4aa'}, snow:{label:'Snow',color:'#d2e7e9'}, water:{label:'Water',color:'#6db1d0'}
};
const VIEW = {world:[[18,8],2],conus:[[38.4,-97],4],mena:[[29,42],4],europe:[[50,15],4],pacific:[[18,145],3]};
const EONET_MAP = {wildfires:'wildfire',severeStorms:'storm',volcanoes:'volcano',floods:'flood',landslides:'landslide',seaLakeIce:'ice',drought:'drought',dustHaze:'atmosphere',snow:'snow',tempExtremes:'temperature',waterColor:'water',manmade:'incident'};
const GDACS_MAP = {EQ:'earthquake',TC:'storm',FL:'flood',VO:'volcano',WF:'wildfire',DR:'drought'};
const TIMEOUT = 13000;

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function num(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function parseTime(v){const t=Date.parse(v||'');return Number.isFinite(t)?t:0;}
function toIso(v){const t=parseTime(v);return t?new Date(t).toISOString():new Date().toISOString();}
function rel(v){const t=parseTime(v);if(!t)return'Time n/a';const s=(Date.now()-t)/1000;if(s<0){const a=Math.abs(s);if(a<3600)return`in ${Math.ceil(a/60)}m`;if(a<86400)return`in ${Math.ceil(a/3600)}h`;return`in ${Math.ceil(a/86400)}d`;}if(s<60)return'just now';if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;return`${Math.floor(s/86400)}d ago`;}
function meta(c){return CAT[c]||{label:String(c||'Other'),color:'#8ca0a5'};}
function sevLabel(x){return x>=5?'Critical':x>=4?'High':x>=3?'Elevated':x>=2?'Watch':'Low';}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function centroid(geometry){if(!geometry)return[null,null];const coords=geometry.coordinates;if(!coords)return[null,null];if(geometry.type==='Point'&&Array.isArray(coords))return[num(coords[1]),num(coords[0])];const pts=[];const walk=x=>{if(Array.isArray(x)&&x.length>=2&&typeof x[0]==='number'&&typeof x[1]==='number')pts.push([x[1],x[0]]);else if(Array.isArray(x))x.forEach(walk);};walk(coords);if(!pts.length)return[null,null];return[pts.reduce((a,p)=>a+p[0],0)/pts.length,pts.reduce((a,p)=>a+p[1],0)/pts.length];}
function fetchJson(url,opts={}){const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),TIMEOUT);return fetch(url,{...opts,signal:ctrl.signal,headers:{Accept:'application/json, application/geo+json;q=0.9',...(opts.headers||{})},cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}).finally(()=>clearTimeout(timer));}
function source(name,fn){const rec={name,status:'loading',count:0,error:'',ms:0};state.sources.push(rec);renderSources();const start=performance.now();return fn().then(events=>{rec.status='ok';rec.count=events.length;rec.ms=Math.round(performance.now()-start);return events;}).catch(err=>{rec.status='bad';rec.error=err?.name==='AbortError'?'timeout':String(err?.message||err).slice(0,70);rec.ms=Math.round(performance.now()-start);return[];}).finally(renderSources);}

async function getUSGS(){
  const d=await fetchJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson');
  return (d.features||[]).slice(0,450).map(f=>{const p=f.properties||{},c=f.geometry?.coordinates||[],mag=num(p.mag)||0,depth=num(c[2]);return{id:`usgs-${f.id}`,title:p.title||'Earthquake',category:'earthquake',severity:mag>=6.5?5:mag>=5.5?4:mag>=4.5?3:mag>=3.5?2:1,lat:num(c[1]),lon:num(c[0]),updated:new Date(p.time||p.updated||Date.now()).toISOString(),source:'USGS',url:p.url||'',summary:`Magnitude ${mag.toFixed(1)}${depth!==null?` · depth ${depth.toFixed(0)} km`:''}`,region:p.place||'',kind:'event'};});
}
async function getEONET(){
  const d=await fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=250');
  return (d.events||[]).map(e=>{const cats=e.categories||[],raw=cats[0]?.id||'natural',cat=EONET_MAP[raw]||'natural',g=(e.geometry||[]).at(-1)||{},[lat,lon]=centroid(g),src=(e.sources||[])[0];return{id:`eonet-${e.id}`,title:e.title||'Natural event',category:cat,severity:['wildfire','storm','volcano','flood'].includes(cat)?3:2,lat,lon,updated:g.date||new Date().toISOString(),source:'NASA EONET',url:src?.url||e.link||'',summary:e.description||cats[0]?.title||'Open natural event tracked by NASA EONET.',region:'',kind:'event'};});
}
async function getNWS(){
  const d=await fetchJson('https://api.weather.gov/alerts/active?status=actual&message_type=alert',{headers:{Accept:'application/geo+json'}});const sm={Extreme:5,Severe:4,Moderate:3,Minor:2,Unknown:2};
  return (d.features||[]).slice(0,260).map(f=>{const p=f.properties||{},[lat,lon]=centroid(f.geometry);return{id:`nws-${p.id||f.id}`,title:p.event||'Weather alert',category:'weather',severity:sm[p.severity]||2,lat,lon,updated:p.sent||p.effective||p.onset||new Date().toISOString(),source:'NOAA / NWS',url:p['@id']||p.id||'',summary:p.headline||p.description||'',region:p.areaDesc||'',kind:'alert'};});
}
async function getNHC(){
  const d=await fetchJson('https://www.nhc.noaa.gov/CurrentStorms.json');
  return (d.activeStorms||[]).map(s=>{const wind=num(s.intensity)||0,cls=String(s.classification||'').toUpperCase();const severity=wind>=115?5:wind>=80?4:wind>=50?3:2;return{id:`nhc-${s.id}`,title:`${s.name||'Tropical system'} · ${cls||'storm'}`,category:'storm',severity,lat:num(s.latitudeNumeric),lon:num(s.longitudeNumeric),updated:s.lastUpdate||s.publicAdvisory?.issuance||new Date().toISOString(),source:'NOAA / NHC',url:s.publicAdvisory?.url||s.forecastGraphics?.url||'https://www.nhc.noaa.gov/',summary:`${cls||'Tropical system'} · sustained wind ${wind} kt · pressure ${s.pressure||'n/a'} mb · moving ${s.movementDir??'—'}° at ${s.movementSpeed??'—'} kt.`,region:s.binNumber||'',kind:'event'};});
}
async function getGDACS(){
  const d=await fetchJson('https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP');const feats=d.features||d||[];if(!Array.isArray(feats))return[];
  return feats.slice(0,160).map((f,i)=>{const p=f.properties||f,[lat,lon]=centroid(f.geometry),level=String(p.alertlevel||p.alertLevel||'green').toLowerCase(),type=String(p.eventtype||p.eventType||p.eventtypeid||'').toUpperCase();return{id:`gdacs-${p.eventid||p.eventId||i}-${type}`,title:p.name||p.eventname||p.title||`${type||'Disaster'} event`,category:GDACS_MAP[type]||'natural',severity:level==='red'?5:level==='orange'?4:level==='green'?2:3,lat,lon,updated:p.fromdate||p.todate||p.datetime||new Date().toISOString(),source:'GDACS',url:p.url?.report||p.url||p.link||'https://www.gdacs.org/',summary:`GDACS ${level.toUpperCase()} alert${p.severity?` · ${p.severity}`:''}.`,region:p.country||p.countryname||'',kind:'alert'};}).filter(e=>e.lat!==null&&e.lon!==null);
}
async function getSWPC(){
  const d=await fetchJson('https://services.swpc.noaa.gov/products/alerts.json');if(!Array.isArray(d))return[];
  return d.slice(0,35).map((a,i)=>{const raw=(a.message||a.product_text||a.text||JSON.stringify(a)).replace(/\s+/g,' ').trim(),code=String(a.product_id||a.productId||a.type||'SWPC'),sev=/(G5|S5|R5|EXTREME)/i.test(raw)?5:/(G4|S4|R4|SEVERE)/i.test(raw)?4:/(G3|S3|R3|STRONG)/i.test(raw)?3:2;return{id:`swpc-${a.issue_datetime||a.issue_datetime_utc||i}-${code}`,title:`Space weather ${code}`,category:'spaceweather',severity:sev,lat:null,lon:null,updated:a.issue_datetime||a.issue_datetime_utc||a.issue_time||new Date().toISOString(),source:'NOAA SWPC',url:'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings',summary:raw.slice(0,340),region:'Near-Earth environment',kind:'alert'};});
}
async function getDONKI(){
  const start=new Date(Date.now()-7*86400000).toISOString().slice(0,10);const urls=[`https://api.nasa.gov/DONKI/FLR?startDate=${start}&api_key=DEMO_KEY`,`https://api.nasa.gov/DONKI/CME?startDate=${start}&api_key=DEMO_KEY`];const res=await Promise.allSettled(urls.map(u=>fetchJson(u)));
  const out=[];if(res[0].status==='fulfilled'&&Array.isArray(res[0].value))res[0].value.slice(-15).forEach((x,i)=>out.push({id:`donki-flr-${x.flrID||i}`,title:`Solar flare ${x.classType||''}`.trim(),category:'spaceweather',severity:/X/i.test(x.classType||'')?4:/M/i.test(x.classType||'')?3:2,lat:null,lon:null,updated:x.beginTime||x.peakTime||new Date().toISOString(),source:'NASA DONKI',url:x.link||'https://kauai.ccmc.gsfc.nasa.gov/DONKI/',summary:`Solar flare${x.classType?` class ${x.classType}`:''}${x.sourceLocation?` · source ${x.sourceLocation}`:''}.`,region:'Sun / space environment',kind:'event'}));if(res[1].status==='fulfilled'&&Array.isArray(res[1].value))res[1].value.slice(-15).forEach((x,i)=>out.push({id:`donki-cme-${x.activityID||i}`,title:'Coronal mass ejection',category:'spaceweather',severity:3,lat:null,lon:null,updated:x.startTime||new Date().toISOString(),source:'NASA DONKI',url:x.link||'https://kauai.ccmc.gsfc.nasa.gov/DONKI/',summary:`CME detected${x.sourceLocation?` · source ${x.sourceLocation}`:''}.`,region:'Sun / space environment',kind:'event'}));if(!out.length)throw new Error('No DONKI response');return out;
}
async function getLaunches(){
  const d=await fetchJson('https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=20&mode=normal&ordering=net');
  return (d.results||[]).map(x=>{const pad=x.pad||{},loc=pad.location||{},lat=num(pad.latitude),lon=num(pad.longitude),agency=x.launch_service_provider?.name||x.lsp?.name||'',status=x.status?.abbrev||x.status?.name||'Scheduled';return{id:`ll2-${x.id}`,title:x.name||'Upcoming launch',category:'space',severity:x.is_crewed?3:2,lat,lon,updated:x.net||x.window_start||x.last_updated||new Date().toISOString(),source:'Launch Library 2',url:x.url||'https://thespacedevs.com/',summary:`${status}${agency?` · ${agency}`:''}${x.mission?.description?` · ${x.mission.description.slice(0,190)}`:''}`,region:loc.name||pad.name||'',kind:'schedule'};});
}
async function getGDELT(){
  const q=encodeURIComponent('(missile OR airstrike OR drone OR military OR conflict OR ceasefire OR nuclear)');const d=await fetchJson(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=45&timespan=24h&format=json&sort=datedesc`);
  return (d.articles||[]).slice(0,45).map((a,i)=>{let t=a.seendate||a.date||new Date().toISOString();if(/^\d{14}$/.test(String(t)))t=`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:${t.slice(12,14)}Z`;const title=a.title||'Security reporting';return{id:`gdelt-${i}-${String(a.url||title).slice(-24)}`,title,category:'security',severity:/nuclear|ballistic|missile|airstrike|invasion|mobilization/i.test(title)?3:2,lat:null,lon:null,updated:toIso(t),source:`GDELT${a.domain?` · ${a.domain}`:''}`,url:a.url||'',summary:'Open-source media reporting. This item has not been independently verified by WATCHTOWER.',region:a.sourcecountry||a.language||'Global',kind:'report'};});
}

const FALLBACK = [
  {id:'demo-eq',title:'Demonstration seismic event',category:'earthquake',severity:4,lat:35.6,lon:139.7,updated:new Date(Date.now()-52*60000).toISOString(),source:'DEMO FALLBACK',url:'',summary:'Live source connection failed. Demonstration marker only.',region:'Japan',kind:'event'},
  {id:'demo-wf',title:'Demonstration wildfire complex',category:'wildfire',severity:3,lat:39.1,lon:-121.2,updated:new Date(Date.now()-2.1*3600000).toISOString(),source:'DEMO FALLBACK',url:'',summary:'Live source connection failed. Demonstration marker only.',region:'United States',kind:'event'},
  {id:'demo-storm',title:'Demonstration tropical system',category:'storm',severity:3,lat:18.4,lon:-62.8,updated:new Date(Date.now()-3.4*3600000).toISOString(),source:'DEMO FALLBACK',url:'',summary:'Live source connection failed. Demonstration marker only.',region:'Atlantic',kind:'event'}
];

function dedupe(events){const seen=new Set();return events.filter(e=>{if(!e||!e.id)return false;const key=e.id;if(seen.has(key))return false;seen.add(key);e.severity=clamp(Number(e.severity)||1,1,5);e.lat=num(e.lat);e.lon=num(e.lon);e.updated=toIso(e.updated);return true;});}
function filtered(){const q=state.query.trim().toLowerCase(),now=Date.now(),win=state.hours*3600000;return state.events.filter(e=>{if(!state.activeCats.has(e.category))return false;if(e.severity<state.minSeverity)return false;const t=parseTime(e.updated);if(e.kind!=='schedule'&&t&&now-t>win)return false;if(q&&!`${e.title} ${e.region} ${e.source} ${e.summary}`.toLowerCase().includes(q))return false;return true;}).sort((a,b)=>(b.severity-a.severity)||(parseTime(b.updated)-parseTime(a.updated)));}

function initMap(){
  if(!window.L){$('map').innerHTML='<div class="map-loading"><strong>Map library unavailable</strong><span>The event stream remains available.</span></div>';return;}
  state.map=L.map('map',{worldCopyJump:true,minZoom:2,maxZoom:11,zoomControl:true,preferCanvas:true,attributionControl:true}).setView(VIEW.world[0],VIEW.world[1]);
  const base=L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:19,attribution:'&copy; OpenStreetMap &copy; CARTO'});
  const labels=L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:19,pane:'overlayPane'});
  base.addTo(state.map);labels.addTo(state.map);
  if(window.L.markerClusterGroup){
    state.cluster=L.markerClusterGroup({
      showCoverageOnHover:false,
      zoomToBoundsOnClick:false,
      spiderfyOnMaxZoom:false,
      removeOutsideVisibleBounds:true,
      maxClusterRadius:zoom=>zoom<=2?62:zoom<=4?48:zoom<=6?38:30,
      iconCreateFunction:c=>L.divIcon({html:`<div class="cluster-icon">${c.getChildCount()}</div>`,className:'',iconSize:[40,40]})
    });
    state.cluster.on('clusterclick',ev=>{
      const cluster=ev.layer;
      if(!cluster||!state.map)return;
      const bounds=cluster.getBounds();
      const current=state.map.getZoom();
      const target=Math.min(state.map.getMaxZoom(),Math.max(current+2,5));
      if(bounds&&bounds.isValid()&&!bounds.getNorthEast().equals(bounds.getSouthWest())){
        state.map.fitBounds(bounds.pad(.22),{padding:[36,36],maxZoom:Math.min(target,8),animate:true,duration:.45});
      }else{
        state.map.setView(cluster.getLatLng(),Math.min(target,8),{animate:true});
      }
      if(ev.originalEvent){
        L.DomEvent.stopPropagation(ev.originalEvent);
        L.DomEvent.preventDefault(ev.originalEvent);
      }
    });
  } else state.cluster=L.layerGroup();
  state.map.addLayer(state.cluster);
  if(window.ResizeObserver){const ro=new ResizeObserver(()=>state.map.invalidateSize(false));ro.observe($('map'));}
}
function renderMap(events){
  if(!state.map||!state.cluster)return;state.cluster.clearLayers();state.markers.clear();const mapped=events.filter(e=>e.lat!==null&&e.lon!==null&&Math.abs(e.lat)<=90&&Math.abs(e.lon)<=180);$('mappedCount').textContent=String(mapped.length);$('mapSignalCount').textContent=String(mapped.length);
  mapped.slice(0,650).forEach(e=>{const m=meta(e.category);const icon=L.divIcon({className:'signal-icon',html:`<div class="signal-marker s${e.severity}" style="--cat:${m.color}"></div>`,iconSize:[18,18],iconAnchor:[9,9]});const marker=L.marker([e.lat,e.lon],{icon,title:e.title});marker.bindPopup(`<div class="popup-cat">${esc(m.label)} · ${esc(sevLabel(e.severity))}</div><div class="popup-title">${esc(e.title)}</div>`);marker.on('click',()=>selectEvent(e.id,false));state.markers.set(e.id,marker);state.cluster.addLayer(marker);});
}
function renderLayers(){const counts={};state.events.forEach(e=>counts[e.category]=(counts[e.category]||0)+1);const cats=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]);$('layerList').innerHTML=cats.map(c=>{const m=meta(c),on=state.activeCats.has(c);return`<button type="button" class="layer-chip ${on?'':'off'}" data-cat="${esc(c)}" style="--cat:${m.color}"><i></i><span>${esc(m.label)}</span><b>${counts[c]}</b></button>`;}).join('');$('layerList').querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{const c=b.dataset.cat;state.activeCats.has(c)?state.activeCats.delete(c):state.activeCats.add(c);renderAll();}));}
function renderLegend(events){const seen=[];for(const e of events){if(!seen.includes(e.category))seen.push(e.category);if(seen.length>=6)break;}$('mapLegend').innerHTML=seen.map(c=>{const m=meta(c);return`<span class="legend-item" style="--cat:${m.color}"><i class="legend-dot"></i>${esc(m.label)}</span>`;}).join('');}
function renderFeed(events){const shown=events.slice(0,70);$('feedCount').textContent=`${shown.length} shown`;if(!shown.length){$('eventFeed').innerHTML='<div class="empty-state">No signals match this view.<br>Expand the time window or reset filters.</div>';return;}$('eventFeed').innerHTML=shown.map(e=>{const m=meta(e.category),mapped=e.lat!==null&&e.lon!==null;return`<button type="button" class="feed-item ${state.selectedId===e.id?'selected':''}" data-id="${esc(e.id)}" style="--cat:${m.color}"><i class="feed-dot"></i><span><span class="feed-top"><b class="feed-cat">${esc(m.label)}</b><time class="feed-time">${esc(rel(e.updated))}</time></span><span class="feed-title">${esc(e.title)}</span><span class="feed-meta"><span>${esc(e.source||'Unknown')}${e.region?` · ${esc(e.region)}`:''}</span>${e.severity>=4?`<b class="feed-severity">${esc(sevLabel(e.severity))}</b>`:''}${mapped?'':'<b class="unmapped">feed only</b>'}</span></span></button>`;}).join('');$('eventFeed').querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>selectEvent(b.dataset.id,true)));}
function renderSources(){const good=state.sources.filter(s=>s.status==='ok').length,total=state.sources.length,loading=state.sources.filter(s=>s.status==='loading').length;$('sourceHealth').textContent=`${good}/${total||9}`;$('sourceNote').textContent=loading?`${loading} syncing`:total?(good===total?'all nominal':'partial coverage'):'connecting';$('sourceGrid').innerHTML=state.sources.length?state.sources.map(s=>`<div class="source-item"><div class="source-title">${esc(s.name)}</div><div class="source-state ${s.status==='bad'?'bad':s.status==='loading'?'loading':''}"><i></i>${s.status==='ok'?'online':s.status==='bad'?'degraded':'syncing'}</div><div class="source-detail">${s.status==='ok'?`${s.count} records · ${s.ms} ms`:s.status==='bad'?esc(s.error||'No response'):'Awaiting response'}</div></div>`).join(''):'<div class="empty-state">Connecting to public sources…</div>';const chip=$('liveStatus');chip.className=`live-pill ${state.loading?'loading':good<total?'degraded':''}`;chip.querySelector('span').textContent=state.loading?'Connecting':good===total&&total?'Live feeds':good?'Partial feeds':'Offline';}
function renderPriority(events){const list=events.filter(e=>e.severity>=3).slice(0,6);$('priorityQueue').innerHTML=list.length?list.map((e,i)=>`<button type="button" class="priority-item" data-id="${esc(e.id)}"><span class="priority-rank">${String(i+1).padStart(2,'0')}</span><span><span class="priority-name">${esc(e.title)}</span><span class="priority-meta">${esc(sevLabel(e.severity))} · ${esc(e.source)} · ${esc(rel(e.updated))}</span></span></button>`).join(''):'<div class="empty-state">No elevated or higher signals in this view.</div>';$('priorityQueue').querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>selectEvent(b.dataset.id,true)));}
function renderTimeline(events){const now=Date.now(),bins=Array.from({length:24},()=>({count:0,high:0}));events.forEach(e=>{if(e.kind==='schedule')return;const age=(now-parseTime(e.updated))/3600000;if(age>=0&&age<24){const idx=23-Math.floor(age);bins[idx].count++;if(e.severity>=4)bins[idx].high++;}});const max=Math.max(1,...bins.map(b=>b.count));$('tempoLabel').textContent=`${bins.reduce((a,b)=>a+b.count,0)} events`;$('timeline').innerHTML=bins.map((b,i)=>{const h=Math.max(2,Math.round((b.count/max)*96)),hour=new Date(now-(23-i)*3600000).getUTCHours();return`<span class="timeline-col" title="${b.count} signal(s) · ${String(hour).padStart(2,'0')}:00 UTC"><i class="timeline-bar ${b.high?'hot':''}" style="height:${h}px"></i>${i%4===3?`<small>${String(hour).padStart(2,'0')}</small>`:'<small>&nbsp;</small>'}</span>`;}).join('');}
function buildSitrep(events){if(!events.length)return'No signals match the current filters. Expand the time window or re-enable layers to rebuild the brief.';const high=events.filter(e=>e.severity>=4),mapped=events.filter(e=>e.lat!==null),counts={};events.forEach(e=>counts[e.category]=(counts[e.category]||0)+1);const tops=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,v])=>`${meta(c).label.toLowerCase()} (${v})`);const lead=events[0];return `<strong>${events.length} visible signals</strong> across ${Object.keys(counts).length} categories, with ${mapped.length} geolocated. ${high.length?`<strong>${high.length} high-priority item${high.length===1?'':'s'}</strong> are currently visible.`:'No high-priority items are visible in this filter set.'} Activity is led by ${esc(tops.join(', '))}. ${lead?`The highest-ranked item is <strong>${esc(lead.title)}</strong> (${esc(sevLabel(lead.severity))}, ${esc(rel(lead.updated))}).`:''}`;}
function posture(events){let score=0,now=Date.now();events.forEach(e=>{const age=Math.max(0,(now-parseTime(e.updated))/3600000),decay=Math.max(.12,1-age/Math.max(24,state.hours));score+=e.severity*decay;});score=clamp(Math.round(score/2.8),0,100);const label=score>=75?'Critical':score>=55?'Heightened':score>=30?'Elevated':'Routine';$('postureScore').textContent=String(score);$('postureLabel').textContent=label;$('postureBar').style.width=`${score}%`;}
function selectEvent(id,focusMap){const e=state.events.find(x=>x.id===id);if(!e)return;state.selectedId=id;const m=meta(e.category);$('drawerCategory').textContent=m.label;$('drawerCategory').style.color=m.color;$('drawerSeverity').textContent=sevLabel(e.severity);$('drawerTitle').textContent=e.title;$('drawerMeta').textContent=`${e.source||'Unknown source'} · ${e.region||'Region not specified'} · ${rel(e.updated)}`;$('drawerCoords').textContent=e.lat!==null&&e.lon!==null?`${e.lat.toFixed(3)}, ${e.lon.toFixed(3)} · ${new Date(parseTime(e.updated)).toISOString().replace('.000','')}`:'Unmapped / feed-only signal';$('drawerSummary').textContent=e.summary||'No additional summary supplied by source.';const a=$('drawerLink');if(e.url){a.href=e.url;a.style.display='inline-flex';}else a.style.display='none';$('detailDrawer').classList.add('open');$('detailDrawer').setAttribute('aria-hidden','false');$('mapHint').textContent=`Selected · ${e.title.slice(0,65)}`;if(focusMap&&state.map&&e.lat!==null&&e.lon!==null){state.map.flyTo([e.lat,e.lon],Math.max(state.map.getZoom(),5),{duration:.65});const marker=state.markers.get(e.id);if(marker)setTimeout(()=>marker.openPopup(),700);}renderFeed(filtered());}
function closeDrawer(){$('detailDrawer').classList.remove('open');$('detailDrawer').setAttribute('aria-hidden','true');state.selectedId=null;$('mapHint').textContent='Select a marker for details';renderFeed(filtered());}
function renderAll(){renderLayers();const events=filtered();$('visibleCount').textContent=String(events.length);$('visibleNote').textContent=state.hours<24?`${state.hours} hour window`:state.hours===24?'24 hour window':state.hours===168?'7 day window':'30 day window';$('priorityCount').textContent=String(events.filter(e=>e.severity>=4).length);renderMap(events);renderLegend(events);renderFeed(events);renderPriority(events);renderTimeline(events);$('sitrepText').innerHTML=buildSitrep(events);posture(events);}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2400);}

async function loadAll(manual=false){if(state.loading)return;state.loading=true;state.sources=[];renderSources();if(manual)toast('Refreshing public sources…');const jobs=[source('USGS',getUSGS),source('NASA EONET',getEONET),source('NOAA / NWS',getNWS),source('NOAA / NHC',getNHC),source('GDACS',getGDACS),source('NOAA SWPC',getSWPC),source('NASA DONKI',getDONKI),source('Launch Library 2',getLaunches),source('GDELT',getGDELT)];const chunks=await Promise.all(jobs);let events=dedupe(chunks.flat());if(!events.length){events=FALLBACK;toast('Live feeds unavailable — clearly labeled demo fallback active');}state.events=events;state.activeCats.clear();events.forEach(e=>state.activeCats.add(e.category));state.lastRefresh=new Date();state.loading=false;renderSources();renderAll();$('lastRefresh').textContent=`sync ${state.lastRefresh.toISOString().slice(11,19)} UTC`;if(manual)toast(`${events.length} signals loaded`);}
function bind(){document.querySelectorAll('#timeFilters [data-hours]').forEach(b=>b.addEventListener('click',()=>{state.hours=Number(b.dataset.hours);document.querySelectorAll('#timeFilters button').forEach(x=>x.classList.toggle('active',x===b));renderAll();}));$('severityFilter').addEventListener('change',e=>{state.minSeverity=Number(e.target.value)||1;renderAll();});$('searchInput').addEventListener('input',e=>{state.query=e.target.value;renderAll();});$('resetBtn').addEventListener('click',()=>{state.hours=168;state.minSeverity=1;state.query='';$('searchInput').value='';$('severityFilter').value='1';document.querySelectorAll('#timeFilters button').forEach(x=>x.classList.toggle('active',x.dataset.hours==='168'));state.activeCats.clear();state.events.forEach(e=>state.activeCats.add(e.category));if(state.map)state.map.setView(VIEW.world[0],VIEW.world[1]);document.querySelectorAll('#mapPresets button').forEach(x=>x.classList.toggle('active',x.dataset.view==='world'));renderAll();toast('View reset');});$('refreshBtn').addEventListener('click',()=>loadAll(true));$('drawerClose').addEventListener('click',closeDrawer);document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});document.querySelectorAll('#mapPresets [data-view]').forEach(b=>b.addEventListener('click',()=>{const v=VIEW[b.dataset.view]||VIEW.world;if(state.map)state.map.flyTo(v[0],v[1],{duration:.6});document.querySelectorAll('#mapPresets button').forEach(x=>x.classList.toggle('active',x===b));}));}
function clock(){const tick=()=>{$('utcClock').textContent=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());if(state.lastRefresh)$('lastRefresh').textContent=`sync ${state.lastRefresh.toISOString().slice(11,19)} UTC · ${rel(state.lastRefresh.toISOString())}`;};tick();setInterval(tick,1000);}
function autoRefresh(){setInterval(()=>{if(!document.hidden)loadAll(false);},10*60*1000);}

bind();initMap();clock();autoRefresh();loadAll(false);
})();
