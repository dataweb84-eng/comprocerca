const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.post(
  '/admin/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Faltan usuario o contraseña' });
    }
    const admin = await db.get('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    req.session.adminId = admin.id;
    res.json({ ok: true });
  })
);

router.post('/admin/logout', (req, res) => {
  req.session.adminId = null;
  res.json({ ok: true });
});

router.get('/admin/me', (req, res) => {
  if (!req.session || !req.session.adminId) return res.status(401).json({ error: 'No autenticado' });
  res.json({ id: req.session.adminId });
});

router.post(
  '/comercio/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Faltan usuario o contraseña' });
    }
    const business = await db.get('SELECT * FROM businesses WHERE username = $1', [username]);
    if (!business || !bcrypt.compareSync(password, business.password_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    if (!business.activo) {
      return res.status(403).json({ error: 'Este comercio está desactivado' });
    }
    req.session.businessId = business.id;
    res.json({ ok: true });
  })
);

router.post(
  '/comercio/registro',
  asyncHandler(async (req, res) => {
    const {
      nombre,
      categoria,
      direccion,
      lat,
      lng,
      telefono,
      username,
      password,
      acepta_envio,
      acepta_retiro,
    } = req.body || {};

    if (!nombre || !username || !password) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (nombre, usuario, contraseña)' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña tiene que tener al menos 6 caracteres' });
    }

    const existing = await db.get('SELECT id FROM businesses WHERE username = $1', [username]);
    if (existing) return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso' });

    // Todo comercio que se registra solo arranca en el plan de entrada
    // (el que permite menos productos); el admin puede subirlo de plan después.
    const planInicial = await db.get('SELECT id FROM plans ORDER BY max_productos ASC LIMIT 1');
    if (!planInicial) return res.status(500).json({ error: 'Todavía no hay planes configurados' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.run(
      `INSERT INTO businesses
        (nombre, categoria, direccion, lat, lng, telefono, plan_id, username, password_hash, acepta_envio, acepta_retiro, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true) RETURNING id`,
      [
        nombre,
        categoria || '',
        direccion || '',
        Number.isFinite(parseFloat(lat)) ? parseFloat(lat) : null,
        Number.isFinite(parseFloat(lng)) ? parseFloat(lng) : null,
        telefono || '',
        planInicial.id,
        username,
        hash,
        acepta_envio === false ? false : true,
        acepta_retiro === false ? false : true,
      ]
    );

    req.session.businessId = result.rows[0].id;
    res.status(201).json({ ok: true, id: result.rows[0].id });
  })
);

router.post('/comercio/logout', (req, res) => {
  req.session.businessId = null;
  res.json({ ok: true });
});

router.get(
  '/comercio/me',
  asyncHandler(async (req, res) => {
    if (!req.session || !req.session.businessId) return res.status(401).json({ error: 'No autenticado' });
    const business = await db.get(
      'SELECT id, nombre, categoria, username FROM businesses WHERE id = $1',
      [req.session.businessId]
    );
    res.json(business);
  })
);

module.exports = router;
