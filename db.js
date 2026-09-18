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
  plan_solicitado_id INTEGER REFERENCES plans(id),
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

-- Tabla de eventos "livianos" para Supabase Realtime: solo metadata no sensible
-- (business_id, public_id, estado). Los datos protegidos del pedido (cliente,
-- telefono, items) siguen viajando solo por nuestra API con sesión/UUID, nunca
-- por acá, porque esta tabla es legible públicamente vía Realtime (anon key).
CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL,
  public_id UUID NOT NULL,
  estado TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;

-- Por si la tabla ya existía de antes de que agregáramos esta columna.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS plan_solicitado_id INTEGER REFERENCES plans(id);
`;

const REALTIME_SETUP = `
DROP POLICY IF EXISTS order_events_select_anon ON order_events;
CREATE POLICY order_events_select_anon ON order_events FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON order_events TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_events;
  END IF;
END $$;
`;

async function seed() {
  const { c: planCount } = await get('SELECT COUNT(*)::int AS c FROM plans');
  if (planCount === 0) {
    await run(
      `INSERT INTO plans (nombre, max_productos, precio, descripcion) VALUES
       ('Gratis', 5, 0, 'Hasta 5 productos, para mostrar tu comercio'),
       ('Plan 10', 10, 10000, 'Hasta 10 productos'),
       ('Plan 20', 20, 20000, 'Hasta 20 productos'),
       ('Plan 40', 40, 35000, 'Hasta 40 productos'),
       ('Plan 100', 100, 80000, 'Hasta 100 productos'),
       ('Plan Ilimitado', 999999, 100000, 'Productos ilimitados')`
    );
    console.log('[seed] Planes creados: Gratis, Plan 10, Plan 20, Plan 40, Plan 100, Plan Ilimitado');
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

// Migración de una sola vez: pasa del esquema viejo de planes
// (Básico/Pro/Premium) al esquema de precios real con pago manual por
// transferencia. Se identifica por nombre y es idempotente: una vez migrado,
// esos nombres ya no existen y no vuelve a tocar nada.
async function migrarPlanes() {
  await run(
    `UPDATE plans SET nombre = 'Gratis', max_productos = 5, precio = 0,
       descripcion = 'Hasta 5 productos, para mostrar tu comercio'
     WHERE nombre = 'Básico'`
  );
  await run(
    `UPDATE plans SET nombre = 'Plan 10', max_productos = 10, precio = 10000,
       descripcion = 'Hasta 10 productos'
     WHERE nombre = 'Pro'`
  );
  await run(
    `UPDATE plans SET nombre = 'Plan 20', max_productos = 20, precio = 20000,
       descripcion = 'Hasta 20 productos'
     WHERE nombre = 'Premium'`
  );

  const faltantes = [
    ['Plan 40', 40, 35000, 'Hasta 40 productos'],
    ['Plan 100', 100, 80000, 'Hasta 100 productos'],
    ['Plan Ilimitado', 999999, 100000, 'Productos ilimitados'],
  ];
  for (const [nombre, max, precio, descripcion] of faltantes) {
    const existe = await get('SELECT id FROM plans WHERE nombre = $1', [nombre]);
    if (!existe) {
      await run('INSERT INTO plans (nombre, max_productos, precio, descripcion) VALUES ($1, $2, $3, $4)', [
        nombre,
        max,
        precio,
        descripcion,
      ]);
    }
  }
}

async function init() {
  await pool.query(SCHEMA);
  await seed();
  await migrarPlanes();
  try {
    await pool.query(REALTIME_SETUP);
  } catch (err) {
    console.warn('[realtime] No se pudo configurar order_events para Supabase Realtime:', err.message);
  }
}

module.exports = { pool, get, all, run, init };
