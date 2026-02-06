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

// 1. Interfaz actualizada para recibir las relaciones permitidas
interface ProyectoInput { 
  proyecto: string; 
  descripcion?: string; 
  participantes_db?: Participante[]; 
  registros: Registro[];
  relaciones_permitidas: RelacionConfig[]; // <--- Nuevo campo
}

// 2. Schema de Zod flexible: permite llaves dinámicas en 'aristas'
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
      // Desestructuramos las relaciones permitidas
      const { proyecto, registros, relaciones_permitidas } = data;

      const definicionesRelaciones = relaciones_permitidas.map(rel => {
        return `CLAVE: "${rel.id}"
        - Nombre: ${rel.nombre}
        - Definición: ${rel.descripcion}
        - Objetivo: ${rel.utilidad}`;
      }).join('\n\n');

      const transcripcionTexto = registros
        .map((r, idx) => `[ID:${idx}] Ronda ${r.ronda} - ${r.participante}: ${r.contenido}`)
        .join("\n");

      //const listaRelacionesPrompt = relaciones_permitidas
      //  .map(rel => `* ${rel.nombre}: Utiliza la clave "${rel.id}"`) // <--- Cambiado rel por rel.nombre y rel.id
      //  .join("\n");

      const systemInstruction = `### ROL
Actúa como un Analista de Grafos Semánticos experto en extracción de conceptos y relaciones lógicas estructuradas para el proyecto "${proyecto}".

### TAREA
Extraer conceptos descriptivos de una transcripción y conectarlos mediante un grafo dirigido, utilizando ÚNICAMENTE las relaciones permitidas definidas dinámicamente.

### REGLAS DE ORO DE ESTRUCTURA
1. **Deduplicación:** Si un concepto ya existe en el array "conceptos", REUTILIZA su índice. No dupliques significados.
2. **Atomicidad:** Máximo 3 conceptos por registro. Cada concepto debe ser una frase corta pero explicativa (ej: " Dependencia tecnológica en adolescentes ").
3. **Validación de Aristas:** Las llaves del objeto "aristas" DEBEN ser exactamente iguales a los IDs proporcionados en la sección "ONTOLOGÍA".

### ONTOLOGÍA DE RELACIONES PERMITIDAS (DINÁMICA)
Debes clasificar las conexiones entre conceptos usando EXCLUSIVAMENTE estas claves:

${definicionesRelaciones}

### EJEMPLO DE REFERENCIA (Lógica de Mapeo)
Si la entrada fuera:
[ID:0] "La dependencia tecnológica en adolescentes se origina en la necesidad de validación social constante, reforzada por el diseño adictivo de las redes sociales."

[ID:1] "El problema principal no es solo emocional, sino la falta de educación digital y de regulación en el hogar y en el sistema educativo."

[ID:2] "La dependencia tecnológica aparece cuando se combinan vulnerabilidades emocionales con un entorno digital sin límites claros."

[ID:3] "El uso excesivo de pantallas en adolescentes está asociado a problemas de concentración, alteraciones del sueño y aumento de ansiedad."

[ID:4] "Estos efectos negativos se intensifican cuando no existe supervisión parental ni hábitos digitales saludables."

[ID:5] "Un ejemplo claro es el uso nocturno del celular, que provoca mala calidad del sueño e irritabilidad durante el día."

[ID:6] "A largo plazo, la dependencia tecnológica puede afectar el desarrollo de habilidades sociales presenciales y la tolerancia a la frustración."

[ID:7] "Sin embargo, la tecnología no es intrínsecamente negativa, ya que bien utilizada puede potenciar el aprendizaje y la creatividad."

[ID:8] "La solución no es prohibir la tecnología, sino generar una estrategia conjunta entre familia, escuela y plataformas digitales."

La salida esperada (asumiendo que todo los IDs están permitidos) sería:

{
  "conceptos": [
    "Dependencia tecnológica en adolescentes",
    "Validación social constante",
    "Diseño adictivo de redes sociales",
    "Falta de educación digital",
    "Falta de regulación familiar y escolar",
    "Vulnerabilidades emocionales",
    "Uso excesivo de pantallas",
    "Problemas de concentración",
    "Alteraciones del sueño",
    "Ansiedad adolescente",
    "Falta de supervisión parental",
    "Uso nocturno del celular",
    "Mala calidad del sueño",
    "Déficit en habilidades sociales presenciales",
    "Baja tolerancia a la frustración",
    "Tecnología como herramienta educativa",
    "Aprendizaje y creatividad",
    "Estrategia conjunta familia-escuela-plataformas",
    "Uso saludable de la tecnología"
  ],
  "aristas": {
    "causalidad": [
      [1, 0],
      [2, 0],
      [3, 0],
      [6, 7],
      [6, 8],
      [6, 9]
    ],
    "dependencia": [
      [10, 6]
    ],
    "ejemplificacion": [
      [11, 12]
    ],
    "consecuencia": [
      [0, 13],
      [0, 14],
      [6, 8]
    ],
    "sinergia": [
      [5, 2],
      [17, 18]
    ],
    "antagonismo": [
      [15, 0]
    ]
  },
  "mapeo_opiniones": [
    { "registro_idx": 0, "conceptos_indices": [1, 2, 0] },
    { "registro_idx": 1, "conceptos_indices": [3, 4, 0] },
    { "registro_idx": 2, "conceptos_indices": [5, 2, 0] },
    { "registro_idx": 3, "conceptos_indices": [6, 7, 8, 9] },
    { "registro_idx": 4, "conceptos_indices": [10, 6] },
    { "registro_idx": 5, "conceptos_indices": [11, 12] },
    { "registro_idx": 6, "conceptos_indices": [0, 13, 14] },
    { "registro_idx": 7, "conceptos_indices": [15, 16] },
    { "registro_idx": 8, "conceptos_indices": [17, 18] }
  ]
}
### PROTOCOLO DE CONSTRUCCIÓN DEL JSON
- **conceptos**: Array de strings (strings únicos).
- **aristas**: { "ID_DE_RELACION": [[origen_idx, destino_idx], ...] }.
- **mapeo_opiniones**: [{ "registro_idx": number, "conceptos_indices": number[] }].

### VERIFICACIÓN FINAL (AUTO-CORRECCIÓN)
Antes de generar el JSON, verifica:
1. ¿Todas las llaves en "aristas" aparecen en la lista de CLAVES permitidas arriba?
2. ¿Los índices en "aristas" son menores que conceptos.length?
3. ¿He reutilizado índices para conceptos que son el mismo aunque se mencionen en registros diferentes?
`.trim();

      console.log("--- [OPENAI SERVICE] 📡 Enviando petición a OpenAI API ---");
      console.log(systemInstruction);
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

      const parsed = JSON.parse(rawContent);
      console.log("--- [OPENAI SERVICE] 🔍 Validando con Zod... ---");
      
      const validated = OpenAIResponseSchema.parse(parsed);
      console.log("--- [OPENAI SERVICE] ✅ Validación Zod exitosa ---");

      return validated;

    } catch (error: any) {
      if (error instanceof z.ZodError) {
        console.error('❌ [OPENAI SERVICE] Error de formato JSON (Zod):', JSON.stringify(error.issues, null, 2));
        throw new Error("La IA generó datos que no cumplen el esquema o usó claves no permitidas.");
      }
      console.error('❌ [OPENAI SERVICE] Error general:', error.message);
      throw error;
    }
  }
};