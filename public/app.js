// ================= INIT MAP =================
const map = L.map('map', {
  center: [-2.5, 118],
  zoom: 5,
  minZoom: 4,
  maxZoom: 12
});

// ---------- TILE LAYER: Esri Ocean (biru gelap) ----------
const oceanLayer = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
  {
    attribution: 'Tiles © Esri — Ocean Basemap',
    maxZoom: 13
  }
);

// ---------- TILE LAYER: Esri Satellite (cadangan) ----------
const satelliteLayer = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {
    attribution: 'Tiles © Esri — World Imagery',
    maxZoom: 19
  }
);

// Default tampilan: Ocean (gelap)
oceanLayer.addTo(map);

// Tombol switch layer di pojok kanan atas
L.control.layers(
  {
    '🌊 Ocean (Gelap)': oceanLayer,
    '🛰️ Satelit': satelliteLayer
  },
  null,
  { position: 'topright', collapsed: false }
).addTo(map);

// Layer group untuk marker gempa
const markerLayer = L.layerGroup().addTo(map);
let allEvents = [];

// ================= HELPER =================
function getLevel(e) {
  if (e.potensiTsunami || e.magnitudo >= 6.0) return 'red';
  if (e.magnitudo >= 5.0) return 'yellow';
  return 'green';
}

function getColor(level) {
  return { green: '#22c55e', yellow: '#facc15', red: '#ef4444' }[level];
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch {
    return iso;
  }
}

// ================= POPUP =================
function buildPopup(e) {
  const level = getLevel(e);
  const label = {
    green: '🟢 Risiko Rendah',
    yellow: '🟡 Cukup Berbahaya',
    red: '🔴 Berbahaya'
  }[level];

  return `
    <div class="popup">
      <h3>${e.wilayah}</h3>
      <span class="badge ${level}">${label}</span>
      <table>
        <tr><td>Magnitudo</td><td><b>${e.magnitudo}</b> SR</td></tr>
        <tr><td>Kedalaman</td><td>${e.kedalaman}</td></tr>
        <tr><td>Waktu</td><td>${fmtTime(e.waktu)}</td></tr>
        <tr><td>Koordinat</td><td>${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}</td></tr>
        <tr><td>Potensi Tsunami</td><td>${e.potensiTsunami ? '⚠️ Ya' : '✅ Tidak'}</td></tr>
        <tr><td>Dirasakan</td><td>${e.dirasakan}</td></tr>
        <tr><td>Frekuensi (150 km)</td><td>${e.frekuensi} gempa</td></tr>
        <tr><td>Sumber</td><td>${e.source}</td></tr>
      </table>
      ${
        e.shakemap
          ? `<a href="${e.shakemap}" target="_blank" rel="noopener">📷 Lihat Shakemap BMKG</a>`
          : ''
      }
    </div>
  `;
}

// ================= MARKER =================
function renderMarkers(events) {
  markerLayer.clearLayers();

  events.forEach((e) => {
    const level = getLevel(e);
    const color = getColor(level);
    const radius = Math.min(22, 6 + (e.magnitudo || 0) * 2.2);

    const marker = L.circleMarker([e.lat, e.lon], {
      radius,
      fillColor: color,
      color: '#ffffff',
      weight: 1.5,
      opacity: 0.9,
      fillOpacity: 0.75
    });

    marker.bindPopup(buildPopup(e), { maxWidth: 340 });
    marker.addTo(markerLayer);
  });
}

// ================= LIST =================
function renderList(events) {
  const ul = document.getElementById('eventList');
  ul.innerHTML = '';

  if (!events.length) {
    ul.innerHTML =
      '<li style="color:#8ea1c1;padding:8px;">Tidak ada data gempa.</li>';
    return;
  }

  events.slice(0, 30).forEach((e) => {
    const level = getLevel(e);
    const li = document.createElement('li');
    li.className = `event-item level-${level}`;
    li.innerHTML = `
      <div class="row1">
        <span class="mag">M ${e.magnitudo}</span>
        <span class="wil">${e.source}</span>
      </div>
      <div>${e.wilayah}</div>
      <div class="wil" style="margin-top:4px;">${fmtTime(e.waktu)}</div>
    `;
    li.addEventListener('click', () => {
      map.setView([e.lat, e.lon], 8);
      markerLayer.eachLayer((m) => {
        const ll = m.getLatLng();
        if (
          Math.abs(ll.lat - e.lat) < 0.001 &&
          Math.abs(ll.lng - e.lon) < 0.001
        ) {
          m.openPopup();
        }
      });
    });
    ul.appendChild(li);
  });
}

// ================= STATS =================
function renderStats(events) {
  document.getElementById('statTotal').textContent = events.length;

  const max = events.reduce((m, e) => Math.max(m, e.magnitudo || 0), 0);
  document.getElementById('statMax').textContent = max.toFixed(1);

  document.getElementById('statTsunami').textContent = events.filter(
    (e) => e.potensiTsunami
  ).length;

  document.getElementById('statFelt').textContent = events.filter(
    (e) => e.dirasakan && e.dirasakan !== '-'
  ).length;
}

// ================= FETCH DATA =================
async function loadData() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Memuat…';

  try {
    const res = await fetch('/api/gempa');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    allEvents = data.events || [];
    allEvents.sort((a, b) => new Date(b.waktu) - new Date(a.waktu));

    renderMarkers(allEvents);
    renderList(allEvents);
    renderStats(allEvents);

    document.getElementById('lastUpdate').textContent =
      'Update: ' + fmtTime(data.updated);
  } catch (err) {
    console.error(err);
    document.getElementById('lastUpdate').textContent = 'Gagal memuat ❌';
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
  }
}

// ================= EVENTS =================
document.getElementById('refreshBtn').addEventListener('click', loadData);

// ================= START =================
loadData();
setInterval(loadData, 5 * 60 * 1000); // auto refresh tiap 5 menit