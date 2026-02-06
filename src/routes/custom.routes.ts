import { Router } from 'express';
import { OpenAIService } from '../services/openai.service.js';
import { GraphModel } from '../models/graph.model.js';
import pool from '../config/database.js';

const router = Router();

// --- POST: GUARDADO SINCRONIZADO (Postgres + IA + Neo4j) ---
router.post('/ai/chat', async (req, res) => {
  const client = await pool.connect();
  console.log("--- [ROUTE] 🚀 Iniciando flujo /ai/chat ---");
  
  try {
    const { proyecto, descripcion, participantes_db, registros, relaciones } = req.body;

    // 1. POSTGRESQL: Transacción para Espacio y Participantes
    console.log("--- [ROUTE] 1. Insertando datos en PostgreSQL ---");
    await client.query('BEGIN');
    
    const espacioRes = await client.query(
      'INSERT INTO espacios (espacio_titulo, espacio_descripcion) VALUES ($1, $2) RETURNING espacio_id',
      [proyecto, descripcion || ""]
    );
    const pid = espacioRes.rows[0].espacio_id;
    console.log(`--- [ROUTE] ✅ Espacio creado en Postgres con ID: ${pid} ---`);

    for (const p of participantes_db) {
      await client.query(
        'INSERT INTO espacio_participantes (espacio_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [pid, p.db_id.toString()]
      );
    }
    
    await client.query('COMMIT');
    console.log("--- [ROUTE] ✅ Transacción Postgres completada (COMMIT) ---");

    // 2. IA: Procesamiento con OpenAI
    console.log("--- [ROUTE] 2. Llamando a OpenAI Service ---");
    const aiResponse = await OpenAIService.generateText(req.body);
    const { conceptos, aristas, mapeo_opiniones } = aiResponse;
    
    console.log(`--- [ROUTE] ✅ IA respondió con ${conceptos.length} conceptos y ${mapeo_opiniones.length} mapeos ---`);

    // 3. NEO4J: Construcción del Grafo
    console.log("--- [ROUTE] 3. Enviando estructura a Neo4j ---");
    await GraphModel.saveFractalStructure({
      pid,
      proyecto,
      participantes: participantes_db,
      conceptos: conceptos as string[],
      registros,
      mapeo_opiniones,
      aristas,
      relaciones
    });

    console.log(`✅ [ROUTE] Proyecto "${proyecto}" sincronizado totalmente (Postgres + Neo4j).`);
    res.json({ success: true, espacioId: pid });

  } catch (error: any) {
    // Si algo falla, intentamos hacer rollback en Postgres si la transacción estaba abierta
    try {
      if (client) {
        await client.query('ROLLBACK');
        console.log("--- [ROUTE] 🔄 Rollback ejecutado en Postgres debido a error ---");
      }
    } catch (rollbackError) {
      console.error("--- [ROUTE] ❌ Error al intentar Rollback:", rollbackError);
    }

    console.error("❌ [ROUTE] Error crítico detectado:", error.message);

    // Determinar el código de estado coherente
    let statusCode = 500;
    if (error.name === "OpenAIRateLimitError") statusCode = 429;
    if (error.name === "OpenAIAuthError") statusCode = 401;
    if (error.name === "OpenAIValidationError" || error.name === "ZodError") statusCode = 400;

    res.status(statusCode).json({ 
      error: error.message || "Ocurrió un error inesperado en el servidor." 
    });

  } finally {
    client.release();
    console.log("--- [ROUTE] 🔚 Conexión a DB liberada ---");
  }
});

// --- DELETE: ELIMINACIÓN SINCRONIZADA PROFUNDA ---
router.delete('/espacios/:id', async (req, res) => {
  const { id } = req.params;
  const pid = parseInt(id);
  const client = await pool.connect();
  
  try {
    console.log(`--- [DELETE] Eliminando espacio ID: ${pid} ---`);
    await GraphModel.deleteFractalStructure(pid);
    await client.query('DELETE FROM espacios WHERE espacio_id = $1', [pid]);
    
    console.log(`🗑️ [DELETE] Espacio ID: ${pid} eliminado de Postgres y Neo4j.`);
    res.json({ success: true });

  } catch (error: any) {
    console.error("❌ [DELETE] Error en eliminación:", error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// --- GET: OBTENER GRAFO COMPLETO POR POSTGRES_ID ---
router.get('/graph/:pid', async (req, res) => {
  try {
    const { pid } = req.params;
    console.log(`--- [GET GRAPH] Solicitando grafo para PID: ${pid} ---`);
    
    const graphData = await GraphModel.getFullGraphByTopic(parseInt(pid));
    
    if (!graphData || graphData.nodes.length === 0) {
      console.warn(`--- [GET GRAPH] ⚠️ No se encontraron nodos para PID: ${pid} ---`);
      return res.status(404).json({ message: "Grafo no encontrado para este ID" });
    }

    res.json(graphData);
  } catch (error: any) {
    console.error("❌ [GET GRAPH] Error al obtener el grafo:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;