function requireAdminAuth(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

function requireComercianteAuth(req, res, next) {
  if (!req.session || !req.session.businessId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

module.exports = { requireAdminAuth, requireComercianteAuth };
