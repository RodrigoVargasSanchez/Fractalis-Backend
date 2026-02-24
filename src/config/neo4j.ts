import dotenv from 'dotenv';
dotenv.config();

const NEO4J_HOST = process.env.NEO4J_HOST || 'neo4j';
const NEO4J_HTTP_PORT = process.env.NEO4J_HTTP_PORT || '7474';

export const neo4jConfig = {
  url: `http://${NEO4J_HOST}:${NEO4J_HTTP_PORT}/db/neo4j/tx/commit`,
  auth: Buffer.from(`${process.env.NEO4J_USER}:${process.env.NEO4J_PASSWORD}`).toString('base64')
};

export const getNeo4jHeaders = () => ({
  'Authorization': `Basic ${neo4jConfig.auth}`,
  'Content-Type': 'application/json'
});