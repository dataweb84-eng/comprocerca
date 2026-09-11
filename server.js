const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSessionFactory = require('connect-pg-simple');

const db = require('./db');

const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const { router: orderRoutes } = require('./routes/orders');
const comercianteRoutes = require('./routes/comerciante');
const adminRoutes = require('./routes/admin');

const app = express();

const PORT = process.env.PORT || 4000;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error('Falta SESSION_SECRET en las variables de entorno');
}

const PgSession = pgSessionFactory(session);

app.use(express.json());
app.use(
  session({
    store: new PgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: true }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

// Se ejecuta una sola vez por instancia (ver comentario más abajo), incluso
// en entornos serverless con múltiples invocaciones sobre la misma instancia.
const ready = db.init().catch((err) => {
  console.error('No se pudo inicializar la base de datos:', err);
  throw err;
});
app.use((req, res, next) => {
  ready.then(() => next()).catch(next);
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', authRoutes);
app.use('/api', publicRoutes);
app.use('/api', orderRoutes);
app.use('/api/comercio', comercianteRoutes);
app.use('/api/admin', adminRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// En local (o cualquier host que no sea serverless) levantamos el server normalmente.
// En Vercel, el archivo solo exporta `app` y el runtime de @vercel/node la invoca por request.
if (!process.env.VERCEL) {
  ready
    .then(() => {
      app.listen(PORT, () => {
        console.log(`ComproCerca corriendo en http://localhost:${PORT}`);
      });
    })
    .catch(() => process.exit(1));
}

module.exports = app;
