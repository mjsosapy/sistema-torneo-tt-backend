const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Obtener ranking general
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const where = {};
    if (search) {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Obtener todos los jugadores ordenados por puntos para calcular ranking
    const allPlayers = await prisma.player.findMany({
      where,
      select: {
        id: true,
        nombre: true,
        email: true,
        puntos: true,
        role: true
      },
      orderBy: [
        { puntos: 'desc' }
      ]
    });

    // Filtrar solo jugadores con puntos > 0
    const playersWithPoints = allPlayers.filter(player => player.puntos > 0);

    // Si no hay jugadores con puntos, devolver respuesta vacía
    if (playersWithPoints.length === 0) {
      return res.json({
        players: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 0
        },
        message: 'No hay datos de ranking disponibles. Los jugadores necesitan participar en torneos para aparecer en el ranking.'
      });
    }

    // Calcular ranking dinámicamente solo para jugadores con puntos
    const playersWithRanking = playersWithPoints.map((player, index) => ({
      ...player,
      ranking: index + 1
    }));

    // Aplicar paginación
    const players = playersWithRanking.slice(skip, skip + parseInt(limit));

    // Obtener estadísticas de partidos para cada jugador
    const playersWithStats = await Promise.all(
      players.map(async (player) => {
        // Obtener todos los partidos del jugador
        const matches = await prisma.match.findMany({
          where: {
            OR: [
              { jugador1Id: player.id },
              { jugador2Id: player.id }
            ],
            estado: 'Finalizado'
          },
          select: {
            jugador1Id: true,
            jugador2Id: true,
            ganadorId: true,
            torneoId: true
          }
        });

        // Calcular estadísticas
        let wins = 0;
        let losses = 0;

        matches.forEach(match => {
          if (match.ganadorId === player.id) {
            wins++;
          } else {
            losses++;
          }
        });

        const totalMatches = wins + losses;
        const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

        // Calcular tendencia (últimos 5 partidos)
        const recentMatches = matches.slice(-5);
        let recentWins = 0;
        recentMatches.forEach(match => {
          if (match.ganadorId === player.id) {
            recentWins++;
          }
        });

        let trend = 'Estable';
        if (recentWins >= 4) trend = 'Ascendente';
        else if (recentWins <= 1) trend = 'Descendente';

        // Obtener estadísticas de torneos - contar torneos donde el jugador participó activamente
        const playerMatches = await prisma.match.findMany({
          where: {
            OR: [
              { jugador1Id: player.id },
              { jugador2Id: player.id }
            ],
            estado: 'Finalizado'
          },
          select: {
            torneoId: true,
            ganadorId: true
          }
        });

        // Obtener IDs únicos de torneos donde participó
        const tournamentIds = [...new Set(playerMatches.map(match => match.torneoId))];
        
        // Verificar que estos torneos estén finalizados y tengan resultados
        const tournamentResults = await prisma.tournamentResult.findMany({
          where: { 
            jugadorId: player.id,
            torneoId: { in: tournamentIds }
          },
          select: { posicionFinal: true, torneoId: true }
        });

        const tournamentsPlayed = tournamentResults.length;
        const tournamentsWon = tournamentResults.filter(result => result.posicionFinal === 1).length;

        return {
          ...player,
          name: player.nombre,
          points: player.puntos,
          wins,
          losses,
          winRate,
          trend,
          totalMatches,
          tournamentsPlayed,
          tournamentsWon
        };
      })
    );

    const total = await prisma.player.count({ where });

    res.json({
      players: playersWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error obteniendo ranking:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener top 10 del ranking
router.get('/top', async (req, res) => {
  try {
    // Obtener todos los jugadores ordenados por puntos para calcular ranking
    const allPlayers = await prisma.player.findMany({
      select: {
        id: true,
        nombre: true,
        email: true,
        puntos: true
      },
      orderBy: [
        { puntos: 'desc' }
      ]
    });

    // Filtrar solo jugadores con puntos > 0
    const playersWithPoints = allPlayers.filter(player => player.puntos > 0);

    // Si no hay jugadores con puntos, devolver respuesta vacía
    if (playersWithPoints.length === 0) {
      return res.json({
        topPlayers: [],
        message: 'No hay datos de ranking disponibles. Los jugadores necesitan participar en torneos para aparecer en el ranking.'
      });
    }

    // Calcular ranking dinámicamente solo para jugadores con puntos
    const playersWithRanking = playersWithPoints.map((player, index) => ({
      ...player,
      ranking: index + 1
    }));

    // Tomar solo los top 10
    const topPlayers = playersWithRanking.slice(0, 10);

    // Obtener estadísticas de partidos para cada jugador
    const topPlayersWithStats = await Promise.all(
      topPlayers.map(async (player) => {
        // Obtener todos los partidos del jugador
        const matches = await prisma.match.findMany({
          where: {
            OR: [
              { jugador1Id: player.id },
              { jugador2Id: player.id }
            ],
            estado: 'Finalizado'
          },
          select: {
            jugador1Id: true,
            jugador2Id: true,
            ganadorId: true,
            torneoId: true
          }
        });

        // Calcular estadísticas
        let wins = 0;
        let losses = 0;

        matches.forEach(match => {
          if (match.ganadorId === player.id) {
            wins++;
          } else {
            losses++;
          }
        });

        const totalMatches = wins + losses;
        const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

        // Calcular tendencia (últimos 5 partidos)
        const recentMatches = matches.slice(-5);
        let recentWins = 0;
        recentMatches.forEach(match => {
          if (match.ganadorId === player.id) {
            recentWins++;
          }
        });

        let trend = 'Estable';
        if (recentWins >= 4) trend = 'Ascendente';
        else if (recentWins <= 1) trend = 'Descendente';

        // Obtener estadísticas de torneos - contar torneos donde el jugador participó activamente
        const playerMatches = await prisma.match.findMany({
          where: {
            OR: [
              { jugador1Id: player.id },
              { jugador2Id: player.id }
            ],
            estado: 'Finalizado'
          },
          select: {
            torneoId: true,
            ganadorId: true
          }
        });

        // Obtener IDs únicos de torneos donde participó
        const tournamentIds = [...new Set(playerMatches.map(match => match.torneoId))];
        
        // Verificar que estos torneos estén finalizados y tengan resultados
        const tournamentResults = await prisma.tournamentResult.findMany({
          where: { 
            jugadorId: player.id,
            torneoId: { in: tournamentIds }
          },
          select: { posicionFinal: true, torneoId: true }
        });

        const tournamentsPlayed = tournamentResults.length;
        const tournamentsWon = tournamentResults.filter(result => result.posicionFinal === 1).length;

        return {
          ...player,
          // Campos en inglés para compatibilidad
          name: player.nombre,
          points: player.puntos,
          wins,
          losses,
          winRate,
          trend,
          totalMatches,
          tournamentsPlayed,
          tournamentsWon,
          // Campos en español para consistencia
          nombre: player.nombre,
          puntos: player.puntos,
          victorias: wins,
          derrotas: losses,
          porcentajeVictoria: winRate,
          tendencia: trend,
          totalPartidos: totalMatches,
          torneosJugados: tournamentsPlayed,
          torneosGanados: tournamentsWon
        };
      })
    );

    res.json({ topPlayers: topPlayersWithStats });
  } catch (error) {
    console.error('Error obteniendo top 10:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener evolución histórica de un jugador
router.get('/player/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 10 } = req.query;

    // Verificar que el jugador existe
    const player = await prisma.player.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, nombre: true, ranking: true, puntos: true }
    });

    if (!player) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    // Obtener historial de torneos del jugador
    const tournamentHistory = await prisma.tournamentResult.findMany({
      where: { jugadorId: parseInt(id) },
      include: {
        torneo: {
          select: {
            id: true,
            nombre: true,
            fechaInicio: true,
            fechaFin: true,
            tipo: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit)
    });

    // Calcular evolución de puntos
    const pointsEvolution = tournamentHistory.map((result, index) => {
      const previousPoints = index < tournamentHistory.length - 1 
        ? tournamentHistory.slice(index + 1).reduce((sum, r) => sum + r.puntosGanados, 0)
        : 0;
      
      return {
        tournamentId: result.torneo.id,
        tournamentName: result.torneo.nombre,
        date: result.torneo.fechaFin || result.torneo.fechaInicio,
        position: result.posicionFinal,
        pointsEarned: result.puntosGanados,
        totalPoints: result.puntosGanados + previousPoints
      };
    }).reverse(); // Ordenar cronológicamente

    res.json({
      player,
      tournamentHistory,
      pointsEvolution
    });
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener estadísticas de un jugador
router.get('/player/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que el jugador existe
    const player = await prisma.player.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, nombre: true, ranking: true, puntos: true }
    });

    if (!player) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    // Obtener TODOS los partidos del jugador (sin filtrar por estado)
    const allMatches = await prisma.match.findMany({
      where: {
        OR: [
          { jugador1Id: parseInt(id) },
          { jugador2Id: parseInt(id) }
        ]
      },
      include: {
        torneo: { select: { nombre: true, tipo: true, estado: true } }
      }
    });

    // Obtener partidos finalizados
    const finishedMatches = allMatches.filter(match => match.estado === 'Finalizado');
    
    // Obtener partidos en curso
    const ongoingMatches = allMatches.filter(match => match.estado === 'En curso');
    
    // Obtener partidos pendientes
    const pendingMatches = allMatches.filter(match => match.estado === 'Pendiente');

    // Calcular estadísticas de partidos finalizados
    let totalFinishedMatches = finishedMatches.length;
    let wins = 0;
    let losses = 0;
    let totalSetsWon = 0;
    let totalSetsLost = 0;
    let tournamentsPlayed = new Set();
    let bestPosition = Infinity;
    let totalPointsEarned = 0;

    finishedMatches.forEach(match => {
      tournamentsPlayed.add(match.torneo.id);
      
      if (match.ganadorId === parseInt(id)) {
        wins++;
        totalSetsWon += match.setsJ1 || 0;
        totalSetsLost += match.setsJ2 || 0;
      } else {
        losses++;
        totalSetsWon += match.setsJ2 || 0;
        totalSetsLost += match.setsJ1 || 0;
      }
    });

    // Obtener resultados de torneos (de donde pueden venir los puntos)
    const tournamentResults = await prisma.tournamentResult.findMany({
      where: { jugadorId: parseInt(id) },
      include: {
        torneo: { select: { nombre: true, tipo: true, estado: true } }
      },
      orderBy: { posicionFinal: 'asc' }
    });

    tournamentResults.forEach(result => {
      if (result.posicionFinal < bestPosition) {
        bestPosition = result.posicionFinal;
      }
      totalPointsEarned += result.puntosGanados;
    });

    // Calcular puntos que no vienen de partidos (puntos asignados manualmente)
    const pointsFromMatches = totalPointsEarned;
    const pointsFromManual = player.puntos - pointsFromMatches;

    const stats = {
      player,
      matches: {
        total: allMatches.length,
        finished: totalFinishedMatches,
        ongoing: ongoingMatches.length,
        pending: pendingMatches.length,
        wins,
        losses,
        winRate: totalFinishedMatches > 0 ? Math.round((wins / totalFinishedMatches) * 100) : 0
      },
      sets: {
        won: totalSetsWon,
        lost: totalSetsLost,
        winRate: (totalSetsWon + totalSetsLost) > 0 ? Math.round((totalSetsWon / (totalSetsWon + totalSetsLost)) * 100) : 0
      },
      tournaments: {
        played: tournamentsPlayed.size,
        results: tournamentResults.length,
        bestPosition: bestPosition === Infinity ? 'N/A' : bestPosition,
        totalPointsEarned
      },
      points: {
        total: player.puntos,
        fromMatches: pointsFromMatches,
        fromManual: pointsFromManual,
        explanation: pointsFromManual > 0 ? 
          `${pointsFromManual} puntos fueron asignados manualmente` : 
          'Todos los puntos provienen de partidos jugados'
      }
    };

    res.json({ stats });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener historial de torneos
router.get('/tournaments', async (req, res) => {
  try {
    const { page = 1, limit = 10, estado = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const where = {};
    if (estado) where.estado = estado;

    const tournaments = await prisma.tournament.findMany({
      where,
      include: {
        _count: {
          select: { 
            matches: true,
            tournamentResults: true
          }
        },
        tournamentResults: {
          include: {
            jugador: { select: { id: true, nombre: true } }
          },
          orderBy: { posicionFinal: 'asc' },
          take: 3 // Solo los primeros 3 lugares
        }
      },
      orderBy: { createdAt: 'desc' },
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
    console.error('Error obteniendo historial de torneos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener resultados de un torneo específico
router.get('/tournament/:id/results', async (req, res) => {
  try {
    const { id } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id: parseInt(id) },
      include: {
        tournamentResults: {
          include: {
            jugador: { select: { id: true, nombre: true, ranking: true } }
          },
          orderBy: { posicionFinal: 'asc' }
        }
      }
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Torneo no encontrado' });
    }

    res.json({ tournament });
  } catch (error) {
    console.error('Error obteniendo resultados del torneo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener estadísticas generales del sistema
router.get('/stats', async (req, res) => {
  try {
    // Contar jugadores
    const totalPlayers = await prisma.player.count({
      where: { role: 'Jugador' }
    });
    
    // Contar torneos
    const totalTournaments = await prisma.tournament.count();
    const completedTournaments = await prisma.tournament.count({
      where: { estado: 'Finalizado' }
    });
    
    // Contar partidos
    const totalMatches = await prisma.match.count();
    const completedMatches = await prisma.match.count({
      where: { estado: 'Finalizado' }
    });

    // Calcular puntos totales y promedio
    const playersWithPoints = await prisma.player.findMany({
      where: { role: 'Jugador' },
      select: { puntos: true }
    });
    
    const totalPoints = playersWithPoints.reduce((sum, player) => sum + player.puntos, 0);
    const averagePoints = totalPlayers > 0 ? Math.round(totalPoints / totalPlayers) : 0;

    // Obtener jugador con más puntos
    const topPlayer = await prisma.player.findFirst({
      select: { id: true, nombre: true, puntos: true },
      where: { role: 'Jugador' },
      orderBy: { puntos: 'desc' }
    });

    // Obtener torneo más reciente
    const latestTournament = await prisma.tournament.findFirst({
      select: { id: true, nombre: true, fechaInicio: true },
      orderBy: { createdAt: 'desc' }
    });

    const stats = {
      totalPlayers,
      totalTournaments,
      totalPoints,
      averagePoints,
      completedTournaments,
      totalMatches,
      completedMatches,
      completionRate: totalTournaments > 0 ? Math.round((completedTournaments / totalTournaments) * 100) : 0,
      topPlayer,
      latestTournament
    };

    res.json({ stats });
  } catch (error) {
    console.error('Error obteniendo estadísticas generales:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener líderes por categoría
router.get('/leaders', async (req, res) => {
  try {
    // Líder en puntos (solo jugadores con puntos > 0)
    const pointsLeader = await prisma.player.findFirst({
      select: { id: true, nombre: true, puntos: true },
      where: { puntos: { gt: 0 } },
      orderBy: { puntos: 'desc' }
    });

    // Jugador con mejor ranking (solo jugadores con puntos > 0)
    const rankingLeader = await prisma.player.findFirst({
      select: { id: true, nombre: true, ranking: true },
      where: { puntos: { gt: 0 } },
      orderBy: { ranking: 'asc' }
    });

    // Jugador más activo (más partidos jugados)
    const mostActivePlayer = await prisma.player.findFirst({
      select: {
        id: true,
        nombre: true,
        _count: {
          select: {
            matches1: true,
            matches2: true
          }
        }
      },
      orderBy: {
        matches1: { _count: 'desc' }
      }
    });

    const leaders = {
      points: pointsLeader,
      ranking: rankingLeader,
      mostActive: mostActivePlayer ? {
        id: mostActivePlayer.id,
        nombre: mostActivePlayer.nombre,
        totalMatches: mostActivePlayer._count.matches1 + mostActivePlayer._count.matches2
      } : null
    };

    res.json({ leaders });
  } catch (error) {
    console.error('Error obteniendo líderes:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;

