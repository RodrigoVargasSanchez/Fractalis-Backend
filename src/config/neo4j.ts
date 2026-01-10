import dotenv from 'dotenv';
dotenv.config();

// Usamos la configuración para peticiones HTTP (fetch) como tenías originalmente
export const neo4jConfig = {
  url: 'http://neo4j:7474/db/neo4j/tx/commit',
  auth: Buffer.from(`${process.env.NEO4J_USER}:${process.env.NEO4J_PASSWORD}`).toString('base64')
};

export const getNeo4jHeaders = () => ({
  'Authorization': `Basic ${neo4jConfig.auth}`,
  'Content-Type': 'application/json'
});