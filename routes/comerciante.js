const express = require('express');
const db = require('../db');
const { requireComercianteAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { ESTADOS } = require('./orders');

const router = express.Router();
router.use(requireComercianteAuth);

router.get(
  '/perfil',
  asyncHandler(async (req, res) => {
    const business = await db.get(
      `SELECT b.id, b.nombre, b.categoria, b.direccion, b.telefono, b.acepta_envio, b.acepta_retiro,
              b.plan_id, b.plan_solicitado_id,
              p.nombre AS plan_nombre, p.max_productos, p.precio AS plan_precio,
              ps.nombre AS plan_solicitado_nombre, ps.precio AS plan_solicitado_precio
       FROM businesses b
       LEFT JOIN plans p ON p.id = b.plan_id
       LEFT JOIN plans ps ON ps.id = b.plan_solicitado_id
       WHERE b.id = $1`,
      [req.session.businessId]
    );
    const { c: productCount } = await db.get('SELECT COUNT(*)::int AS c FROM products WHERE business_id = $1', [
      req.session.businessId,
    ]);
    res.json({ ...business, productos_usados: productCount });
  })
);

router.post(
  '/solicitar-plan',
  asyncHandler(async (req, res) => {
    const { plan_id } = req.body || {};
    const plan = await db.get('SELECT * FROM plans WHERE id = $1', [plan_id]);
    if (!plan) return res.status(400).json({ error: 'Plan inválido' });

    await db.run('UPDATE businesses SET plan_solicitado_id = $1 WHERE id = $2', [
      plan.id,
      req.session.businessId,
    ]);
    res.json({ ok: true });
  })
);

router.put(
  '/perfil',
  asyncHandler(async (req, res) => {
    const { direccion, telefono, acepta_envio, acepta_retiro } = req.body || {};
    await db.run(
      `UPDATE businesses SET direccion = $1, telefono = $2, acepta_envio = $3, acepta_retiro = $4 WHERE id = $5`,
      [direccion || '', telefono || '', !!acepta_envio, !!acepta_retiro, req.session.businessId]
    );
    res.json({ ok: true });
  })
);

router.get(
  '/productos',
  asyncHandler(async (req, res) => {
    const productos = await db.all('SELECT * FROM products WHERE business_id = $1 ORDER BY id DESC', [
      req.session.businessId,
    ]);
    res.json(productos);
  })
);

router.post(
  '/productos',
  asyncHandler(async (req, res) => {
    const { nombre, descripcion, precio, unidad } = req.body || {};
    if (!nombre || !unidad) return res.status(400).json({ error: 'Faltan datos del producto' });

    const business = await db.get('SELECT plan_id FROM businesses WHERE id = $1', [req.session.businessId]);
    const plan = await db.get('SELECT max_productos FROM plans WHERE id = $1', [business.plan_id]);
    const { c: count } = await db.get('SELECT COUNT(*)::int AS c FROM products WHERE business_id = $1', [
      req.session.businessId,
    ]);

    if (plan && count >= plan.max_productos) {
      return res
        .status(403)
        .json({ error: `Llegaste al límite de tu plan (${plan.max_productos} productos)` });
    }

    const result = await db.run(
      'INSERT INTO products (business_id, nombre, descripcion, precio, unidad) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [req.session.businessId, nombre, descripcion || '', parseFloat(precio) || 0, unidad]
    );
    res.status(201).json({ id: result.rows[0].id });
  })
);

router.put(
  '/productos/:id',
  asyncHandler(async (req, res) => {
    const product = await db.get('SELECT * FROM products WHERE id = $1 AND business_id = $2', [
      req.params.id,
      req.session.businessId,
    ]);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

    const { nombre, descripcion, precio, unidad, activo } = req.body || {};
    await db.run(
      'UPDATE products SET nombre = $1, descripcion = $2, precio = $3, unidad = $4, activo = $5 WHERE id = $6',
      [
        nombre ?? product.nombre,
        descripcion ?? product.descripcion,
        Number.isFinite(parseFloat(precio)) ? parseFloat(precio) : product.precio,
        unidad ?? product.unidad,
        activo === undefined ? product.activo : !!activo,
        product.id,
      ]
    );
    res.json({ ok: true });
  })
);

router.delete(
  '/productos/:id',
  asyncHandler(async (req, res) => {
    const product = await db.get('SELECT * FROM products WHERE id = $1 AND business_id = $2', [
      req.params.id,
      req.session.businessId,
    ]);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    await db.run('DELETE FROM products WHERE id = $1', [product.id]);
    res.json({ ok: true });
  })
);

router.get(
  '/pedidos',
  asyncHandler(async (req, res) => {
    const pedidos = await db.all(
      'SELECT * FROM orders WHERE business_id = $1 ORDER BY id DESC LIMIT 100',
      [req.session.businessId]
    );
    const withItems = [];
    for (const p of pedidos) {
      const items = await db.all(
        'SELECT product_nombre, cantidad, unidad, nota FROM order_items WHERE order_id = $1',
        [p.id]
      );
      withItems.push({ ...p, items });
    }
    res.json(withItems);
  })
);

router.patch(
  '/pedidos/:id/estado',
  asyncHandler(async (req, res) => {
    const { estado } = req.body || {};
    if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

    const order = await db.get('SELECT * FROM orders WHERE id = $1 AND business_id = $2', [
      req.params.id,
      req.session.businessId,
    ]);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    await db.run('UPDATE orders SET estado = $1 WHERE id = $2', [estado, order.id]);
    await db.run('INSERT INTO order_events (business_id, public_id, estado) VALUES ($1, $2, $3)', [
      order.business_id,
      order.public_id,
      estado,
    ]);

    res.json({ ok: true });
  })
);

module.exports = router;
