const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function get(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

async function all(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function run(sql, params = []) {
  return pool.query(sql, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  max_productos INTEGER NOT NULL,
  precio NUMERIC NOT NULL DEFAULT 0,
  descripcion TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS businesses (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT DEFAULT '',
  direccion TEXT DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  telefono TEXT DEFAULT '',
  plan_id INTEGER REFERENCES plans(id),
  activo BOOLEAN NOT NULL DEFAULT true,
  acepta_envio BOOLEAN NOT NULL DEFAULT true,
  acepta_retiro BOOLEAN NOT NULL DEFAULT true,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  nombre TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  precio NUMERIC NOT NULL DEFAULT 0,
  unidad TEXT NOT NULL DEFAULT 'unidad',
  activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  public_id UUID UNIQUE NOT NULL,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  cliente_nombre TEXT NOT NULL,
  cliente_telefono TEXT NOT NULL,
  tipo_entrega TEXT NOT NULL,
  direccion_entrega TEXT DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER REFERENCES products(id),
  product_nombre TEXT NOT NULL,
  cantidad NUMERIC NOT NULL,
  unidad TEXT NOT NULL,
  nota TEXT DEFAULT '',
  precio_snapshot NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);
`;

async function seed() {
  const { c: planCount } = await get('SELECT COUNT(*)::int AS c FROM plans');
  if (planCount === 0) {
    await run(
      `INSERT INTO plans (nombre, max_productos, precio, descripcion) VALUES
       ('Básico', 10, 5000, 'Hasta 10 productos publicados'),
       ('Pro', 30, 12000, 'Hasta 30 productos publicados'),
       ('Premium', 999, 20000, 'Productos ilimitados')`
    );
    console.log('[seed] Planes creados: Básico, Pro, Premium');
  }

  const { c: adminCount } = await get('SELECT COUNT(*)::int AS c FROM admin_users');
  if (adminCount === 0) {
    const password = crypto.randomBytes(6).toString('hex');
    const hash = bcrypt.hashSync(password, 10);
    await run('INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)', ['admin', hash]);
    console.log('========================================');
    console.log('[seed] Usuario admin creado');
    console.log('  usuario:    admin');
    console.log('  contraseña:', password);
    console.log('  (guardala, no se vuelve a mostrar)');
    console.log('========================================');
  }
}

async function init() {
  await pool.query(SCHEMA);
  await seed();
}

module.exports = { pool, get, all, run, init };
