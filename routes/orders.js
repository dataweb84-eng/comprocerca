const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

const ESTADOS = ['pendiente', 'preparando', 'listo', 'entregado', 'cancelado'];

router.post(
  '/pedidos',
  asyncHandler(async (req, res) => {
    const { business_id, cliente_nombre, cliente_telefono, tipo_entrega, direccion_entrega, items } =
      req.body || {};

    if (!business_id || !cliente_nombre || !cliente_telefono || !tipo_entrega) {
      return res.status(400).json({ error: 'Faltan datos del pedido' });
    }
    if (!['envio', 'retiro'].includes(tipo_entrega)) {
      return res.status(400).json({ error: 'Tipo de entrega inválido' });
    }
    if (tipo_entrega === 'envio' && !direccion_entrega) {
      return res.status(400).json({ error: 'Falta la dirección de envío' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El pedido no tiene productos' });
    }

    const business = await db.get('SELECT * FROM businesses WHERE id = $1 AND activo = true', [
      business_id,
    ]);
    if (!business) return res.status(404).json({ error: 'Comercio no encontrado' });
    if (tipo_entrega === 'envio' && !business.acepta_envio) {
      return res.status(400).json({ error: 'Este comercio no ofrece envío' });
    }
    if (tipo_entrega === 'retiro' && !business.acepta_retiro) {
      return res.status(400).json({ error: 'Este comercio no ofrece retiro en local' });
    }

    const resolvedItems = [];
    for (const item of items) {
      const cantidad = parseFloat(item.cantidad);
      if (!item.product_id || !Number.isFinite(cantidad) || cantidad <= 0) {
        return res.status(400).json({ error: 'Ítem de pedido inválido' });
      }
      const product = await db.get(
        'SELECT * FROM products WHERE id = $1 AND business_id = $2 AND activo = true',
        [item.product_id, business_id]
      );
      if (!product) {
        return res.status(400).json({ error: `Producto no disponible: ${item.product_id}` });
      }
      resolvedItems.push({
        product_id: product.id,
        product_nombre: product.nombre,
        cantidad,
        unidad: item.unidad || product.unidad,
        nota: (item.nota || '').toString().slice(0, 300),
        precio_snapshot: product.precio,
      });
    }

    const publicId = crypto.randomUUID();
    const client = await db.pool.connect();
    let orderId;
    try {
      await client.query('BEGIN');
      const orderRes = await client.query(
        `INSERT INTO orders (public_id, business_id, cliente_nombre, cliente_telefono, tipo_entrega, direccion_entrega, estado)
         VALUES ($1, $2, $3, $4, $5, $6, 'pendiente') RETURNING id`,
        [publicId, business_id, cliente_nombre, cliente_telefono, tipo_entrega, direccion_entrega || '']
      );
      orderId = orderRes.rows[0].id;

      for (const it of resolvedItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_nombre, cantidad, unidad, nota, precio_snapshot)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orderId, it.product_id, it.product_nombre, it.cantidad, it.unidad, it.nota, it.precio_snapshot]
        );
      }
      // Evento liviano (sin datos del cliente) para que Supabase Realtime avise
      // al panel del comerciante sin exponer info sensible por ese canal.
      await client.query(
        'INSERT INTO order_events (business_id, public_id, estado) VALUES ($1, $2, $3)',
        [business_id, publicId, 'pendiente']
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({ public_id: publicId });
  })
);

router.get(
  '/pedidos/:publicId',
  asyncHandler(async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE public_id = $1', [req.params.publicId]);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    const business = await db.get('SELECT id, nombre, direccion, telefono FROM businesses WHERE id = $1', [
      order.business_id,
    ]);
    const items = await db.all(
      'SELECT product_nombre, cantidad, unidad, nota, precio_snapshot FROM order_items WHERE order_id = $1',
      [order.id]
    );

    res.json({
      public_id: order.public_id,
      estado: order.estado,
      tipo_entrega: order.tipo_entrega,
      direccion_entrega: order.direccion_entrega,
      cliente_nombre: order.cliente_nombre,
      created_at: order.created_at,
      business,
      items,
    });
  })
);

module.exports = { router, ESTADOS };
