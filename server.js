const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { createServer } = require('http');
const { Server } = require('socket.io');

const db = require('./db');

const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const { router: orderRoutes } = require('./routes/orders');
const comercianteRoutes = require('./routes/comerciante');
const adminRoutes = require('./routes/admin');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 4000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
});

app.use(express.json());
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

app.set('io', io);

app.use('/api', authRoutes);
app.use('/api', publicRoutes);
app.use('/api', orderRoutes);
app.use('/api/comercio', comercianteRoutes);
app.use('/api/admin', adminRoutes);

io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
  socket.on('join_comercio', () => {
    const businessId = socket.request.session && socket.request.session.businessId;
    if (businessId) socket.join(`comercio_${businessId}`);
  });

  socket.on('join_pedido', (publicId) => {
    if (typeof publicId === 'string' && publicId.length < 100) {
      socket.join(`pedido_${publicId}`);
    }
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

async function main() {
  await db.init();
  httpServer.listen(PORT, () => {
    console.log(`ComproCerca corriendo en http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('No se pudo iniciar ComproCerca:', err);
  process.exit(1);
});
