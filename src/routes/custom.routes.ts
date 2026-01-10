import { Router } from 'express';
import { OpenAIService } from '../services/openai.service.js';
import { GraphModel } from '../models/graph.model.js';
import pool from '../config/database.js';

const router = Router();

// --- POST: GUARDADO SINCRONIZADO (Postgres + IA + Neo4j) ---
router.post('/ai/chat', async (req, res) => {
  const client = await pool.connect();
  try {
    const { proyecto, descripcion, participantes_db, registros } = req.body;

    // 1. POSTGRESQL: Transacción para Espacio y Participantes
    await client.query('BEGIN');
    const espacioRes = await client.query(
      'INSERT INTO espacios (espacio_titulo, espacio_descripcion) VALUES ($1, $2) RETURNING espacio_id',
      [proyecto, descripcion || ""]
    );
    const pid = espacioRes.rows[0].espacio_id;

    for (const p of participantes_db) {
      await client.query(
        'INSERT INTO espacio_participantes (espacio_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [pid, p.db_id.toString()]
      );
    }
    await client.query('COMMIT');

    // 2. IA: Procesamiento con OpenAI (Delegado al servicio)
    const aiResponse = await OpenAIService.generateText(req.body);
    const { conceptos, aristas, mapeo_opiniones } = aiResponse;

    // 3. NEO4J: Construcción del Grafo (Delegado al modelo)
    // Pasamos todos los datos necesarios para que el modelo construya los statements
    await GraphModel.saveFractalStructure({
      pid,
      proyecto,
      participantes: participantes_db,
      conceptos: conceptos as string[],
      registros,
      mapeo_opiniones,
      aristas
    });

    console.log(`✅ Proyecto "${proyecto}" sincronizado correctamente (ID: ${pid}).`);
    res.json({ success: true, espacioId: pid });

  } catch (error: any) {
    // Si algo falla después de iniciar Postgres, hacemos rollback
    if (client) await client.query('ROLLBACK');
    console.error("❌ Error en el flujo de guardado:", error.message);
    res.status(500).json({ error: error.message });
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
    // 1. NEO4J: Limpieza de grafos (Delegado al modelo)
    await GraphModel.deleteFractalStructure(pid);

    // 2. POSTGRESQL: Borrado físico
    await client.query('DELETE FROM espacios WHERE espacio_id = $1', [pid]);
    
    console.log(`🗑️ Espacio ID: ${pid} y sus grafos asociados eliminados.`);
    res.json({ success: true });

  } catch (error: any) {
    console.error("❌ Error en eliminación:", error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;