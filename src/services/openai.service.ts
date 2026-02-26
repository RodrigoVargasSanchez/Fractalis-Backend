import { z } from 'zod';

class OpenAIRateLimitError extends Error { constructor(m: string) { super(m); this.name = "OpenAIRateLimitError"; } }
class OpenAIAuthError extends Error { constructor(m: string) { super(m); this.name = "OpenAIAuthError"; } }
class OpenAIValidationError extends Error { constructor(m: string) { super(m); this.name = "OpenAIValidationError"; } }

interface Participante { db_id: string; nombre: string; }
interface Registro { ronda: number; participante: string; contenido: string; }

interface RelacionConfig {
  id: string;
  nombre: string;
  descripcion: string;
  utilidad: string;
}

interface ProyectoInput { 
  proyecto: string; 
  descripcion?: string; 
  participantes_db?: Participante[]; 
  registros: Registro[];
  relaciones_permitidas: RelacionConfig[];
}

/**
 * ACTUALIZACIÓN: El esquema ahora espera una tupla de 3 números para las aristas:
 * [origen_idx, destino_idx, registro_fuente_idx]
 */
const OpenAIResponseSchema = z.object({
  conceptos: z.array(z.string()),
  aristas: z.record(z.string(), z.array(z.tuple([z.number(), z.number(), z.number()]))),
  mapeo_opiniones: z.array(z.object({
    registro_idx: z.number(),
    conceptos_indices: z.array(z.number())
  }))
});

export const OpenAIService = {
  async generateText(data: ProyectoInput) {
    try {
      const { proyecto, registros, relaciones_permitidas } = data;

      const definicionesRelaciones = relaciones_permitidas.map(rel => {
        let refuerzo = "";
        if (rel.id === "sinergia") refuerzo = "\n- MANDATO: Evalúa cada concepto nuevo contra TODOS los anteriores. Si coinciden en propósito o se refuerzan, DEBES marcar sinergia.";
        if (rel.id === "antagonismo") refuerzo = "\n- MANDATO: Compara cada intervención. Si un participante contradice, matiza o se opone a un concepto previo, DEBES marcar antagonismo.";
        
        return `CLAVE: "${rel.id}"
- Nombre: ${rel.nombre}
- Definición: ${rel.descripcion}
- Objetivo: ${rel.utilidad}${refuerzo}`;
      }).join('\n\n');

      const transcripcionTexto = registros
        .map((r, idx) => `[ID:${idx}] Ronda ${r.ronda} - ${r.participante}: ${r.contenido}`)
        .join("\n");

      const systemInstruction = `### ROL
Actúa como un Analista de Grafos Semánticos experto en redes de debate y lógica compleja para el proyecto "${proyecto}".

### TAREA
Extraer conceptos descriptivos y, lo más importante, construir un grafo altamente denso que capture la interacción total entre los participantes.

### REGLAS DE ORO DE ESTRUCTURA
1. **Deduplicación Estricta:** Reutiliza índices para significados similares.
2. **Atomicidad:** Máximo 3 conceptos por registro.
3. **Validación:** Solo usa las claves de la ONTOLOGÍA.
4. **No Huérfanos:** TODO concepto listado en "conceptos" DEBE estar presente al menos en un "registro_idx" dentro de "mapeo_opiniones".
5. **No Auto-relaciones:** En "aristas", el origen_idx y destino_idx DEBEN ser diferentes. Un concepto no puede relacionarse consigo mismo.

### ONTOLOGÍA DE RELACIONES PERMITIDAS
${definicionesRelaciones}

### PROTOCOLO DE ANÁLISIS MATRICIAL (OBLIGATORIO)
No analices el texto registro por registro de forma aislada. Sigue este proceso:
1. **Fase de Extracción:** Identifica los conceptos clave de cada intervención.
2. **Fase de Contraste Transversal (Cross-Examination):** Toma cada concepto extraído y compáralo con el resto del corpus. 
   - Busca CUALQUIER indicio de acuerdo, validación o refuerzo entre distintos participantes para crear una "sinergia".
   - Busca CUALQUIER indicio de desacuerdo, crítica, excepción o refutación para crear un "antagonismo".
3. **Densidad:** Se espera un grafo rico en conexiones. Si un concepto no tiene al menos una relación con otro registro, vuelve a evaluar.

### EJEMPLO DE REFERENCIA PARA ARISTAS (ATRIBUCIÓN DE AUTORÍA)
Si el Participante A [ID:0] introduce "Concepto X" y el Participante B [ID:4] dice algo que genera una "sinergia" con "Concepto X", la arista debe registrar que fue el registro [ID:4] quien propuso ese vínculo.
Estructura: [índice_origen, índice_destino, índice_registro_que_crea_la_relación]

### PROTOCOLO DE CONSTRUCCIÓN DEL JSON
- **conceptos**: Array de strings.
- **aristas**: { "ID_DE_RELACION": [[origen_idx, destino_idx, registro_fuente_idx], ...] }. 
  *IMPORTANTE*: registro_fuente_idx es OBLIGATORIO y debe ser el ID numérico del registro donde el participante expresa dicha relación.
- **mapeo_opiniones**: [{ "registro_idx": number, "conceptos_indices": number[] }].

### EJEMPLO DE REFERENCIA (FEW-SHOT PROMPTING)

**Input del Usuario:**
[ID:0] CS: "Desde una perspectiva organizacional, el teletrabajo puede aumentar la productividad al permitir mayor flexibilidad horaria."
[ID:1] DP: "Si bien reduce traslados, también puede difuminar los límites entre vida personal y laboral, generando agotamiento."
[ID:2] CS2: "Además, no todas las tareas se benefician; algunas requieren colaboración presencial para mayor eficiencia."
[ID:3] CS: "En relación con la colaboración, las herramientas digitales han avanzado significativamente, permitiendo coordinación en tiempo real."
[ID:4] DP: "Sin embargo, la comunicación virtual puede provocar malentendidos y afectar la cohesión de los equipos de trabajo."
[ID:5] CS2: "También debemos considerar la desigualdad tecnológica, ya que no todos cuentan con las mismas condiciones en sus hogares."
[ID:6] CS: "Si las empresas establecen políticas claras y cultura de resultados, el teletrabajo puede ser un modelo sostenible."
[ID:7] DP: "Coincido parcialmente, pero es necesario implementar medidas de apoyo psicológico para evitar el burnout."
[ID:8] CS2: "En síntesis, el debate es cómo regularlo para equilibrar productividad y bienestar."

**Output Esperado (JSON):**
{
  "conceptos": [
    "Teletrabajo", "Productividad", "Flexibilidad horaria", "Difuminación vida laboral-personal", 
    "Agotamiento/Burnout", "Necesidad de colaboración presencial", "Herramientas digitales avanzadas", 
    "Coordinación en tiempo real", "Malentendidos en comunicación virtual", "Cohesión de equipo", 
    "Desigualdad tecnológica", "Políticas claras empresariales", "Cultura organizacional orientada a resultados", 
    "Modelo laboral sostenible", "Medidas de apoyo psicológico", "Regulación del teletrabajo", "Equilibrio productividad-bienestar"
  ],
  "aristas": {
    "causalidad": [[0, 1, 0], [3, 4, 1], [6, 7, 3], [8, 9, 4], [12, 13, 6], [15, 16, 8]],
    "dependencia": [[13, 11, 6], [13, 12, 6], [16, 15, 7], [1, 2, 0]],
    "consecuencia": [[10, 9, 5], [5, 1, 2], [4, 16, 7], [0, 3, 1]],
    "sinergia": [[0, 2, 0], [6, 1, 3], [15, 13, 8], [11, 12, 6], [1, 16, 8]],
    "antagonismo": [[1, 4, 1], [6, 5, 2], [7, 8, 4], [2, 3, 1], [1, 3, 1]],
    "ejemplificacion": [[6, 7, 3], [15, 16, 8]]
  },
  "mapeo_opiniones": [
    { "registro_idx": 0, "conceptos_indices": [0, 1, 2] },
    { "registro_idx": 1, "conceptos_indices": [3, 4, 0] },
    { "registro_idx": 2, "conceptos_indices": [5, 0, 1] },
    { "registro_idx": 3, "conceptos_indices": [6, 7, 1] },
    { "registro_idx": 4, "conceptos_indices": [8, 9, 0] },
    { "registro_idx": 5, "conceptos_indices": [10, 0, 9] },
    { "registro_idx": 6, "conceptos_indices": [11, 12, 13] },
    { "registro_idx": 7, "conceptos_indices": [14, 4, 15] },
    { "registro_idx": 8, "conceptos_indices": [15, 16, 0] }
  ]
}

### VERIFICACIÓN FINAL
¿He revisado cada concepto contra todos los demás para encontrar sinergias y antagonismos ocultos? 
¿Cada arista tiene los 3 elementos requeridos (origen, destino y fuente de autoría)?
Si la respuesta es no, procesa de nuevo antes de entregar el JSON.`.trim();

      console.log("--- [OPENAI SERVICE] 📡 Enviando petición (Análisis Matricial con Trazabilidad) ---");
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: `Transcripción para analizar detalladamente:\n\n${transcripcionTexto}` }
          ],
          temperature: 0.4, 
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`Error en OpenAI: ${response.status}`);
      }

      const result = await response.json();
      const rawContent = result.choices[0].message.content;
      const parsed = JSON.parse(rawContent);
      
      // La validación de Zod fallará si OpenAI no devuelve los 3 elementos en la arista
      return OpenAIResponseSchema.parse(parsed);

    } catch (error: any) {
      if (error instanceof z.ZodError) {
        console.error('❌ Error de Validación en Schema OpenAI:', error.issues);
        throw new OpenAIValidationError("La IA no devolvió el formato de aristas con trazabilidad esperado.");
      }
      console.error('❌ Error en OpenAIService:', error.message);
      throw error;
    }
  }
};