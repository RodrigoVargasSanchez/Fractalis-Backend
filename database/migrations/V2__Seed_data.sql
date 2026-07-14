-- Insertar Usuario Administrador únicamente
INSERT INTO usuarios (usuario_id, usuario_nombre, password_hash, usuario_email, rol) 
VALUES 
('admin', 'admin', '$2b$10$cnrKwWLPqXAuwrrN./mtNeQ5SsGw3iaSQkkdo9AY/kis9MnILKCaS', 'vargassanchez0950@gmail.com', 'admin'),
('admin2', 'admin2026', '$2b$10$cnrKwWLPqXAuwrrN./mtNeQ5SsGw3iaSQkkdo9AY/kis9MnILKCaS', 'admin2026@fractalis.cl', 'admin');