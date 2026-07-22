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

const StructureFileResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable().optional(),
  data: z.array(z.object({
    Ronda: z.number(),
    Participante: z.string(),
    Contenido: z.string(),
    Timestamp: z.string()
  })).optional()
});

export const OpenAIService = {
  async structureUnstructuredFile(text: string, participantes: { idArchivo: string; nombre: string }[]) {
    try {
      const validCodes = participantes.map(p => p.idArchivo);

      const systemInstruction = `Actúa como un experto en procesamiento de lenguaje natural y formateo de datos. Tu tarea es recibir una transcripción informal o desestructurada de un debate o conversación en texto plano y transformarla a un formato JSON estructurado.

### LISTA DE PARTICIPANTES VÁLIDOS
Tienes los siguientes participantes válidos (cada uno tiene un "nombre" y un "idArchivo"):
${participantes.map(p => `- Nombre: "${p.nombre}", idArchivo (código): "${p.idArchivo}"`).join('\n')}

### REGLAS DE ESTRUCTURACIÓN
1. **Identificación de Intervenciones**: Extrae cada intervención del diálogo. Asigna a cada intervención el "Participante" correcto comparando el nombre o indicación de quién habla en el texto con la lista de participantes válidos. Debes mapearlo obligatoriamente a su "idArchivo" (por ejemplo, "CS" o "DP"). Si no puedes determinar con certeza quién habla entre los participantes válidos, o si es un participante no registrado, no lo incluyes o devuelves success: false si la mayoría del texto no se puede mapear.
2. **Campos por Intervención**:
   - "Ronda": Número entero que representa el turno o ronda del diálogo, comenzando en 1 y siendo estrictamente secuencial incremental (1, 2, 3...).
   - "Participante": El "idArchivo" (código) del participante que habla. Debe coincidir EXACTAMENTE con alguno de los códigos provistos en la lista de participantes.
   - "Contenido": El texto que dice el participante. Limpia ruidos del chat (como emojis redundantes, saludos iniciales irrelevantes, etc.), pero conserva el significado semántico completo y la opinión expresada.
   - "Timestamp": Marca de tiempo en formato "DD-MM-YYYY HH:MM:SS". Si el texto original contiene fechas/horas, úsalas y adáptalas a este formato. Si no hay marcas de tiempo en el texto, genera marcas de tiempo ficticias realistas que comiencen en una fecha lógica (por ejemplo, "07-07-2026 10:00:00") e incrementa en 1 minuto por cada intervención (e.g. "07-07-2026 10:01:00", "07-07-2026 10:02:00") para asegurar que estén ordenadas de forma estrictamente cronológica.
3. **Validación y Fallo**:
   - Si el texto provisto no contiene una conversación/diálogo inteligible, o no tiene ninguna relación con los participantes indicados, o es una lista de palabras inconexas, debes marcar "success" como false y proveer una explicación corta en "error".

### FORMATO DE RESPUESTA
Debes devolver ÚNICAMENTE un objeto JSON con la siguiente estructura (usa response_format json_object):
{
  "success": true | false,
  "error": "Mensaje de error descriptivo en caso de que success sea false, de lo contrario null o vacío",
  "data": [
    {
      "Ronda": 1,
      "Participante": "CÓDIGO_PARTICIPANTE",
      "Contenido": "Texto de la intervención...",
      "Timestamp": "DD-MM-YYYY HH:MM:SS"
    },
    ...
  ]
}
`.trim();

      console.log("--- [OPENAI SERVICE] 📡 Enviando petición para estructurar archivo desestructurado ---");
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: (() => {
          const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";
          const isReasoning = modelName.startsWith("o1") || modelName.startsWith("o3");
          const payload: any = {
            model: modelName,
            messages: [
              { role: "system", content: systemInstruction },
              { role: "user", content: `Texto a estructurar:\n\n${text}` }
            ],
            response_format: { type: "json_object" }
          };
          if (isReasoning) {
            payload.reasoning_effort = "low";
          }
          return JSON.stringify(payload);
        })()
      });

      if (!response.ok) {
        throw new Error(`Error en OpenAI al estructurar archivo: ${response.status}`);
      }

      const result = await response.json();
      const rawContent = result.choices[0].message.content;
      const parsed = JSON.parse(rawContent);

      const validated = StructureFileResponseSchema.parse(parsed);

      if (validated.success && validated.data) {
        const regexTS = /^\d{2}-\d{2}-\d{4}\s\d{2}:\d{2}:\d{2}$/;
        let lastTime = 0;
        let rowNum = 0;

        for (const row of validated.data) {
          rowNum++;

          if (!validCodes.includes(row.Participante)) {
            return {
              success: false,
              error: `Fila ${rowNum}: El participante "${row.Participante}" retornado por la IA no está registrado en la lista.`
            };
          }

          const currentTS = String(row.Timestamp).trim();
          if (!regexTS.test(currentTS)) {
            return {
              success: false,
              error: `Fila ${rowNum}: El formato de fecha "${currentTS}" es incorrecto.`
            };
          }

          const tsParts = currentTS.split(" ");
          const datePart = tsParts[0];
          const timePart = tsParts[1];
          if (!datePart || !timePart) {
            return {
              success: false,
              error: `Fila ${rowNum}: El formato de fecha "${currentTS}" es incorrecto.`
            };
          }

          const dateParts = datePart.split("-");
          const d = dateParts[0];
          const m = dateParts[1];
          const y = dateParts[2];
          if (!d || !m || !y) {
            return {
              success: false,
              error: `Fila ${rowNum}: El formato de fecha "${currentTS}" es incorrecto.`
            };
          }

          const currentTime = new Date(`${y}-${m}-${d}T${timePart}`).getTime();

          if (currentTime < lastTime) {
            return {
              success: false,
              error: `Fila ${rowNum}: Las marcas de tiempo de las intervenciones no están ordenadas cronológicamente.`
            };
          }
          lastTime = currentTime;
        }
      }

      return validated;

    } catch (error: any) {
      console.error('❌ Error en OpenAIService al estructurar archivo:', error.message);
      return {
        success: false,
        error: `Error de procesamiento de IA: ${error.message}`
      };
    }
  },

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
Extraer conceptos descriptivos y de alto nivel, y construir un grafo altamente denso que capture la interacción total entre los participantes.

### REGLAS DE ORO DE ESTRUCTURA
1. **Deduplicación Estricta:** Reutiliza índices para significados similares o equivalentes semánticos.
2. **Abstracción Conceptual (REGLA ANTI-GRANULARIDAD):** Evita extraer elementos que funcionen como meros ejemplos, herramientas puntuales, artículos de leyes específicos, nombres propios o tecnicismos instrumentales citados de forma ilustrativa. Eleva siempre el contenido a su **dimensión temática o categoría macro**.
   
   *Ejemplos de Abstracción Interdisciplinaria:*
   - Si un Ingeniero cita *Docker, Nginx y Postgres*, extrae: "Infraestructura de desarrollo y persistencia de datos".
   - Si un Abogado cita *el Artículo 15, el inciso B y la apelación X*, extrae: "Mecanismos de impugnación y garantías procesales".
   - Si un Médico cita *paracetamol, ibuprofeno y amoxicilina*, extrae: "Protocolos de terapia farmacológica común".
   - Si un Deportista cita *entrenamiento en zonas de potencia, series de sprint y lactato*, extrae: "Metodologías de preparación física de alta intensidad".
3. **Atomicidad Temática:** Máximo 3 conceptos macro por registro.
4. **Validación:** Solo usa las claves de la ONTOLOGÍA.
5. **No Huérfanos:** TODO concepto listado en "conceptos" DEBE estar presente al menos en un "registro_idx" dentro de "mapeo_opiniones".
6. **No Auto-relaciones:** En "aristas", el origen_idx y destino_idx DEBEN ser diferentes.

### ONTOLOGÍA DE RELACIONES PERMITIDAS
${definicionesRelaciones}

### PROTOCOLO DE ANÁLISIS EN DOS FASES (OBLIGATORIO)
No analices el texto registro por registro de forma aislada ni saltes directamente al contraste global. Sigue este proceso en orden estricto:

**FASE 1 — Mapeo Intra-Registro (Relaciones Internas):**
Para CADA registro de forma individual:
1. Extrae los conceptos clave que el participante menciona en esa intervención.
2. Evalúa si dentro de esa MISMA intervención el participante conecta esos conceptos entre sí. 
3. Si existe una relación lógica interna, regístrala en "aristas" usando como registro_fuente_idx el ID de ese mismo registro.
4. Si el registro solo presenta un concepto aislado sin conexión interna, continúa sin forzar una arista.

**FASE 2 — Contraste Transversal (Cross-Examination):**
Una vez mapeadas las relaciones internas de TODOS los registros, toma cada concepto extraído y compáralo con el resto del corpus (conceptos de otras intervenciones, incluso de otras rondas).
   - Busca CUALQUIER indicio de acuerdo, validación o refuerzo entre distintos participantes para crear una "sinergia".
   - Busca CUALQUIER indicio de desacuerdo, crítica, excepción o refutación para crear un "antagonismo".
   - La arista de una relación cruzada debe llevar como registro_fuente_idx el ID del registro donde se establece esa conexión (normalmente el registro más reciente que la provoca).

**FASE 3 — Densidad:** Se espera un grafo rico en conexiones, combinando relaciones internas (Fase 1) y cruzadas (Fase 2). Si un concepto quedó sin ninguna relación (ni interna ni externa), vuelve a evaluarlo antes de entregar el resultado.

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

### AUTO-JUSTIFICACIÓN OBLIGATORIA (ANTES DE FINALIZAR)
Antes de entregar el JSON, revisa mentalmente tu propio trabajo como si tuvieras que defenderlo ante un auditor. Para CADA elemento que hayas generado, debes poder responder internamente:

**Sobre cada concepto:**
- ¿Este concepto aparece textualmente o de forma semánticamente clara en al menos un registro? Si no puedes señalar la frase exacta que lo origina, el concepto no es válido — elimínalo o corrígelo.
- ¿Este concepto es lo suficientemente específico como para ser útil, o es tan genérico que no aporta significado al grafo (ej. "Discusión", "Tema", "Idea")? Si es genérico, refórmalo o descártalo.

**Sobre cada arista (relación):**
- ¿Puedo señalar la frase o idea exacta, en el registro_fuente_idx correspondiente, que justifica esta relación? Si la conexión requiere "inventar" un puente lógico que el participante no expresó, la relación NO es válida.
- ¿La clave de relación que usé (de la ONTOLOGÍA) es la que mejor describe lo que ocurre entre ambos conceptos, o forcé una relación en una categoría que no le corresponde solo para aumentar el conteo? Usa siempre la clave más precisa, nunca la más conveniente.
- ¿Esta relación sería obvia y defendible para un lector humano que lea ambos registros citados, o es una interpretación forzada? Si es forzada, descártala.

**Regla de descarte:** Es preferible una relación menos que una relación injustificada. No agregues aristas ni conceptos solo para cumplir una cuota de densidad — cada elemento del JSON final debe poder rastrearse a una razón concreta en el texto original. Si al revisar un elemento no puedes justificarlo con una cita o paráfrasis fiel del registro correspondiente, elimínalo antes de responder.

### DENSIDAD MÍNIMA — SOLO COMO DISPARADOR DE RE-REVISIÓN, NUNCA COMO CUOTA A FORZAR
- Sea N = número total de conceptos extraídos.
- Como referencia orientativa, un grafo bien analizado suele tener al menos N aristas en total (interna + cruzadas).
- Esta cifra NO es una cuota que debas rellenar. Su único propósito es decirte cuándo debes volver a leer el corpus con más atención: si tu conteo actual es menor a N, vuelve a revisar el texto buscando relaciones reales que hayas pasado por alto — NUNCA inventes una relación para alcanzar el número.
- **Jerarquía explícita:** si en algún punto la meta de densidad y la regla de auto-justificación entran en conflicto, la auto-justificación SIEMPRE gana. Un grafo con menos aristas pero 100% justificables es preferible a un grafo con N aristas donde algunas son forzadas.

### VERIFICACIÓN FINAL
¿Mapeé primero las relaciones internas de cada registro (Fase 1) antes de cruzar conceptos entre registros (Fase 2)?
¿Cada concepto y cada arista pasó la auto-justificación (puedo citar la frase exacta que lo origina)?
¿Si mi conteo de aristas fue menor a N, volví a revisar el corpus antes de aceptar ese resultado como final?
¿He revisado cada concepto contra todos los demás para encontrar sinergias y antagonismos ocultos?
¿Cada arista tiene los 3 elementos requeridos (origen, destino y fuente de autoría)?
Si la respuesta es no, procesa de nuevo antes de entregar el JSON.`.trim();

      console.log("--- [OPENAI SERVICE] 📡 Enviando petición (Análisis en 2 Fases con Auto-Justificación) ---");
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: (() => {
          const modelName = process.env.OPENAI_MODEL || "gpt-5.4-mini";
          const isReasoning = modelName.startsWith("o1") || modelName.startsWith("o3");
          const payload: any = {
            model: modelName,
            messages: [
              { role: "system", content: systemInstruction },
              { role: "user", content: `Transcripción para analizar detalladamente:\n\n${transcripcionTexto}` }
            ],
            response_format: { type: "json_object" }
          };
          if (isReasoning) {
            payload.reasoning_effort = "medium";
          }
          return JSON.stringify(payload);
        })()
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
  },

  async generateNarrativeAnalysis(data: any) {
    const { titulo, descripcion, concepts, relations, interventions } = data;

    const transcripcionTexto = interventions
      .map((item: any, idx: number) => `[Ronda ${item.ronda}] - ${item.authorName || item.participante || 'Participante'}: "${item.opinionContent || item.contenido || ''}" (Concepto asociado: "${item.name || item.conceptName || ''}")`)
      .join("\n");

    const relacionesTexto = relations && Array.isArray(relations)
      ? relations
        .map((r: any) => {
          const sourceName = r.sourceName || r.sourceLabel || r.source;
          const targetName = r.targetName || r.targetLabel || r.target;
          const type = r.label || r.type || "relación";
          return `- [${sourceName}] -(${type})-> [${targetName}]`;
        })
        .join("\n")
      : "No hay relaciones semánticas registradas.";

    const systemInstruction = `
Actúa como un experto en análisis del discurso, sociolingüística y metodología de investigación cualitativa. Tu tarea es generar un informe cualitativo exhaustivo basado en el esquema de codificación de Zhang (2022). 

Analizarás la transcripción de una conversación y, si está disponible, la representación de red generada que te proporcionaré al final de este prompt.

### DETALLES DEL CASO / ESPACIO
- Título: "${titulo}"
- Descripción: "${descripcion || 'Sin descripción'}"

### OBJETIVO DEL INFORME
Realizar un análisis profundo de la conversación que vaya más allá del contenido temático directo. El informe debe dar cuenta de los repertorios sociolingüísticos desplegados por los participantes y las tipologías de interacción que ocurren durante la resolución del problema.

### ESPECIFICACIONES TÉCNICAS
- Extensión: El informe final debe tener una extensión obligatoria de entre 2000 y 3000 palabras. Desarrolla cada sección con el nivel de detalle, profundidad académica y análisis crítico necesarios para alcanzar esta meta.
- Evidencia empírica: Es fundamental que incluyas de forma integrada citas textuales exactas extraídas de la transcripción para respaldar cada afirmación, código o patrón detectado.

### MARCO TEÓRICO Y MATRIZ DE CODIFICACIÓN (Zhang, 2022)
Debes evaluar y mapear rigurosamente el texto e interacciones utilizando las siguientes 4 dimensiones y sus códigos específicos:

1. Compartir recursos/ideas (S)
   - S1: El estudiante proporciona a los miembros del equipo recursos relacionados con las instrucciones para la resolución del caso.
   - S2: El estudiante proporciona a los miembros del equipo pistas para recuperar información del texto y el caso.
   - S3: El estudiante responde a las solicitudes de los miembros del equipo para proporcionar información del texto y el caso.

2. Negociar ideas (N)
   - N1: El estudiante expresa su consentimiento/acuerdo a los miembros del equipo.
   - N2: El estudiante expresa desacuerdo con los miembros del equipo.
   - N3: El estudiante no está seguro de estar de acuerdo o en desacuerdo.
   - N4: El estudiante solicita a los miembros del equipo que respondan a un punto de vista o sugerencia.
   - N5: El estudiante pide a los miembros del equipo que clarifiquen una afirmación.
   - N6: El estudiante repite la afirmación de un miembro del equipo.
   - N7: El estudiante señala que sus ideas son diferentes a las de los miembros del equipo.
   - N8: El estudiante emplea evidencia para señalar deficiencias en las afirmaciones de otros miembros.
   - N9: El estudiante refina/detalla sus propios puntos de vista.
   - N10: El individuo cambia su punto de vista tras el análisis de un miembro del equipo o del grupo.

3. Regular las actividades de resolución de problemas (R)
   - R1: El estudiante identifica el objetivo de la discusión.
   - R2: El estudiante sugiere el siguiente paso de trabajo al compañero de equipo.
   - R3: El estudiante está confundido o frustrado debido a una falta de comprensión.
   - R4: El estudiante está progresando en su comprensión.
   - R5: El estudiante reflexiona sobre los logros alcanzados por el equipo.
   - R6: El estudiante expresa lo que le falta al equipo en el proceso de resolución de problemas.
   - R7: El estudiante verifica su propia comprensión.
   - R8: El estudiante evalúa si las contribuciones del equipo son útiles para la resolución del problema.
   - R9: El estudiante manifiesta satisfacción con el desempeño del equipo.
   - R10: El estudiante señala deficiencias en la toma de decisiones del equipo o en la calidad de las respuestas redactadas.
   - R11: El estudiante señala problemas específicos que surgieron en el proceso de resolución del caso.

4. Mantener comunicaciones positivas (M)
   - M1: El estudiante responde preguntas de los miembros del equipo (orientación social).
   - M2: El estudiante hace las conversaciones más animadas mediante risas, bromas, etc.
   - M3: El estudiante espera a que el miembro del equipo termine su afirmación antes de responder (escucha activa).
   - M5: El estudiante ofrece ayuda a un miembro del equipo.
   - M6: El estudiante se disculpa por una interrupción no intencional.
   - M7: El estudiante rechaza la sugerencia de un compañero sin una razón justificada.
   - M8: El estudiante dice algo sin sentido o fuera de la tarea.
   - M9: El estudiante expresa empatía o comprensión ante la confusión/frustración de sus compañeros.

5. Otros códigos de interacción (O)
   - O1: El estudiante no se hace cargo o no enlaza con la conversación o argumentos anteriores.
   - O2: El estudiante usa lenguaje denigratorio u ofensas contra otro miembro.
   - O3: El estudiante manifiesta un reclamo.

### ESTRUCTURA REQUERIDA DEL INFORME
1. Introducción y Contexto de la Interacción: Contextualiza el flujo del diálogo detectado y el ecosistema de la discusión.
2. Análisis por Dimensión (La sección más extensa): Desglosa cada una de las 4 dimensiones (S, N, R, M) y las conductas anómalas (O). Explica cómo interactúan los participantes, cuáles son los códigos dominantes y fundamenta con abundantes citas textuales del documento.
3. Dinámicas de Red e Interacción Sociolingüística: Describe los roles discursivos de los estudiantes (quién lidera, quién regula, quién concilia, quién genera disenso). Si se entregaron datos de red, vincula la densidad de la interacción con los códigos lingüísticos observados.
4. Conclusiones: Balance de la efectividad del trabajo colaborativo, la calidad de la negociación del conocimiento y los hallazgos principales del repertorio sociolingüístico.
`.trim();

    try {
      console.log("--- [OPENAI SERVICE] 📡 Enviando petición (Narrativa e Informe) ---");
      const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";
      const isReasoning = modelName.startsWith("o1") || modelName.startsWith("o3");
      const payload: any = {
        model: modelName,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: `A continuación tienes los datos del debate:\n\n### TRANSCRIPCIÓN DE INTERVENCIONES:\n${transcripcionTexto}\n\n### RED DE RELACIONES SEMÁNTICAS:\n${relacionesTexto}` }
        ]
      };
      if (isReasoning) {
        payload.reasoning_effort = "medium";
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Error en OpenAI al generar narrativa: ${response.status}`);
      }

      const result = await response.json();
      return result.choices[0].message.content;
    } catch (error: any) {
      console.warn("⚠️ Fallo en el servicio de OpenAI. Usando motor de análisis local como fallback. Razón:", error.message);
      return this.generateLocalNarrative(data);
    }
  },

  generateLocalNarrative(data: any) {
    const { titulo, descripcion, concepts, relations, interventions } = data;

    // 1. Agrupar intervenciones por ronda para narrar cronológicamente
    const roundsMap = new Map<number, any[]>();
    if (Array.isArray(interventions)) {
      interventions.forEach(item => {
        const r = item.ronda || 1;
        if (!roundsMap.has(r)) roundsMap.set(r, []);
        roundsMap.get(r)!.push(item);
      });
    }

    const sortedRounds = Array.from(roundsMap.keys()).sort((a, b) => a - b);
    let resumenCronologico = "";
    if (sortedRounds.length === 0) {
      resumenCronologico = "_No hay intervenciones registradas en el diálogo actual._";
    } else {
      sortedRounds.forEach(r => {
        const items = roundsMap.get(r)!;
        resumenCronologico += `#### Ronda ${r}\n`;
        items.forEach(item => {
          const conceptText = item.conceptName ? ` (introduciendo el concepto de **${item.conceptName}**)` : "";
          resumenCronologico += `- **${item.authorName}** aportó al diálogo${conceptText} señalando:\n  _"${item.opinionContent}"_\n`;
        });
        resumenCronologico += `\n`;
      });
    }

    // 2. Extraer puntos de convergencia (sinergias/complementariedad)
    let sinergiasTexto = "";
    const sinergiaRelations = Array.isArray(relations)
      ? relations.filter((r: any) => ["sinergia", "complementariedad", "coincidencia", "acuerdo"].includes((r.type || "").toLowerCase()))
      : [];

    if (sinergiaRelations.length === 0) {
      sinergiasTexto = "_No se detectaron convergencias o sinergias explícitas registradas en el grafo._";
    } else {
      sinergiasTexto = `Se identificaron **${sinergiaRelations.length}** puntos de coincidencia o complementariedad clave:\n\n`;
      sinergiaRelations.forEach((r: any) => {
        sinergiasTexto += `- **${r.sourceLabel}** se complementa/genera sinergia con **${r.targetLabel}**.\n`;
      });
    }

    // 3. Extraer puntos de divergencia (antagonismos/tensiones)
    let antagonismosTexto = "";
    const antagonismoRelations = Array.isArray(relations)
      ? relations.filter((r: any) => ["antagonismo", "conflicto", "contradiccion", "disenso", "oposicion"].includes((r.type || "").toLowerCase()))
      : [];

    if (antagonismoRelations.length === 0) {
      antagonismosTexto = "_No se registraron tensiones o puntos de antagonismo explícitos en el análisis semántico._";
    } else {
      antagonismosTexto = `Se registraron **${antagonismoRelations.length}** puntos de discusión, tensión o antagonismo discursivo:\n\n`;
      antagonismoRelations.forEach((r: any) => {
        antagonismosTexto += `- Se opone o problematiza la relación entre **${r.sourceLabel}** y **${r.targetLabel}** (Vínculo de tipo: _${r.type.toUpperCase()}_).\n`;
      });
    }

    // 4. Conclusiones y Conceptos Clave (Métricas de Centralidad de Grado Local)
    const degreeMap = new Map<string, number>();
    if (Array.isArray(relations)) {
      relations.forEach((r: any) => {
        if (r.sourceLabel) degreeMap.set(r.sourceLabel, (degreeMap.get(r.sourceLabel) || 0) + 1);
        if (r.targetLabel) degreeMap.set(r.targetLabel, (degreeMap.get(r.targetLabel) || 0) + 1);
      });
    }

    const sortedConcepts = Array.from(degreeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    let conceptosClaveTexto = "";
    if (sortedConcepts.length === 0) {
      conceptosClaveTexto = "_No hay suficientes relaciones semánticas para calcular la centralidad conceptual._";
    } else {
      conceptosClaveTexto = `A partir del análisis estructural de la red semántica, los conceptos con mayor cantidad de conexiones e influencia en el debate son:\n\n`;
      sortedConcepts.forEach(([name, count]) => {
        conceptosClaveTexto += `- **${name}** (conectado con ${count} ${count === 1 ? 'idea' : 'ideas'})\n`;
      });
      conceptosClaveTexto += `\nEstos términos actúan como **puentes discursivos**, enlazando los distintos puntos de vista y facilitando el flujo del debate.`;
    }

    return `
# 📊 Informe Analítico de Diálogo (Local Fallback)

> [!NOTE]
> **Aviso:** Este informe descriptivo ha sido generado por el motor de análisis local alternativo debido a limitaciones temporales de cuota (Error 429 / Rate Limit) en la conexión externa con OpenAI. Toda la red semántica y cronológica representada a continuación es fiel al grafo editado.

---

## 1. Resumen de la Conversación
El espacio titulado **"${titulo}"** (Descripción: _"${descripcion || 'Sin descripción disponible'}"_) aborda una red discursiva con **${concepts?.length || 0} conceptos** y **${relations?.length || 0} relaciones** registradas.

### Hilo Conductor Cronológico
${resumenCronologico}

---

## 2. Puntos de Sinergia (Consensos y Convergencias)
${sinergiasTexto}

---

## 3. Puntos de Conflicto (Divergencias y Tensiones)
${antagonismosTexto}

---

## 4. Conclusiones y Conceptos Detonantes
${conceptosClaveTexto}

---
Informe analítico compilado automáticamente por el motor local de Fractalis.
`.trim();
  }
}