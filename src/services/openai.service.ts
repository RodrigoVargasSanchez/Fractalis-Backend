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

const OpenAIResponseSchema = z.object({
  conceptos: z.array(z.string()),
  aristas: z.record(z.string(), z.array(z.tuple([z.number(), z.number()]))),
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

### ONTOLOGÍA DE RELACIONES PERMITIDAS
${definicionesRelaciones}

### PROTOCOLO DE ANÁLISIS MATRICIAL (OBLIGATORIO)
No analices el texto registro por registro de forma aislada. Sigue este proceso:
1. **Fase de Extracción:** Identifica los conceptos clave de cada intervención.
2. **Fase de Contraste Transversal (Cross-Examination):** Toma cada concepto extraído y compáralo con el resto del corpus. 
   - Busca CUALQUIER indicio de acuerdo, validación o refuerzo entre distintos participantes para crear una "sinergia".
   - Busca CUALQUIER indicio de desacuerdo, crítica, excepción o refutación para crear un "antagonismo".
3. **Densidad:** Se espera un grafo rico en conexiones. Si un concepto no tiene al menos una relación con otro registro, vuelve a evaluar.

### EJEMPLO DE REFERENCIA
(Igual al anterior, pero priorizando la detección de conexiones entre IDs distantes)

### PROTOCOLO DE CONSTRUCCIÓN DEL JSON
- **conceptos**: Array de strings.
- **aristas**: { "ID_DE_RELACION": [[origen_idx, destino_idx], ...] }.
- **mapeo_opiniones**: [{ "registro_idx": number, "conceptos_indices": number[] }].

### VERIFICACIÓN FINAL
¿He revisado cada concepto contra todos los demás para encontrar sinergias y antagonismos ocultos? 
Si la respuesta es no, procesa de nuevo antes de entregar el JSON.`.trim();

      console.log("--- [OPENAI SERVICE] 📡 Enviando petición (Análisis Matricial) ---");
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
          temperature: 0.4, // Aumentado a 0.4 para fomentar la detección de relaciones no obvias
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`Error en OpenAI: ${response.status}`);
      }

      const result = await response.json();
      const rawContent = result.choices[0].message.content;
      const parsed = JSON.parse(rawContent);
      return OpenAIResponseSchema.parse(parsed);

    } catch (error: any) {
      console.error('❌ Error en OpenAIService:', error.message);
      throw error;
    }
  }
};