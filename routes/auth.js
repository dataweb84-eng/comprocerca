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
