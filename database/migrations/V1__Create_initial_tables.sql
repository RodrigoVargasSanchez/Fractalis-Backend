-- 1. Usuarios
CREATE TABLE usuarios (
    usuario_id VARCHAR(50) PRIMARY KEY,
    usuario_nombre VARCHAR(100) NOT NULL
);

-- 2. Espacios
CREATE TABLE espacios (
    espacio_id SERIAL PRIMARY KEY,
    espacio_titulo VARCHAR(255) NOT NULL,
    espacio_descripcion TEXT,
    espacio_fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Participantes
CREATE TABLE espacio_participantes (
    espacio_id INTEGER REFERENCES espacios(espacio_id) ON DELETE CASCADE,
    usuario_id VARCHAR(50) REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
    rol_usuario VARCHAR(50) DEFAULT 'participante',
    PRIMARY KEY (espacio_id, usuario_id)
);