import { z } from 'zod';

class OpenAIRateLimitError extends Error { constructor(m: string) { super(m); this.name = "OpenAIRateLimitError"; } }
class OpenAIAuthError extends Error { constructor(m: string) { super(m); this.name = "OpenAIAuthError"; } }
class OpenAIValidationError extends Error { constructor(m: string) { super(m); this.name = "OpenAIValidationError"; } }

interface Participante { db_id: string; nombre: string; }
interface Registro { ronda: number; participante: string; contenido: string; }
interface ProyectoInput { proyecto: string; descripcion?: string; participantes_db?: Participante[]; registros: Registro[]; }

const OpenAIResponseSchema = z.object({
  conceptos: z.array(z.string()),
  aristas: z.object({
    sinergia: z.array(z.tuple([z.number(), z.number()])),
    antagonismo: z.array(z.tuple([z.number(), z.number()]))
  }),
  mapeo_opiniones: z.array(z.object({
    registro_idx: z.number(),
    conceptos_indices: z.array(z.number())
  }))
});

export const OpenAIService = {
  async generateText(data: ProyectoInput) {
    try {
      const { proyecto, registros } = data;

      const transcripcionTexto = registros
        .map((r, idx) => `[ID:${idx}] Ronda ${r.ronda} - ${r.participante}: ${r.contenido}`)
        .join("\n");

      console.log("--- [OPENAI SERVICE] 📝 Preparando transcripción para IA ---");
      console.log(`--- [OPENAI SERVICE] Cantidad de registros: ${registros.length} ---`);

      const systemInstruction = `
Tu tarea es realizar un análisis de grafos semánticos del proyecto "${proyecto}". 
Debes extraer micro-conceptos granulares (1 a 3 por intervención) y mapear cómo chocan o se apoyan entre sí.
Distintas opiniones pueden apuntar al mismo concepto.

INSTRUCCIONES DE GRANULARIDAD:
- No sintetices: Si tres personas hablan de "Economía", extrae la arista específica de cada uno (ej. "Inflación por consumo", "Déficit fiscal", "Inversión externa").
- Relaciones Lógicas: 
  * Sinergia: Cuando un concepto refuerza, deriva o soluciona a otro.
  * Antagonismo: Cuando un concepto contradice, invalida o compite con otro.

EJEMPLO DE REFERENCIA (FEW-SHOT):
ENTRADA:
[ID:0] "El trabajo remoto aumenta la productividad porque elimina el estrés del transporte."
[ID:1] "El trabajo remoto destruye la cultura organizacional y el sentido de pertenencia."
SALIDA ESPERADA:
{
  "conceptos": ["Productividad", "Estrés del transporte", "Cultura organizacional"],
  "aristas": { "sinergia": [], "antagonismo": [[0, 2]] },
  "mapeo_opiniones": [{ "registro_idx": 0, "conceptos_indices": [0, 1] }]
}

REGLAS DE ORO:
1. Mínimo 1, máximo 3 conceptos por cada [ID].
2. Los conceptos deben ser frases autoexplicativas.
3. Las aristas deben conectar los índices del array global "conceptos".
4. Respuesta estrictamente en JSON.
5. VERIFICACIÓN FINAL: Antes de cerrar el JSON, asegúrate de que el índice más alto utilizado no sea igual o mayor a la longitud total del array "conceptos".
`.trim();

      console.log("--- [OPENAI SERVICE] 📡 Enviando petición a OpenAI API ---");
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
            { role: "user", content: `Transcripción para analizar:\n\n${transcripcionTexto}` }
          ],
          temperature: 0.15,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        console.error(`--- [OPENAI SERVICE] ❌ Error HTTP: ${response.status} ---`);
        if (response.status === 429) throw new OpenAIRateLimitError('Límite excedido.');
        if (response.status === 401) throw new OpenAIAuthError('API Key inválida.');
        throw new Error(`Error en OpenAI: ${response.status}`);
      }

      const result = await response.json();
      const rawContent = result.choices[0].message.content;

      console.log("--- [OPENAI SERVICE] 📥 Respuesta cruda recibida: ---");
      console.log(rawContent);

      const parsed = JSON.parse(rawContent);
      console.log("--- [OPENAI SERVICE] 🔍 Validando con Zod... ---");
      
      const validated = OpenAIResponseSchema.parse(parsed);
      console.log("--- [OPENAI SERVICE] ✅ Validación Zod exitosa ---");

      return validated;

    } catch (error: any) {
      if (error instanceof z.ZodError) {
        console.error('❌ [OPENAI SERVICE] Error de formato JSON (Zod):', JSON.stringify(error.issues, null, 2));
        throw new Error("La IA generó datos que no cumplen el esquema.");
      }
      console.error('❌ [OPENAI SERVICE] Error general:', error.message);
      throw error;
    }
  }
};