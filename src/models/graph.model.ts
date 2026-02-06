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

  async saveFractalStructure(data: any) {
    const { pid, proyecto, participantes, conceptos, registros, mapeo_opiniones, aristas } = data;
    const statements: any[] = [];

    console.log(`--- [NEO4J MODEL] 🛠️ Construyendo grafo aislado para Proyecto ID: ${pid} ---`);

    // A. Topic (Raíz del espacio)
    statements.push({
      statement: "MERGE (t:Topic {postgres_id: $pid}) SET t.title = $titulo",
      parameters: { pid, titulo: proyecto }
    });

    // B. Usuarios
    participantes.forEach((p: any) => {
      statements.push({
        statement: `
          MERGE (u:User {id: $uid}) 
          SET u.name = $uname
          WITH u MATCH (t:Topic {postgres_id: $pid})
          MERGE (u)-[:CREATED]->(t)`,
        parameters: { uid: p.db_id.toString(), uname: p.nombre, pid }
      });
    });

    // C. Conceptos con UID (Aislamiento por espacio)
    const conceptosData = conceptos.map((c: string) => ({
      nombre: c,
      uid: this._getConceptUid(pid, c)
    }));

    statements.push({
      statement: `
        UNWIND $conceptosData AS cData
        MERGE (c:Concept {uid: cData.uid})
        SET c.name = cData.nombre, c.topic_id = $pid
        WITH c MATCH (t:Topic {postgres_id: $pid})
        MERGE (t)-[:HAS_CONCEPT]->(c)`,
      parameters: { conceptosData, pid }
    });

    // D. Opiniones y Vínculos Semánticos
    registros.forEach((reg: any, idx: number) => {
      const oid = `OP_${pid}_${idx}`;
      
      statements.push({
        statement: `
          MATCH (u:User {id: $uid}), (t:Topic {postgres_id: $pid})
          MERGE (o:Opinion {id: $oid})
          SET o.text = $text, 
              o.ronda = $ronda, 
              o.timestamp = datetime(
                substring($ts, 6, 4) + "-" + substring($ts, 3, 2) + "-" + substring($ts, 0, 2) + 
                "T" + trim(substring($ts, 10))
              )
          MERGE (u)-[:MADE_OPINION]->(o)
          MERGE (o)-[:ABOUT_TOPIC]->(t)`,
        parameters: { 
          uid: reg.participante_db_id.toString(), 
          pid, oid, text: reg.contenido, ronda: reg.ronda, ts: reg.timestamp
        }
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

    // E. Relaciones Semánticas Dinámicas (Aristas entre conceptos)
    if (aristas && typeof aristas === 'object') {
      Object.entries(aristas).forEach(([relType, pares]) => {
        const label = relType.toUpperCase(); 
        if (Array.isArray(pares)) {
          pares.forEach((p) => {
            const c1Name = conceptos[p[0]];
            const c2Name = conceptos[p[1]];
            if (c1Name && c2Name) {
              statements.push({
                statement: `
                  MATCH (c1:Concept {uid: $uid1}), (c2:Concept {uid: $uid2}) 
                  MERGE (c1)-[:${label}]->(c2)`,
                parameters: { 
                  uid1: this._getConceptUid(pid, c1Name), 
                  uid2: this._getConceptUid(pid, c2Name) 
                }
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
      {
        // Borra Topic y Opiniones asociadas
        statement: `MATCH (t:Topic {postgres_id: $pid}) OPTIONAL MATCH (t)<-[:ABOUT_TOPIC]-(o:Opinion) DETACH DELETE t, o`,
        parameters: { pid }
      },
      {
        // Borra solo los conceptos de ESTE proyecto
        statement: `MATCH (c:Concept {topic_id: $pid}) DETACH DELETE c`,
        parameters: { pid }
      }
    ];
    return this.execute(statements);
  },

  async getFullGraphByTopic(pid: number) {
    const statement = {
      // Traemos el grafo asegurando que los nodos pertenezcan al contexto del proyecto
      statement: `
        MATCH (t:Topic {postgres_id: $pid}) 
        OPTIONAL MATCH path = (t)-[*..2]-(connected)
        RETURN path`,
      parameters: { pid },
      resultDataContents: ["graph"] 
    };
    const response = await this.execute([statement]);
    return this.formatGraphResponse(response);
  },

  formatGraphResponse(rawResponse: any) {
    const nodesMap = new Map();
    const edgesMap = new Map();
    const results = rawResponse?.results?.[0]?.data || [];

    results.forEach((row: any) => {
      if (row.graph) {
        row.graph.nodes.forEach((node: any) => {
          // Normalización para React Flow
          nodesMap.set(node.id, { 
            id: node.id, 
            type: node.labels[0], // 'Concept', 'Opinion', 'Topic', 'User'
            data: { 
              label: node.properties.name || node.properties.title || node.properties.text,
              ...node.properties 
            },
            // Posición inicial (el layout se maneja en el front)
            position: { x: Math.random() * 100, y: Math.random() * 100 } 
          });
        });
        
        row.graph.relationships.forEach((rel: any) => {
          edgesMap.set(rel.id, { 
            id: rel.id, 
            source: rel.startNode, 
            target: rel.endNode, 
            label: rel.type,
            type: 'smoothstep', // Estilo de línea común en React Flow
            animated: ['CAUSALIDAD', 'DEPENDENCIA'].includes(rel.type) 
          });
        });
      }
    });

    return { 
      nodes: Array.from(nodesMap.values()), 
      edges: Array.from(edgesMap.values()) 
    };
  }
};