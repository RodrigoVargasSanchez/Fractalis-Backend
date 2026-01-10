-- 1. Insertar Usuarios de prueba
INSERT INTO usuarios (usuario_id, usuario_nombre) VALUES 
('A-12', 'Ana García'),
('B-45', 'Roberto Gómez'),
('C-89', 'Carla Soto'),
('D-10', 'Diego Portales'),
('E-23', 'Cristian Subiabre'),
('F-45', 'Carlos Silva');

-- 2. Insertar Espacios de prueba
-- El ID se genera solo (SERIAL), por eso no lo incluimos
INSERT INTO espacios (espacio_titulo, espacio_descripcion) VALUES 
('Análisis Comunitario Zona Sur', 'Estudio sobre la infraestructura vial en el sector sur de la ciudad.'),
('Taller de Innovación Digital', 'Espacio colaborativo para prototipado de soluciones web.'),
('Planificación Parque Central', 'Reunión de vecinos para el diseño de áreas verdes.');

-- 3. Relacionar Usuarios con Espacios (Participantes)
-- Asumimos que los IDs autoincrementales de los espacios fueron 1, 2 y 3
INSERT INTO espacio_participantes (espacio_id, usuario_id, rol_usuario) VALUES 
(1, 'A-12', 'administrador'), -- Ana en Análisis Comunitario
(1, 'B-45', 'participante'),  -- Roberto en Análisis Comunitario
(2, 'C-89', 'administrador'), -- Carla en Taller Innovación
(3, 'D-10', 'administrador'), -- Diego en Parque Central
(3, 'A-12', 'participante');  -- Ana también participa en Parque Central