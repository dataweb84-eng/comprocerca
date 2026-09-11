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
const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  // No tiramos el módulo abajo (eso hace que la función serverless "crashee"
  // en vez de responder). Servimos 500 con un mensaje diagnosticable más abajo.
  console.error('Falta SESSION_SECRET en las variables de entorno');
}

const PgSession = pgSessionFactory(session);

app.use(express.json());
app.use(
  session({
    store: new PgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: true }),
    // Fallback solo para que express-session no tire un error de arranque;
    // sin SESSION_SECRET real, el middleware de abajo bloquea todas las rutas igual.
    secret: SESSION_SECRET || 'fallback-inseguro-configurar-SESSION_SECRET',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

// Se ejecuta una sola vez por instancia (incluso en serverless, mientras la
// instancia siga "tibia" entre invocaciones). No re-lanzamos el error acá:
// solo lo guardamos, para no generar una promesa rechazada sin manejar a
// nivel de módulo (eso también crashea la función en Vercel).
let initError = null;
const ready = db.init().catch((err) => {
  console.error('No se pudo inicializar la base de datos:', err);
  initError = err;
});

app.use((req, res, next) => {
  ready.then(() => {
    if (!SESSION_SECRET) {
      return res.status(500).json({ error: 'Falta configurar SESSION_SECRET en el servidor' });
    }
    if (initError) {
      return res.status(500).json({ error: 'No se pudo conectar a la base de datos' });
    }
    next();
  });
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
  if (!SESSION_SECRET) {
    console.error('No se puede arrancar localmente sin SESSION_SECRET en .env');
    process.exit(1);
  }
  ready.then(() => {
    if (initError) {
      console.error('No se pudo iniciar ComproCerca:', initError);
      process.exit(1);
    }
    app.listen(PORT, () => {
      console.log(`ComproCerca corriendo en http://localhost:${PORT}`);
    });
  });
}

module.exports = app;
