const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verificar que el usuario existe en la base de datos
    const user = await prisma.player.findUnique({
      where: { id: decoded.userId },
      select: { id: true, nombre: true, email: true, role: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Autenticación requerida' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Acceso denegado. Permisos insuficientes.' 
      });
    }

    next();
  };
};

const requireAdmin = requireRole(['Admin']);
const requireArbitro = requireRole(['Admin', 'Árbitro']);
const requireJugador = requireRole(['Admin', 'Árbitro', 'Jugador']);

module.exports = {
  authenticateToken,
  requireRole,
  requireAdmin,
  requireArbitro,
  requireJugador
};


