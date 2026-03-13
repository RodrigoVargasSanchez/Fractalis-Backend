// src/routes/auth.routes.ts
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool from '../config/database.js'; // Tu conexión a PostgreSQL

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura';

// src/routes/auth.routes.ts
router.post('/login', async (req, res) => {
  const { usuarioNombre, clave } = req.body;

  try {
    // Buscamos por usuario_nombre según tu esquema de DB
    const result = await pool.query(
      'SELECT usuario_id, usuario_nombre, password_hash FROM usuarios WHERE usuario_nombre = $1', 
      [usuarioNombre]
    );
    
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(clave, user.password_hash))) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Generamos el token incluyendo el usuario_id para que PostGraphile lo use
    const token = jwt.sign(
      { usuarioId: user.usuario_id, nombre: user.usuario_nombre },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({ token });
  } catch (error) {
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

export default router;