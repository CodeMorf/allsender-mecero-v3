# Optimización del backend que consume esta PWA (12-sep-2026)

Este documento es el **lado frontend** del trabajo de rendimiento hecho sobre el backend
`restapp.allsender.tech`. El detalle completo (diagnóstico, mediciones y post-mortem) está en
el repositorio del backend: `Allsender-Restapp → docs/OPTIMIZACION_RENDIMIENTO_20260912.md`.

**Resumen para esta app:** el API pasó de ~1.500 ms por petición a **189-369 ms** (~6×), y las
**imágenes de producto ya se ven**. Esta PWA no cambió su código para lograrlo, pero su
contrato de imágenes y el peso de su primer arranque sí requieren atención.

---

## 1. Contrato de imágenes (importante mantenerlo)

Esta aplicación resuelve la foto de un producto con la ruta:

```
api/application-integration/media/item/{fichero}
```

**Esa ruta no existía en el backend** (devolvía 404 siempre): por eso ninguna imagen se veía.
Ahora existe y responde, resolviendo el fichero desde el almacenamiento activo:

| Caso | Respuesta |
|---|---|
| El fichero está en disco (heredados) | `302` → `/user-uploads/item/{fichero}` (servido por nginx, cacheable 7 días) |
| El fichero está en Cloudflare R2 (lo normal) | `302` → URL firmada de R2 |
| No existe | `404` |
| Nombre con *path traversal* (`..%2f..%2f.env`) o carpeta no permitida | `404` |

**Reglas al tocar la resolución de URLs en esta app:**

1. **Preferir siempre `media/item/{fichero}`** (ruta propia, estable y sin caducidad) antes que
   construir URLs contra el host de R2.
2. Las **URLs firmadas de R2 caducan**: su validez se amplió de 60 minutos a **24 horas** para
   que nunca mueran dentro de una caché, pero **no se les puede añadir ningún parámetro**
   (`?v=…`): la firma cubre la cadena de consulta y quedaría inválida.
3. Las **URLs locales** sí llevan versión (`?v=<timestamp>`) — es intencionado, para que un
   navegador con una imagen fallida cacheada no se quede mostrando el marcador de posición.
4. El `<img>` **no envía token**: la ruta es pública por diseño (con límite de 600 peticiones
   por minuto y por IP). No hay que añadir cabeceras de autenticación al cargar imágenes.
5. Muchos productos **no tienen foto en la base de datos** (`image = NULL`): en esos casos el
   marcador (la campana dorada) **es lo correcto**, no un fallo de la app.

---

## 2. Icono PWA: corregido en producción

El icono `branding/mesero-app-icon-20260908.png` pesaba **1.180.936 B (1,18 MB)** y se cargaba
en cada primer arranque de la PWA.

**Corregido en el servidor a 57.897 B (58 KB), −95 %** (redimensionado a 512×512, 256 colores,
sin metadatos).

**Recomendación para el repositorio:** incorporar el icono ya comprimido a los *assets*
fuente y, si se quiere máxima calidad, declarar varios tamaños en el `manifest`
(192×192, 512×512) en lugar de servir un único PNG de más de un megabyte.

---

## 3. Peso del primer arranque (pendiente, recomendado)

Medido en el bundle desplegado (`index-3RJY0Yt5.js`): **735 KB de JavaScript** + el icono.
Con el icono ya reducido a 58 KB, queda el bundle como principal coste de arranque.

Sugerencias, por impacto:

1. **División del bundle** (`import()` dinámico) para las pantallas que no se usan en el
   arranque del mesero (KDS, caja, reportes).
2. **Revisar dependencias**: comprobar si alguna librería pesada (gráficas, tablas, editores)
   se importa en el punto de entrada sin usarse en las pantallas de servicio.
3. La pantalla de arranque debería depender de **una sola llamada** al backend
   (`pos/offline/bootstrap`, ~4,2 KB) y no de varias encadenadas.

---

## 4. Qué se benefició sin tocar esta app

Estas mejoras del backend se notan directamente aquí, porque cada llamada desde el móvil o la
tablet atraviesa el mismo camino:

| Cambio en el backend | Efecto en esta PWA |
|---|---|
| Caché de esquema reorganizada | 278 → **24 operaciones Redis** por petición |
| Redis por socket unix (no TCP) | 11,63 → **0,490 ms** por operación |
| MySQL por socket unix | ~10 → **1,03 ms** por consulta |
| `route:cache` activo (1.069 rutas) | **−150 ms** en cada petición |
| Orden de sucursal y pagos optimizados | `pos/orders` de 4.697 ms a **~330 ms** |
| Tiempo real (Pusher) reparado | las suscripciones privadas pasan de **500 → 200** (firma verificada contra el HMAC esperado) |
| `pos/get-order-number` | **500 → 200** (bloqueaba la creación de pedidos por API) |

**Relevante para el tiempo real:** el backend tenía tres defectos encadenados en la
autorización de canales privados. Ahora `POST /pusher/authorize-channel` devuelve
`{"auth":"clave:firma"}` correctamente, así que mesas, pedidos y KOT **deberían actualizarse en
vivo**. Si en alguna pantalla no se refresca sola, el primer sitio a mirar es esa llamada.

---

## 5. Nota sobre el arranque en el servidor

El despliegue de esta PWA es estático (nginx sobre `/www/wwwroot/mesero.allsender.tech`) y
no usa el `route:cache` del backend. Aparte: el vhost del mesero **reenvía**
`/api/application-integration/media/` al origen del API, de modo que las rutas relativas de
imagen funcionan también cuando el navegador las resuelve contra este dominio.

Si se cambia el prefijo de la ruta de imágenes, hay que actualizar ese `location` del vhost.
