/* ============================================================
   PBC Resource Guide — application logic
   ============================================================ */

const PBC_CENTER = [26.7153, -80.0534]; // roughly central Palm Beach County
const PBC_DEFAULT_ZOOM = 10;

const state = {
  view: 'all',            // 'all' | 'virtual' | 'so'
  activeCategories: new Set(),
  searchText: '',
  emergencyMode: false,
  userLocation: null,     // {lat, lng, label}
  sidebarWidth: 'wide',
};

const markerRegistry = new Map(); // id -> L.marker
let map, clusterGroup, userLocationMarker;
let mapAvailable = false;

/* ---------------- Init ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  try {
    if (typeof L === 'undefined') throw new Error('Leaflet failed to load (no network / CDN blocked)');
    initMap();
    mapAvailable = true;
  } catch (err) {
    console.error('Map initialization failed, continuing in list-only mode:', err);
    showMapUnavailableNotice();
  }
  renderLegend();
  renderChips();
  bindGlobalEvents();
  applyFiltersAndRender();
});

function showMapUnavailableNotice() {
  const mapEl = document.getElementById('map');
  mapEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;text-align:center;padding:40px;">
      <div style="max-width:360px;color:var(--ink-soft);">
        <div style="font-size:40px;margin-bottom:12px;">🗺️</div>
        <h3 style="color:var(--teal-700);margin-bottom:8px;">Map unavailable</h3>
        <p style="font-size:14.5px;">The map tiles couldn't load (no internet connection right now). The resource list on the left still works fully — click any resource for full details.</p>
      </div>
    </div>`;
  document.getElementById('mapLegend').classList.add('hidden');
  document.getElementById('emergencyBanner').classList.add('map-disabled');
}

function initMap() {
  map = L.map('map', { zoomControl: true }).setView(PBC_CENTER, PBC_DEFAULT_ZOOM);

  // Light "Positron" basemap — easy on the eyes, low visual noise
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 48,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div class="cluster-badge">${count}</div>`,
        className: 'pbc-cluster-icon',
        iconSize: [40, 40],
      });
    },
  });
  map.addLayer(clusterGroup);

  // Inject a little extra CSS for the cluster badge (kept here so styles.css
  // stays focused on the app chrome, not Leaflet plugin internals).
  const style = document.createElement('style');
  style.textContent = `
    .cluster-badge {
      background: var(--teal-600); color: #fff; width: 40px; height: 40px;
      border-radius: 50%; display:flex; align-items:center; justify-content:center;
      font-weight: 800; font-size: 14px; border: 3px solid #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .pbc-cluster-icon { background: transparent; border: none; }
  `;
  document.head.appendChild(style);
}

/* ---------------- Legend ---------------- */
function renderLegend() {
  const el = document.getElementById('legendItems');
  const usedCats = new Set();
  PBC_RESOURCES.forEach(r => r.services.forEach(s => usedCats.add(CATS[s] ? s : 'Other')));
  el.innerHTML = [...usedCats].map(cat => `
    <div class="legend-row"><span class="legend-dot" style="background:${catColor(cat)}"></span>${catIcon(cat)} ${CATS[cat].label}</div>
  `).join('');
}

/* ---------------- Category chips ---------------- */
function renderChips() {
  const el = document.getElementById('categoryChips');
  const usedCats = new Set();
  PBC_RESOURCES.forEach(r => r.services.forEach(s => usedCats.add(CATS[s] ? s : 'Other')));

  let html = `<button class="chip all-chip active" data-cat="__all__">All</button>`;
  html += [...usedCats].map(cat => `
    <button class="chip" data-cat="${cat}" style="--cat-color:${catColor(cat)}">${catIcon(cat)} ${CATS[cat].label}</button>
  `).join('');
  el.innerHTML = html;

  el.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat;
      if (cat === '__all__') {
        state.activeCategories.clear();
      } else {
        if (state.activeCategories.has(cat)) state.activeCategories.delete(cat);
        else state.activeCategories.add(cat);
      }
      syncChipUI();
      applyFiltersAndRender();
    });
  });
}

function syncChipUI() {
  document.querySelectorAll('.chip').forEach(chip => {
    const cat = chip.dataset.cat;
    if (cat === '__all__') {
      chip.classList.toggle('active', state.activeCategories.size === 0);
    } else {
      chip.classList.toggle('active', state.activeCategories.has(cat));
    }
  });
}

/* ---------------- Global events ---------------- */
function bindGlobalEvents() {
  document.getElementById('sidebarToggleBtn').addEventListener('click', () => {
    const order = ['wide', 'compact', 'narrow'];
    const next = order[(order.indexOf(state.sidebarWidth) + 1) % order.length];
    state.sidebarWidth = next;
    document.getElementById('sidebar').dataset.width = next;
    setTimeout(() => { if (mapAvailable) map.invalidateSize(); }, 220);
  });

  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (state.emergencyMode) exitEmergencyMode();
      state.view = tab.dataset.view;
      document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.getElementById('categoryChips').classList.remove('chips-collapsed');
      document.getElementById('resourceList').scrollTop = 0;
      applyFiltersAndRender();
    });
  });

  document.getElementById('resourceSearchInput').addEventListener('input', (e) => {
    state.searchText = e.target.value.trim().toLowerCase();
    applyFiltersAndRender();
  });

  document.getElementById('resetViewBtn').addEventListener('click', resetEverything);

  document.getElementById('emergencyFab').addEventListener('click', () => {
    if (state.emergencyMode) exitEmergencyMode();
    else enterEmergencyMode();
  });
  document.getElementById('exitEmergencyBtn').addEventListener('click', exitEmergencyMode);

  document.getElementById('resourceList').addEventListener('scroll', handleResourceListScroll);

  document.getElementById('legendToggleBtn').addEventListener('click', () => {
    const legend = document.getElementById('mapLegend');
    const expanded = legend.classList.toggle('legend-expanded');
    document.getElementById('legendToggleBtn').setAttribute('aria-expanded', expanded);
  });

  document.getElementById('addressSearchBtn').addEventListener('click', doAddressSearch);
  document.getElementById('addressSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAddressSearch();
  });

  document.getElementById('detailCloseBtn').addEventListener('click', closeDetailModal);
  document.getElementById('detailOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'detailOverlay') closeDetailModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetailModal();
  });
}

function handleResourceListScroll(e) {
  const chips = document.getElementById('categoryChips');
  const scrollTop = e.target.scrollTop;
  // Hysteresis (collapse past 32px, re-expand only once back under 8px) avoids flicker
  if (scrollTop > 32) {
    chips.classList.add('chips-collapsed');
  } else if (scrollTop < 8) {
    chips.classList.remove('chips-collapsed');
  }
}

function resetEverything() {
  state.view = 'all';
  state.activeCategories.clear();
  state.searchText = '';
  state.userLocation = null;
  exitEmergencyMode(false);
  document.getElementById('resourceSearchInput').value = '';
  document.getElementById('addressSearchInput').value = '';
  document.getElementById('addressSearchStatus').textContent = '';
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'all'));
  syncChipUI();
  document.getElementById('categoryChips').classList.remove('chips-collapsed');
  document.getElementById('resourceList').scrollTop = 0;
  if (mapAvailable) {
    if (userLocationMarker) { map.removeLayer(userLocationMarker); userLocationMarker = null; }
    map.setView(PBC_CENTER, PBC_DEFAULT_ZOOM);
  }
  applyFiltersAndRender();
}

function enterEmergencyMode() {
  state.emergencyMode = true;
  document.getElementById('emergencyFab').classList.add('active');
  document.getElementById('emergencyBanner').classList.remove('hidden');
  document.getElementById('viewTabs').classList.add('hidden');
  document.getElementById('categoryChips').classList.add('hidden');
  applyFiltersAndRender();
}

function exitEmergencyMode(rerender = true) {
  state.emergencyMode = false;
  document.getElementById('emergencyFab').classList.remove('active');
  document.getElementById('emergencyBanner').classList.add('hidden');
  document.getElementById('viewTabs').classList.remove('hidden');
  document.getElementById('categoryChips').classList.remove('hidden');
  if (rerender) applyFiltersAndRender();
}

/* ---------------- Filtering ---------------- */
function getFilteredResources() {
  let list = PBC_RESOURCES;

  if (state.emergencyMode) {
    list = list.filter(r => r.isEmergency);
  } else if (state.view === 'all') {
    list = list.filter(r => r.hasCoords);
  } else if (state.view === 'virtual') {
    list = list.filter(r => !!r.noAddressReason);
  } else if (state.view === 'so') {
    list = list.filter(r => r.isSO);
  }

  if (state.activeCategories.size > 0) {
    list = list.filter(r => r.services.some(s => state.activeCategories.has(s)));
  }

  if (state.searchText) {
    const q = state.searchText;
    list = list.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.address.toLowerCase().includes(q) ||
      r.services.join(' ').toLowerCase().includes(q)
    );
  }

  if (state.userLocation) {
    list = list.slice().sort((a, b) => {
      const da = a.hasCoords ? haversineMiles(state.userLocation, a) : Infinity;
      const db = b.hasCoords ? haversineMiles(state.userLocation, b) : Infinity;
      return da - db;
    });
  }

  return list;
}

function applyFiltersAndRender() {
  const filtered = getFilteredResources();
  renderList(filtered);
  renderMapMarkers(filtered);
  document.getElementById('resultsCount').textContent = filtered.length;
}

/* ---------------- Distance ---------------- */
function haversineMiles(loc, resource) {
  const R = 3958.8;
  const dLat = toRad(resource.lat - loc.lat);
  const dLng = toRad(resource.lng - loc.lng);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(loc.lat)) * Math.cos(toRad(resource.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toRad(deg) { return deg * Math.PI / 180; }

/* ---------------- Sidebar list ---------------- */
function renderList(list) {
  const el = document.getElementById('resourceList');

  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state"><span class="emoji">🔍</span>No matching resources. Try clearing filters or search.</div>`;
    return;
  }

  el.innerHTML = list.map(r => {
    const dist = (state.userLocation && r.hasCoords)
      ? `<span class="res-sub"> · ${haversineMiles(state.userLocation, r).toFixed(1)} mi</span>` : '';
    let addressLine;
    if (r.hasCoords) {
      addressLine = `<span class="res-sub">${escapeHtml(r.address)}</span>${dist}`;
    } else if (r.noAddressReason === 'virtual') {
      addressLine = `<span class="res-sub contactflag">🌐 Virtual / online service</span>`;
    } else {
      addressLine = `<span class="res-sub contactflag">📞 Contact for address</span>`;
    }
    const tagIcons = r.services.slice(0, 5).map(s => `<span class="res-tag-icon" title="${(CATS[s] || CATS.Other).label}">${catIcon(s)}</span>`).join('');
    return `
      <div class="res-card ${r.isEmergency ? 'emergency' : ''}" data-id="${r.id}" tabindex="0">
        <div class="res-icon" style="background:${catColor(r.primaryCategory)}">${catIcon(r.primaryCategory)}</div>
        <div class="res-body">
          <div class="res-name">${escapeHtml(r.name)}</div>
          ${addressLine}
          <div class="res-tags">${tagIcons}</div>
        </div>
        <div class="res-actions">
          ${r.phone ? `<a class="card-btn" href="tel:${r.phone.replace(/[^\d+]/g, '')}" title="Call ${escapeHtml(r.phone)}" onclick="event.stopPropagation()">📞</a>` : ''}
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.res-card').forEach(card => {
    card.addEventListener('click', () => openResource(parseInt(card.dataset.id, 10)));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openResource(parseInt(card.dataset.id, 10)); });
  });
}

/* ---------------- Map markers ---------------- */
function renderMapMarkers(list) {
  if (!mapAvailable) return;
  clusterGroup.clearLayers();
  markerRegistry.clear();

  list.filter(r => r.hasCoords).forEach(r => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="pbc-pin ${r.isEmergency ? 'emergency-pin' : ''}" style="background:${catColor(r.primaryCategory)}"><span class="pin-emoji">${catIcon(r.primaryCategory)}</span></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 34],
      popupAnchor: [0, -30],
    });
    const marker = L.marker([r.lat, r.lng], { icon, title: r.name });
    marker.bindPopup(buildPopupHTML(r), { maxWidth: 320, minWidth: 280, maxHeight: 420 });
    marker.on('popupopen', () => bindDetailActionEvents(r, marker.getPopup().getElement()));
    clusterGroup.addLayer(marker);
    markerRegistry.set(r.id, marker);
  });
}

function openResource(id) {
  const r = PBC_RESOURCES.find(x => x.id === id);
  if (!r) return;
  if (mapAvailable && r.hasCoords && markerRegistry.has(id)) {
    const marker = markerRegistry.get(id);
    clusterGroup.zoomToShowLayer(marker, () => marker.openPopup());
  } else {
    openDetailModal(r);
  }
}

/* ---------------- Shared content builder (popup + modal) ---------------- */
function buildRequirementsHTML(r) {
  let html = '';
  if (r.eligibility) html += `<div class="detail-section"><h3>Client Eligibility</h3><p>${escapeHtml(r.eligibility)}</p></div>`;
  if (r.mustHave) html += `<div class="detail-section"><h3>Client Must Have</h3><p>${escapeHtml(r.mustHave)}</p></div>`;
  return html;
}

function buildReferralHTML(r) {
  let inner = escapeHtml(r.referralText || 'Contact the organization directly.');
  if (r.referralLink) {
    inner += ` — <a href="${escapeAttr(r.referralLink)}" target="_blank" rel="noopener">Open referral link ↗</a>`;
  }
  return `<div class="detail-section"><h3>Referral Instructions</h3><p>${inner}</p></div>`;
}

function buildHoursHTML(r) {
  const parsed = parseHours(r.hoursRaw);
  if (parsed.type === 'empty') return '';
  let body;
  if (parsed.type === 'grid') {
    body = `<table class="hours-table">${parsed.rows.map(row => `
      <tr class="${row.time ? '' : 'closed'}">
        <td class="day">${row.day}</td>
        <td class="time">${row.time || 'Closed'}</td>
      </tr>`).join('')}</table>`;
  } else {
    body = parsed.lines.map(l => `<div class="hours-fallback-line">${escapeHtml(l)}</div>`).join('');
  }
  return `<div class="detail-section"><h3>Hours</h3>${body}</div>`;
}

function buildFlagsHTML(r) {
  const flags = [];
  if (r.isEmergency) flags.push(`<span class="flag-badge flag-emergency">🆘 24/7 · Walk-in</span>`);
  if (r.isSO) flags.push(`<span class="flag-badge flag-so">🔒 SO-Specific</span>`);
  if (r.noAddressReason === 'virtual') flags.push(`<span class="flag-badge flag-virtual">🌐 Virtual</span>`);
  if (r.noAddressReason === 'contact') flags.push(`<span class="flag-badge flag-virtual">📞 Contact for Address</span>`);
  return flags.length ? `<div class="detail-flags">${flags.join('')}</div>` : '';
}

function buildDirectionsPanel(r) {
  if (!r.hasCoords) {
    return `<div class="no-address-note">📞 No public address on file — call ahead for an exact location and directions.</div>`;
  }
  const gWalk = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}&travelmode=walking`;
  const gTransit = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}&travelmode=transit`;
  const aWalk = `https://maps.apple.com/?daddr=${r.lat},${r.lng}&dirflg=w`;
  const aTransit = `https://maps.apple.com/?daddr=${r.lat},${r.lng}&dirflg=r`;
  return `
    <div class="directions-panel">
      <strong style="font-size:13px;">🧭 How to get there</strong>
      <div class="directions-row">
        <a class="btn btn-outline btn-sm" href="${gWalk}" target="_blank" rel="noopener">🚶 Google Maps (Walking)</a>
        <a class="btn btn-outline btn-sm" href="${gTransit}" target="_blank" rel="noopener">🚌 Google Maps (Transit)</a>
      </div>
      <div class="directions-row">
        <a class="btn btn-outline btn-sm" href="${aWalk}" target="_blank" rel="noopener">🚶 Apple Maps (Walking)</a>
        <a class="btn btn-outline btn-sm" href="${aTransit}" target="_blank" rel="noopener">🚌 Apple Maps (Transit)</a>
      </div>
    </div>`;
}

function buildPopupHTML(r) {
  return `
    <div class="popup-title">${catIcon(r.primaryCategory)} ${escapeHtml(r.name)}</div>
    ${buildFlagsHTML(r)}
    <div class="popup-desc">${escapeHtml(r.description)}</div>
    ${buildRequirementsHTML(r)}
    ${buildReferralHTML(r)}
    ${buildHoursHTML(r)}
    <div class="detail-actions">
      ${r.phone ? `<a class="btn btn-primary btn-sm" href="tel:${r.phone.replace(/[^\d+]/g, '')}">📞 Call</a>` : ''}
      ${r.website ? `<a class="btn btn-ghost btn-sm" href="${escapeAttr(r.website)}" target="_blank" rel="noopener">🌐 Website</a>` : ''}
    </div>
    ${buildDirectionsPanel(r)}
  `;
}

function bindDetailActionEvents() { /* placeholder: all popup links are plain <a> tags, no extra JS wiring needed */ }

/* ---------------- Full-screen detail modal (used for virtual / contact-for-address resources) ---------------- */
function openDetailModal(r) {
  const el = document.getElementById('detailContent');
  el.innerHTML = `
    <div class="detail-header">
      <div class="detail-icon" style="background:${catColor(r.primaryCategory)}">${catIcon(r.primaryCategory)}</div>
      <div>
        <div class="detail-title">${escapeHtml(r.name)}</div>
        ${buildFlagsHTML(r)}
      </div>
    </div>
    <div class="detail-section"><p>${escapeHtml(r.description)}</p></div>
    <div class="detail-section"><h3>Services</h3><div class="detail-tags">${r.services.map(s => `<span class="detail-tag">${catIcon(s)} ${(CATS[s] || CATS.Other).label}</span>`).join('')}</div></div>
    ${r.address ? `<div class="detail-section"><h3>Address on File</h3><p>${escapeHtml(r.address)}</p></div>` : ''}
    ${r.phone ? `<div class="detail-section"><h3>Contact</h3><p>${escapeHtml(r.contactRaw)}</p></div>` : ''}
    ${buildRequirementsHTML(r)}
    ${buildReferralHTML(r)}
    ${buildHoursHTML(r)}
    ${buildDirectionsPanel(r)}
    <div class="detail-actions">
      ${r.phone ? `<a class="btn btn-primary" href="tel:${r.phone.replace(/[^\d+]/g, '')}">📞 Call ${escapeHtml(r.phone)}</a>` : ''}
      ${r.website ? `<a class="btn btn-ghost" href="${escapeAttr(r.website)}" target="_blank" rel="noopener">🌐 Visit Website</a>` : ''}
    </div>
  `;
  document.getElementById('detailOverlay').classList.remove('hidden');
}
function closeDetailModal() {
  document.getElementById('detailOverlay').classList.add('hidden');
}

/* ---------------- Address search ("resources near an address") ---------------- */
async function doAddressSearch() {
  const input = document.getElementById('addressSearchInput');
  const statusEl = document.getElementById('addressSearchStatus');
  const query = input.value.trim();
  if (!query) return;

  statusEl.textContent = 'Searching…';
  statusEl.className = 'search-status';

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(query + ', Palm Beach County, FL')}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();

    if (!data || data.length === 0) {
      statusEl.textContent = 'No matching location found. Try a fuller address.';
      statusEl.className = 'search-status error';
      return;
    }

    const { lat, lon, display_name } = data[0];
    state.userLocation = { lat: parseFloat(lat), lng: parseFloat(lon), label: display_name };

    if (userLocationMarker) map.removeLayer(userLocationMarker);
    userLocationMarker = L.marker([lat, lon], {
      icon: L.divIcon({
        className: '',
        html: `<div class="pbc-pin" style="background:#3E6E8E"><span class="pin-emoji">📍</span></div>`,
        iconSize: [34, 34], iconAnchor: [17, 34],
      }),
      title: 'Searched location',
    }).addTo(map).bindPopup(`<strong>Searched location</strong><br>${escapeHtml(display_name)}`);

    map.setView([lat, lon], 13);

    statusEl.textContent = `Showing resources sorted by distance from: ${display_name}`;
    statusEl.className = 'search-status success';

    applyFiltersAndRender();
  } catch (err) {
    statusEl.textContent = 'Could not search right now — check your internet connection and try again.';
    statusEl.className = 'search-status error';
  }
}

/* ---------------- Helpers ---------------- */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }
