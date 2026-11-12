# phpMyFlow

**El reemplazo moderno de phpMyAdmin.** Se instala igual, pesa menos y nunca recarga la página.

[English](README.md) · [Español](README.es.md)

phpMyFlow es un administrador web para MySQL y MariaDB. Como phpMyAdmin, es una carpeta de archivos PHP que subes a cualquier hosting. A diferencia de phpMyAdmin, es una aplicación de una sola página con un editor SQL de verdad y un asistente que escribe consultas sobre tu esquema real.

> Estado: desarrollo temprano (v0.1). Todavía no está listo para datos de producción.

## Qué lo hace distinto

- **Sin recargas.** Navega tablas, ordena, filtra y edita celdas al instante.
- **Un editor que conoce tu base.** Tablas y columnas se autocompletan mientras escribes, con su tipo y sus claves.
- **Errores detectados antes de ejecutar.** Los nombres mal escritos se subrayan en vivo, con arreglo en un clic ("¿Quisiste decir `customers`?"). El servidor valida cada sentencia con `EXPLAIN`, sin ejecutarla.
- **Errores en palabras simples.** Los códigos de error de MySQL se explican en tu idioma, con una sugerencia cuando la hay.
- **Asistente (opcional).** Describe lo que necesitas y obtén la consulta; explica, corrige u optimiza consultas existentes. Ve tu esquema y el plan de ejecución, y nunca ejecuta nada por su cuenta. Funciona con Anthropic, OpenAI, OpenRouter o un modelo local con Ollama.
- **Seguro por defecto.** Una sentencia por petición, confirmación antes de `DROP`, `TRUNCATE` o `UPDATE`/`DELETE` sin `WHERE`, protección CSRF, límite de intentos de login, lista de servidores permitidos y modo solo lectura.
- **Inglés, español, italiano y francés**, tema claro y oscuro.

## Instalar en un hosting PHP

Requisitos: PHP 8.1+ con `pdo_mysql` y `openssl`. Sin Composer ni Node en el servidor.
Si puedes, usa PHP 8.3 o posterior: 8.1 ya no recibe parches de seguridad y 8.2 deja de recibirlos a fines de 2026.

1. Descarga `phpmyflow-x.y.z.zip` desde Releases y descomprímelo en tu sitio, por ejemplo `public_html/phpmyflow/`.
2. Copia `config.sample.php` como `config.php` y configura tus servidores.
3. Abre `https://tu-sitio/phpmyflow/` y entra con un usuario de MySQL.

Si puedes, no lo dejes abierto a todo internet: restringe por IP, VPN o autenticación HTTP.

## Probar con Docker

```bash
docker compose up --build
# http://localhost:8080 — usuario root, contraseña root
```

## Activar el asistente

Ver la sección "Enable the assistant" del [README en inglés](README.md#enable-the-assistant). La clave queda en el servidor; al proveedor se le envía el esquema (nombres y tipos), nunca los datos de las filas.

## Licencia

[GNU AGPL-3.0](LICENSE). Si ofreces a otras personas una copia modificada, la AGPL pide que les des acceso a su código fuente: pon `source_url` en `config.php` (aparece en la pantalla de acceso).
