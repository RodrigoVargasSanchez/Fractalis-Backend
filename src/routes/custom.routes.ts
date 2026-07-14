import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { OpenAIService } from '../services/openai.service.js';
import { GraphModel } from '../models/graph.model.js';
import pool from '../config/database.js';
import { createRequire } from 'module';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

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
  console.log("--- [ROUTE] 🚀 Iniciando flujo /ai/chat (Análisis con Trazabilidad) ---");
  let client: any = null;

  try {
    const { proyecto, descripcion, participantes_db, registros, relaciones } = req.body;

    // 1. IA: Procesamiento con OpenAI (Ahora devuelve aristas con [src, tgt, source_reg])
    // Se ejecuta primero para no mantener abierta una transacción de Postgres durante la llamada HTTP.
    console.log("--- [ROUTE] 1. Llamando a OpenAI Service ---");
    const aiResponse = await OpenAIService.generateText(req.body);
    const { conceptos, aristas, mapeo_opiniones } = aiResponse;

    console.log(`--- [ROUTE] ✅ IA respondió con ${conceptos.length} conceptos y aristas trazables ---`);

    // 2. POSTGRESQL: Transacción para Espacio y Participantes
    console.log("--- [ROUTE] 2. Insertando datos en PostgreSQL ---");
    client = await pool.connect();
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

    await client.query('COMMIT');
    console.log("--- [ROUTE] ✅ Transacción Postgres completada (COMMIT) ---");

    console.log(`✅ [ROUTE] Proyecto "${proyecto}" sincronizado totalmente con trazabilidad de autor.`);
    res.json({ success: true, espacioId: pid });

  } catch (error: any) {
    if (client) {
      try {
        console.log("--- [ROUTE] ❌ Error detectado. Intentando deshacer cambios (ROLLBACK) en Postgres ---");
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error("--- [ROUTE] ❌ Error al intentar Rollback:", rollbackError);
      }
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
    if (client) {
      client.release();
    }
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

    // 1. Obtener el título más reciente desde Postgres
    const postgresResult = await pool.query(
      'SELECT espacio_titulo FROM espacios WHERE espacio_id = $1',
      [parseInt(pid)]
    );
    const postgresTitle = postgresResult.rows[0]?.espacio_titulo;

    const graphData = await GraphModel.getFullGraphByTopic(parseInt(pid));

    if (!graphData || graphData.nodes.length === 0) {
      return res.status(404).json({ message: "Grafo no encontrado para este ID" });
    }

    // 2. Si encontramos el título en Postgres, lo inyectamos o actualizamos en el nodo Topic del grafo
    if (postgresTitle) {
      const topicNode = graphData.nodes.find((n: any) => n.type === "Topic" || (n.labels?.includes("Topic")));
      if (topicNode) {
        if (!topicNode.data) topicNode.data = {};
        topicNode.data.title = postgresTitle;
      }

      // Sincronizar en Neo4j en segundo plano
      GraphModel.updateTopicTitle(parseInt(pid), postgresTitle).catch(err => {
        console.error("❌ Error al actualizar el título en Neo4j:", err);
      });
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

// --- GET: OBTENER TODOS LOS USUARIOS (ADMIN ONLY) ---
router.get('/admin/usuarios', async (req, res) => {
  const user = (req as any).user;
  if (!user || user.rol !== 'admin') {
    return res.status(403).json({ message: 'Acceso denegado: se requiere rol de Administrador' });
  }

  try {
    const result = await pool.query(
      'SELECT usuario_id, usuario_nombre, usuario_email, rol FROM usuarios ORDER BY usuario_nombre ASC'
    );
    res.json(result.rows);
  } catch (error: any) {
    console.error('❌ [GET-USERS] Error:', error.message);
    res.status(500).json({ error: error.message || 'Error en el servidor al obtener usuarios' });
  }
});

// --- POST: CREAR NUEVO USUARIO (ADMIN ONLY) ---
router.post('/admin/usuarios', async (req, res) => {
  const user = (req as any).user;
  if (!user || user.rol !== 'admin') {
    return res.status(403).json({ message: 'Acceso denegado: se requiere rol de Administrador' });
  }

  const { nombre, email, password, rol } = req.body;

  if (!nombre || !email || !password) {
    return res.status(400).json({ message: 'Todos los campos son obligatorios: nombre, email, password' });
  }

  try {
    // 1. Verificar si el correo ya existe
    const checkEmail = await pool.query(
      'SELECT usuario_id FROM usuarios WHERE TRIM(usuario_email) ILIKE $1',
      [email.trim()]
    );
    if (checkEmail.rows.length > 0) {
      return res.status(400).json({ message: 'El correo electrónico ya está registrado por otro usuario' });
    }

    // 2. Verificar si el nombre de usuario ya existe
    const checkName = await pool.query(
      'SELECT usuario_id FROM usuarios WHERE TRIM(usuario_nombre) ILIKE $1',
      [nombre.trim()]
    );
    if (checkName.rows.length > 0) {
      return res.status(400).json({ message: 'El nombre de usuario ya está registrado por otro usuario' });
    }

    // 3. Hashear la contraseña
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 4. Generar un usuario_id único
    const usuarioId = 'usr_' + Math.random().toString(36).substr(2, 9);

    // 5. Guardar en Postgres
    const userRole = rol || 'usuario';
    await pool.query(
      'INSERT INTO usuarios (usuario_id, usuario_nombre, password_hash, usuario_email, rol) VALUES ($1, $2, $3, $4, $5)',
      [usuarioId, nombre.trim(), passwordHash, email.trim(), userRole]
    );

    res.json({ success: true, message: 'Usuario creado exitosamente' });
  } catch (error: any) {
    console.error('❌ [CREATE-USER] Error:', error.message);
    res.status(500).json({ error: error.message || 'Error en el servidor al crear usuario' });
  }
});

// --- PUT: EDITAR USUARIO EXISTENTE (ADMIN ONLY) ---
router.put('/admin/usuarios/:id', async (req, res) => {
  const user = (req as any).user;
  if (!user || user.rol !== 'admin') {
    return res.status(403).json({ message: 'Acceso denegado: se requiere rol de Administrador' });
  }

  const { id } = req.params;
  const { nombre, email, password, rol } = req.body;

  if (!nombre || !email || !rol) {
    return res.status(400).json({ message: 'Todos los campos básicos son obligatorios: nombre, email, rol' });
  }

  try {
    // 1. Verificar si el correo ya existe para otro usuario
    const checkEmail = await pool.query(
      'SELECT usuario_id FROM usuarios WHERE TRIM(usuario_email) ILIKE $1 AND usuario_id <> $2',
      [email.trim(), id]
    );
    if (checkEmail.rows.length > 0) {
      return res.status(400).json({ message: 'El correo electrónico ya está registrado por otro usuario' });
    }

    // 2. Verificar si el nombre de usuario ya existe para otro usuario
    const checkName = await pool.query(
      'SELECT usuario_id FROM usuarios WHERE TRIM(usuario_nombre) ILIKE $1 AND usuario_id <> $2',
      [nombre.trim(), id]
    );
    if (checkName.rows.length > 0) {
      return res.status(400).json({ message: 'El nombre de usuario ya está registrado por otro usuario' });
    }

    // 3. Si se proporciona contraseña, hashearla y actualizarla
    if (password && password.trim().length > 0) {
      if (password.length < 6) {
        return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
      }
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      await pool.query(
        'UPDATE usuarios SET usuario_nombre = $1, usuario_email = $2, password_hash = $3, rol = $4 WHERE usuario_id = $5',
        [nombre.trim(), email.trim(), passwordHash, rol, id]
      );
    } else {
      await pool.query(
        'UPDATE usuarios SET usuario_nombre = $1, usuario_email = $2, rol = $3 WHERE usuario_id = $4',
        [nombre.trim(), email.trim(), rol, id]
      );
    }

    res.json({ success: true, message: 'Usuario actualizado exitosamente' });
  } catch (error: any) {
    console.error('❌ [UPDATE-USER] Error:', error.message);
    res.status(500).json({ error: error.message || 'Error en el servidor al actualizar usuario' });
  }
});

// --- DELETE: ELIMINAR USUARIO (ADMIN ONLY) ---
router.delete('/admin/usuarios/:id', async (req, res) => {
  const user = (req as any).user;
  if (!user || user.rol !== 'admin') {
    return res.status(403).json({ message: 'Acceso denegado: se requiere rol de Administrador' });
  }

  const { id } = req.params;

  if (id === user.usuarioId) {
    return res.status(400).json({ message: 'No puedes eliminar tu propio usuario administrador' });
  }

  try {
    // Verificar si el usuario está participando en algún espacio
    const spacesResult = await pool.query(
      `SELECT e.espacio_titulo 
       FROM espacio_participantes ep
       JOIN espacios e ON ep.espacio_id = e.espacio_id
       WHERE ep.usuario_id = $1`,
      [id]
    );

    if (spacesResult.rows.length > 0) {
      const spaceNames = spacesResult.rows.map((r: any) => `"${r.espacio_titulo}"`).join(', ');
      return res.status(400).json({
        message: `El usuario participa en los siguientes espacios: ${spaceNames}. Solo se puede eliminar si se eliminan primero estos espacios.`
      });
    }

    await pool.query('DELETE FROM usuarios WHERE usuario_id = $1', [id]);
    res.json({ success: true, message: 'Usuario eliminado exitosamente' });
  } catch (error: any) {
    console.error('❌ [DELETE-USER] Error:', error.message);
    res.status(500).json({ error: error.message || 'Error en el servidor al eliminar usuario' });
  }
});

// --- POST: GENERAR ANÁLISIS NARRATIVO CON OPENAI ---
router.post('/graph/:pid/analysis', async (req, res) => {
  const { pid } = req.params;
  const { concepts, relations, interventions } = req.body;

  if (!interventions || !Array.isArray(interventions)) {
    return res.status(400).json({ error: "Falta la lista de intervenciones para el análisis." });
  }

  try {
    console.log(`--- [ANALYSIS] 🔍 Buscando informe para PID: ${pid} ---`);
    const postgresResult = await pool.query(
      'SELECT espacio_titulo, espacio_descripcion, espacio_analisis FROM espacios WHERE espacio_id = $1',
      [parseInt(pid)]
    );

    const row = postgresResult.rows[0];
    if (row && row.espacio_analisis && row.espacio_analisis.trim().length > 0) {
      console.log(`--- [ANALYSIS] 💾 Devuelto informe cacheado desde la base de datos para espacio ${pid} ---`);
      return res.json({ analysis: row.espacio_analisis });
    }

    console.log(`--- [ANALYSIS] 🌐 No hay informe cacheado. Consultando OpenAI para espacio ${pid} ---`);
    const titulo = row?.espacio_titulo || "Diálogo Sin Título";
    const descripcion = row?.espacio_descripcion || "Sin descripción.";

    const analysis = await OpenAIService.generateNarrativeAnalysis({
      titulo,
      descripcion,
      concepts,
      relations,
      interventions
    });

    console.log(`--- [ANALYSIS] 💾 Guardando nuevo informe en la base de datos para espacio ${pid} ---`);
    await pool.query(
      'UPDATE espacios SET espacio_analisis = $1 WHERE espacio_id = $2',
      [analysis, parseInt(pid)]
    );

    res.json({ analysis });
  } catch (error: any) {
    console.error('❌ [GRAPH-ANALYSIS] Error:', error.message);
    res.status(500).json({ error: error.message || 'Error en el servidor al generar el análisis' });
  }
});

// --- POST: PROCESAR Y ESTRUCTURAR ARCHIVO DE DIÁLOGO ---
router.post('/ai/structure-file', async (req, res) => {
  console.log("--- [ROUTE] 🚀 Iniciando estructuración de archivo con IA ---");
  try {
    const { fileBase64, fileType, participantes } = req.body;

    if (!fileBase64 || !fileType || !participantes) {
      return res.status(400).json({ error: "Faltan parámetros requeridos: fileBase64, fileType o participantes." });
    }

    if (fileType !== 'pdf' && fileType !== 'txt') {
      return res.status(400).json({ error: "El tipo de archivo debe ser 'pdf' o 'txt'." });
    }

    let textContent = "";

    if (fileType === 'pdf') {
      console.log("--- [ROUTE] Decodificando y parseando PDF ---");
      const pdfBuffer = Buffer.from(fileBase64, 'base64');
      const pdfData = await pdf(pdfBuffer);
      textContent = pdfData.text;
    } else {
      console.log("--- [ROUTE] Decodificando archivo TXT ---");
      textContent = Buffer.from(fileBase64, 'base64').toString('utf-8');
    }

    if (!textContent || textContent.trim() === "") {
      return res.status(400).json({ error: "El archivo no contiene texto legible." });
    }

    console.log(`--- [ROUTE] Procesando texto de longitud ${textContent.length} con OpenAI ---`);
    const aiResponse = await OpenAIService.structureUnstructuredFile(textContent, participantes);

    res.json(aiResponse);

  } catch (error: any) {
    console.error("❌ [ROUTE] Error al estructurar archivo:", error.message);
    res.status(500).json({ error: error.message || "Error al estructurar el archivo." });
  }
});

export default router;