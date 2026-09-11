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
