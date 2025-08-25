const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const playerRoutes = require('./routes/players');
const tournamentRoutes = require('./routes/tournaments');
const matchRoutes = require('./routes/matches');
const rankingRoutes = require('./routes/ranking');
const { authenticateToken } = require('./middleware/auth');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3001",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: 'Demasiadas solicitudes desde esta IP, intente nuevamente más tarde.'
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:3001",
  credentials: true
}));
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/players', playerRoutes); // Removido authenticateToken para permitir acceso público
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/matches', authenticateToken, matchRoutes);
app.use('/api/ranking', rankingRoutes);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  socket.on('join-tournament', (tournamentId) => {
    socket.join(`tournament-${tournamentId}`);
    console.log(`Usuario ${socket.id} se unió al torneo ${tournamentId}`);
  });

  socket.on('leave-tournament', (tournamentId) => {
    socket.leave(`tournament-${tournamentId}`);
    console.log(`Usuario ${socket.id} salió del torneo ${tournamentId}`);
  });

  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
  });
});

// Make io available to routes
app.set('io', io);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Endpoint público para verificar estado de torneos (debugging)
app.get('/api/debug/tournaments', async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const tournaments = await prisma.tournament.findMany({
      include: {
        _count: {
          select: {
            matches: true,
            tournamentResults: true
          }
        },
        matches: {
          where: { estado: 'Finalizado' }
        }
      }
    });

    const stats = tournaments.map(tournament => ({
      id: tournament.id,
      nombre: tournament.nombre,
      estado: tournament.estado,
      totalMatches: tournament._count.matches,
      completedMatches: tournament.matches.length,
      hasResults: tournament._count.tournamentResults > 0,
      completionPercentage: tournament._count.matches > 0 
        ? Math.round((tournament.matches.length / tournament._count.matches) * 100) 
        : 0
    }));

    await prisma.$disconnect();
    res.json({ stats });

  } catch (error) {
    console.error('Error obteniendo estadísticas de torneos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Algo salió mal!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Error interno del servidor'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
});

