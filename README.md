# Geoportal del Libro Rojo de Peces de Bolivia

Geoportal de consulta y revisión de las observaciones y distribuciones UICN del proyecto. El usuario puede filtrar especies, cambiar el mapa base, revisar fichas por fuente y excluir o restaurar registros con un motivo. Cada revisión registra la fecha y el nombre declarado por el revisor.

Las propuestas de exclusión mantienen el punto visible en rojo. El botón «Historial de exclusiones» consulta las revisiones de todas las especies, con filtros por especie y acción, y páginas de 50 registros. Cada entrada muestra revisor, fecha, motivo, estado actual, coordenadas y acceso a la ubicación en el mapa. Las restauraciones conservan el historial y recuperan el color de la fuente. Las nuevas revisiones guardan una copia de las coordenadas, fuente y URL; las revisiones anteriores consultan la ubicación en los datos de la especie.

## Entrada desde GitHub Pages

La interfaz se abre directamente en [GitHub Pages](https://ctemplar-zz.github.io/LibroRojoPeces/). El servidor de Sites valida el inicio de sesión y guarda los cambios en el mismo almacén de revisiones que usa su propia interfaz. Para actualizar el HTML raíz después de editar la interfaz, ejecuta `node scripts/build.mjs --pages` y versiona el archivo generado.

## Ejecutar y publicar

- Node.js 22 o posterior.
- `npm run build` genera el Worker para Sites en `dist/server/index.js`.
- `npm test` comprueba la autenticación, la protección de datos y el flujo de revisión.
- El Worker requiere la vinculación privada R2 `BUCKET` y las variables de entorno `PORTAL_USER`, `PORTAL_PASSWORD` y `SESSION_SECRET`.
- La carga inicial utiliza `IMPORT_TOKEN` como secreto separado. Se cargan los JSON de cada especie en `PUT /api/import/{slug}` y el índice en `PUT /api/import/index`. La publicación del índice cierra ese punto de importación.
- Los objetos `data/` y `reviews/` viven en el bucket privado. Las exclusiones nunca borran los datos originales. El repositorio contiene el código y la configuración sin credenciales.

## Datos

Se publican las categorías de la lista Excel, con prioridad para la propuesta nacional de 2026, luego la categoría nacional de 2009 y la categoría global cuando están disponibles. Las áreas de distribución se recortaron previamente con el límite de Bolivia. Se simplificaron las geometrías para la visualización web y se mantuvieron los registros por fuente, incluidos los solapamientos señalados en los datos de origen.


### Capas de referencia

El mapa abre con World Imagery de Esri. La capa departamental y las líneas de OSM se leen del almacén privado `reference/v1/`. Para provisionar una copia del sitio, carga primero `departments`, `overview`, `regional` y los JSON de la cuadrícula mediante `PUT /api/import-reference/{key}`, con un secreto independiente `REFERENCE_IMPORT_TOKEN`. Carga `index` al final para cerrar la importación. El índice contiene la lista de claves de cuadrícula y los recuentos.

### Cuencas y frecuencia de amenazas

Las capas ambientales se guardan en el bucket privado bajo thematic/20261119. El origen HydroATLAS_Nivel05_Bolivia contiene 23 registros, de los cuales 21 tienen geometría. El portal muestra esos 21 polígonos. La tabla de atributos proporciona los nombres y códigos.

Los dos rásteres originales se reproyectaron a EPSG:3857 con celdas de 30 m y vecino más próximo. Los archivos COG incluyen vistas de menor resolución mediante el mismo remuestreo. El portal lee porciones mediante HTTP Range y GeoTIFF.js 2.1.3, sin interpolar los valores de frecuencia. El valor 0 es NoData en ambos archivos y se dibuja transparente. Las vistas lejanas son representaciones generalizadas y no deben usarse para calcular áreas.

Para provisionar otra instancia, configurar THEMATIC_IMPORT_TOKEN como secreto de servidor y cargar basins, deforestation.tif y fire.tif mediante PUT /api/import-thematic/{key}. Cargar manifest al final cierra la importación. Los cambios de revisión de especies usan un prefijo independiente.

