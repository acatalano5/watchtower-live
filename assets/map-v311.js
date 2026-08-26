'use strict';
(() => {
  const CAT={earthquake:'gold',wildfire:'coral',storm:'cyan',weather:'cyan',volcano:'coral',flood:'cyan',conflict:'coral',security:'violet',space:'mint',spaceweather:'violet',landslide:'gold',drought:'gold',ice:'cyan',natural:'mint',incident:'coral',temperature:'coral',atmosphere:'cyan',snow:'cyan',water:'cyan'};
  const VIEW={world:null,conus:{lon:-98,lat:39,k:2.65},mena:{lon:42,lat:29,k:2.95},europe:{lon:15,lat:50,k:2.9},pacific:{lon:145,lat:18,k:2.25}};
  const FEATURED=new Set(['conflict-ukraine','conflict-israel-palestine','conflict-iran-israel-us','conflict-yemen-red-sea','conflict-sudan','conflict-myanmar','conflict-drc']);
  const s={world:null,projection:null,path:null,zoom:null,transform:d3.zoomIdentity,events:[],visible:[],mode:'overview',selectedId:null,selectedPlace:null,baseGroup:null,svg:null,canvas:null,fx:null,ctx:null,fxctx:null,dpr:1,hit:[],onSelect:null,onHover:null,staticRaf:0,lastStatic:0,fxRaf:0,lastFx:0,phase:0,reduce:false,fxDirty:[],animCache:[]};
  const $=id=>document.getElementById(id);
  function css(name){return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()}
  function color(e){return css(CAT[e.category]||'accent')||'#5d62d7'}
  function colorMix(hex,a){if(!hex.startsWith('#'))return hex;let h=hex.slice(1);if(h.length===3)h=h.split('').map(x=>x+x).join('');const n=parseInt(h,16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;return`rgba(${r},${g},${b},${a})`}
  function score(e){const age=Math.max(0,(Date.now()-Date.parse(e.updated||0))/36e5);return(e.severity||1)*22+Math.max(0,42-age)+(e.category==='security'?4:0)}
  function pick(list,caps,limit){const out=[],counts={};for(const e of list){if(out.length>=limit)break;const cap=caps[e.category]??caps['*']??5;if((counts[e.category]||0)>=cap)continue;counts[e.category]=(counts[e.category]||0)+1;out.push(e)}return out}
  function visibleFor(events,mode){
    const mapped=events.filter(e=>Number.isFinite(e.lat)&&Number.isFinite(e.lon));
    const conflicts=mapped.filter(e=>e.category==='conflict');
    const live=mapped.filter(e=>e.category!=='conflict').sort((a,b)=>score(b)-score(a));
    if(mode==='conflict')return[...conflicts,...pick(live.filter(e=>e.category==='security'),{security:60},60)];
    if(mode==='hazards')return pick(live.filter(e=>e.category!=='security'),{weather:20,earthquake:18,storm:14,wildfire:12,flood:8,volcano:7,spaceweather:6,space:4,'*':5},120);
    if(mode==='signals')return[...conflicts,...live.slice(0,280)];
    const refs=conflicts.filter(e=>FEATURED.has(e.id));
    const hero=live.filter(e=>e.severity>=3||['storm','earthquake','wildfire','security','space','spaceweather'].includes(e.category));
    return[...refs,...pick(hero,{weather:7,earthquake:10,storm:7,wildfire:7,security:9,space:4,spaceweather:4,flood:3,volcano:3,'*':3},64)];
  }
  function init({onSelect,onHover}={}){
    s.svg=d3.select('#worldMap');s.baseGroup=s.svg.select('#worldLayer');s.canvas=$('signalCanvas');s.fx=$('effectCanvas');
    s.ctx=s.canvas.getContext('2d',{alpha:true,desynchronized:true});s.fxctx=s.fx.getContext('2d',{alpha:true,desynchronized:true});
    s.onSelect=onSelect;s.onHover=onHover;s.reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    setupZoom();bindPointer();resize();loadWorld();startEffects();return api;
  }
  async function loadWorld(){
    try{const d=await fetch('./data/world-v311.geojson',{cache:'force-cache'});if(!d.ok)throw new Error('world');s.world=await d.json()}catch(e){s.world=null}
    drawBase();redraw(true);
  }
  function resize(){
    const w=innerWidth,h=innerHeight,aspect=w/Math.max(1,h);s.dpr=w>2400?1:Math.min(devicePixelRatio||1,1.35);
    for(const c of [s.canvas,s.fx]){c.width=Math.max(1,Math.round(w*s.dpr));c.height=Math.max(1,Math.round(h*s.dpr));c.style.width=`${w}px`;c.style.height=`${h}px`}
    s.ctx.setTransform(s.dpr,0,0,s.dpr,0,0);s.fxctx.setTransform(s.dpr,0,0,s.dpr,0,0);s.svg.attr('viewBox',`0 0 ${w} ${h}`);
    s.projection=d3.geoEqualEarth().fitExtent([[Math.max(26,w*.025),Math.max(44,h*.035)],[w-Math.max(26,w*.025),h-Math.max(28,h*.025)]],{type:'Sphere'});
    if(aspect>2.55)s.projection.scale(s.projection.scale()*1.15);else if(aspect>1.85)s.projection.scale(s.projection.scale()*1.06);
    s.path=d3.geoPath(s.projection);if(s.zoom){s.zoom.extent([[0,0],[w,h]]).translateExtent([[-w*.35,-h*.35],[w*1.35,h*1.35]])}
    drawBase();resetWorld(false);redraw(true);
  }
  function drawBase(){
    if(!s.projection)return;const g=s.baseGroup;g.selectAll('*').remove();
    g.append('path').datum({type:'Sphere'}).attr('class','sphere-glow').attr('d',s.path);
    g.append('path').datum({type:'Sphere'}).attr('class','sphere').attr('d',s.path);
    g.append('path').datum(d3.geoGraticule10()).attr('class','grat').attr('d',s.path);
    if(s.world)g.selectAll('.country').data(s.world.features).join('path').attr('class','country').attr('d',s.path).style('fill-opacity',d=>.92+(Math.abs(hash(d.properties?.name||''))%5)*.014);
    const labels=[['NORTH AMERICA',-105,46],['SOUTH AMERICA',-60,-18],['EUROPE',17,53],['AFRICA',22,7],['ASIA',86,43],['AUSTRALIA',135,-27]];
    g.selectAll('.continent-label').data(labels).join('text').attr('class','continent-label').attr('x',d=>s.projection([d[1],d[2]])[0]).attr('y',d=>s.projection([d[1],d[2]])[1]).text(d=>d[0]);applyTransform();
  }
  function setupZoom(){
    s.zoom=d3.zoom().scaleExtent([1,8]).filter(ev=>!ev.ctrlKey&&(!ev.button||ev.type==='wheel'))
      .on('zoom',ev=>{s.transform=ev.transform;applyTransform();scheduleStatic()})
      .on('end',()=>{redrawStatic();redrawEffects(true)});
    s.svg.call(s.zoom).on('dblclick.zoom',null);
  }
  function applyTransform(){if(s.baseGroup&&s.transform)s.baseGroup.attr('transform',s.transform.toString())}
  function resetWorld(animate=true){s.selectedPlace=null;const t=d3.zoomIdentity;if(!s.svg||!s.zoom)return;s.transform=t;if(animate&&!s.reduce)s.svg.interrupt().transition().duration(500).ease(d3.easeCubicInOut).call(s.zoom.transform,t);else s.svg.call(s.zoom.transform,t)}
  function focus(lon,lat,k=3.5,animate=true){if(!s.projection)return;const p=s.projection([lon,lat]),w=innerWidth,h=innerHeight,t=d3.zoomIdentity.translate(w/2-p[0]*k,h/2-p[1]*k).scale(k);if(animate&&!s.reduce)s.svg.interrupt().transition().duration(560).ease(d3.easeCubicInOut).call(s.zoom.transform,t);else s.svg.call(s.zoom.transform,t)}
  function focusView(name){if(name==='world'||!VIEW[name])return resetWorld();const v=VIEW[name];focus(v.lon,v.lat,v.k)}
  function setPlace(place){s.selectedPlace=place||null;if(place)focus(place.lon,place.lat,place.zoom||4.4);redrawStatic()}
  function setData(events,mode='overview',selectedId=null){s.events=events||[];s.mode=mode;s.selectedId=selectedId;s.visible=visibleFor(s.events,s.mode);s.animCache=buildAnimated();redraw(true);return s.visible}
  function setTheme(){drawBase();redraw(true)}
  function scheduleStatic(){
    if(s.staticRaf)return;s.staticRaf=requestAnimationFrame(ts=>{s.staticRaf=0;if(ts-s.lastStatic<28){scheduleStatic();return}s.lastStatic=ts;redrawStatic();redrawEffects(true)});
  }
  function toScreen(e){const p=s.projection?.([e.lon,e.lat]);if(!p)return null;return s.transform.apply(p)}
  function fieldFor(e){
    const c=toScreen(e);if(!c)return null;
    const deg=(e.radiusKm||300)/111,cos=Math.max(.28,Math.cos(e.lat*Math.PI/180));
    const px=s.projection([Math.min(179,e.lon+deg/cos),e.lat]),py=s.projection([e.lon,Math.min(84,e.lat+deg)]);if(!px||!py)return null;
    const sx=s.transform.apply(px),sy=s.transform.apply(py),rx=Math.abs(sx[0]-c[0]),ry=Math.abs(sy[1]-c[1]);
    // Keep reference fields visually stable in screen space. Equal Earth stretches geographic
    // circles away from the equator; geometric mean preserves approximate area without ugly ovals.
    const r=Math.max(22,Math.min(105,Math.sqrt(Math.max(1,rx)*Math.max(1,ry))));
    return{x:c[0],y:c[1],r};
  }
  function organicPath(ctx,e,x,y,r,phase=0){
    const seed=Math.abs(hash(e.id||`${e.lon},${e.lat}`));
    const n=14;ctx.beginPath();
    for(let i=0;i<=n;i++){
      const a=(i%n)/n*Math.PI*2;
      const wobble=1+Math.sin(a*3+(seed%17)*.31+phase)*.075+Math.cos(a*5+(seed%29)*.17)*.045;
      const rr=r*wobble,px=x+Math.cos(a)*rr,py=y+Math.sin(a)*rr;
      if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
    ctx.closePath();
  }
  function redraw(fullFx=false){redrawStatic();redrawEffects(fullFx)}
  function clearFull(ctx){ctx.save();ctx.setTransform(s.dpr,0,0,s.dpr,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);ctx.restore()}
  function redrawStatic(){
    if(!s.projection||!s.ctx)return;clearFull(s.ctx);s.hit=[];const ctx=s.ctx;ctx.save();ctx.setTransform(s.dpr,0,0,s.dpr,0,0);
    const conflicts=s.visible.filter(e=>e.category==='conflict'),signals=s.visible.filter(e=>e.category!=='conflict');
    for(const e of conflicts){
      const q=fieldFor(e);if(!q)continue;ctx.save();
      const c=color(e),g=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,q.r*1.08);
      g.addColorStop(0,colorMix(c,.085));g.addColorStop(.58,colorMix(c,.045));g.addColorStop(1,colorMix(c,0));
      organicPath(ctx,e,q.x,q.y,q.r);ctx.save();ctx.clip();ctx.fillStyle=g;ctx.fillRect(q.x-q.r*1.15,q.y-q.r*1.15,q.r*2.3,q.r*2.3);ctx.restore();
      organicPath(ctx,e,q.x,q.y,q.r);ctx.strokeStyle=colorMix(c,.28);ctx.lineWidth=1.15;ctx.setLineDash([4,7]);ctx.stroke();
      ctx.restore();s.hit.push({e,x:q.x,y:q.y,r:16});
    }
    for(const e of signals){const p=toScreen(e);if(!p||p[0]<-35||p[0]>innerWidth+35||p[1]<-35||p[1]>innerHeight+35)continue;drawMarker(ctx,e,p[0],p[1]);s.hit.push({e,x:p[0],y:p[1],r:14})}
    if(s.selectedPlace){const p=s.projection([s.selectedPlace.lon,s.selectedPlace.lat]);if(p){const q=s.transform.apply(p);drawPlace(ctx,q[0],q[1],s.selectedPlace)}}
    ctx.restore();
  }
  function drawPlace(ctx,x,y,place){
    const text=`${place.name}`;ctx.save();ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=css('ink');ctx.fill();ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.strokeStyle=css('accent');ctx.lineWidth=2;ctx.stroke();
    const fs=innerWidth>2600?15:13;ctx.font=`650 ${fs}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;const w=ctx.measureText(text).width;const bx=x+17,by=y-15;ctx.fillStyle=css('panel');roundRect(ctx,bx-8,by-fs-5,w+16,fs+14,10);ctx.fill();ctx.strokeStyle=colorMix(css('ink'),.12);ctx.lineWidth=1;ctx.stroke();ctx.fillStyle=css('ink');ctx.fillText(text,bx,by);ctx.restore();
  }
  function roundRect(ctx,x,y,w,h,r){const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath()}
  function drawMarker(ctx,e,x,y){
    const c=color(e),sev=e.severity||1,r=sev>=5?8:sev>=4?7:sev>=3?6:5;ctx.save();
    // Neutral underlay keeps markers crisp over both land and ocean in every theme.
    ctx.beginPath();ctx.arc(x,y,r+2.4,0,Math.PI*2);ctx.fillStyle=colorMix(css('panel'),.88);ctx.fill();
    if(sev>=4){ctx.beginPath();ctx.arc(x,y,r+6,0,Math.PI*2);ctx.fillStyle=colorMix(c,.12);ctx.fill()}
    ctx.strokeStyle=c;ctx.fillStyle=c;ctx.lineWidth=sev>=4?2.1:1.55;
    if(e.category==='security'){
      ctx.translate(x,y);ctx.rotate(Math.PI/4);ctx.fillRect(-r*.70,-r*.70,r*1.40,r*1.40);
    }else if(e.category==='wildfire'){
      ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r*.92,y+r*.82);ctx.lineTo(x-r*.92,y+r*.82);ctx.closePath();ctx.fill();
    }else if(e.category==='earthquake'){
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(x,y,Math.max(2.2,r*.34),0,Math.PI*2);ctx.fill();
    }else if(e.category==='space'||e.category==='spaceweather'){
      star(ctx,x,y,r+1,c);
    }else{
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
    if(e.id===s.selectedId){ctx.save();ctx.beginPath();ctx.arc(x,y,r+8,0,Math.PI*2);ctx.strokeStyle=css('ink');ctx.lineWidth=1.6;ctx.stroke();ctx.restore()}
  }
  function star(ctx,x,y,r,c){ctx.save();ctx.translate(x,y);ctx.fillStyle=c;ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r:r*.42;ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr)}ctx.closePath();ctx.fill();ctx.restore()}
  function buildAnimated(){
    // Select per category first so one noisy feed (usually weather) cannot monopolize motion.
    const cfg={
      conflict:{min:1,cap:4},storm:{min:2,cap:4},weather:{min:3,cap:2},flood:{min:3,cap:2},
      earthquake:{min:2,cap:4},wildfire:{min:2,cap:3},security:{min:2,cap:3},spaceweather:{min:2,cap:2}
    };
    const groups={};for(const e of s.visible){const c=cfg[e.category];if(!c||(e.severity||1)<c.min)continue;(groups[e.category]??=[]).push(e)}
    const out=[];for(const [cat,c] of Object.entries(cfg)){const arr=(groups[cat]||[]).sort((a,b)=>score(b)-score(a));out.push(...arr.slice(0,c.cap))}
    return out.sort((a,b)=>score(b)-score(a)).slice(0,16);
  }
  function startEffects(){if(s.reduce)return;const loop=ts=>{s.fxRaf=requestAnimationFrame(loop);if(document.hidden||ts-s.lastFx<38)return;s.lastFx=ts;s.phase=(ts%12000)/12000;redrawEffects(false)};s.fxRaf=requestAnimationFrame(loop)}
  function stopEffects(){if(s.fxRaf)cancelAnimationFrame(s.fxRaf);s.fxRaf=0}
  function clearDirty(){const ctx=s.fxctx;if(!ctx)return;ctx.save();ctx.setTransform(s.dpr,0,0,s.dpr,0,0);for(const b of s.fxDirty)ctx.clearRect(b.x,b.y,b.w,b.h);ctx.restore();s.fxDirty=[]}
  function dirty(x,y,r){s.fxDirty.push({x:x-r-4,y:y-r-4,w:r*2+8,h:r*2+8})}
  function redrawEffects(forceFull=false){
    if(!s.fxctx)return;if(forceFull){clearFull(s.fxctx);s.fxDirty=[]}else clearDirty();if(s.reduce||s.mode==='signals')return;
    const ctx=s.fxctx;ctx.save();ctx.setTransform(s.dpr,0,0,s.dpr,0,0);
    for(const e of s.animCache){const p=toScreen(e);if(!p||p[0]<-100||p[0]>innerWidth+100||p[1]<-100||p[1]>innerHeight+100)continue;const seed=(Math.abs(hash(e.id))%1000)/1000,t=(s.phase+seed)%1,c=color(e);
      if(e.category==='storm'||e.category==='weather'||e.category==='flood')drawWeatherFx(ctx,p[0],p[1],c,t,e.category==='storm');
      else if(e.category==='earthquake')drawSeismicFx(ctx,p[0],p[1],c,t);
      else if(e.category==='wildfire')drawFireFx(ctx,p[0],p[1],c,t,seed);
      else if(e.category==='security')drawSecurityFx(ctx,p[0],p[1],c,t);
      else if(e.category==='spaceweather')drawSpaceWeatherFx(ctx,p[0],p[1],c,t);
      else if(e.category==='conflict')drawConflictFx(ctx,e,c,t);
    }
    ctx.restore();
  }
  function drawWeatherFx(ctx,x,y,c,t,strong){
    const base=strong?25:20,rot=t*Math.PI*2;ctx.save();ctx.translate(x,y);ctx.rotate(rot*.18);ctx.strokeStyle=colorMix(c,strong?.30:.20);ctx.lineWidth=1.2;ctx.lineCap='round';
    for(let i=0;i<3;i++){const r=base+i*8,off=i*2.1;ctx.beginPath();ctx.arc(0,0,r,off+rot,off+rot+(strong?1.45:1.05));ctx.stroke()}
    for(let i=0;i<3;i++){const a=rot+i*2.05,r=base+8+i*4;ctx.beginPath();ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);ctx.lineTo(Math.cos(a)*(r+10),Math.sin(a)*(r+10));ctx.strokeStyle=colorMix(c,.15);ctx.stroke()}
    ctx.restore();dirty(x,y,base+38);
  }
  function drawSeismicFx(ctx,x,y,c,t){const r=10+30*t;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.strokeStyle=colorMix(c,.32*(1-t));ctx.lineWidth=1.4;ctx.stroke();const r2=8+20*((t+.45)%1);ctx.beginPath();ctx.arc(x,y,r2,0,Math.PI*2);ctx.strokeStyle=colorMix(c,.14*(1-((t+.45)%1)));ctx.lineWidth=1;ctx.stroke();dirty(x,y,44)}
  function drawFireFx(ctx,x,y,c,t,seed){ctx.save();ctx.strokeStyle=colorMix(c,.24);ctx.lineWidth=1.2;ctx.lineCap='round';for(let i=0;i<3;i++){const tt=(t+i*.29+seed*.2)%1,dx=(i-1)*5+Math.sin((tt+seed)*8)*3,dy=-(8+20*tt);ctx.beginPath();ctx.moveTo(x+dx,y-2);ctx.quadraticCurveTo(x+dx+3,y+dy*.55,x+dx-1,y+dy);ctx.strokeStyle=colorMix(c,.25*(1-tt));ctx.stroke()}ctx.restore();dirty(x,y,38)}
  function drawSecurityFx(ctx,x,y,c,t){const r=11+15*t;ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);ctx.strokeStyle=colorMix(c,.34*(1-t));ctx.lineWidth=1.35;ctx.strokeRect(-r/2,-r/2,r,r);ctx.restore();dirty(x,y,34)}
  function drawSpaceWeatherFx(ctx,x,y,c,t){ctx.save();ctx.strokeStyle=colorMix(c,.22);ctx.lineWidth=1.2;ctx.lineCap='round';for(let i=0;i<3;i++){const rr=14+i*7,shift=(t+i*.19)%1;ctx.beginPath();ctx.arc(x,y,rr,-Math.PI*.92+shift*.7,-Math.PI*.12+shift*.7);ctx.stroke()}ctx.restore();dirty(x,y,42)}
  function drawConflictFx(ctx,e,c,t){const q=fieldFor(e);if(!q)return;const pulse=.97+Math.sin(t*Math.PI*2)*.035;ctx.save();organicPath(ctx,e,q.x,q.y,q.r*pulse,t*Math.PI*.7);ctx.strokeStyle=colorMix(c,.17);ctx.lineWidth=1.25;ctx.stroke();ctx.restore();dirty(q.x,q.y,q.r+14)}
  function hash(str){let h=0;for(let i=0;i<String(str).length;i++)h=((h<<5)-h)+str.charCodeAt(i)|0;return h}
  function bindPointer(){const node=$('worldMap');node.addEventListener('mousemove',ev=>{const h=nearest(ev.clientX,ev.clientY);s.onHover?.(h?.e||null,ev)});node.addEventListener('mouseleave',()=>s.onHover?.(null,null));node.addEventListener('click',ev=>{const h=nearest(ev.clientX,ev.clientY);if(h)s.onSelect?.(h.e)})}
  function nearest(x,y){let best=null,bd=Infinity;for(const h of s.hit){const d=(h.x-x)**2+(h.y-y)**2;if(d<h.r*h.r&&d<bd){best=h;bd=d}}return best}
  const api={init,setData,setTheme,focus,focusView,resetWorld,setPlace,resize,getVisible:()=>s.visible,getTransform:()=>s.transform,stopEffects};
  window.WatchtowerMap=api;
})();
