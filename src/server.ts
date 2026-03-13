import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { postgraphile } from 'postgraphile';
import { postgraphileOptions } from './graphql/postgraphile.js';
import customRoutes from './routes/custom.routes.js';
import authRoutes from './routes/auth.routes.js';
import { authenticateToken } from './middlewares/auth.middleware.js'; //

dotenv.config();

const app = express();

// 1. Middlewares globales
app.use(cors());
app.use(express.json()); // Movido aquí para que todas las rutas lo usen sin repetirlo

// 2. Rutas de Autenticación (PÚBLICAS)
// No llevan el middleware authenticateToken porque es donde el usuario inicia sesión
app.use('/api/auth', authRoutes); //

// 3. Rutas de la API (PROTEGIDAS)
// Aplicamos el middleware de autenticación antes de cargar tus rutas personalizadas
app.use('/api', authenticateToken, customRoutes); //

// 4. PostGraphile (GraphQL)
app.use(
  postgraphile(
    process.env.DATABASE_URL!,
    'public',
    {
      ...postgraphileOptions,
      graphqlRoute: '/graphql',
      graphiqlRoute: '/graphiql',
      // Permite que el SQL sepa qué usuario está haciendo la consulta vía JWT
      additionalGraphQLContextFromRequest: async (req) => ({
        userId: (req as any).user?.usuarioId, //
      }),
    }
  )
);

// 5. Rutas de utilidad (PÚBLICAS)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Servidor Fractal-IS Activo' });
});

// --- ELIMINADO EL SEGUNDO BLOQUE DE app.use('/api'...) QUE ESTABA AL FINAL ---

const rawPort = process.env.PORT;
if (!rawPort) {
  throw new Error("❌ ERROR: La variable de entorno PORT no está definida");
}

const PORT: number = parseInt(rawPort, 10);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend listo en puerto ${PORT}`);
  console.log(`📡 GraphQL: http://localhost:${PORT}/graphql`);
});