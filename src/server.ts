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

app.use(cors());

app.use('/api/auth', express.json(), authRoutes);

app.use('/api', express.json(), authenticateToken, customRoutes);

app.use(
  postgraphile(
    process.env.DATABASE_URL!,
    'public',
    {
      ...postgraphileOptions,
      graphqlRoute: '/graphql',
      graphiqlRoute: '/graphiql',
      // Esto permite que PostGraphile lea el usuario del token si lo necesitas en SQL
      additionalGraphQLContextFromRequest: async (req, res) => ({
        userId: (req as any).user?.usuarioId,
      }),
    }
  )
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Servidor Fractal-IS Activo' });
});

// Rutas API con su parser JSON
app.use('/api', express.json(), customRoutes);

// PostGraphile
app.use(
  postgraphile(
    process.env.DATABASE_URL!,
    'public',
    {
      ...postgraphileOptions,
      graphqlRoute: '/graphql',
      graphiqlRoute: '/graphiql',
    }
  )
);


const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error("❌ ERROR: La variable de entorno PORT no está definida en el archivo .env");
}

const PORT: number = parseInt(rawPort, 10);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend listo en puerto ${PORT}`);
  console.log(`📡 GraphQL: http://localhost:${PORT}/graphql`);
  console.log(`🤖 AI API: http://localhost:${PORT}/api/ai/chat`);
});