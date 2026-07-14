// --- src/server.ts corregido ---
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { postgraphile } from 'postgraphile';
import { postgraphileOptions } from './graphql/postgraphile.js';
import customRoutes from './routes/custom.routes.js';
import authRoutes from './routes/auth.routes.js';
import { authenticateToken } from './middlewares/auth.middleware.js';

dotenv.config();

const app = express();

// 1. Middlewares globales que NO consumen el cuerpo (body) de la petición
app.use(cors());

// 2. PostGraphile (GraphQL) - MOVIDO ARRIBA
// Debe ir ANTES de express.json() para evitar el error "stream is not readable"
app.use(
  postgraphile(
    process.env.DATABASE_URL!,
    'public',
    {
      ...postgraphileOptions,
      graphqlRoute: '/graphql',
      graphiqlRoute: '/graphiql',
      additionalGraphQLContextFromRequest: async (req) => ({
        userId: (req as any).user?.usuarioId,
      }),
    }
  )
);

// 3. Middlewares que consumen el cuerpo de la petición
// Se colocan después de PostGraphile para no interferir con GraphQL
app.use(express.json({ limit: '50mb' }));

// 4. Rutas de Autenticación (PÚBLICAS)
app.use('/api/auth', authRoutes);

// 5. Rutas de la API (PROTEGIDAS)
app.use('/api', authenticateToken, customRoutes);

// 6. Rutas de utilidad
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Servidor Fractal-IS Activo' });
});

const rawPort = process.env.PORT;
if (!rawPort) {
  throw new Error("❌ ERROR: La variable de entorno PORT no está definida");
}

const PORT: number = parseInt(rawPort, 10);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend listo en puerto ${PORT}`);
  console.log(`📡 GraphQL: http://localhost:${PORT}/graphql`);
});