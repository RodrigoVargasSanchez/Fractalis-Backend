import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { postgraphile } from 'postgraphile';
import { postgraphileOptions } from './graphql/postgraphile.js';
import customRoutes from './routes/custom.routes.js';

dotenv.config();

const app = express();

app.use(cors());

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