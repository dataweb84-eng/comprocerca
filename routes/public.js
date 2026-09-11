const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

router.get('/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// Proxy a la API pública GeoRef (datos.gob.ar) para autocompletar ciudades
// de todo el país sin tener que embeber un listado gigante en el frontend.
router.get(
  '/geo/localidades',
  asyncHandler(async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (q.length < 2) return res.json([]);

    const url = `https://apis.datos.gob.ar/georef/api/localidades?nombre=${encodeURIComponent(
      q
    )}&max=8&campos=nombre,provincia,centroide&orden=nombre`;
    const apiRes = await fetch(url);
    if (!apiRes.ok) return res.json([]);
    const data = await apiRes.json();

    const resultados = (data.localidades || [])
      .filter((l) => l.centroide)
      .map((l) => ({
        nombre: l.nombre,
        provincia: l.provincia ? l.provincia.nombre : '',
        lat: l.centroide.lat,
        lng: l.centroide.lon,
      }));
    res.json(resultados);
  })
);

// Reverse geocoding: a partir de lat/lng del GPS, devuelve una etiqueta
// legible ("Santa Rosa, La Pampa") para mostrarle al cliente.
router.get(
  '/geo/ubicacion',
  asyncHandler(async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Faltan coordenadas' });
    }
    const url = `https://apis.datos.gob.ar/georef/api/ubicacion?lat=${lat}&lon=${lng}`;
    const apiRes = await fetch(url);
    if (!apiRes.ok) return res.json({ label: null });
    const data = await apiRes.json();
    const ubicacion = data.ubicacion;
    if (!ubicacion) return res.json({ label: null });
    const ciudad = (ubicacion.municipio && ubicacion.municipio.nombre) || (ubicacion.departamento && ubicacion.departamento.nombre);
    const provincia = ubicacion.provincia ? ubicacion.provincia.nombre : '';
    const label = [ciudad, provincia].filter(Boolean).join(', ');
    res.json({ label: label || null });
  })
);

router.get(
  '/comercios',
  asyncHandler(async (req, res) => {
    const businesses = await db.all(
      `SELECT id, nombre, categoria, direccion, lat, lng, acepta_envio, acepta_retiro
       FROM businesses WHERE activo = true`
    );

    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    let result = businesses.map((b) => ({
      ...b,
      distancia_km:
        hasCoords && Number.isFinite(b.lat) && Number.isFinite(b.lng)
          ? Math.round(haversineKm(lat, lng, b.lat, b.lng) * 10) / 10
          : null,
    }));

    if (hasCoords) {
      result.sort((a, b) => {
        if (a.distancia_km === null) return 1;
        if (b.distancia_km === null) return -1;
        return a.distancia_km - b.distancia_km;
      });
    } else {
      result.sort((a, b) => a.nombre.localeCompare(b.nombre));
    }

    res.json(result);
  })
);

router.get(
  '/comercios/:id',
  asyncHandler(async (req, res) => {
    const business = await db.get(
      `SELECT id, nombre, categoria, direccion, telefono, acepta_envio, acepta_retiro
       FROM businesses WHERE id = $1 AND activo = true`,
      [req.params.id]
    );
    if (!business) return res.status(404).json({ error: 'Comercio no encontrado' });

    const productos = await db.all(
      'SELECT id, nombre, descripcion, precio, unidad FROM products WHERE business_id = $1 AND activo = true',
      [business.id]
    );

    res.json({ ...business, productos });
  })
);

module.exports = router;
