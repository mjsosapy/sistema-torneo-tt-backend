const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { requireArbitro } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Obtener todos los partidos de un torneo
router.get('/tournament/:tournamentId', async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { ronda, fase, estado } = req.query;

    const where = { torneoId: parseInt(tournamentId) };
    if (ronda) where.ronda = parseInt(ronda);
    if (fase) where.fase = fase;
    if (estado) where.estado = estado;

    const matches = await prisma.match.findMany({
      where,
      include: {
        jugador1: { select: { id: true, nombre: true } },
        jugador2: { select: { id: true, nombre: true } }
      },
      orderBy: [{ ronda: 'asc' }, { id: 'asc' }]
    });

    res.json({ matches });
  } catch (error) {
    console.error('Error obteniendo partidos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener un partido específico
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const match = await prisma.match.findUnique({
      where: { id: parseInt(id) },
      include: {
        torneo: { select: { id: true, nombre: true, setsPorPartido: true } },
        jugador1: { select: { id: true, nombre: true } },
        jugador2: { select: { id: true, nombre: true } }
      }
    });

    if (!match) {
      return res.status(404).json({ error: 'Partido no encontrado' });
    }

    res.json({ match });
  } catch (error) {
    console.error('Error obteniendo partido:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Registrar resultado de partido (solo Árbitro/Admin)
router.put('/:id/result', requireArbitro, [
  body('sets').isArray().withMessage('Sets debe ser un array'),
  body('winnerId').isInt().withMessage('ID del ganador requerido'),
  body('status').isIn(['Pendiente', 'En curso', 'Finalizado']).withMessage('Estado inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { sets, winnerId, status } = req.body;

    // Obtener el partido
    const match = await prisma.match.findUnique({
      where: { id: parseInt(id) },
      include: {
        torneo: { select: { id: true, nombre: true, setsPorPartido: true } },
        jugador1: { select: { id: true, nombre: true } },
        jugador2: { select: { id: true, nombre: true } }
      }
    });

    if (!match) {
      return res.status(404).json({ error: 'Partido no encontrado' });
    }

    if (match.estado === 'Finalizado') {
      return res.status(400).json({ error: 'El partido ya está finalizado' });
    }

    // Validar que el ganador es uno de los jugadores
    if (winnerId !== match.jugador1Id && winnerId !== match.jugador2Id) {
      return res.status(400).json({ error: 'El ganador debe ser uno de los jugadores del partido' });
    }

    // Validar que los sets son válidos
    if (!sets || sets.length === 0) {
      return res.status(400).json({ error: 'Debe proporcionar al menos un set' });
    }

    // Calcular sets ganados por cada jugador
    let setsJ1 = 0;
    let setsJ2 = 0;

    sets.forEach(set => {
      if (set.player1Score > set.player2Score) {
        setsJ1++;
      } else if (set.player2Score > set.player1Score) {
        setsJ2++;
      }
    });

    // Validar formato del torneo
    const maxSets = match.torneo.setsPorPartido;
    const setsNeeded = Math.ceil(maxSets / 2);

    // Verificar si el partido está completado
    const isCompleted = setsJ1 >= setsNeeded || setsJ2 >= setsNeeded;

    // Validar que no se registren sets adicionales si el partido ya está completado
    if (isCompleted && sets.length > setsNeeded * 2 - 1) {
      return res.status(400).json({ 
        error: `El partido ya está completado. Se necesitan ${setsNeeded} sets para ganar. No se pueden registrar sets adicionales.` 
      });
    }

    // Validar que el ganador coincide con los sets
    if (setsJ1 + setsJ2 > maxSets) {
      return res.status(400).json({ error: `Los sets no pueden sumar más de ${maxSets}` });
    }

    if (!isCompleted) {
      return res.status(400).json({ 
        error: `El partido no está completado. Se necesitan ${setsNeeded} sets para ganar. Actual: ${setsJ1} vs ${setsJ2}` 
      });
    }

    if (setsJ1 >= setsNeeded && setsJ2 >= setsNeeded) {
      return res.status(400).json({ error: 'Solo un jugador puede ganar' });
    }

    // Validar que el ganador declarado coincide con los sets
    const actualWinner = setsJ1 >= setsNeeded ? match.jugador1Id : match.jugador2Id;
    if (winnerId !== actualWinner) {
      return res.status(400).json({ 
        error: `El ganador declarado no coincide con los resultados. Ganador real: ${setsJ1 >= setsNeeded ? match.jugador1.nombre : match.jugador2.nombre}` 
      });
    }

    // Actualizar el partido
    const updatedMatch = await prisma.match.update({
      where: { id: parseInt(id) },
      data: {
        setsJ1,
        setsJ2,
        ganadorId: winnerId,
        estado: status || 'Finalizado',
        fecha: new Date()
      },
      include: {
        torneo: { select: { id: true, nombre: true } },
        jugador1: { select: { id: true, nombre: true } },
        jugador2: { select: { id: true, nombre: true } }
      }
    });

    // Crear los sets individuales
    const setsToCreate = sets.map((set, index) => ({
      partidoId: parseInt(id),
      numeroSet: index + 1,
      puntosJ1: set.player1Score,
      puntosJ2: set.player2Score,
      ganadorId: set.player1Score > set.player2Score ? match.jugador1Id : match.jugador2Id
    }));

    // Eliminar sets existentes y crear los nuevos
    await prisma.set.deleteMany({
      where: { partidoId: parseInt(id) }
    });

    if (setsToCreate.length > 0) {
      await prisma.set.createMany({
        data: setsToCreate
      });
    }

    // Generar siguiente partido si es necesario
    await generateNextMatch(updatedMatch);

    // Notificar a través de Socket.io
    const io = req.app.get('io');
    io.to(`tournament-${match.torneo.id}`).emit('match-updated', {
      matchId: parseInt(id),
      tournamentId: match.torneo.id,
      result: {
        setsJ1,
        setsJ2,
        ganadorId: winnerId
      }
    });

    res.json({
      message: 'Resultado registrado exitosamente',
      match: updatedMatch
    });
  } catch (error) {
    console.error('Error registrando resultado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Función para generar el siguiente partido
const generateNextMatch = async (completedMatch) => {
  try {
    const { torneoId, ronda, fase } = completedMatch;
    
    // Obtener todos los partidos de la misma ronda y fase
    const roundMatches = await prisma.match.findMany({
      where: {
        torneoId,
        ronda,
        fase
      },
      orderBy: { id: 'asc' }
    });

    // Verificar si todos los partidos de la ronda están completados
    const allCompleted = roundMatches.every(match => match.estado === 'Finalizado');
    
    if (!allCompleted) {
      return; // Esperar a que se completen todos los partidos de la ronda
    }

    // Obtener ganadores de la ronda
    const winners = roundMatches
      .filter(match => match.ganadorId)
      .map(match => match.ganadorId);

    if (winners.length <= 1) {
      // Torneo terminado o solo queda un ganador
      if (winners.length === 1) {
        await finalizeTournament(torneoId, winners[0]);
      }
      return;
    }

    // Generar partidos de la siguiente ronda
    const nextRound = ronda + 1;
    const nextMatches = [];

    for (let i = 0; i < winners.length; i += 2) {
      if (i + 1 < winners.length) {
        nextMatches.push({
          torneoId,
          jugador1Id: winners[i],
          jugador2Id: winners[i + 1],
          ronda: nextRound,
          fase
        });
      } else {
        // BYE - el jugador avanza automáticamente
        nextMatches.push({
          torneoId,
          jugador1Id: winners[i],
          jugador2Id: null,
          ronda: nextRound,
          fase,
          ganadorId: winners[i],
          setsJ1: 1,
          setsJ2: 0,
          estado: 'Finalizado'
        });
      }
    }

    // Crear los nuevos partidos
    if (nextMatches.length > 0) {
      await prisma.match.createMany({
        data: nextMatches
      });
    }

  } catch (error) {
    console.error('Error generando siguiente partido:', error);
  }
};

// Función para finalizar el torneo
const finalizeTournament = async (tournamentId, winnerId) => {
  try {
    console.log(`🏆 Finalizando torneo ${tournamentId} con ganador ${winnerId}`);
    
    // Verificar si el torneo ya está finalizado
    const existingTournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        tournamentResults: true
      }
    });

    if (existingTournament.estado === 'Finalizado') {
      console.log(`Torneo ${tournamentId} ya está finalizado`);
      return;
    }

    // Obtener todos los partidos del torneo
    const matches = await prisma.match.findMany({
      where: { torneoId: tournamentId },
      include: {
        jugador1: { select: { id: true, nombre: true } },
        jugador2: { select: { id: true, nombre: true } }
      },
      orderBy: [{ ronda: 'desc' }, { id: 'asc' }]
    });

    console.log(`Encontrados ${matches.length} partidos para el torneo ${tournamentId}`);

    // Calcular posiciones finales
    const positions = calculateFinalPositions(matches);
    
    console.log('Posiciones calculadas:', positions);
    
    // Crear resultados del torneo
    const tournamentResults = positions.map((position, index) => ({
      torneoId: tournamentId,
      jugadorId: position.playerId,
      posicionFinal: index + 1,
      puntosGanados: calculatePoints(index + 1)
    }));

    console.log('Resultados a guardar:', tournamentResults);

    // Guardar resultados
    await prisma.tournamentResult.createMany({
      data: tournamentResults
    });

    console.log('Resultados guardados exitosamente');

    // Actualizar puntos de los jugadores
    for (const result of tournamentResults) {
      await prisma.player.update({
        where: { id: result.jugadorId },
        data: {
          puntos: {
            increment: result.puntosGanados
          }
        }
      });
    }

    console.log('Puntos de jugadores actualizados');

    // Actualizar ranking
    await updateRankings();

    // Finalizar torneo
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        estado: 'Finalizado',
        fechaFin: new Date()
      }
    });

    console.log(`✅ Torneo ${tournamentId} finalizado exitosamente`);

    // Notificar a través de Socket.io
    const io = require('../index').io;
    if (io) {
      io.to(`tournament-${tournamentId}`).emit('tournament-finished', {
        tournamentId,
        winner: winnerId,
        results: tournamentResults
      });
    }

  } catch (error) {
    console.error('Error finalizando torneo:', error);
  }
};

// Función para calcular posiciones finales
const calculateFinalPositions = (matches) => {
  const players = new Map();
  
  // Contar victorias por jugador
  matches.forEach(match => {
    if (match.ganadorId) {
      const currentWins = players.get(match.ganadorId) || 0;
      players.set(match.ganadorId, currentWins + 1);
    }
  });

  // Ordenar por victorias
  return Array.from(players.entries())
    .map(([playerId, wins]) => ({ playerId, wins }))
    .sort((a, b) => b.wins - a.wins);
};

// Función para calcular puntos según posición
const calculatePoints = (position) => {
  const pointSystem = {
    1: 100,  // 1er lugar
    2: 75,   // 2do lugar
    3: 50,   // 3er lugar
    4: 25,   // 4to lugar
    5: 10,   // 5to lugar
    6: 10,   // 6to lugar
    7: 5,    // 7mo lugar
    8: 5     // 8vo lugar
  };
  
  return pointSystem[position] || 1;
};

// Función para actualizar rankings
const updateRankings = async () => {
  try {
    const players = await prisma.player.findMany({
      orderBy: { puntos: 'desc' }
    });

    // Actualizar ranking secuencial
    for (let i = 0; i < players.length; i++) {
      await prisma.player.update({
        where: { id: players[i].id },
        data: { ranking: i + 1 }
      });
    }
  } catch (error) {
    console.error('Error actualizando rankings:', error);
  }
};

// Obtener partidos en progreso
router.get('/in-progress/tournament/:tournamentId', async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const matches = await prisma.match.findMany({
      where: {
        torneoId: parseInt(tournamentId),
        estado: 'En curso'
      },
      include: {
        jugador1: { select: { id: true, nombre: true } },
        jugador2: { select: { id: true, nombre: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ matches });
  } catch (error) {
    console.error('Error obteniendo partidos en progreso:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Iniciar partido
router.put('/:id/start', requireArbitro, async (req, res) => {
  try {
    const { id } = req.params;

    const match = await prisma.match.findUnique({
      where: { id: parseInt(id) }
    });

    if (!match) {
      return res.status(404).json({ error: 'Partido no encontrado' });
    }

    if (match.estado !== 'Pendiente') {
      return res.status(400).json({ error: 'El partido no está pendiente' });
    }

    const updatedMatch = await prisma.match.update({
      where: { id: parseInt(id) },
      data: {
        estado: 'En curso',
        fecha: new Date()
      }
    });

    // Notificar a través de Socket.io
    const io = req.app.get('io');
    io.to(`tournament-${match.torneoId}`).emit('match-started', {
      matchId: parseInt(id),
      tournamentId: match.torneoId
    });

    res.json({
      message: 'Partido iniciado exitosamente',
      match: updatedMatch
    });
  } catch (error) {
    console.error('Error iniciando partido:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint para verificar y cerrar torneos completados
router.post('/check-tournament-completion/:tournamentId', requireArbitro, async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Obtener el torneo
    const tournament = await prisma.tournament.findUnique({
      where: { id: parseInt(tournamentId) },
      include: {
        matches: {
          orderBy: [{ ronda: 'desc' }, { id: 'asc' }]
        },
        tournamentResults: true
      }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Torneo no encontrado' });
    }

    if (tournament.estado === 'Finalizado') {
      return res.json({
        message: 'El torneo ya está finalizado',
        tournament: tournament
      });
    }

    // Verificar si todos los partidos están completados
    const allMatchesCompleted = tournament.matches.every(match => match.estado === 'Finalizado');
    
    if (!allMatchesCompleted) {
      const pendingMatches = tournament.matches.filter(match => match.estado !== 'Finalizado');
      return res.json({
        message: 'El torneo no está completo',
        pendingMatches: pendingMatches.length,
        totalMatches: tournament.matches.length
      });
    }

    // Encontrar el ganador (último partido finalizado)
    const finalMatch = tournament.matches.find(match => match.ganadorId);
    if (!finalMatch) {
      return res.status(400).json({ error: 'No se puede determinar el ganador del torneo' });
    }

    // Finalizar el torneo
    await finalizeTournament(parseInt(tournamentId), finalMatch.ganadorId);

    // Obtener el torneo actualizado
    const updatedTournament = await prisma.tournament.findUnique({
      where: { id: parseInt(tournamentId) },
      include: {
        tournamentResults: {
          include: {
            jugador: { select: { id: true, nombre: true } }
          },
          orderBy: { posicionFinal: 'asc' }
        }
      }
    });

    res.json({
      message: 'Torneo finalizado exitosamente',
      tournament: updatedTournament
    });

  } catch (error) {
    console.error('Error verificando finalización del torneo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint para obtener estadísticas de finalización de torneos (sin autenticación para debugging)
router.get('/tournament-completion-stats', async (req, res) => {
  try {
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

    res.json({ stats });

  } catch (error) {
    console.error('Error obteniendo estadísticas de torneos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;

