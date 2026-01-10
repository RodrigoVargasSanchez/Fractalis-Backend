import { neo4jConfig, getNeo4jHeaders } from '../config/neo4j.js';

export const GraphModel = {
  /**
   * Envía los statements a Neo4j vía HTTP fetch
   */
  async execute(statements: any[]) {
    const response = await fetch(neo4jConfig.url, {
      method: 'POST',
      headers: getNeo4jHeaders(),
      body: JSON.stringify({ statements })
    });

    if (!response.ok) {
      throw new Error("Error de comunicación con Neo4j");
    }
    return response.json();
  },

  /**
   * Construye los statements para el guardado sincronizado
   */
  async saveFractalStructure(data: any) {
    const { pid, proyecto, participantes, conceptos, registros, mapeo_opiniones, aristas } = data;
    const statements: any[] = [];

    // --- A. Crear Topic ---
    statements.push({
      statement: "MERGE (t:Topic {postgres_id: $pid}) SET t.title = $titulo",
      parameters: { pid, titulo: proyecto }
    });

    // --- B. Crear Usuarios ---
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

    // --- C. Crear Conceptos ---
    statements.push({
      statement: `
        UNWIND $conceptos AS nombre
        MERGE (c:Concept {name: nombre})
        WITH c MATCH (t:Topic {postgres_id: $pid})
        MERGE (t)-[:HAS_CONCEPT]->(c)`,
      parameters: { conceptos, pid }
    });

    // --- D. Crear Opiniones ---
    registros.forEach((reg: any, idx: number) => {
      const oid = `OP_${pid}_${idx}`;
      statements.push({
        statement: `
          MATCH (u:User {id: $uid}), (t:Topic {postgres_id: $pid})
          MERGE (o:Opinion {id: $oid})
          SET o.text = $text, o.ronda = $ronda
          MERGE (u)-[:MADE_OPINION]->(o)
          MERGE (o)-[:ABOUT_TOPIC]->(t)`,
        parameters: { uid: reg.participante_db_id.toString(), pid, oid, text: reg.contenido, ronda: reg.ronda }
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

    // --- E. Relaciones Semánticas ---
    aristas?.sinergia?.forEach((p: any) => {
      statements.push({
        statement: "MATCH (c1:Concept {name: $n1}), (c2:Concept {name: $n2}) MERGE (c1)-[:COMPLEMENTARY_TO]->(c2)",
        parameters: { n1: conceptos[p[0]], n2: conceptos[p[1]] }
      });
    });

    aristas?.antagonismo?.forEach((p: any) => {
      statements.push({
        statement: "MATCH (c1:Concept {name: $n1}), (c2:Concept {name: $n2}) MERGE (c1)-[:CONTRADICTS]->(c2)",
        parameters: { n1: conceptos[p[0]], n2: conceptos[p[1]] }
      });
    });

    return this.execute(statements);
  },

  /**
   * Statements para la eliminación profunda
   */
  async deleteFractalStructure(pid: number) {
    const statements = [
      {
        statement: `MATCH (t:Topic {postgres_id: $pid}) OPTIONAL MATCH (t)<-[:ABOUT_TOPIC]-(o:Opinion) DETACH DELETE t, o`,
        parameters: { pid }
      },
      {
        statement: `MATCH (c:Concept) WHERE NOT (c)<-[:CONTAINS]-(:Opinion) DETACH DELETE c`,
        parameters: {}
      },
      {
        statement: `MATCH (u:User) WHERE NOT (u)-[:MADE_OPINION]->() AND NOT (u)-[:CREATED]->() DELETE u`,
        parameters: {}
      }
    ];
    return this.execute(statements);
  }
};