import { Router } from 'express';
import { OpenAIService } from '../services/openai.service.js';
import { GraphModel } from '../models/graph.model.js';
import pool from '../config/database.js';

const router = Router();

// --- GET: OBTENER ESTADÍSTICAS AVANZADAS DEL GRAFO ---
router.get('/graph/:pid/stats', async (req, res) => {
  try {
    const { pid } = req.params;
    console.log(`--- [STATS] Calculando métricas avanzadas para PID: ${pid} ---`);
    
    const stats = await GraphModel.getAdvancedStats(parseInt(pid));
    
    res.json(stats);
  } catch (error: any) {
    console.error("❌ [STATS] Error al calcular estadísticas:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- POST: GUARDADO SINCRONIZADO (Postgres + IA + Neo4j) ---
router.post('/ai/chat', async (req, res) => {
  const client = await pool.connect();
  console.log("--- [ROUTE] 🚀 Iniciando flujo /ai/chat (Análisis con Trazabilidad) ---");
  
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

    // 2. IA: Procesamiento con OpenAI (Ahora devuelve aristas con [src, tgt, source_reg])
    console.log("--- [ROUTE] 2. Llamando a OpenAI Service ---");
    const aiResponse = await OpenAIService.generateText(req.body);
    const { conceptos, aristas, mapeo_opiniones } = aiResponse;
    
    console.log(`--- [ROUTE] ✅ IA respondió con ${conceptos.length} conceptos y aristas trazables ---`);

    // 3. NEO4J: Construcción del Grafo con Atribución de Autoría
    console.log("--- [ROUTE] 3. Enviando estructura a Neo4j ---");
    await GraphModel.saveFractalStructure({
      pid,
      proyecto,
      participantes: participantes_db,
      conceptos: conceptos as string[],
      registros,
      mapeo_opiniones,
      aristas, // Aquí viajan las aristas con el índice de registro
      relaciones
    });

    console.log(`✅ [ROUTE] Proyecto "${proyecto}" sincronizado totalmente con trazabilidad de autor.`);
    res.json({ success: true, espacioId: pid });

  } catch (error: any) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error("--- [ROUTE] ❌ Error al intentar Rollback:", rollbackError);
    }

    console.error("❌ [ROUTE] Error crítico detectado:", error.message);

    let statusCode = 500;
    if (error.name === "OpenAIRateLimitError") statusCode = 429;
    if (error.name === "OpenAIAuthError") statusCode = 401;
    if (error.name === "OpenAIValidationError" || error.name === "ZodError") statusCode = 400;

    res.status(statusCode).json({ 
      error: error.message || "Ocurrió un error inesperado en el servidor." 
    });

  } finally {
    client.release();
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
      return res.status(404).json({ message: "Grafo no encontrado para este ID" });
    }

    res.json(graphData);
  } catch (error: any) {
    console.error("❌ [GET GRAPH] Error al obtener el grafo:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- PATCH: ACTUALIZACIÓN MASIVA DE CONCEPTOS ---
router.patch('/concepts/bulk-update', async (req, res) => {
  const { pid, updates } = req.body; 
  try {
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ error: "El formato de 'updates' es inválido." });
    }
    for (const change of updates) {
      if (change.oldName !== change.newName) {
        await GraphModel.updateConceptName(pid, change.oldName, change.newName);
      }
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/concepts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await GraphModel.deleteConcept(id);
    res.json({ success: true, deletedCount: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/edges/bulk-update', async (req, res) => {
  const { updates, deletions } = req.body; 
  try {
    if (deletions && Array.isArray(deletions)) {
      for (const edgeId of deletions) {
        await GraphModel.deleteRelationship(edgeId);
      }
    }
    if (updates && Array.isArray(updates)) {
      for (const update of updates) {
        await GraphModel.updateRelationshipType(update.id, update.newType);
      }
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- POST: CREAR RELACIÓN MANUAL (Ahora con atribución) ---
router.post('/edges', async (req, res) => {
  const { sourceId, targetId, type, opinionId, pid } = req.body;
  try {
    console.log(`--- [CREATE-EDGE] Vinculando ${sourceId} -> [${type}] -> ${targetId} vía opinión ${opinionId} ---`);
    
    // Ahora opinionId es obligatorio para saber quién crea la relación manual
    if (!sourceId || !targetId || !type || !opinionId || !pid) {
      return res.status(400).json({ error: "Origen, destino, tipo, proyecto e ID de opinión son obligatorios." });
    }

    const result = await GraphModel.createRelationship(sourceId, targetId, type, opinionId, pid);
    res.json({ success: true, edgeId: result });
  } catch (error: any) {
    console.error("❌ [CREATE-EDGE] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- POST: CREAR CONCEPTO MANUAL ---
router.post('/concepts', async (req, res) => {
  const { pid, name, opinionId } = req.body; 
  try {
    if (!name || name.trim() === "" || !opinionId) {
      return res.status(400).json({ error: "El nombre del concepto y el ID de la opinión son obligatorios." });
    }
    const result = await GraphModel.createSingleConcept(pid, name, opinionId);
    res.json({ success: true, node: result });
  } catch (error: any) {
    console.error("❌ [CREATE-CONCEPT] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;