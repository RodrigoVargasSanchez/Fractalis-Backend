// src/routes/auth.routes.ts
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura';

router.post('/login', async (req, res) => {
  console.log("Datos recibidos para login:", req.body);
  const { email, usuarioNombre, clave } = req.body;
  const loginUser = email || usuarioNombre;

  if (!loginUser || !clave) {
    return res.status(400).json({ message: 'El correo electrónico y la contraseña son obligatorios' });
  }

  try {
    const result = await pool.query(
      'SELECT usuario_id, usuario_nombre, password_hash, rol FROM usuarios WHERE TRIM(usuario_email) ILIKE $1',
      [loginUser.trim()]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(clave, user.password_hash))) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Generamos el token incluyendo el usuario_id y rol
    const token = jwt.sign(
      { usuarioId: user.usuario_id, nombre: user.usuario_nombre, rol: user.rol || 'usuario' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token });
  } catch (error: any) {
    console.error("❌ [LOGIN-ERROR] Error:", error.message);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

export default router;