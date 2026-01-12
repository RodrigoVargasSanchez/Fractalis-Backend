export const OpenAIService = {
  async generateText(data: any) {
    try {
      const { proyecto = "Sin título", registros = [] } = data;

      // 1. Preparar el contexto de la transcripción
      const transcripcionTexto = registros
        .map((r: any, idx: number) => `[ID:${idx}] Ronda ${r.ronda} - ${r.participante}: ${r.contenido}`)
        .join("\n");

      // 2. Definición de instrucciones con Few-Shot Rico y Granular
      const systemInstruction = `
Tu tarea es realizar un análisis de grafos semánticos del proyecto "${proyecto}". 
Debes extraer micro-conceptos granulares (1 a 3 por intervención) y mapear cómo chocan o se apoyan entre sí.

INSTRUCCIONES DE GRANULARIDAD:
- No sintetices: Si tres personas hablan de "Economía", extrae la arista específica de cada uno (ej. "Inflación por consumo", "Déficit fiscal", "Inversión externa").
- Relaciones Lógicas: 
  * Sinergia: Cuando un concepto refuerza, deriva o soluciona a otro.
  * Antagonismo: Cuando un concepto contradice, invalida o compite con otro.

EJEMPLO DE REFERENCIA (FEW-SHOT):

ENTRADA:
[ID:0] "El trabajo remoto aumenta la productividad porque elimina el estrés del transporte."
[ID:1] "El trabajo remoto destruye la cultura organizacional y el sentido de pertenencia."
[ID:2] "Podemos mantener la cultura con reuniones presenciales mensuales, conservando la flexibilidad del hogar."

SALIDA ESPERADA:
{
  "conceptos": [
    "Eliminación de fricción logística por transporte",
    "Bienestar psicológico derivado de la flexibilidad laboral",
    "Erosión del capital social y cultura de equipo",
    "Modelo híbrido como mediador de cohesión cultural"
  ],
  "aristas": {
    "sinergia": [
      [0, 1],
      [2, 3]
    ],
    "antagonismo": [
      [1, 2],
      [2, 3]
    ]
  },
  "mapeo_opiniones": [
    { "registro_idx": 0, "conceptos_indices": [0, 1] },
    { "registro_idx": 1, "conceptos_indices": [2] },
    { "registro_idx": 2, "conceptos_indices": [3] }
  ]
}

MODELO DE SALIDA JSON:
{
  "conceptos": [],
  "aristas": { "sinergia": [], "antagonismo": [] },
  "mapeo_opiniones": []
}

REGLAS DE ORO:
1. Mínimo 1, máximo 3 conceptos por cada [ID].
2. Los conceptos deben ser frases autoexplicativas (Sujeto + Acción/Estado + Contexto).
3. Las aristas deben conectar los índices del array global "conceptos".
4. Respuesta estrictamente en JSON.
`.trim();

      // 3. Petición a OpenAI
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o", 
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: `Transcripción para analizar:\n\n${transcripcionTexto}` }
          ],
          temperature: 0.15,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Error OpenAI: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      return JSON.parse(result.choices[0].message.content);

    } catch (error: any) {
      console.error('❌ Error OpenAI Service:', error.message);
      throw error;
    }
  }
};