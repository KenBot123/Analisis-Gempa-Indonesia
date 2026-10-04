// api/gempa.js — Vercel Serverless Function
const fetch = require('node-fetch');

// ---------- UTIL: jarak antar koordinat (km) ----------
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------- SUMBER 1: BMKG (gempa terkini) ----------
async function fetchBMKG() {
  try {
    const res = await fetch(
      'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json',
      { headers: { 'User-Agent': 'PantauGempa/1.0' } }
    );
    if (!res.ok) throw new Error(`BMKG HTTP ${res.status}`);
    const data = await res.json();
    const g = data?.Infogempa?.gempa;
    if (!g) return [];

    const [lat, lon] = g.Coordinates.split(',').map(Number);
    const potensi = (g.Potensi || '').toLowerCase();
    const tsunami = potensi.includes('tsunami') && !potensi.includes('tidak');

    return [{
      id: `bmkg-${g.DateTime}`,
      source: 'BMKG',
      wilayah: g.Wilayah || 'Tidak diketahui',
      magnitudo: parseFloat(g.Magnitude) || 0,
      kedalaman: g.Kedalaman || '-',
      lat, lon,
      waktu: g.DateTime,
      potensiTsunami: tsunami,
      dirasakan: g.Dirasakan || '-',
      shakemap: g.Shakemap
        ? `https://data.bmkg.go.id/DataMKG/TEWS/${g.Shakemap}`
        : null
    }];
  } catch (err) {
    console.error('[BMKG]', err.message);
    return [];
  }
}

// ---------- SUMBER 2: USGS (30 hari terakhir, radius Indonesia) ----------
async function fetchUSGS() {
  try {
    const starttime = new Date(Date.now() - 30 * 24 * 3600 * 1000)
      .toISOString()
      .split('.')[0];

    const url =
      'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson' +
      `&starttime=${starttime}` +
      '&minmagnitude=4.5' +
      '&minlatitude=-12&maxlatitude=8' +
      '&minlongitude=92&maxlongitude=142' +
      '&orderby=time';

    const res = await fetch(url);
    if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
    const data = await res.json();

    return (data.features || []).map((f) => {
      const p = f.properties;
      const [lon, lat, depth] = f.geometry.coordinates;
      return {
        id: f.id,
        source: 'USGS',
        wilayah: p.place || 'Tidak diketahui',
        magnitudo: p.mag || 0,
        kedalaman: `${Math.round(depth)} km`,
        lat, lon,
        waktu: new Date(p.time).toISOString(),
        potensiTsunami: p.tsunami === 1,
        dirasakan: p.felt ? `${p.felt} laporan` : '-',
        shakemap: null
      };
    });
  } catch (err) {
    console.error('[USGS]', err.message);
    return [];
  }
}

// ---------- HANDLER UTAMA ----------
module.exports = async (req, res) => {
  // CORS biar bisa dipanggil dari domain lain kalau perlu
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const [bmkg, usgs] = await Promise.all([fetchBMKG(), fetchUSGS()]);

    // Gabungkan + buang duplikat (radius 100 km + waktu < 30 menit)
    const all = [...bmkg];
    for (const u of usgs) {
      const dup = all.some(
        (b) =>
          haversine(b.lat, b.lon, u.lat, u.lon) < 100 &&
          Math.abs(new Date(b.waktu) - new Date(u.waktu)) < 30 * 60 * 1000
      );
      if (!dup) all.push(u);
    }

    // Hitung frekuensi radius 150 km
    const enriched = all.map((e) => ({
      ...e,
      frekuensi: all.filter(
        (o) => haversine(e.lat, e.lon, o.lat, o.lon) < 150
      ).length
    }));

    // Urutkan terbaru di atas
    enriched.sort((a, b) => new Date(b.waktu) - new Date(a.waktu));

    return res.status(200).json({
      updated: new Date().toISOString(),
      total: enriched.length,
      events: enriched
    });
  } catch (err) {
    console.error('[API]', err);
    return res.status(500).json({
      error: 'Gagal memuat data gempa',
      detail: err.message
    });
  }
};