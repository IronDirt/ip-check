/* =====================================================================
   IP Check – app.js
   Features: My IP, Ping, DNS Lookup  |  Dark/Light  |  IT/EN i18n
   ===================================================================== */

'use strict';

/* ── i18n strings ──────────────────────────────────────────────────── */

const I18N = {
  it: {
    nav: { myip: 'Il Mio IP', ping: 'Ping', dns: 'DNS Lookup' },
    myip: {
      heading: 'Il Mio Indirizzo IP',
      subtitle: 'Le tue informazioni di rete attuali',
      ipv4: 'Indirizzo IPv4', ipv6: 'Indirizzo IPv6',
      location: 'La Tua Posizione', locationDetails: 'Dettagli Posizione',
      isp: 'Provider Internet', timezone: 'Fuso Orario',
      country: 'Paese', city: 'Città', region: 'Regione',
      zip: 'CAP', as: 'Numero AS',
      copy: 'Copia', copied: 'Copiato!',
      loading: 'Caricamento...', notAvailable: 'Non disponibile',
      refreshBtn: 'Aggiorna'
    },
    ping: {
      heading: 'Strumento Ping',
      subtitle: 'Verifica la connettività verso qualsiasi indirizzo IP',
      placeholder: 'Inserisci indirizzo IP (es. 8.8.8.8)',
      pingBtn: 'Avvia Ping',
      results: 'Risultati Ping', summary: 'Sommario', location: 'Posizione Destinazione',
      transmitted: 'Trasmessi', received: 'Ricevuti', lost: 'Persi',
      packetLoss: 'Perdita Pacchetti', minTime: 'Minimo', avgTime: 'Medio', maxTime: 'Massimo',
      seq: 'N°', status: 'Stato', time: 'Tempo', ttl: 'TTL', bytes: 'Byte',
      online: 'Online', offline: 'Offline',
      timeout: 'Timeout', reply: 'Risposta', unreachable: 'Non Raggiungibile',
      invalidIP: 'Inserisci un indirizzo IP valido',
      pinging: 'Ping in corso…'
    },
    dns: {
      heading: 'DNS Lookup', subtitle: 'Interroga i record DNS per qualsiasi dominio',
      placeholder: 'Inserisci dominio (es. google.com)',
      typeLabel: 'Tipo Record', lookupBtn: 'Cerca',
      results: 'Record DNS', type: 'Tipo', name: 'Nome / Valore', ttl: 'TTL',
      priority: 'Priorità', noRecords: 'Nessun record trovato',
      invalidDomain: 'Inserisci un dominio valido', loading: 'Ricerca in corso…'
    },
    footer: { madeWith: 'Fatto con' }
  },
  en: {
    nav: { myip: 'My IP', ping: 'Ping', dns: 'DNS Lookup' },
    myip: {
      heading: 'My IP Address',
      subtitle: 'Your current network information',
      ipv4: 'IPv4 Address', ipv6: 'IPv6 Address',
      location: 'Your Location', locationDetails: 'Location Details',
      isp: 'Internet Service Provider', timezone: 'Timezone',
      country: 'Country', city: 'City', region: 'Region',
      zip: 'ZIP Code', as: 'AS Number',
      copy: 'Copy', copied: 'Copied!',
      loading: 'Loading…', notAvailable: 'Not available',
      refreshBtn: 'Refresh'
    },
    ping: {
      heading: 'Ping Tool',
      subtitle: 'Test connectivity to any IP address',
      placeholder: 'Enter IP address (e.g. 8.8.8.8)',
      pingBtn: 'Start Ping',
      results: 'Ping Results', summary: 'Summary', location: 'Target Location',
      transmitted: 'Transmitted', received: 'Received', lost: 'Lost',
      packetLoss: 'Packet Loss', minTime: 'Min', avgTime: 'Avg', maxTime: 'Max',
      seq: '#', status: 'Status', time: 'Time', ttl: 'TTL', bytes: 'Bytes',
      online: 'Online', offline: 'Offline',
      timeout: 'Timeout', reply: 'Reply', unreachable: 'Unreachable',
      invalidIP: 'Please enter a valid IP address',
      pinging: 'Pinging…'
    },
    dns: {
      heading: 'DNS Lookup', subtitle: 'Query DNS records for any domain',
      placeholder: 'Enter domain (e.g. google.com)',
      typeLabel: 'Record Type', lookupBtn: 'Lookup',
      results: 'DNS Records', type: 'Type', name: 'Name / Value', ttl: 'TTL',
      priority: 'Priority', noRecords: 'No records found',
      invalidDomain: 'Please enter a valid domain', loading: 'Looking up…'
    },
    footer: { madeWith: 'Made with' }
  }
};

/* ── State ──────────────────────────────────────────────────────────── */

let currentLang = localStorage.getItem('ipcheck-lang') || 'it';
let currentTheme = localStorage.getItem('ipcheck-theme') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let myipMap = null;
let pingMap = null;
// Keep marker references so we can remove them without fragile instanceof checks
let myipMarker = null;
let pingMarker = null;
let myIPv4 = null;
let myIPv6 = null;

/* ── Translation helper ─────────────────────────────────────────────── */

function t(keyPath) {
  const keys = keyPath.split('.');
  let obj = I18N[currentLang];
  for (const k of keys) { obj = obj && obj[k]; }
  return obj || keyPath;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.getElementById('lang-label').textContent = currentLang.toUpperCase();
  document.documentElement.lang = currentLang;
}

/* ── Theme ──────────────────────────────────────────────────────────── */

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  const icon = document.getElementById('theme-icon');
  icon.className = currentTheme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  // Refresh Leaflet maps to redraw tiles
  if (myipMap) { myipMap.invalidateSize(); }
  if (pingMap) { pingMap.invalidateSize(); }
}

/* ── Toast ──────────────────────────────────────────────────────────── */

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

/* ── Copy to clipboard ──────────────────────────────────────────────── */

async function copyText(text) {
  if (!text || text === t('myip.notAvailable')) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('✅ ' + t('myip.copied') + ' ' + text);
  } catch (_) {
    showToast('❌ Copy failed');
  }
}

/* ── Leaflet map helper ─────────────────────────────────────────────── */

function initOrUpdateMap(mapId, existingMap, existingMarkerRef, lat, lon, popupHtml) {
  if (existingMap) {
    existingMap.setView([lat, lon], 10);
    // Remove old marker via stored reference (avoids fragile instanceof check)
    if (existingMarkerRef) {
      existingMap.removeLayer(existingMarkerRef);
    }
    const marker = L.marker([lat, lon]).addTo(existingMap).bindPopup(popupHtml).openPopup();
    existingMap.invalidateSize();
    return { map: existingMap, marker };
  }
  const map = L.map(mapId, { zoomControl: true, scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);
  map.setView([lat, lon], 10);
  const marker = L.marker([lat, lon]).addTo(map).bindPopup(popupHtml).openPopup();
  return { map, marker };
}

/* ── Location details renderer ──────────────────────────────────────── */

function renderLocationDetails(containerId, geo) {
  const c = document.getElementById(containerId);
  if (!geo || geo.status === 'fail') {
    c.innerHTML = `<p style="color:var(--text-muted);font-size:.9rem">${t('myip.notAvailable')}</p>`;
    return;
  }
  const rows = [
    { icon: 'fa-flag',          label: t('myip.country'),  value: `${geo.country || '—'} (${geo.countryCode || ''})` },
    { icon: 'fa-city',          label: t('myip.city'),     value: geo.city || '—' },
    { icon: 'fa-map',           label: t('myip.region'),   value: geo.regionName || '—' },
    { icon: 'fa-envelope',      label: t('myip.zip'),      value: geo.zip || '—' },
    { icon: 'fa-clock',         label: t('myip.timezone'), value: geo.timezone || '—' },
    { icon: 'fa-building',      label: t('myip.isp'),      value: geo.isp || '—' },
    { icon: 'fa-network-wired', label: t('myip.as'),       value: geo.as || '—' }
  ];
  c.innerHTML = rows.map(r => `
    <div class="location-row">
      <div class="location-row-icon"><i class="fa-solid ${r.icon}"></i></div>
      <div class="location-row-body">
        <div class="location-row-label">${r.label}</div>
        <div class="location-row-value">${escHtml(r.value)}</div>
      </div>
    </div>`).join('');
}

/* ── Fetch helper ───────────────────────────────────────────────────── */

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

/* ── HTML escape ────────────────────────────────────────────────────── */

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════════════════════════════
   MY IP
   ══════════════════════════════════════════════════════════════════════ */

async function loadMyIP() {
  // Reset UI
  document.getElementById('ipv4-value').innerHTML = '<span class="skeleton-text"></span>';
  document.getElementById('ipv6-value').innerHTML = '<span class="skeleton-text"></span>';
  document.getElementById('myip-location-details').innerHTML =
    '<div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div>';

  // Fetch IPv4 (ipify returns IPv4 by default)
  let ipv4 = null;
  try {
    const r4 = await fetchJSON('https://api.ipify.org?format=json');
    ipv4 = r4.ip;
    myIPv4 = ipv4;
    document.getElementById('ipv4-value').textContent = ipv4;
  } catch (_) {
    document.getElementById('ipv4-value').textContent = t('myip.notAvailable');
  }

  // Fetch IPv6 (api64.ipify.org returns IPv6 when available)
  try {
    const r6 = await fetchJSON('https://api64.ipify.org?format=json');
    const ip6 = r6.ip;
    // Only show as IPv6 if it contains ':'
    if (ip6 && ip6.includes(':')) {
      myIPv6 = ip6;
      document.getElementById('ipv6-value').textContent = ip6;
    } else {
      document.getElementById('ipv6-value').textContent = t('myip.notAvailable');
    }
  } catch (_) {
    document.getElementById('ipv6-value').textContent = t('myip.notAvailable');
  }

  // Geo-locate the IPv4 (or fall back to server-detected IP)
  const geoTarget = ipv4 || 'me';
  try {
    const geo = await fetchJSON(`/api/geoip/${encodeURIComponent(geoTarget)}`);
    renderLocationDetails('myip-location-details', geo);
    if (geo.lat && geo.lon) {
      const popup = `<b>${escHtml(geo.city || '')}, ${escHtml(geo.country || '')}</b>`;
      const result = initOrUpdateMap('myip-map', myipMap, myipMarker, geo.lat, geo.lon, popup);
      myipMap = result.map;
      myipMarker = result.marker;
    }
  } catch (_) {
    document.getElementById('myip-location-details').innerHTML =
      `<p style="color:var(--text-muted);font-size:.9rem">${t('myip.notAvailable')}</p>`;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   PING
   ══════════════════════════════════════════════════════════════════════ */

function validateIP(ip) {
  // Basic client-side format check — the server performs full validation.
  const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
  // Accept any string that looks like an IPv6 address (colons + hex)
  const ipv6Re = /^[0-9a-fA-F:]+$/;
  if (ipv4Re.test(ip)) {
    return ip.split('.').every(p => Number(p) <= 255);
  }
  return ip.includes(':') && ipv6Re.test(ip);
}

function statusBadge(status) {
  const map = {
    reply:       ['badge-green', 'dot-green', ''],
    timeout:     ['badge-amber', 'dot-amber', ''],
    unreachable: ['badge-red',   'dot-red',   '']
  };
  const [cls, dot] = map[status] || ['badge-amber', 'dot-amber'];
  const label = t(`ping.${status}`) || status;
  return `<span class="badge ${cls}"><span class="status-dot ${dot}"></span>${escHtml(label)}</span>`;
}

async function doPing(ip) {
  const btn = document.getElementById('ping-btn');
  const errEl = document.getElementById('ping-error');
  errEl.hidden = true;

  if (!ip) {
    errEl.textContent = '⚠ ' + t('ping.invalidIP');
    errEl.hidden = false; return;
  }
  if (!validateIP(ip)) {
    errEl.textContent = '⚠ ' + t('ping.invalidIP');
    errEl.hidden = false; return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner spinner"></i> ${escHtml(t('ping.pinging'))}`;

  document.getElementById('ping-results-section').hidden = false;
  document.getElementById('ping-geo-section').hidden = true;

  const tbody = document.getElementById('ping-tbody');
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">
    <i class="fa-solid fa-spinner spinner"></i> ${escHtml(t('ping.pinging'))}</td></tr>`;
  document.getElementById('ping-stats').innerHTML = '';

  let data;
  try {
    data = await fetchJSON('/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });
  } catch (err) {
    errEl.textContent = '❌ ' + err.message;
    errEl.hidden = false;
    tbody.innerHTML = '';
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> ${escHtml(t('ping.pingBtn'))}`;
    return;
  }

  // Determine max time for bar scaling
  const times = (data.parsed.packets || []).filter(p => p.time).map(p => p.time);
  const maxT = times.length ? Math.max(...times) : 1;

  // Render packets table
  tbody.innerHTML = '';
  if (!data.parsed.packets || data.parsed.packets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">${escHtml(t('ping.offline'))}</td></tr>`;
  } else {
    for (const pkt of data.parsed.packets) {
      const timeHtml = pkt.time !== undefined
        ? `<div class="time-bar-wrap">
            <span class="time-val mono">${pkt.time.toFixed(1)} ms</span>
            <div class="time-bar-bg"><div class="time-bar-fill" style="width:${Math.min(100,(pkt.time/maxT)*100).toFixed(1)}%"></div></div>
           </div>`
        : '—';
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="mono">${pkt.seq}</td>
        <td>${statusBadge(pkt.status)}</td>
        <td>${timeHtml}</td>
        <td class="mono">${pkt.ttl ?? '—'}</td>
        <td class="mono">${pkt.bytes ?? '—'}</td>`;
      tbody.appendChild(row);
    }
  }

  // Ping status badge in card title
  const statusBadgeEl = document.getElementById('ping-status-badge');
  if (data.success) {
    statusBadgeEl.className = 'badge badge-green';
    statusBadgeEl.innerHTML = `<span class="status-dot dot-green"></span> ${t('ping.online')}`;
  } else {
    statusBadgeEl.className = 'badge badge-red';
    statusBadgeEl.innerHTML = `<span class="status-dot dot-red"></span> ${t('ping.offline')}`;
  }

  // Stats
  const statsEl = document.getElementById('ping-stats');
  statsEl.innerHTML = '';
  if (data.parsed.stats) {
    const s = data.parsed.stats;
    const loss = s.packetLoss;
    const lossClass = loss === 0 ? 'green' : loss < 50 ? 'amber' : 'red';
    const addStat = (label, value, cls = '') => {
      statsEl.innerHTML += `<div class="stat-item">
        <div class="stat-label">${escHtml(label)}</div>
        <div class="stat-value ${cls}">${escHtml(String(value))}</div>
      </div>`;
    };
    addStat(t('ping.transmitted'), s.transmitted, 'blue');
    addStat(t('ping.received'), s.received, 'green');
    addStat(t('ping.lost'), s.transmitted - s.received, s.transmitted - s.received > 0 ? 'red' : 'green');
    addStat(t('ping.packetLoss'), loss + '%', lossClass);
    if (data.parsed.rtt) {
      const r = data.parsed.rtt;
      addStat(t('ping.minTime'), r.min.toFixed(2) + ' ms', 'blue');
      addStat(t('ping.avgTime'), r.avg.toFixed(2) + ' ms', 'blue');
      addStat(t('ping.maxTime'), r.max.toFixed(2) + ' ms', 'blue');
    }
  } else {
    statsEl.innerHTML = `<p style="color:var(--text-muted);font-size:.85rem">${data.success ? '' : t('ping.offline')}</p>`;
  }

  // Geo-locate pinged IP
  if (data.success) {
    try {
      const geo = await fetchJSON(`/api/geoip/${encodeURIComponent(ip)}`);
      if (geo && geo.status !== 'fail') {
        document.getElementById('ping-geo-section').hidden = false;
        renderLocationDetails('ping-location-details', geo);
        if (geo.lat && geo.lon) {
          const popup = `<b>${escHtml(ip)}</b><br>${escHtml(geo.city || '')}, ${escHtml(geo.country || '')}`;
          const result = initOrUpdateMap('ping-map', pingMap, pingMarker, geo.lat, geo.lon, popup);
          pingMap = result.map;
          pingMarker = result.marker;
        }
      }
    } catch (_) { /* no geo, that's fine */ }
  }

  btn.disabled = false;
  btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> <span data-i18n="ping.pingBtn">${escHtml(t('ping.pingBtn'))}</span>`;
}

/* ══════════════════════════════════════════════════════════════════════
   DNS LOOKUP
   ══════════════════════════════════════════════════════════════════════ */

function validateDomain(domain) {
  return /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(domain);
}

function recordTypeClass(type) {
  const map = { A:'rt-A', AAAA:'rt-AAAA', MX:'rt-MX', NS:'rt-NS', TXT:'rt-TXT', CNAME:'rt-CNAME', SOA:'rt-SOA' };
  return map[type] || 'rt-A';
}

async function doDNSLookup(domain, type) {
  const btn = document.getElementById('dns-btn');
  const errEl = document.getElementById('dns-error');
  errEl.hidden = true;

  if (!domain) {
    errEl.textContent = '⚠ ' + t('dns.invalidDomain');
    errEl.hidden = false; return;
  }
  if (!validateDomain(domain)) {
    errEl.textContent = '⚠ ' + t('dns.invalidDomain');
    errEl.hidden = false; return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner spinner"></i> ${escHtml(t('dns.loading'))}`;

  document.getElementById('dns-results-section').hidden = false;
  const tbody = document.getElementById('dns-tbody');
  const thead = document.getElementById('dns-thead');
  tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">
    <i class="fa-solid fa-spinner spinner"></i> ${escHtml(t('dns.loading'))}</td></tr>`;
  document.getElementById('dns-domain-badge').textContent = domain + ' · ' + type;

  let data;
  try {
    data = await fetchJSON(`/api/dns?domain=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`);
  } catch (err) {
    errEl.textContent = '❌ ' + err.message;
    errEl.hidden = false;
    tbody.innerHTML = '';
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-search"></i> <span data-i18n="dns.lookupBtn">${escHtml(t('dns.lookupBtn'))}</span>`;
    return;
  }

  // Build table based on type
  const typeBadge = `<span class="record-type-badge ${recordTypeClass(type)}">${escHtml(type)}</span>`;
  let headHtml, rows;

  if (type === 'A' || type === 'AAAA') {
    headHtml = `<tr><th data-i18n="dns.type">${t('dns.type')}</th><th data-i18n="dns.name">${t('dns.name')}</th><th data-i18n="dns.ttl">${t('dns.ttl')}</th></tr>`;
    rows = (data.records || []).map(r =>
      `<tr><td>${typeBadge}</td><td class="mono">${escHtml(r.address ?? r)}</td><td class="mono">${r.ttl ?? '—'}</td></tr>`
    );
  } else if (type === 'MX') {
    headHtml = `<tr><th data-i18n="dns.type">${t('dns.type')}</th><th data-i18n="dns.priority">${t('dns.priority')}</th><th data-i18n="dns.name">${t('dns.name')}</th></tr>`;
    rows = (data.records || []).map(r =>
      `<tr><td>${typeBadge}</td><td class="mono">${escHtml(String(r.priority ?? '—'))}</td><td class="mono">${escHtml(r.exchange ?? r)}</td></tr>`
    );
  } else if (type === 'SOA') {
    headHtml = `<tr><th data-i18n="dns.type">${t('dns.type')}</th><th colspan="2" data-i18n="dns.name">${t('dns.name')}</th></tr>`;
    rows = (data.records || []).map(r => {
      const val = typeof r === 'object'
        ? Object.entries(r).map(([k, v]) => `<b>${escHtml(k)}</b>: ${escHtml(String(v))}`).join(' · ')
        : escHtml(String(r));
      return `<tr><td>${typeBadge}</td><td colspan="2" class="mono" style="font-size:.8rem;word-break:break-all">${val}</td></tr>`;
    });
  } else {
    headHtml = `<tr><th data-i18n="dns.type">${t('dns.type')}</th><th colspan="2" data-i18n="dns.name">${t('dns.name')}</th></tr>`;
    rows = (data.records || []).map(r =>
      `<tr><td>${typeBadge}</td><td colspan="2" class="mono" style="word-break:break-all">${escHtml(typeof r === 'object' ? JSON.stringify(r) : String(r))}</td></tr>`
    );
  }

  thead.innerHTML = headHtml;
  tbody.innerHTML = rows.length
    ? rows.join('')
    : `<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">${t('dns.noRecords')}</td></tr>`;

  btn.disabled = false;
  btn.innerHTML = `<i class="fa-solid fa-search"></i> <span data-i18n="dns.lookupBtn">${escHtml(t('dns.lookupBtn'))}</span>`;
}

/* ══════════════════════════════════════════════════════════════════════
   TAB SWITCHING
   ══════════════════════════════════════════════════════════════════════ */

function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
    b.setAttribute('aria-selected', b.dataset.tab === tabId ? 'true' : 'false');
  });
  const pane = document.getElementById('tab-' + tabId);
  if (pane) {
    pane.classList.add('active');
    // Lazy-init map after element is visible
    if (tabId === 'myip') {
      requestAnimationFrame(() => { if (myipMap) myipMap.invalidateSize(); });
    }
    if (tabId === 'ping') {
      requestAnimationFrame(() => { if (pingMap) pingMap.invalidateSize(); });
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════════════ */

function init() {
  // Apply saved preferences
  applyTheme();
  applyTranslations();

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ipcheck-theme', currentTheme);
    applyTheme();
  });

  // Language toggle
  document.getElementById('lang-toggle').addEventListener('click', () => {
    currentLang = currentLang === 'it' ? 'en' : 'it';
    localStorage.setItem('ipcheck-lang', currentLang);
    applyTranslations();
  });

  // Refresh My IP
  document.getElementById('refresh-myip').addEventListener('click', loadMyIP);

  // Copy buttons
  document.getElementById('copy-ipv4').addEventListener('click', () => {
    copyText(document.getElementById('ipv4-value').textContent);
  });
  document.getElementById('copy-ipv6').addEventListener('click', () => {
    copyText(document.getElementById('ipv6-value').textContent);
  });

  // Ping
  const pingBtn = document.getElementById('ping-btn');
  const pingInput = document.getElementById('ping-input');
  pingBtn.addEventListener('click', () => doPing(pingInput.value.trim()));
  pingInput.addEventListener('keydown', e => { if (e.key === 'Enter') doPing(pingInput.value.trim()); });

  // DNS
  const dnsBtn = document.getElementById('dns-btn');
  const dnsInput = document.getElementById('dns-input');
  const dnsType = document.getElementById('dns-type');
  dnsBtn.addEventListener('click', () => doDNSLookup(dnsInput.value.trim(), dnsType.value));
  dnsInput.addEventListener('keydown', e => { if (e.key === 'Enter') doDNSLookup(dnsInput.value.trim(), dnsType.value); });

  // Load My IP on startup
  loadMyIP();
}

document.addEventListener('DOMContentLoaded', init);
