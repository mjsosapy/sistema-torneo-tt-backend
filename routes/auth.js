const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Registro de usuario
router.post('/register', [
  body('nombre').trim().isLength({ min: 2 }).withMessage('El nombre debe tener al menos 2 caracteres'),
  body('email').isEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
  body('role').optional().isIn(['Admin', 'Árbitro', 'Jugador', 'admin', 'arbitro', 'jugador']).withMessage('Rol inválido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { nombre, email, password, role = 'Jugador' } = req.body;

    // Normalizar el rol
    let normalizedRole = 'Jugador';
    if (role) {
      const roleLower = role.toLowerCase();
      if (roleLower === 'admin') normalizedRole = 'Admin';
      else if (roleLower === 'árbitro' || roleLower === 'arbitro') normalizedRole = 'Árbitro';
      else if (roleLower === 'jugador') normalizedRole = 'Jugador';
    }

    // Verificar si el email ya existe
    const existingUser = await prisma.player.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Encriptar contraseña
    const hashedPassword = await bcrypt.hash(password, 12);

    // Crear usuario
    const user = await prisma.player.create({
      data: {
        nombre,
        email,
        password: hashedPassword,
        role: normalizedRole
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

    // Generar token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user,
      token
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Login de usuario
router.post('/login', [
  body('email').isEmail().withMessage('Email inválido'),
  body('password').notEmpty().withMessage('Contraseña requerida')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Buscar usuario
    const user = await prisma.player.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Generar token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login exitoso',
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        role: user.role,
        ranking: user.ranking,
        puntos: user.puntos
      },
      token
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener perfil del usuario actual
router.get('/profile', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await prisma.player.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        nombre: true,
        email: true,
        role: true,
        ranking: true,
        puntos: true,
        telefono: true,
        fechaNacimiento: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar perfil del usuario
router.put('/profile', [
  body('nombre').optional().isLength({ min: 2 }).withMessage('El nombre debe tener al menos 2 caracteres'),
  body('email').optional().isEmail().withMessage('Email inválido'),
  body('telefono').optional().isLength({ min: 10 }).withMessage('El teléfono debe tener al menos 10 dígitos'),
  body('fechaNacimiento').optional().isISO8601().withMessage('Fecha de nacimiento inválida')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { nombre, email, telefono, fechaNacimiento } = req.body;

    // Verificar si el email ya existe (si se está actualizando)
    if (email) {
      const existingUser = await prisma.player.findFirst({
        where: {
          email,
          id: { not: decoded.userId }
        }
      });
      
      if (existingUser) {
        return res.status(400).json({ error: 'El email ya está en uso' });
      }
    }

    // Actualizar perfil
    const updatedUser = await prisma.player.update({
      where: { id: decoded.userId },
      data: {
        ...(nombre && { nombre }),
        ...(email && { email }),
        ...(telefono && { telefono }),
        ...(fechaNacimiento && { fechaNacimiento: new Date(fechaNacimiento) })
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        role: true,
        ranking: true,
        puntos: true,
        telefono: true,
        fechaNacimiento: true,
        createdAt: true
      }
    });

    res.json({ 
      message: 'Perfil actualizado exitosamente',
      user: updatedUser 
    });
  } catch (error) {
    console.error('Error actualizando perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Cambiar contraseña
router.put('/change-password', [
  body('currentPassword').notEmpty().withMessage('Contraseña actual requerida'),
  body('newPassword').isLength({ min: 6 }).withMessage('La nueva contraseña debe tener al menos 6 caracteres')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { currentPassword, newPassword } = req.body;

    // Obtener usuario con contraseña
    const user = await prisma.player.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Verificar contraseña actual
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }

    // Encriptar nueva contraseña
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    // Actualizar contraseña
    await prisma.player.update({
      where: { id: decoded.userId },
      data: { password: hashedNewPassword }
    });

    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;


