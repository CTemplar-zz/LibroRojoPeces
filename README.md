# Geoportal del Libro Rojo de Peces de Bolivia

Geoportal de consulta y revisión de las observaciones y distribuciones UICN del proyecto. El usuario puede filtrar especies, cambiar el mapa base, revisar fichas por fuente y excluir o restaurar registros con un motivo. Cada revisión registra la fecha y el nombre declarado por el revisor.

## Ejecutar y publicar

- Node.js 22 o posterior.
- `npm run build` genera el Worker para Sites en `dist/server/index.js`.
- `npm test` comprueba la autenticación, la protección de datos y el flujo de revisión.
- El Worker requiere la vinculación privada R2 `BUCKET` y las variables de entorno `PORTAL_USER`, `PORTAL_PASSWORD` y `SESSION_SECRET`.
- La carga inicial utiliza `IMPORT_TOKEN` como secreto separado. Se cargan los JSON de cada especie en `PUT /api/import/{slug}` y el índice en `PUT /api/import/index`. La publicación del índice cierra ese punto de importación.
- Los objetos `data/` y `reviews/` viven en el bucket privado. Las exclusiones nunca borran los datos originales. El repositorio contiene el código y la configuración sin credenciales.

## Datos

Se publican las categorías de la lista Excel, con prioridad para la propuesta nacional de 2026, luego la categoría nacional de 2009 y la categoría global cuando están disponibles. Las áreas de distribución se recortaron previamente con el límite de Bolivia. Se simplificaron las geometrías para la visualización web y se mantuvieron los registros por fuente, incluidos los solapamientos señalados en los datos de origen.

