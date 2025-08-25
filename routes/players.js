const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireAdmin, requireArbitro } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Configuración de multer para subida de archivos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || 
        file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos CSV y Excel'));
    }
  }
});

// Obtener todos los jugadores
router.get('/', async (req, res) => {
  try {
    console.log('GET /players - Query params:', req.query);
    const { page = 1, limit = 20, search = '', sortBy = 'ranking', sortOrder = 'asc' } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Construir filtros de búsqueda
    const where = {};
    
    // Filtro de estado (activo/inactivo)
    if (req.query.status === 'active') {
      where.activo = true;
    } else if (req.query.status === 'inactive') {
      where.activo = false;
    } else {
      // Por defecto mostrar solo activos
      where.activo = true;
    }
    
    if (search) {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Mapear campos de ordenamiento
    const orderByMap = {
      nombre: 'nombre',
      role: 'role',
      ranking: 'ranking',
      activo: 'activo',
      createdAt: 'createdAt'
    };

    const orderByField = orderByMap[sortBy] || 'nombre';
    const orderByDirection = sortOrder === 'desc' ? 'desc' : 'asc';

    // Obtener jugadores con paginación
    const players = await prisma.player.findMany({
      where,
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        fechaNacimiento: true,
        ranking: true,
        puntos: true,
        role: true,
        activo: true,
        fechaBaja: true,
        createdAt: true
      },
      orderBy: { [orderByField]: orderByDirection },
      skip,
      take: parseInt(limit)
    });

    // Transformar los datos para el frontend
    const transformedPlayers = players.map(player => ({
      ...player,
      name: player.nombre, // Agregar campo 'name' para compatibilidad con el frontend
      points: player.puntos, // Agregar campo 'points' para compatibilidad con el frontend
      phone: player.telefono, // Agregar campo 'phone' para compatibilidad con el frontend
      birthDate: player.fechaNacimiento, // Agregar campo 'birthDate' para compatibilidad con el frontend
      active: player.activo, // Agregar campo 'active' para compatibilidad con el frontend
      deactivationDate: player.fechaBaja // Agregar campo 'deactivationDate' para compatibilidad con el frontend
    }));

    // Contar total de jugadores
    const total = await prisma.player.count({ where });

    console.log('GET /players - Result:', { 
      playersCount: transformedPlayers.length, 
      total, 
      page: parseInt(page), 
      limit: parseInt(limit) 
    });

    res.json({
      players: transformedPlayers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error obteniendo jugadores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener un jugador por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const player = await prisma.player.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        fechaNacimiento: true,
        ranking: true,
        puntos: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!player) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    // Transformar los datos para el frontend
    const transformedPlayer = {
      ...player,
      name: player.nombre, // Agregar campo 'name' para compatibilidad con el frontend
      points: player.puntos, // Agregar campo 'points' para compatibilidad con el frontend
      phone: player.telefono, // Agregar campo 'phone' para compatibilidad con el frontend
      birthDate: player.fechaNacimiento // Agregar campo 'birthDate' para compatibilidad con el frontend
    };

    res.json({ player: transformedPlayer });
  } catch (error) {
    console.error('Error obteniendo jugador:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Crear nuevo jugador (temporalmente público para pruebas)
router.post('/', [
  body('nombre').trim().isLength({ min: 2 }).withMessage('El nombre debe tener al menos 2 caracteres'),
  body('email').isEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
  body('role').optional().isIn(['Admin', 'Árbitro', 'Jugador']).withMessage('Rol inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { nombre, email, password, role = 'Jugador' } = req.body;

    // Verificar si el email ya existe
    const existingPlayer = await prisma.player.findUnique({
      where: { email }
    });

    if (existingPlayer) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Encriptar contraseña
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 12);

    const player = await prisma.player.create({
      data: {
        nombre,
        email,
        password: hashedPassword,
        role
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        role: true,
        ranking: true,
        puntos: true
      }
    });

    res.status(201).json({
      message: 'Jugador creado exitosamente',
      player
    });
  } catch (error) {
    console.error('Error creando jugador:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar jugador (solo Admin)
router.put('/:id', authenticateToken, requireAdmin, [
  body('nombre').optional().trim().isLength({ min: 2 }).withMessage('El nombre debe tener al menos 2 caracteres'),
  body('email').optional().isEmail().withMessage('Email inválido'),
  body('role').optional().isIn(['Admin', 'Árbitro', 'Jugador']).withMessage('Rol inválido'),
  body('telefono').optional().trim(),
  body('fechaNacimiento').optional().isISO8601().withMessage('Fecha de nacimiento inválida')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { nombre, email, role, telefono, fechaNacimiento } = req.body;

    // Verificar si el jugador existe
    const existingPlayer = await prisma.player.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existingPlayer) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    // Verificar si el email ya existe (si se está cambiando)
    if (email && email !== existingPlayer.email) {
      const emailExists = await prisma.player.findUnique({
        where: { email }
      });

      if (emailExists) {
        return res.status(400).json({ error: 'El email ya está registrado' });
      }
    }

    const player = await prisma.player.update({
      where: { id: parseInt(id) },
      data: {
        ...(nombre && { nombre }),
        ...(email && { email }),
        ...(role && { role }),
        ...(telefono !== undefined && { telefono }),
        ...(fechaNacimiento && { fechaNacimiento: new Date(fechaNacimiento) })
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        role: true,
        ranking: true,
        puntos: true
      }
    });

    res.json({
      message: 'Jugador actualizado exitosamente',
      player
    });
  } catch (error) {
    console.error('Error actualizando jugador:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Dar de baja jugador (solo Admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si el jugador existe
    const player = await prisma.player.findUnique({
      where: { id: parseInt(id) }
    });

    if (!player) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    // En lugar de eliminar, marcar como inactivo
    await prisma.player.update({
      where: { id: parseInt(id) },
      data: {
        activo: false,
        fechaBaja: new Date()
      }
    });

    res.json({ message: 'Jugador dado de baja exitosamente' });
  } catch (error) {
    console.error('Error dando de baja al jugador:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Reactivar jugador (solo Admin)
router.patch('/:id/reactivar', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si el jugador existe
    const player = await prisma.player.findUnique({
      where: { id: parseInt(id) }
    });

    if (!player) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    // Reactivar el jugador
    await prisma.player.update({
      where: { id: parseInt(id) },
      data: {
        activo: true,
        fechaBaja: null
      }
    });

    res.json({ message: 'Jugador reactivado exitosamente' });
  } catch (error) {
    console.error('Error reactivando al jugador:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Importar jugadores desde CSV/Excel
router.post('/import', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo requerido' });
    }

    const players = [];
    const bcrypt = require('bcryptjs');

    if (req.file.mimetype === 'text/csv') {
      // Procesar CSV
      const csvData = req.file.buffer.toString();
      const lines = csvData.split('\n');
      const headers = lines[0].split(',').map(h => h.trim());

      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
          const values = lines[i].split(',').map(v => v.trim());
          const player = {};
          
          headers.forEach((header, index) => {
            player[header] = values[index];
          });

          if (player.nombre && player.email) {
            players.push(player);
          }
        }
      }
    } else {
      // Procesar Excel
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      data.forEach(row => {
        if (row.nombre && row.email) {
          players.push(row);
        }
      });
    }

    if (players.length === 0) {
      return res.status(400).json({ error: 'No se encontraron jugadores válidos en el archivo' });
    }

    // Crear jugadores en la base de datos
    const createdPlayers = [];
    const errors = [];

    for (const playerData of players) {
      try {
        // Verificar si el email ya existe
        const existingPlayer = await prisma.player.findUnique({
          where: { email: playerData.email }
        });

        if (existingPlayer) {
          errors.push(`Email ${playerData.email} ya existe`);
          continue;
        }

        // Encriptar contraseña (usar email como contraseña por defecto)
        const hashedPassword = await bcrypt.hash(playerData.email, 12);

        const player = await prisma.player.create({
          data: {
            nombre: playerData.nombre,
            email: playerData.email,
            password: hashedPassword,
            role: playerData.role || 'Jugador'
          },
          select: {
            id: true,
            nombre: true,
            email: true,
            role: true
          }
        });

        createdPlayers.push(player);
      } catch (error) {
        errors.push(`Error creando ${playerData.nombre}: ${error.message}`);
      }
    }

    res.json({
      message: `${createdPlayers.length} jugadores importados exitosamente`,
      createdPlayers,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error importando jugadores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Exportar jugadores a CSV
router.get('/export/csv', authenticateToken, requireArbitro, async (req, res) => {
  try {
    const players = await prisma.player.findMany({
      select: {
        id: true,
        nombre: true,
        email: true,
        ranking: true,
        puntos: true,
        role: true,
        createdAt: true
      },
      orderBy: { ranking: 'asc' }
    });

    // Crear CSV
    const csvHeader = 'ID,Nombre,Email,Ranking,Puntos,Rol,Fecha Creación\n';
    const csvData = players.map(player => 
      `${player.id},"${player.nombre}","${player.email}",${player.ranking},${player.puntos},"${player.role}","${player.createdAt.toISOString()}"`
    ).join('\n');

    const csvContent = csvHeader + csvData;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=jugadores.csv');
    res.send(csvContent);
  } catch (error) {
    console.error('Error exportando jugadores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;


