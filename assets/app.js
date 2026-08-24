(() => {
  'use strict';

  const state = {
    raw: null,
    events: [],
    hours: 168,
    query: '',
    activeCats: new Set(),
    map: null,
    markers: [],
    selectedId: null,
    usingFallback: false,
  };

  const CATEGORY_META = {
    earthquake: { label: 'Earthquakes', color: '#e0b85b' },
    wildfire:   { label: 'Wildfires', color: '#e36f68' },
    storm:      { label: 'Severe Storms', color: '#7fc3dc' },
    weather:    { label: 'Weather Alerts', color: '#7fc3dc' },
    volcano:    { label: 'Volcanoes', color: '#d9876e' },
    flood:      { label: 'Flooding', color: '#76aede' },
    security:   { label: 'Security News', color: '#a89ce8' },
    incident:   { label: 'Incidents', color: '#d99ca7' },
    landslide:  { label: 'Landslides', color: '#b6a178' },
    ice:        { label: 'Ice', color: '#a7d8e6' },
    drought:    { label: 'Drought', color: '#c8b16d' },
    atmosphere: { label: 'Atmosphere', color: '#92b9b2' },
    snow:       { label: 'Snow', color: '#d8e7ea' },
    temperature:{ label: 'Temperature', color: '#d79a71' },
    water:      { label: 'Water', color: '#7fb9d3' },
    natural:    { label: 'Natural Events', color: '#86bd8f' },
  };

  const FALLBACK = {
    sample: true,
    generated_at: new Date().toISOString(),
    version: '0.1.0-demo',
    sources: [
      { name: 'USGS', ok: false, count: 0 },
      { name: 'NASA EONET', ok: false, count: 0 },
      { name: 'NOAA / NWS', ok: false, count: 0 },
      { name: 'GDELT', ok: false, count: 0 },
    ],
    events: [
      { id:'demo-1', title:'Demo seismic event', category:'earthquake', severity:4, lat:35.7, lon:139.7, updated:new Date(Date.now()-42*60000).toISOString(), source:'DEMO DATA', summary:'Live collector unavailable. This marker demonstrates WATCHTOWER event styling.', region:'Japan', kind:'event' },
      { id:'demo-2', title:'Demo wildfire perimeter', category:'wildfire', severity:3, lat:38.6, lon:-121.4, updated:new Date(Date.now()-2.2*3600000).toISOString(), source:'DEMO DATA', summary:'Live collector unavailable. This marker demonstrates WATCHTOWER event styling.', region:'California, USA', kind:'event' },
      { id:'demo-3', title:'Demo severe weather alert', category:'weather', severity:4, lat:35.4, lon:-97.5, updated:new Date(Date.now()-4.5*3600000).toISOString(), source:'DEMO DATA', summary:'Live collector unavailable. This marker demonstrates WATCHTOWER event styling.', region:'Oklahoma, USA', kind:'alert' },
      { id:'demo-4', title:'Demo security reporting item', category:'security', severity:2, lat:null, lon:null, updated:new Date(Date.now()-1.1*3600000).toISOString(), source:'DEMO DATA', summary:'News-layer demo. Reporting is not the same as independently verified event data.', region:'Global', kind:'report' },
    ]
  };

  const $ = (id) => document.getElementById(id);

  function parseTime(value) {
    if (!value) return 0;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }

  function relTime(value) {
    const t = parseTime(value);
    if (!t) return 'TIME N/A';
    const sec = Math.max(0, (Date.now() - t) / 1000);
    if (sec < 60) return `${Math.floor(sec)}s ago`;
    if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
    return `${Math.floor(sec/86400)}d ago`;
  }

  function formatUtc(value) {
    const t = parseTime(value);
    if (!t) return 'Unknown time';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit', hour12:false
    }).format(new Date(t)) + ' UTC';
  }

  function escapeHtml(value='') {
    return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function catMeta(cat) {
    return CATEGORY_META[cat] || { label: String(cat || 'Other'), color: '#91a8ac' };
  }

  function severityLabel(n) {
    return n >= 5 ? 'CRITICAL' : n >= 4 ? 'HIGH' : n >= 3 ? 'ELEVATED' : n >= 2 ? 'WATCH' : 'LOW';
  }

  function filteredEvents() {
    const cutoff = Date.now() - state.hours * 3600000;
    const q = state.query.trim().toLowerCase();
    return state.events.filter(e => {
      if (!state.activeCats.has(e.category)) return false;
      const t = parseTime(e.updated);
      if (t && t < cutoff) return false;
      if (q) {
        const blob = [e.title,e.summary,e.region,e.source,e.category].join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }

  function initMap() {
    if (!window.L) {
      $('map').innerHTML = '<div class="empty-state">Map library could not load. Event stream remains available.</div>';
      return;
    }
    state.map = L.map('map', { zoomControl: true, worldCopyJump: true, minZoom: 2 }).setView([24, 8], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd', maxZoom: 19
    }).addTo(state.map);
  }

  function markerIcon(e) {
    const meta = catMeta(e.category);
    const high = Number(e.severity) >= 4 ? 'high' : '';
    return L.divIcon({
      className: 'event-marker',
      html: `<div class="marker-core ${high}" style="color:${meta.color};background:${meta.color}"></div>`,
      iconSize: [14,14], iconAnchor:[7,7]
    });
  }

  function renderMap(events) {
    if (!state.map) return;
    state.markers.forEach(m => m.remove());
    state.markers = [];
    events.filter(e => Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lon))).slice(0, 320).forEach(e => {
      const marker = L.marker([Number(e.lat), Number(e.lon)], { icon: markerIcon(e), keyboard: true, title: e.title }).addTo(state.map);
      marker.on('click', () => selectEvent(e.id, true));
      state.markers.push(marker);
    });
  }

  function renderLayers() {
    const counts = {};
    state.events.forEach(e => counts[e.category] = (counts[e.category] || 0) + 1);
    const cats = Object.keys(counts).sort((a,b) => counts[b]-counts[a]);
    if (!state.activeCats.size) cats.forEach(c => state.activeCats.add(c));
    $('layerList').innerHTML = cats.map(cat => {
      const m = catMeta(cat), active = state.activeCats.has(cat);
      return `<button class="layer-row ${active?'active':''}" type="button" data-cat="${escapeHtml(cat)}" aria-pressed="${active}">
        <span class="swatch" style="background:${m.color};color:${m.color}"></span>
        <span class="layer-name">${escapeHtml(m.label)}</span>
        <span class="layer-count">${counts[cat]}</span>
      </button>`;
    }).join('');
    $('layerCount').textContent = `${state.activeCats.size} active`;
    $('layerList').querySelectorAll('[data-cat]').forEach(btn => btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      state.activeCats.has(cat) ? state.activeCats.delete(cat) : state.activeCats.add(cat);
      renderLayers(); renderAll();
    }));
  }

  function renderFeed(events) {
    const feed = $('eventFeed');
    const shown = events.slice(0, 100);
    $('feedCount').textContent = `${shown.length} shown`;
    if (!shown.length) {
      feed.innerHTML = '<div class="empty-state">No signals match this view.<br>Expand the time window or reset filters.</div>';
      return;
    }
    feed.innerHTML = shown.map(e => {
      const meta = catMeta(e.category);
      const region = e.region ? ` · ${escapeHtml(e.region)}` : '';
      return `<button class="feed-item ${state.selectedId===e.id?'selected':''}" type="button" data-id="${escapeHtml(e.id)}">
        <span class="severity-bar s${Number(e.severity)||1}"></span>
        <span>
          <span class="feed-topline"><span class="feed-cat" style="color:${meta.color}">${escapeHtml(meta.label)}</span><span class="feed-time">${escapeHtml(relTime(e.updated))}</span></span>
          <span class="feed-title">${escapeHtml(e.title)}</span>
          <span class="feed-meta">${escapeHtml(e.source || 'Unknown source')}${region}</span>
        </span>
      </button>`;
    }).join('');
    feed.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => selectEvent(b.dataset.id, true)));
  }

  function renderSources() {
    const sources = state.raw?.sources || [];
    const good = sources.filter(s => s.ok).length;
    $('sourceCount').textContent = `${good}/${sources.length}`;
    $('sourceFoot').textContent = sources.length ? `${sources.reduce((a,s)=>a+(s.count||0),0)} records collected` : 'no collector status';
    $('sourceGrid').innerHTML = sources.map(s => `<div class="source-item">
      <div class="source-name">${escapeHtml(s.name)}</div>
      <div class="source-status ${s.ok?'':'bad'}"><i></i>${s.ok?'ONLINE':'DEGRADED'}</div>
      <div class="source-count">${s.ok ? `${s.count || 0} normalized records` : escapeHtml(s.error || 'No live response')}</div>
    </div>`).join('') || '<div class="empty-state">No source status available.</div>';
    $('liveChip').classList.toggle('degraded', good !== sources.length || state.usingFallback);
    $('liveLabel').textContent = state.usingFallback ? 'DEMO MODE' : (good === sources.length ? 'LIVE FEEDS' : 'PARTIAL FEEDS');
  }

  function renderPriority(events) {
    const priority = [...events].sort((a,b) => (Number(b.severity)-Number(a.severity)) || (parseTime(b.updated)-parseTime(a.updated))).slice(0,4);
    $('priorityQueue').innerHTML = priority.length ? priority.map((e,i) => `<button type="button" class="priority-item" data-id="${escapeHtml(e.id)}">
      <span class="priority-rank">0${i+1}</span><span><span class="priority-title">${escapeHtml(e.title)}</span><span class="priority-meta">${escapeHtml(severityLabel(Number(e.severity)))} · ${escapeHtml(relTime(e.updated))}</span></span>
    </button>`).join('') : '<div class="empty-state">No priority signals in this window.</div>';
    $('priorityQueue').querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => selectEvent(b.dataset.id, true)));
  }

  function renderPosture(events) {
    if (!events.length) {
      $('postureScore').textContent = '--'; $('postureLabel').textContent = 'QUIET'; $('postureText').textContent = 'No signals in the selected view.'; return;
    }
    const weighted = events.reduce((sum,e) => sum + Math.pow(Number(e.severity)||1, 2), 0);
    const high = events.filter(e => Number(e.severity)>=4).length;
    const score = Math.min(99, Math.round(Math.log10(weighted + 10) * 26 + high * 2));
    const label = score >= 80 ? 'HIGH ACTIVITY' : score >= 62 ? 'ELEVATED' : score >= 42 ? 'ACTIVE' : 'NOMINAL';
    $('postureScore').textContent = score;
    $('postureLabel').textContent = label;
    $('postureText').textContent = `${events.length} visible signals; ${high} high-priority.`;
  }

  function renderMetrics(events) {
    $('visibleCount').textContent = events.length.toLocaleString();
    $('highCount').textContent = events.filter(e => Number(e.severity)>=4).length.toLocaleString();
    $('timeWindowLabel').textContent = state.hours < 24 ? `within ${state.hours} hours` : `within ${Math.round(state.hours/24)} days`;
    const gen = state.raw?.generated_at;
    $('refreshAge').textContent = gen ? relTime(gen).toUpperCase() : '--';
    $('refreshTime').textContent = gen ? formatUtc(gen) : 'unknown collector time';
  }

  function renderAll() {
    const events = filteredEvents();
    renderMetrics(events);
    renderMap(events);
    renderFeed(events);
    renderPriority(events);
    renderPosture(events);
  }

  function selectEvent(id, pan=false) {
    const e = state.events.find(x => x.id === id);
    if (!e) return;
    state.selectedId = id;
    const meta = catMeta(e.category);
    $('drawerKicker').textContent = `${meta.label.toUpperCase()} // ${severityLabel(Number(e.severity))}`;
    $('drawerTitle').textContent = e.title || 'Untitled event';
    $('drawerMeta').innerHTML = `${escapeHtml(e.source || 'Unknown source')}<br>${escapeHtml(formatUtc(e.updated))}${e.region?`<br>${escapeHtml(e.region)}`:''}`;
    $('drawerSummary').textContent = e.summary || 'No additional summary supplied by the normalized source.';
    const link = $('drawerLink');
    if (e.url) { link.href = e.url; link.style.display = 'inline-flex'; } else { link.style.display = 'none'; }
    $('detailDrawer').classList.add('open'); $('detailDrawer').setAttribute('aria-hidden','false');
    if (pan && state.map && Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lon))) state.map.flyTo([Number(e.lat), Number(e.lon)], Math.max(state.map.getZoom(), 5), { duration: .7 });
    renderFeed(filteredEvents());
  }

  function closeDrawer() {
    state.selectedId = null; $('detailDrawer').classList.remove('open'); $('detailDrawer').setAttribute('aria-hidden','true'); renderFeed(filteredEvents());
  }

  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(()=>el.classList.remove('show'), 2200);
  }

  async function loadData(force=false) {
    $('refreshBtn').disabled = true;
    try {
      const suffix = force ? `?t=${Date.now()}` : '';
      const r = await fetch(`./data/events.json${suffix}`, { cache: force ? 'no-store' : 'default' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      state.raw = await r.json();
      state.events = Array.isArray(state.raw.events) ? state.raw.events : [];
      state.usingFallback = !!state.raw.sample;
    } catch (err) {
      state.raw = FALLBACK; state.events = FALLBACK.events; state.usingFallback = true;
      toast('Live data unavailable — demo data loaded');
    } finally {
      $('refreshBtn').disabled = false;
    }
    state.activeCats.clear();
    state.events.forEach(e => state.activeCats.add(e.category));
    renderLayers(); renderSources(); renderAll();
    if (force) toast(state.usingFallback ? 'Demo data refreshed' : 'Event stream refreshed');
  }

  function bindControls() {
    $('refreshBtn').addEventListener('click', () => loadData(true));
    $('drawerClose').addEventListener('click', closeDrawer);
    $('searchInput').addEventListener('input', e => { state.query = e.target.value; renderAll(); });
    $('resetBtn').addEventListener('click', () => {
      state.query = ''; $('searchInput').value = ''; state.hours = 168;
      document.querySelectorAll('#timeFilters button').forEach(b => b.classList.toggle('active', b.dataset.hours === '168'));
      state.activeCats.clear(); state.events.forEach(e => state.activeCats.add(e.category)); renderLayers(); renderAll();
      if (state.map) state.map.setView([24,8],2); closeDrawer();
    });
    document.querySelectorAll('#timeFilters button').forEach(btn => btn.addEventListener('click', () => {
      state.hours = Number(btn.dataset.hours) || 168;
      document.querySelectorAll('#timeFilters button').forEach(b => b.classList.toggle('active', b === btn));
      renderAll();
    }));
    document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b === btn));
      if (!state.map) return;
      if (btn.dataset.view === 'conus') state.map.flyTo([39.5,-98.35],4,{duration:.8});
      else state.map.flyTo([24,8],2,{duration:.8});
    }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  }

  function startClock() {
    const tick = () => {
      $('utcClock').textContent = new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
      const gen = state.raw?.generated_at;
      if (gen) $('refreshAge').textContent = relTime(gen).toUpperCase();
    };
    tick(); setInterval(tick, 1000);
  }

  bindControls();
  initMap();
  startClock();
  loadData(false);
})();
