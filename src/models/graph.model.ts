import { neo4jConfig, getNeo4jHeaders } from '../config/neo4j.js';

export const GraphModel = {
  // Helper interno para normalizar UIDs y evitar colisiones entre espacios
  _getConceptUid(pid: number | string, name: string): string {
    return `${pid}_${name.trim().toLowerCase().replace(/\s+/g, '_')}`;
  },

  async execute(statements: any[]) {
    console.log(`--- [NEO4J MODEL] 🛰️ Enviando ${statements.length} sentencias a Neo4j ---`);
    
    const response = await fetch(neo4jConfig.url, {
      method: 'POST',
      headers: getNeo4jHeaders(),
      body: JSON.stringify({ statements })
    });

    const data = await response.json();

    if (!response.ok || (data.errors && data.errors.length > 0)) {
      console.error("❌ [NEO4J MODEL] Error de ejecución:", JSON.stringify(data.errors, null, 2));
      throw new Error("Neo4j rechazó la transacción.");
    }

    console.log("--- [NEO4J MODEL] ✅ Transacción ejecutada con éxito ---");
    return data;
  },

// graph.model.ts

async createRelationship(sourceId: string, targetId: string, type: string, opinionId: string, pid: number) {
  const statement = {
    statement: `
      // 1. Buscamos los conceptos por su ID interno de Neo4j
      MATCH (a), (b)
      WHERE id(a) = toInteger($sourceId) AND id(b) = toInteger($targetId)
      
      // 2. Buscamos la opinión y su autor
      MATCH (o:Opinion)<-[:MADE_OPINION]-(u:User)
      WHERE id(o) = toInteger($opinionId) OR o.id = $opinionId
      
      // 3. ASEGURAMOS QUE EL CONCEPTO ORIGEN ESTÉ VINCULADO A ESTA OPINIÓN
      MERGE (o)-[:CONTAINS]->(a)
      
      // 4. Creamos la relación entre conceptos con los metadatos de autoría
      MERGE (a)-[r:${type.toUpperCase()} {author_id: u.id}]->(b)
      SET r.author_name = u.name,
          r.opinion_id = o.id,
          r.project_id = $pid,
          r.created_at = timestamp()
          
      RETURN r, id(r) as edgeId
    `,
    parameters: { sourceId, targetId, type, opinionId, pid }
  };

  const response = await this.execute([statement]);
  if (!response.results?.[0]?.data?.[0]) {
    throw new Error("No se pudo crear la relación. Verifique que conceptos, opinión y autor existan.");
  }
  return response.results[0].data[0].row[1];
},

  async createSingleConcept(pid: number, name: string, opinionId: string) {
    const uid = this._getConceptUid(pid, name);
    const statement = {
      statement: `
        MATCH (t:Topic {postgres_id: $pid})
        MATCH (o:Opinion)
        WHERE id(o) = toInteger($opinionId) OR o.id = $opinionId
        MERGE (c:Concept {uid: $uid})
        SET c.name = $name, c.topic_id = $pid
        MERGE (t)-[:HAS_CONCEPT]->(c)
        MERGE (o)-[:CONTAINS]->(c)
        RETURN c, id(c) as internalId
      `,
      parameters: { pid, uid, name, opinionId }
    };

    const response = await this.execute([statement]);
    if (!response.results?.[0]?.data?.[0]) {
      throw new Error(`No se encontró la Opinión con ID: ${opinionId} en el Proyecto: ${pid}`);
    }

    const nodeData = response.results[0].data[0].row[0];
    const internalId = response.results[0].data[0].row[1];
    return { ...nodeData, id: internalId.toString() };
  },

  async updateConceptName(pid: number, oldName: string, newName: string) {
    const oldUid = this._getConceptUid(pid, oldName);
    const newUid = this._getConceptUid(pid, newName);
    if (oldUid === newUid) return;

    const statement = {
      statement: `
        MATCH (old:Concept {uid: $oldUid})
        MERGE (new:Concept {uid: $newUid})
        SET new.name = $newName, new.topic_id = $pid
        WITH old, new
        CALL {
          WITH old, new
          MATCH (a)-[r]->(old) WHERE a <> new
          CALL apoc.refactor.to(r, new) YIELD output RETURN count(output) AS rIn
        }
        WITH old, new
        CALL {
          WITH old, new
          MATCH (old)-[r]->(b) WHERE b <> new
          CALL apoc.refactor.from(r, new) YIELD output RETURN count(output) AS rOut
        }
        WITH old DETACH DELETE old RETURN count(*) as updated
      `,
      parameters: { oldUid, newUid, newName, pid }
    };
    return this.execute([statement]);
  },

  async updateRelationshipType(edgeId: string | number, newType: string) {
    const statement = {
      statement: `
        MATCH ()-[r]->() WHERE id(r) = toInteger($edgeId)
        CALL apoc.refactor.setType(r, $newType) YIELD output RETURN output
      `,
      parameters: { edgeId, newType: newType.toUpperCase() }
    };
    return this.execute([statement]);
  },

  async deleteRelationship(edgeId: string | number) {
    const statement = {
      statement: `MATCH ()-[r]->() WHERE id(r) = toInteger($edgeId) DELETE r RETURN count(*) as deleted`,
      parameters: { edgeId }
    };
    return this.execute([statement]);
  },

  async deleteConcept(conceptId: string | number) {
    const statement = {
      statement: `MATCH (c:Concept) WHERE id(c) = toInteger($conceptId) DETACH DELETE c RETURN count(*) as deleted`,
      parameters: { conceptId }
    };
    return this.execute([statement]);
  },

  async saveFractalStructure(data: any) {
    const { pid, proyecto, participantes, conceptos, registros, mapeo_opiniones, aristas } = data;
    const statements: any[] = [];

    // A. Topic
    statements.push({
      statement: "MERGE (t:Topic {postgres_id: $pid}) SET t.title = $titulo",
      parameters: { pid, titulo: proyecto }
    });

    // B. Usuarios
    participantes.forEach((p: any) => {
      statements.push({
        statement: `MERGE (u:User {id: $uid}) SET u.name = $uname WITH u MATCH (t:Topic {postgres_id: $pid}) MERGE (u)-[:CREATED]->(t)`,
        parameters: { uid: p.db_id.toString(), uname: p.nombre, pid }
      });
    });

    // C. Conceptos (Validación para evitar huérfanos)
    // 1. Identificamos qué índices de conceptos sí tienen una opinión asociada
    const indicesConOpinion = new Set(mapeo_opiniones?.flatMap((m: any) => m.conceptos_indices) || []);

    // 2. Filtramos y tipamos: 'c' es un objeto con nombre e idx
    const conceptosValidos = conceptos
      .map((nombre: string, idx: number) => ({ nombre, idx }))
      .filter((c: { nombre: string; idx: number }) => indicesConOpinion.has(c.idx));

    // 3. Generamos la data para Neo4j
    const conceptosData = conceptosValidos.map((c: { nombre: string; idx: number }) => ({ 
      nombre: c.nombre, 
      uid: this._getConceptUid(pid, c.nombre) 
    }));

    if (conceptosData.length > 0) {
      statements.push({
        statement: `UNWIND $conceptosData AS cData 
                    MERGE (c:Concept {uid: cData.uid}) 
                    SET c.name = cData.nombre, c.topic_id = $pid 
                    WITH c MATCH (t:Topic {postgres_id: $pid}) 
                    MERGE (t)-[:HAS_CONCEPT]->(c)`,
        parameters: { conceptosData, pid }
      });
    }

    // D. Opiniones
    registros.forEach((reg: any, idx: number) => {
      const oid = `OP_${pid}_${idx}`;
      statements.push({
        statement: `
          MATCH (u:User {id: $uid}), (t:Topic {postgres_id: $pid})
          MERGE (o:Opinion {id: $oid})
          SET o.text = $text, o.ronda = $ronda, 
              o.timestamp = datetime(substring($ts, 6, 4) + "-" + substring($ts, 3, 2) + "-" + substring($ts, 0, 2) + "T" + trim(substring($ts, 10)))
          MERGE (u)-[:MADE_OPINION]->(o)
          MERGE (o)-[:ABOUT_TOPIC]->(t)`,
        parameters: { uid: reg.participante_db_id.toString(), pid, oid, text: reg.contenido, ronda: reg.ronda, ts: reg.timestamp }
      });

      const mapeo = mapeo_opiniones?.find((m: any) => m.registro_idx === idx);
      if (mapeo) {
        mapeo.conceptos_indices.forEach((cIdx: number) => {
          const cName = conceptos[cIdx];
          if (cName) {
            statements.push({
              statement: "MATCH (o:Opinion {id: $oid}) MATCH (c:Concept {uid: $cuid}) MERGE (o)-[:CONTAINS]->(c)",
              parameters: { oid, cuid: this._getConceptUid(pid, cName) }
            });
          }
        });
      }
    });

    // E. Relaciones Semánticas con Atribución (Las 3 flechas)
    if (aristas && typeof aristas === 'object') {
      Object.entries(aristas).forEach(([relType, pares]) => {
        const label = relType.toUpperCase(); 
        if (Array.isArray(pares)) {
          pares.forEach((p) => {
            const [srcIdx, tgtIdx, regIdx] = p; // Ahora OpenAI envía 3 valores

            if (srcIdx === tgtIdx) {
                console.warn(`⚠️ Saltando relación autorreferencial en concepto índice: ${srcIdx}`);
                return; // No procesar esta arista
              }

            const c1Name = conceptos[srcIdx];
            const c2Name = conceptos[tgtIdx];
            const oid = `OP_${pid}_${regIdx}`;

            if (c1Name && c2Name) {
              statements.push({
                statement: `
                  MATCH (c1:Concept {uid: $uid1}), (c2:Concept {uid: $uid2})
                  WHERE c1 <> c2
                  MATCH (o:Opinion {id: $oid})<-[:MADE_OPINION]-(u:User)
                  MERGE (c1)-[r:${label} {author_id: u.id}]->(c2)
                  SET r.author_name = u.name, r.opinion_id = o.id, r.project_id = $pid`,
                parameters: { uid1: this._getConceptUid(pid, c1Name), uid2: this._getConceptUid(pid, c2Name), oid, pid }
              });
            }
          });
        }
      });
    }
    return this.execute(statements);
  },

  async deleteFractalStructure(pid: number) {
    const statements = [
      { statement: `MATCH (t:Topic {postgres_id: $pid}) OPTIONAL MATCH (t)<-[:ABOUT_TOPIC]-(o:Opinion) DETACH DELETE t, o`, parameters: { pid } },
      { statement: `MATCH (c:Concept {topic_id: $pid}) DETACH DELETE c`, parameters: { pid } }
    ];
    return this.execute(statements);
  },

async getAdvancedStats(pid: number) {
  const statement = {
    statement: `
      WITH 'conceptGraph_' + $pid AS graphName

      CALL {
        WITH graphName
        CALL gds.graph.exists(graphName) YIELD exists
        WITH graphName, exists
        CALL apoc.do.when(
          exists,
          'CALL gds.graph.drop($graphName) YIELD graphName RETURN graphName',
          'RETURN null AS graphName',
          {graphName: graphName}
        ) YIELD value
        RETURN value
      }

      CALL gds.graph.project.cypher(
        graphName,
        '
          MATCH (c:Concept)
          WHERE c.topic_id = $pid
          RETURN id(c) AS id
        ',
        '
          MATCH (c1:Concept)-[r]->(c2:Concept)
          WHERE c1.topic_id = $pid AND c2.topic_id = $pid
          RETURN id(c1) AS source, id(c2) AS target
        ',
        { parameters: { pid: $pid } }
      )
      YIELD graphName AS gName

      // ---- Louvain una sola vez ----
      CALL gds.louvain.stream(gName)
      YIELD nodeId, communityId
      WITH gName,
           collect({
             id: nodeId,
             comunidad: communityId
           }) AS louvainResults

      // ---- Closeness una sola vez ----
      CALL gds.closeness.stream(gName)
      YIELD nodeId, score
      WITH gName, louvainResults,
           collect({
             id: nodeId,
             centralidad: score
           }) AS closenessResults

      UNWIND louvainResults AS l
      UNWIND closenessResults AS c
      WITH gName, l, c
      WHERE l.id = c.id

      WITH gName,
           gds.util.asNode(l.id) AS node,
           l.comunidad AS comunidad,
           c.centralidad AS centralidad

      OPTIONAL MATCH (u:User)-[:MADE_OPINION]->(:Opinion)-[:CONTAINS]->(node)
      WITH gName, node, comunidad, centralidad,
           count(DISTINCT u) AS grado

      WITH gName,
           collect({
             conceptId: id(node),
             name: node.name,
             grado: grado,
             comunidad: comunidad,
             centralidad: centralidad
           }) AS results

      CALL gds.graph.drop(gName) YIELD graphName

      UNWIND results AS row
      RETURN
        row.conceptId AS conceptId,
        row.name AS name,
        row.grado AS grado,
        row.comunidad AS comunidad,
        row.centralidad AS centralidad
    `,
    parameters: { pid }
  };

  const response = await this.execute([statement]);

  return response.results[0].data.map((row: any) => ({
    id: row.row[0].toString(),
    name: row.row[1],
    grado: row.row[2] || 0,
    comunidad: row.row[3],
    centralidad: row.row[4] || 0
  }));
}




,

  // En getFullGraphByTopic dentro de tu GraphModel
  async getFullGraphByTopic(pid: number) {
    const statement = {
      statement: `
        MATCH (t:Topic {postgres_id: $pid})
        OPTIONAL MATCH path = (t)-[*..2]-(connected)
        WITH path, t
        
        // Buscamos la PRIMERA ronda de cada concepto en este proyecto
        OPTIONAL MATCH (c:Concept {topic_id: $pid})<-[:CONTAINS]-(o:Opinion)
        WITH path, c, min(o.ronda) as primeraRonda
        RETURN path, collect({conceptId: id(c), ronda: primeraRonda}) as rondasInfo
      `,
      parameters: { pid },
      resultDataContents: ["graph", "row"] 
    };
    const response = await this.execute([statement]);
    return this.formatGraphResponse(response);
  },

  formatGraphResponse(rawResponse: any) {
    const nodesMap = new Map();
    const edgesMap = new Map();
    const conceptRondas = new Map(); // Para agrupar rondas por concepto

    const results = rawResponse?.results?.[0]?.data || [];

    // 1. Mapear primero las rondas (del "row" de la respuesta)
    results.forEach((row: any) => {
      if (row.row && row.row[1]) {
        row.row[1].forEach((info: any) => {
          if (!conceptRondas.has(info.conceptId)) {
            conceptRondas.set(info.conceptId, new Set());
          }
          conceptRondas.get(info.conceptId).add(info.ronda);
        });
      }
    });

    // 2. Procesar el grafo
    results.forEach((row: any) => {
      if (row.graph) {
        row.graph.nodes.forEach((node: any) => {
          const nodeType = node.labels[0];
          const baseData = { 
            label: node.properties.name || node.properties.title || node.properties.text, 
            ...node.properties 
          };

          // SI ES CONCEPTO: Inyectamos las rondas que recolectamos
          if (nodeType === 'Concept') {
            const rondas = conceptRondas.get(node.id);
            baseData.rondas = rondas ? Array.from(rondas).sort() : [];
          }

          nodesMap.set(node.id, { 
            id: node.id, 
            type: nodeType,
            data: baseData,
            position: { x: Math.random() * 600, y: Math.random() * 400 } 
          });
        });
        
        // ... (procesamiento de edges se mantiene igual)
        row.graph.relationships.forEach((rel: any) => {
          edgesMap.set(rel.id, { 
            id: rel.id, 
            source: rel.startNode, 
            target: rel.endNode, 
            label: rel.type,
            data: { ...rel.properties },
            animated: ['CAUSALIDAD', 'DEPENDENCIA'].includes(rel.type) 
          });
        });
      }
    });

    return { nodes: Array.from(nodesMap.values()), edges: Array.from(edgesMap.values()) };
  }
};