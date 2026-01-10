export const OpenAIService = {
  async generateText(data: any) {
    try {
      const { proyecto = "Sin título", registros = [] } = data;

      // 1. Preparar el contexto de la transcripción
      const transcripcionTexto = registros
        .map((r: any, idx: number) => `[ID:${idx}] Ronda ${r.ronda} - ${r.participante}: ${r.contenido}`)
        .join("\n");

      // 2. Definición de instrucciones (Prompt Engineering)
      const systemInstruction = `
        Eres un analista experto en grafos. Analiza la transcripción del proyecto "${proyecto}".
        
        MODELO DE SALIDA JSON:
        {
          "conceptos": ["Idea 1", "Idea 2"],
          "aristas": {
            "sinergia": [[0, 1]],
            "antagonismo": [[1, 2]]
          },
          "mapeo_opiniones": [
            { "registro_idx": 0, "conceptos_indices": [0, 2] }
          ]
        }

        REGLAS:
        1. "conceptos": Máximo 15 conceptos únicos.
        2. "mapeo_opiniones": Para cada [ID:x] entregado en el user content, identifica qué índices del array "conceptos" se mencionan. Es vital para la trazabilidad.
        3. No salgas del formato JSON.
      `.trim();

      // 3. Petición a OpenAI usando Fetch
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o", // O el modelo que prefieras (gpt-4o-mini es más económico)
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: `Transcripción con IDs:\n\n${transcripcionTexto}` }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Error OpenAI: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      const content = result.choices[0].message.content;

      // 4. Retornar el contenido parseado
      return JSON.parse(content);

    } catch (error: any) {
      console.error('❌ Error OpenAI Service:', error.message);
      throw error;
    }
  }
};