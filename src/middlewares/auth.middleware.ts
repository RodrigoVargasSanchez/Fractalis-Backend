// src/middlewares/auth.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * OPCIÓN 2 RECOMENDADA: Validación explícita de variables de entorno.
 * Esto evita errores de tipo "undefined" y detiene el servidor si la configuración es incorrecta.
 */
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("❌ ERROR: La variable de entorno JWT_SECRET no está definida en el archivo .env");
}

/**
 * Middleware para autenticar el JSON Web Token.
 * Coherente con la configuración de server.ts para inyectar el usuario en el contexto.
 */
export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  // El token se recibe en el header 'Authorization' con formato 'Bearer <token>'
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ 
      message: 'No hay token, autorización denegada' 
    });
  }

  // Extraer el token (segunda parte tras el espacio)
  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      message: 'Formato de token inválido' 
    });
  }

  try {
    // Verificamos el token usando el secreto validado arriba
    const decoded = jwt.verify(token, JWT_SECRET);
    
    /**
     * Guardamos los datos decodificados en el objeto request.
     * Importante: Se usa (req as any).user para que coincida con:
     * userId: (req as any).user?.usuarioId en tu server.ts
     */
    (req as any).user = decoded; 
    
    next();
  } catch (err) {
    return res.status(401).json({ 
      message: 'Token no es válido o ha expirado' 
    });
  }
};