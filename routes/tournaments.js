const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { requireAdmin, requireArbitro } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Algoritmo para generar cuadro de eliminación directa
const generateEliminationBracket = (players, tournamentId) => {
  const matches = [];
  const numPlayers = players.length;
  const numRounds = Math.ceil(Math.log2(numPlayers));
  const totalSlots = Math.pow(2, numRounds);
  
  // Rellenar con BYE si es necesario
  while (players.length < totalSlots) {
    players.push(null); // BYE
  }

  // Mezclar jugadores aleatoriamente
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }

  // Generar partidos de la primera ronda
  for (let i = 0; i < totalSlots; i += 2) {
    if (players[i] && players[i + 1]) {
      matches.push({
        torneoId: tournamentId,
        jugador1Id: players[i].id,
        jugador2Id: players[i + 1].id,
        ronda: 1,
        fase: 'Principal'
      });
    } else if (players[i]) {
      // BYE - el jugador avanza automáticamente
      matches.push({
        torneoId: tournamentId,
        jugador1Id: players[i].id,
        jugador2Id: null,
        ronda: 1,
        fase: 'Principal',
        ganadorId: players[i].id,
        setsJ1: 1,
        setsJ2: 0,
        estado: 'Finalizado'
      });
    }
  }

  return matches;
};

// Algoritmo para generar grupos
const generateGroups = (players, numGroups, tournamentId) => {
  const groups = [];
  const playersPerGroup = Math.ceil(players.length / numGroups);
  
  // Mezclar jugadores
  const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
  
  for (let i = 0; i < numGroups; i++) {
    const groupPlayers = shuffledPlayers.slice(i * playersPerGroup, (i + 1) * playersPerGroup);
    groups.push({
      torneoId: tournamentId,
      nombre: `Grupo ${String.fromCharCode(65 + i)}`, // A, B, C, etc.
      jugadores: groupPlayers
    });
  }
  
  return groups;
};

// Algoritmo para generar Round Robin (todos contra todos)
const generateRoundRobinBracket = (players, tournamentId) => {
  const matches = [];
  const numPlayers = players.length;
  
  // Si el número de jugadores es impar, agregar un "BYE" (jugador fantasma)
  const playersWithBye = numPlayers % 2 === 0 ? [...players] : [...players, null];
  const n = playersWithBye.length;
  
  console.log(`Generando Round Robin para ${numPlayers} jugadores (${n} con BYE)`);
  console.log('Jugadores:', playersWithBye.map(p => p ? p.nombre : 'BYE'));
  
  // Algoritmo de Round Robin usando el método del círculo
  for (let round = 1; round <= n - 1; round++) {
    console.log(`\nRonda ${round}:`);
    
    for (let i = 0; i < n / 2; i++) {
      const player1Index = i;
      const player2Index = n - 1 - i;
      
      const player1 = playersWithBye[player1Index];
      const player2 = playersWithBye[player2Index];
      
      console.log(`  ${player1 ? player1.nombre : 'BYE'} vs ${player2 ? player2.nombre : 'BYE'}`);
      
      // Solo crear partido si ambos jugadores existen (no BYE)
      if (player1 && player2) {
        matches.push({
          torneoId: tournamentId,
          jugador1Id: player1.id,
          jugador2Id: player2.id,
          ronda: round,
          fase: 'Principal'
        });
      }
    }
    
    // Rotar jugadores (excepto el primero)
    const temp = playersWithBye[1];
    for (let i = 1; i < n - 1; i++) {
      playersWithBye[i] = playersWithBye[i + 1];
    }
    playersWithBye[n - 1] = temp;
    
    console.log('Después de rotación:', playersWithBye.map(p => p ? p.nombre : 'BYE'));
  }
  
  console.log(`\nTotal de partidos generados: ${matches.length}`);
  return matches;
};

// Obtener todos los torneos
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, status = '', type = '', search = '', sortBy = 'nombre', sortOrder = 'asc' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const where = {};
    if (status && status !== 'all') where.status = status;
    if (type && type !== 'all') where.tipo = type;
    if (search) {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { descripcion: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Mapear campos de ordenamiento
    const orderByMap = {
      nombre: 'nombre',
      tipo: 'tipo',
      status: 'status',
      fechaInicio: 'fechaInicio',
      fechaFin: 'fechaFin',
      createdAt: 'createdAt'
    };

    const orderByField = orderByMap[sortBy] || 'nombre';
    const orderByDirection = sortOrder === 'desc' ? 'desc' : 'asc';

    const tournaments = await prisma.tournament.findMany({
      where,
      include: {
        _count: {
          select: { matches: true }
        }
      },
      orderBy: { [orderByField]: orderByDirection },
      skip,
      take: parseInt(limit)
    });

    const total = await prisma.tournament.count({ where });

    res.json({
      tournaments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error obteniendo torneos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener un torneo por ID con detalles completos
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id: parseInt(id) },
      include: {
        matches: {
          include: {
            jugador1: { select: { id: true, nombre: true } },
            jugador2: { select: { id: true, nombre: true } },
            ganador: { select: { id: true, nombre: true } },
            sets: {
              orderBy: { numeroSet: 'asc' }
            }
          },
          orderBy: [{ ronda: 'asc' }, { id: 'asc' }]
        },
        groups: {
          include: {
            jugadores: { select: { id: true, nombre: true } }
          }
        },
        tournamentResults: {
          include: {
            jugador: { select: { id: true, nombre: true } }
          },
          orderBy: { posicionFinal: 'asc' }
        }
      }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Torneo no encontrado' });
    }

    // Procesar los partidos para incluir información adicional
    const processedMatches = tournament.matches.map(match => {
      // Calcular el resultado del partido
      let resultado = '';
      let ganadorNombre = '';
      
      if (match.estado === 'Finalizado') {
        if (match.ganadorId) {
          ganadorNombre = match.ganador?.nombre || 'Desconocido';
          resultado = `${match.setsJ1 || 0} - ${match.setsJ2 || 0}`;
        } else {
          resultado = `${match.setsJ1 || 0} - ${match.setsJ2 || 0}`;
        }
      } else if (match.estado === 'En curso') {
        resultado = 'En progreso';
      } else {
        resultado = 'Pendiente';
      }

      // Procesar los sets individuales
      const setsDetallados = match.sets.map(set => ({
        id: set.id,
        numeroSet: set.numeroSet,
        puntosJ1: set.puntosJ1,
        puntosJ2: set.puntosJ2,
        ganadorId: set.ganadorId,
        ganador: set.ganadorId === match.jugador1Id ? match.jugador1?.nombre : 
                set.ganadorId === match.jugador2Id ? match.jugador2?.nombre : null,
        resultado: `${set.puntosJ1} - ${set.puntosJ2}`,
        estado: set.ganadorId ? 'Finalizado' : 'Pendiente'
      }));

      return {
        ...match,
        resultado,
        ganadorNombre,
        sets: setsDetallados,
        fechaHora: match.updatedAt || match.createdAt
      };
    });

    // Crear el objeto de respuesta con los partidos procesados
    const tournamentWithProcessedMatches = {
      ...tournament,
      partidos: processedMatches
    };

    res.json({ tournament: tournamentWithProcessedMatches });
  } catch (error) {
    console.error('Error obteniendo torneo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Crear nuevo torneo
router.post('/', [
  body('name').trim().isLength({ min: 3 }).withMessage('El nombre debe tener al menos 3 caracteres'),
  body('type').isIn(['elimination', 'double_elimination', 'round_robin', 'groups_elimination']).withMessage('Tipo de torneo inválido'),
  body('setsToWin').isInt({ min: 3, max: 7 }).withMessage('Sets por partido debe ser entre 3 y 7'),
  body('startDate').isISO8601().withMessage('Fecha de inicio inválida'),
  body('maxPlayers').isInt({ min: 2, max: 128 }).withMessage('Máximo de jugadores debe ser entre 2 y 128')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, type, setsToWin, startDate, endDate, maxPlayers, description } = req.body;

    // Mapear tipos del frontend a tipos del backend
    const typeMapping = {
      'elimination': 'Eliminación directa',
      'double_elimination': 'Doble eliminación',
      'round_robin': 'Round Robin',
      'groups_elimination': 'Grupos + Eliminación'
    };
    
    console.log('Creating tournament with data:', req.body);
    console.log('Type mapping:', typeMapping[type]);

    const tournament = await prisma.tournament.create({
      data: {
        nombre: name,
        tipo: typeMapping[type],
        setsPorPartido: setsToWin,
        fechaInicio: new Date(startDate),
        fechaFin: endDate ? new Date(endDate) : null,
        maxJugadores: maxPlayers,
        puntosPorSet: 11, // Valor fijo para tenis de mesa
        descripcion: description || null,
        estado: 'Pendiente'
      },
      include: {
        _count: {
          select: { matches: true }
        }
      }
    });

    res.status(201).json({
      message: 'Torneo creado exitosamente',
      tournament
    });
  } catch (error) {
    console.error('Error creando torneo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar torneo (solo Admin)
router.put('/:id', [
  body('name').optional().trim().isLength({ min: 3 }).withMessage('El nombre debe tener al menos 3 caracteres'),
  body('description').optional().trim(),
  body('type').optional().isIn(['elimination', 'double_elimination', 'round_robin', 'groups_elimination']).withMessage('Tipo inválido'),
  body('startDate').optional().isISO8601().withMessage('Fecha de inicio inválida'),
  body('endDate').optional().isISO8601().withMessage('Fecha de fin inválida'),
  body('maxPlayers').optional().isInt({ min: 2, max: 64 }).withMessage('Número de jugadores inválido'),
  body('setsToWin').optional().isInt({ min: 3, max: 7 }).withMessage('Sets para ganar inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { name, description, type, startDate, endDate, maxPlayers, setsToWin } = req.body;
    
    console.log('Updating tournament with data:', req.body);

    // Mapear tipos del frontend a tipos del backend
    const typeMapping = {
      'elimination': 'Eliminación directa',
      'double_elimination': 'Doble eliminación',
      'round_robin': 'Round Robin',
      'groups_elimination': 'Grupos + Eliminación'
    };

    const tournament = await prisma.tournament.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { nombre: name }),
        ...(description && { descripcion: description }),
        ...(type && { tipo: typeMapping[type] || type }),
        ...(startDate && { fechaInicio: new Date(startDate) }),
        ...(endDate && { fechaFin: new Date(endDate) }),
        ...(maxPlayers && { maxJugadores: maxPlayers }),
        ...(setsToWin && { setsPorPartido: setsToWin })
      }
    });

    res.json({
      message: 'Torneo actualizado exitosamente',
      tournament
    });
  } catch (error) {
    console.error('Error actualizando torneo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Eliminar torneo
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { force = false } = req.query; // Parámetro para forzar eliminación

    const tournament = await prisma.tournament.findUnique({
      where: { id: parseInt(id) },
      include: {
        _count: {
          select: { matches: true }
        }
      }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Torneo no encontrado' });
    }

    if (tournament._count.matches > 0 && !force) {
      return res.status(400).json({ 
        error: 'No se puede eliminar el torneo porque tiene partidos asociados. Use force=true para eliminar todo.' 
      });
    }

    // Obtener resultados del torneo antes de eliminar
    const tournamentResults = await prisma.tournamentResult.findMany({
      where: { torneoId: parseInt(id) },
      select: {
        jugadorId: true,
        puntosGanados: true
      }
    });

    console.log(`Encontrados ${tournamentResults.length} resultados del torneo ${id}`);

    // Si force=true, eliminar partidos primero
    if (force && tournament._count.matches > 0) {
      await prisma.match.deleteMany({
        where: { torneoId: parseInt(id) }
      });
      console.log(`Eliminados ${tournament._count.matches} partidos del torneo ${id}`);
    }

    // Eliminar resultados del torneo
    await prisma.tournamentResult.deleteMany({
      where: { torneoId: parseInt(id) }
    });
    console.log(`Eliminados ${tournamentResults.length} resultados del torneo ${id}`);

    // Restar puntos de los jugadores
    for (const result of tournamentResults) {
      await prisma.player.update({
        where: { id: result.jugadorId },
        data: {
          puntos: {
            decrement: result.puntosGanados
          }
        }
      });
      console.log(`Restados ${result.puntosGanados} puntos al jugador ${result.jugadorId}`);
    }

    // Eliminar el torneo
    await prisma.tournament.delete({
      where: { id: parseInt(id) }
    });

    console.log(`✅ Torneo ${id} eliminado completamente con todos sus datos`);

    res.json({ 
      message: 'Torneo eliminado exitosamente',
      pointsRemoved: tournamentResults.length,
      totalPointsRemoved: tournamentResults.reduce((sum, r) => sum + r.puntosGanados, 0)
    });
  } catch (error) {
    console.error('Error eliminando torneo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Generar cuadro de torneo
router.post('/:id/generate-bracket', async (req, res) => {
  try {
    const { id } = req.params;
    const { playerIds, seedingType = 'automatic' } = req.body;

    const tournament = await prisma.tournament.findUnique({
      where: { id: parseInt(id) }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Torneo no encontrado' });
    }

    if (tournament.estado !== 'Pendiente') {
      return res.status(400).json({ error: 'Solo se puede generar el cuadro para torneos pendientes' });
    }

    // Obtener jugadores
    const players = await prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, nombre: true, ranking: true }
    });

    if (players.length < 2) {
      return res.status(400).json({ error: 'Se requieren al menos 2 jugadores' });
    }

    let matches = [];

    if (tournament.tipo === 'Eliminación directa') {
      matches = generateEliminationBracket(players, parseInt(id));
    } else if (tournament.tipo === 'Grupos + Eliminación') {
      // Generar grupos primero
      const numGroups = Math.ceil(players.length / 4); // 4 jugadores por grupo por defecto
      const groups = generateGroups(players, numGroups, parseInt(id));
      
      // Crear grupos en la base de datos
      for (const group of groups) {
        await prisma.group.create({
          data: {
            torneoId: parseInt(id),
            nombre: group.nombre,
            jugadores: {
              connect: group.jugadores.map(p => ({ id: p.id }))
            }
          }
        });
      }
    } else if (tournament.tipo === 'Round Robin') {
      matches = generateRoundRobinBracket(players, parseInt(id));
    }

    // Crear partidos en la base de datos
    if (matches.length > 0) {
      await prisma.match.createMany({
        data: matches
      });
    }

    // Actualizar estado del torneo
    await prisma.tournament.update({
      where: { id: parseInt(id) },
      data: { estado: 'En curso' }
    });

    // Notificar a través de Socket.io
    const io = req.app.get('io');
    io.to(`tournament-${id}`).emit('bracket-generated', {
      tournamentId: parseInt(id),
      matches: matches.length
    });

    res.json({
      message: 'Cuadro de torneo generado exitosamente',
      matchesCreated: matches.length
    });
  } catch (error) {
    console.error('Error generando cuadro:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Sorteo manual (Drag & Drop)
router.post('/:id/manual-seeding', async (req, res) => {
  try {
    console.log('Iniciando sorteo manual...');
    const { id } = req.params;
    const { seededPlayers } = req.body; // Array de { position: number, playerId: number }
    
    console.log('Tournament ID:', id);
    console.log('Seeded Players:', seededPlayers);

    const tournament = await prisma.tournament.findUnique({
      where: { id: parseInt(id) }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Torneo no encontrado' });
    }

    if (tournament.estado !== 'Pendiente') {
      return res.status(400).json({ error: 'Solo se puede hacer sorteo para torneos pendientes' });
    }

    // Validar que todos los jugadores existen
    const playerIds = seededPlayers.map(sp => sp.playerId);
    console.log('Player IDs:', playerIds);
    
    const players = await prisma.player.findMany({
      where: { id: { in: playerIds } }
    });
    
    console.log('Players found:', players.length);
    console.log('Players:', players.map(p => ({ id: p.id, nombre: p.nombre })));

    if (players.length !== seededPlayers.length) {
      console.log('Error: No se encontraron todos los jugadores');
      return res.status(400).json({ error: 'Algunos jugadores no existen' });
    }

    // Generar partidos según el tipo de torneo
    let matches = [];
    
    console.log('Tipo de torneo:', tournament.tipo);
    
    if (tournament.tipo === 'Round Robin') {
      // Para Round Robin, generar todos los partidos automáticamente
      matches = generateRoundRobinBracket(players, parseInt(id));
    } else {
      // Para otros tipos de torneo (eliminación directa, etc.)
      const numRounds = Math.ceil(Math.log2(seededPlayers.length));
      const totalSlots = Math.pow(2, numRounds);

      // Rellenar posiciones vacías con null (BYE)
      const positions = new Array(totalSlots).fill(null);
      seededPlayers.forEach(sp => {
        positions[sp.position - 1] = players.find(p => p.id === sp.playerId);
      });

      // Generar partidos de la primera ronda
      for (let i = 0; i < totalSlots; i += 2) {
        if (positions[i] && positions[i + 1]) {
          // Partido normal entre dos jugadores
          matches.push({
            torneoId: parseInt(id),
            jugador1Id: positions[i].id,
            jugador2Id: positions[i + 1].id,
            ronda: 1,
            fase: 'Principal'
          });
        } else if (positions[i]) {
          // BYE - el jugador avanza automáticamente
          // No creamos un partido, solo registramos que el jugador avanza
          // Esto se manejará en la siguiente ronda
          console.log(`BYE para jugador ${positions[i].nombre} en posición ${i + 1}`);
        }
      }
    }

    // Crear partidos en la base de datos
    console.log('Matches to create:', matches.length);
    console.log('Matches:', matches);
    if (matches.length > 0) {
      await prisma.match.createMany({
        data: matches
      });
      console.log('Matches created successfully');
    }

    // Actualizar estado del torneo
    await prisma.tournament.update({
      where: { id: parseInt(id) },
      data: { estado: 'En curso' }
    });

    // Notificar a través de Socket.io
    const io = req.app.get('io');
    io.to(`tournament-${id}`).emit('manual-seeding-completed', {
      tournamentId: parseInt(id),
      matches: matches.length
    });

    res.json({
      message: 'Sorteo manual completado exitosamente',
      matchesCreated: matches.length
    });
  } catch (error) {
    console.error('Error en sorteo manual:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener estadísticas del torneo
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id: parseInt(id) },
      include: {
        matches: {
          include: {
            jugador1: { select: { id: true, nombre: true } },
            jugador2: { select: { id: true, nombre: true } }
          }
        },
        _count: {
          select: { matches: true }
        }
      }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Torneo no encontrado' });
    }

    // Calcular estadísticas
    const totalMatches = tournament._count.matches;
    const completedMatches = tournament.matches.filter(m => m.estado === 'Finalizado').length;
    const pendingMatches = tournament.matches.filter(m => m.estado === 'Pendiente').length;
    const inProgressMatches = tournament.matches.filter(m => m.estado === 'En curso').length;

    // Obtener jugadores únicos
    const playerIds = new Set();
    tournament.matches.forEach(match => {
      if (match.jugador1Id) playerIds.add(match.jugador1Id);
      if (match.jugador2Id) playerIds.add(match.jugador2Id);
    });

    const stats = {
      tournament: {
        id: tournament.id,
        nombre: tournament.nombre,
        tipo: tournament.tipo,
        estado: tournament.estado
      },
      matches: {
        total: totalMatches,
        completed: completedMatches,
        pending: pendingMatches,
        inProgress: inProgressMatches,
        progress: totalMatches > 0 ? Math.round((completedMatches / totalMatches) * 100) : 0
      },
      players: playerIds.size
    };

    res.json({ stats });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;

