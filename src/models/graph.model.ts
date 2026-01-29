import { neo4jConfig, getNeo4jHeaders } from '../config/neo4j.js';

export const GraphModel = {
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

    console.log(`--- [NEO4J MODEL] 🛠️ Construyendo grafo para Proyecto ID: ${pid} ---`);

    // A. Topic
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

    // C. Conceptos
    statements.push({
      statement: `
        UNWIND $conceptos AS nombre
        MERGE (c:Concept {name: nombre})
        WITH c MATCH (t:Topic {postgres_id: $pid})
        MERGE (t)-[:HAS_CONCEPT]->(c)`,
      parameters: { conceptos, pid }
    });

    // D. Opiniones
    console.log(`--- [NEO4J MODEL] Mapeando ${registros.length} opiniones... ---`);
    registros.forEach((reg: any, idx: number) => {
      const oid = `OP_${pid}_${idx}`;
      
      if (!reg.participante_db_id || reg.participante_db_id === "No encontrado") {
        console.warn(`⚠️ [NEO4J MODEL] Registro ${idx}: participante_db_id no válido (${reg.participante_db_id})`);
      }

      statements.push({
        statement: `
          MATCH (u:User {id: $uid}), (t:Topic {postgres_id: $pid})
          MERGE (o:Opinion {id: $oid})
          SET o.text = $text, 
              o.ronda = $ronda, 
              o.timestamp = datetime(
                substring($ts, 6, 4) + "-" + substring($ts, 3, 2) + "-" + substring($ts, 0, 2) + 
                "T" + 
                trim(substring($ts, 10))
              )
          MERGE (u)-[:MADE_OPINION]->(o)
          MERGE (o)-[:ABOUT_TOPIC]->(t)`,
        parameters: { 
          uid: reg.participante_db_id.toString(), 
          pid, 
          oid, 
          text: reg.contenido, 
          ronda: reg.ronda,
          ts: reg.timestamp
        }
      });

      const mapeo = mapeo_opiniones?.find((m: any) => m.registro_idx === idx);
      if (mapeo) {
        mapeo.conceptos_indices.forEach((cIdx: number) => {
          if (conceptos[cIdx]) {
            statements.push({
              statement: "MATCH (o:Opinion {id: $oid}) MATCH (c:Concept {name: $cn}) MERGE (o)-[:CONTAINS]->(c)",
              parameters: { oid, cn: conceptos[cIdx] }
            });
          }
        });
      }
    });

    // E. Relaciones Semánticas (SECCIÓN CORREGIDA CON BLINDAJE)
    aristas?.sinergia?.forEach((p: any) => {
      const c1 = conceptos[p[0]];
      const c2 = conceptos[p[1]];

      if (c1 && c2) {
        statements.push({
          statement: "MATCH (c1:Concept {name: $n1}), (c2:Concept {name: $n2}) MERGE (c1)-[:COMPLEMENTARY_TO]->(c2)",
          parameters: { n1: c1, n2: c2 }
        });
      } else {
        console.warn(`⚠️ [NEO4J MODEL] Saltando sinergia: Índice fuera de rango [${p[0]}, ${p[1]}]`);
      }
    });

    aristas?.antagonismo?.forEach((p: any) => {
      const c1 = conceptos[p[0]];
      const c2 = conceptos[p[1]];

      if (c1 && c2) {
        statements.push({
          statement: "MATCH (c1:Concept {name: $n1}), (c2:Concept {name: $n2}) MERGE (c1)-[:CONTRADICTS]->(c2)",
          parameters: { n1: c1, n2: c2 }
        });
      } else {
        console.warn(`⚠️ [NEO4J MODEL] Saltando antagonismo: Índice fuera de rango [${p[0]}, ${p[1]}]`);
      }
    });

    return this.execute(statements);
  },

  async deleteFractalStructure(pid: number) {
    const statements = [
      {
        statement: `MATCH (t:Topic {postgres_id: $pid}) OPTIONAL MATCH (t)<-[:ABOUT_TOPIC]-(o:Opinion) DETACH DELETE t, o`,
        parameters: { pid }
      },
      {
        statement: `MATCH (c:Concept) WHERE NOT (c)<-[:CONTAINS]-(:Opinion) DETACH DELETE c`,
        parameters: {}
      }
    ];
    return this.execute(statements);
  },

  async getFullGraphByTopic(pid: number) {
    const statement = {
      statement: `MATCH (t:Topic {postgres_id: $pid}) OPTIONAL MATCH path = (t)-[*..2]-(connected) RETURN path`,
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
          nodesMap.set(node.id, { id: node.id, labels: node.labels, properties: node.properties });
        });
        row.graph.relationships.forEach((rel: any) => {
          edgesMap.set(rel.id, { id: rel.id, type: rel.type, source: rel.startNode, target: rel.endNode, properties: rel.properties });
        });
      }
    });

    return { nodes: Array.from(nodesMap.values()), edges: Array.from(edgesMap.values()) };
  }
};