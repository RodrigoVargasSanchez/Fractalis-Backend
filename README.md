# Fractal-IS Backend

Este es el núcleo de **Fractal-IS**, una plataforma avanzada que combina **Bases de Datos Relacionales**, **Grafos** e **Inteligencia Artificial** para analizar discusiones y proyectos. El sistema procesa transcripciones, extrae conceptos clave mediante IA y genera estructuras de grafos para visualizar relaciones.


## Stack Tecnológico

* **Runtime:** [Node.js] con **TypeScript**.
* **Framework Web:** [Express.js]
* **Base de Datos Relacional:** [PostgreSQL 16] (Gestión de espacios y participantes).
* **Base de Datos de Grafos:** [Neo4j 5](Análisis de conexiones y conceptos).
* **Motor de API:** [PostGraphile] (Generación automática de GraphQL sobre Postgres).
* **IA:** [OpenAI API (GPT-4o)] (Procesamiento de lenguaje natural y extracción de entidades).
* **Infraestructura:** [Docker] & **Docker Compose**.
* **Migraciones:** [Flyway]

## Arquitectura del Sistema

El backend opera bajo un flujo de **Guardado Sincronizado**:
1.  **PostgreSQL:** Almacena los datos maestros del proyecto (Espacios y Participantes) mediante una transacción segura.
2.  **OpenAI Service:** Analiza el texto para identificar conceptos y relaciones semánticas, retornando un esquema JSON estructurado.
3.  **Neo4j:** Construye un grafo fractal que conecta los participantes con los conceptos extraídos, permitiendo análisis de red profundo.

## Instalación y Uso

### Requisitos Previos
* Docker y Docker Compose instalados.
* Una cuenta de OpenAI con API Key activa.

### Configuración
1.  Clona el repositorio.
2.  Crea un archivo `.env` basado en el `.env.example`:
    ```bash
    cp .env.example .env
    ```
3.  Edita el `.env` con tus credenciales reales (especialmente `OPENAI_API_KEY`).

### Despliegue con Docker
Para levantar todos los servicios (Backend, Postgres, Neo4j, Flyway) de forma automática:

```bash
docker-compose up --build
