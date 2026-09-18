const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdminAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireAdminAuth);

// --- Planes ---

router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    res.json(await db.all('SELECT * FROM plans ORDER BY id'));
  })
);

router.post(
  '/plans',
  asyncHandler(async (req, res) => {
    const { nombre, max_productos, precio, descripcion } = req.body || {};
    if (!nombre || !max_productos) return res.status(400).json({ error: 'Faltan datos del plan' });
    const result = await db.run(
      'INSERT INTO plans (nombre, max_productos, precio, descripcion) VALUES ($1, $2, $3, $4) RETURNING id',
      [nombre, parseInt(max_productos, 10), parseFloat(precio) || 0, descripcion || '']
    );
    res.status(201).json({ id: result.rows[0].id });
  })
);

router.put(
  '/plans/:id',
  asyncHandler(async (req, res) => {
    const plan = await db.get('SELECT * FROM plans WHERE id = $1', [req.params.id]);
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    const { nombre, max_productos, precio, descripcion } = req.body || {};
    await db.run('UPDATE plans SET nombre = $1, max_productos = $2, precio = $3, descripcion = $4 WHERE id = $5', [
      nombre ?? plan.nombre,
      max_productos ? parseInt(max_productos, 10) : plan.max_productos,
      Number.isFinite(parseFloat(precio)) ? parseFloat(precio) : plan.precio,
      descripcion ?? plan.descripcion,
      plan.id,
    ]);
    res.json({ ok: true });
  })
);

router.delete(
  '/plans/:id',
  asyncHandler(async (req, res) => {
    const { c: inUse } = await db.get('SELECT COUNT(*)::int AS c FROM businesses WHERE plan_id = $1', [
      req.params.id,
    ]);
    if (inUse > 0) return res.status(400).json({ error: 'Hay comercios usando este plan' });
    await db.run('DELETE FROM plans WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

// --- Comercios ---

router.get(
  '/businesses',
  asyncHandler(async (req, res) => {
    const businesses = await db.all(
      `SELECT b.id, b.nombre, b.categoria, b.direccion, b.lat, b.lng, b.telefono, b.activo,
              b.acepta_envio, b.acepta_retiro, b.username, b.plan_id, p.nombre AS plan_nombre,
              b.plan_solicitado_id, ps.nombre AS plan_solicitado_nombre, ps.precio AS plan_solicitado_precio
       FROM businesses b
       LEFT JOIN plans p ON p.id = b.plan_id
       LEFT JOIN plans ps ON ps.id = b.plan_solicitado_id
       ORDER BY b.plan_solicitado_id IS NULL, b.id DESC`
    );
    res.json(businesses);
  })
);

router.post(
  '/businesses',
  asyncHandler(async (req, res) => {
    const {
      nombre,
      categoria,
      direccion,
      lat,
      lng,
      telefono,
      plan_id,
      username,
      password,
      acepta_envio,
      acepta_retiro,
    } = req.body || {};

    if (!nombre || !username || !password || !plan_id) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (nombre, usuario, contraseña, plan)' });
    }
    const existing = await db.get('SELECT id FROM businesses WHERE username = $1', [username]);
    if (existing) return res.status(400).json({ error: 'Ese nombre de usuario ya existe' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.run(
      `INSERT INTO businesses
        (nombre, categoria, direccion, lat, lng, telefono, plan_id, username, password_hash, acepta_envio, acepta_retiro)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        nombre,
        categoria || '',
        direccion || '',
        Number.isFinite(parseFloat(lat)) ? parseFloat(lat) : null,
        Number.isFinite(parseFloat(lng)) ? parseFloat(lng) : null,
        telefono || '',
        plan_id,
        username,
        hash,
        acepta_envio === false ? false : true,
        acepta_retiro === false ? false : true,
      ]
    );
    res.status(201).json({ id: result.rows[0].id });
  })
);

router.put(
  '/businesses/:id',
  asyncHandler(async (req, res) => {
    const business = await db.get('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
    if (!business) return res.status(404).json({ error: 'Comercio no encontrado' });

    const {
      nombre,
      categoria,
      direccion,
      lat,
      lng,
      telefono,
      plan_id,
      activo,
      acepta_envio,
      acepta_retiro,
      password,
    } = req.body || {};

    const nuevoPlanId = plan_id ?? business.plan_id;
    // Si el admin cambia el plan a mano desde acá, ya sea al que habían
    // pedido o a otro, se da por atendida la solicitud pendiente.
    const limpiarSolicitud = String(nuevoPlanId) !== String(business.plan_id);

    await db.run(
      `UPDATE businesses SET nombre = $1, categoria = $2, direccion = $3, lat = $4, lng = $5, telefono = $6,
        plan_id = $7, activo = $8, acepta_envio = $9, acepta_retiro = $10,
        plan_solicitado_id = CASE WHEN $12 THEN NULL ELSE plan_solicitado_id END
       WHERE id = $11`,
      [
        nombre ?? business.nombre,
        categoria ?? business.categoria,
        direccion ?? business.direccion,
        Number.isFinite(parseFloat(lat)) ? parseFloat(lat) : business.lat,
        Number.isFinite(parseFloat(lng)) ? parseFloat(lng) : business.lng,
        telefono ?? business.telefono,
        nuevoPlanId,
        activo === undefined ? business.activo : !!activo,
        acepta_envio === undefined ? business.acepta_envio : !!acepta_envio,
        acepta_retiro === undefined ? business.acepta_retiro : !!acepta_retiro,
        business.id,
        limpiarSolicitud,
      ]
    );

    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await db.run('UPDATE businesses SET password_hash = $1 WHERE id = $2', [hash, business.id]);
    }

    res.json({ ok: true });
  })
);

router.post(
  '/businesses/:id/aprobar-plan',
  asyncHandler(async (req, res) => {
    const business = await db.get('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
    if (!business) return res.status(404).json({ error: 'Comercio no encontrado' });
    if (!business.plan_solicitado_id) return res.status(400).json({ error: 'Este comercio no pidió cambiar de plan' });

    await db.run('UPDATE businesses SET plan_id = plan_solicitado_id, plan_solicitado_id = NULL WHERE id = $1', [
      business.id,
    ]);
    res.json({ ok: true });
  })
);

router.post(
  '/businesses/:id/rechazar-plan',
  asyncHandler(async (req, res) => {
    await db.run('UPDATE businesses SET plan_solicitado_id = NULL WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

router.delete(
  '/businesses/:id',
  asyncHandler(async (req, res) => {
    const business = await db.get('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
    if (!business) return res.status(404).json({ error: 'Comercio no encontrado' });
    await db.run('DELETE FROM products WHERE business_id = $1', [business.id]);
    await db.run('DELETE FROM businesses WHERE id = $1', [business.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
