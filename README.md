# Geoportal del Libro Rojo de Peces de Bolivia

Geoportal de consulta y revisión de las observaciones y distribuciones UICN del proyecto. El usuario puede filtrar especies, cambiar el mapa base, revisar fichas por fuente y excluir o restaurar registros con un motivo. Cada revisión registra la fecha y el nombre declarado por el revisor.

Las propuestas de exclusión mantienen el punto visible en rojo. El botón «Historial de revisiones» consulta las revisiones de todas las especies, con filtros por especie y acción, y páginas de 50 registros. Cada entrada muestra revisor, fecha, motivo, estado actual, coordenadas y acceso a la ubicación en el mapa. Las restauraciones conservan el historial y recuperan el color de fuente o de posible duplicado, según corresponda. Las nuevas revisiones guardan una copia de las coordenadas, fuente y URL; las revisiones anteriores consultan la ubicación en los datos de la especie.

## Consolidado, coincidencias y edición de ubicación

Se integraron 18.318 registros adicionales de ICTIO2024, SantosMercado–Pando y Peces final, que llevan el total a 46.826. La carga se conserva separada de los 28.508 registros anteriores, en `supplements/20261123/`. Los identificadores anteriores y las revisiones permanecen intactos. `scripts/prepare-supplement.py` transforma el CSV revisado en archivos por especie con identificadores estables; los datos no se guardan en Git. Se importa con un secreto `SUPPLEMENT_IMPORT_TOKEN` a `PUT /api/import-supplement/{especie}` y finalmente `/index`. El índice activa la carga completa y cierra las escrituras de importación. Antes de activarlo, las cargas pendientes no aparecen en el portal.

Los puntos activos de una misma especie con al menos otro registro a una distancia geodésica WGS84 de hasta 100 m se muestran en naranja. Se incluyen coincidencias dentro de la misma fuente y entre fuentes. El umbral es distancia entre puntos, no intersección de dos buffers de 100 m. Las ubicaciones idénticas se agrupan antes de calcular vecinos. `POS_DUP_100`, `GRUPO_DUP`, `VECINOS_100` y `DIST_MIN_M` aparecen en la tabla y en el CSV filtrado. Un grupo representa vecinos conectados: sus extremos pueden estar a más de 100 m. Esta clasificación es una señal para revisión; no elimina ni excluye automáticamente observaciones. Al excluir un punto permanece rojo y deja de contar como vecino activo; al restaurarlo o moverlo se recalculan las coincidencias.

El panel permite filtrar candidatos, registros sin coincidencias, exclusiones, grupo y base de datos. «Comparar grupo» presenta sus registros en una tabla paginada, incluyendo puntos exactamente superpuestos. La selección de filas utiliza los mismos controles de revisión y motivo que el mapa. La exportación CSV conserva los filtros y las coordenadas actuales e iniciales.

«Editar ubicación» permite arrastrar una cruz, elegir en el mapa o escribir longitud y latitud en grados decimales. El cambio requiere revisor y motivo y se guarda mediante `POST /api/species/{especie}/location`. Las coordenadas de origen nunca se sobrescriben: `reviews/{especie}.locations` guarda la posición vigente, mientras el historial registra la anterior, la nueva y la inicial. Volver a la ubicación inicial crea un movimiento nuevo. El historial general incluye el filtro «Cambios de ubicación» y enlaces para consultar las posiciones histórica, anterior, inicial y actual. Las escrituras usan ETag y una revisión de ubicación por punto para rechazar ediciones obsoletas sin perder exclusiones o cambios concurrentes.

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

El mapa abre con el satelital de ArcGIS Location Platform e incluye National Geographic, Relieve, Topográfico y Oscuro. Los estilos vectoriales y ráster se dibujan con MapLibre GL y se sincronizan con las capas de Leaflet. National Geographic combina la base física, el sombreado y las etiquetas del estilo oficial de Esri. Los estilos generales usan etiquetas en español cuando están disponibles.

Configura `ARCGIS_LOCATION_API_KEY` como secreto del servidor de Sites. La interfaz nunca recibe la clave: los estilos, teselas, fuentes y sprites pasan por `/api/basemaps/`, con la sesión del portal y una lista limitada de servicios de Esri. El servidor añade la clave únicamente a las peticiones a ArcGIS. Los errores de autorización del proveedor se presentan sin cerrar la sesión del usuario. Durante un cambio de mapa se conserva el anterior hasta que el nuevo está listo. El HTML generado y el repositorio no contienen credenciales.

La capa departamental y las líneas de OSM se leen del almacén privado `reference/v1/`. Para provisionar una copia del sitio, carga primero `departments`, `overview`, `regional` y los JSON de la cuadrícula mediante `PUT /api/import-reference/{key}`, con un secreto independiente `REFERENCE_IMPORT_TOKEN`. Carga `index` al final para cerrar la importación. El índice contiene la lista de claves de cuadrícula y los recuentos.

### Cuencas y frecuencia de amenazas

Las capas ambientales se guardan en el bucket privado bajo thematic/20261119. El origen HydroATLAS_Nivel05_Bolivia contiene 23 registros, de los cuales 21 tienen geometría. El portal muestra esos 21 polígonos. La tabla de atributos proporciona los nombres y códigos.

Los dos rásteres originales se reproyectaron a EPSG:3857 con celdas de 30 m y vecino más próximo. Los archivos COG incluyen vistas de menor resolución mediante el mismo remuestreo. El portal lee porciones mediante HTTP Range y GeoTIFF.js 2.1.3, sin interpolar los valores de frecuencia. El valor 0 es NoData en ambos archivos y se dibuja transparente. Las vistas lejanas son representaciones generalizadas y no deben usarse para calcular áreas.

Para provisionar otra instancia, configurar THEMATIC_IMPORT_TOKEN como secreto de servidor y cargar basins, deforestation.tif y fire.tif mediante PUT /api/import-thematic/{key}. Cargar manifest al final cierra la importación. Los cambios de revisión de especies usan un prefijo independiente.

Las cuencas muestran sus nombres de forma permanente y tienen un relleno violeta con 88 % de transparencia. La capa «Minería ilegal» incorpora los 544 polígonos de `Mineria_Ilegal_AP_Todos`, con registros de 2018 a 2025, en color ámbar. Sus ventanas muestran los atributos originales `ANIO`, `PERIODO`, `MINED_HA` y `nombre_ap`; un nombre vacío se presenta como «No informada en el archivo». La superficie es el valor del atributo original, sin recalcular ni sumar solapamientos de distintos períodos.

`scripts/prepare-mining.py` convierte el shapefile geográfico WGS84 a GeoJSON de dos dimensiones, conserva sus atributos y vértices XY, y omite Z. Requiere `pyshp`. La capa se guarda en el bucket privado en `thematic/20261120/mining` y se lee en `GET /api/thematic/mining` con la sesión del portal. Para provisionarla se configura el secreto `MINING_IMPORT_TOKEN` y se carga una vez mediante `PUT /api/import-mining`; el objeto existente cierra esta ruta a nuevas escrituras. Los archivos de origen y los datos de la capa no se publican en el repositorio.

