import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { usuarioNombre, clave } = req.body; // 'clave' sería el ID en este ejemplo de prueba

  try {
    // Buscar usuario en PostgreSQL
    const result = await pool.query(
      'SELECT usuario_id, usuario_nombre FROM usuarios WHERE usuario_nombre = $1 AND usuario_id = $2',
      [usuarioNombre, clave]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const usuario = result.rows[0];

    // Generar JWT
    const token = jwt.sign(
      { usuarioId: usuario.usuario_id, nombre: usuario.usuario_nombre },
      process.env.JWT_SECRET!,
      { expiresIn: '8h' }
    );

    res.json({ token, usuario: { id: usuario.usuario_id, nombre: usuario.usuario_nombre } });
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

export default router;