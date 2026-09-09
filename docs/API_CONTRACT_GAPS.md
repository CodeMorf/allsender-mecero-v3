# RestaApp — brechas del contrato API de órdenes

**Fase:** 0 — inventario y contrato real.

**Regla:** este documento no crea endpoints ni declara soportado lo que sólo aparece en un ejemplo.

## 1. Fuentes y alcance

- Base de integración: `https://restapp.allsender.tech/api/application-integration`.
- Rutas Laravel: `backend_work/Modules/RestApi/Routes/api.php`, checkout candidato `09c93b3` y comparación con `origin/main` `757f9f3`.
- Controladores principales: `PosProxyController`, `PlatformController`, `FiscalDocumentController`, `OfflineSyncController`.
- Cliente: `src/api/client.ts`, `src/App.tsx`, `src/types.ts`, `src/storage/offline.ts`.
- Página pública: [`documentación pública`](https://restapp.allsender.tech/application-integration/docs/public/kHfyEzZjpFytQ3xMBDx532aFSGEY6znzkTDNcC1ufvY6z0S1?lang=es-do).
- OpenAPI: `GET /api/application-integration/openapi.json`, servido desde un JSON estático según `api.php`.

## 2. Autenticación, tenant y permisos

La API usa Bearer Sanctum. El grupo protegido aplica `auth:sanctum`, `EnsurePosFeatureEnabled` y `LogApiMutation`. Las mutaciones POS tienen permisos comerciales, entre ellos:

| Capacidad | Slug observado |
|---|---|
| Ver órdenes | `orders.view` |
| Crear/actualizar órdenes | `orders.create`, `orders.update` |
| KOT | `orders.kot`, `kitchen.manage` |
| Cobrar | `payments.charge` |
| Ver cobros | `payments.view` en el catálogo, aunque las rutas de lectura deben revisarse una por una |
| Propina | `payments.tip` |
| Imprimir | `orders.print`, `print.use` según catálogo/uso |
| Clientes | `customers.view`, `customers.manage` |
| Mesas | `tables.view`, `tables.manage` |
| Caja | `cash.view`, `cash.open`, `cash.close`, `cash.movement`, `cash.approve` |

`EnsureApiPermission` combina permiso Spatie y abilities del token de integración. El cliente debe usar `permission_map` para la UX, pero nunca como sustituto de la validación del servidor.

El aislamiento observado se basa en `restaurant_id` del usuario y `branch_id` de la sucursal activa. `getOrder` y la mayoría de mutaciones buscan por `branch_id`. Las pruebas de contrato deben intentar leer/modificar un ID de otra sucursal con un token autorizado y esperar 404/403, sin tocar datos.

## 3. Matriz principal de contrato

| Endpoint | Rutas Laravel | Documentación HTML | OpenAPI publicado | Mesero actual | Brecha concreta |
|---|---:|---:|---:|---:|---|
| `POST /pos/orders` | Sí | Sí | Sí | Sí | Entrada presentacional/legacy; idempotencia no demostrada en controlador |
| `PUT /pos/orders/{id}` | Sí | Sí | Sí | Sí | Mezcla `status`, `order_status` y `actions` |
| `GET /pos/orders` | Sí | Sí | Sí | Sí | Lista paginada y formas financieras no canónicas |
| `GET /pos/orders/{id}` | Sí | Sí | Sí | Sí | No se confirmó `payment_status`, `settlement_mode` ni `amount_due` como contrato estable |
| `POST /pos/orders/{id}/status` | Sí | Sí | Sí | No como flujo principal | Ejemplo de docs usa `paid`, contradiciendo la separación |
| `POST /pos/orders/{id}/pay` | Sí | Sí | Sí | Sí | Respuesta y columna legacy pueden convertir operación en `paid` |
| `POST /pos/orders/{id}/split-payments` | Sí | Sí | No | No | OpenAPI incompleto; no hay método cliente; semántica no equivale automáticamente a `payments[]` |
| `POST /pos/orders/{id}/kot` | Sí | Sí | Sí | Sí | Idempotencia por artículo, no contrato replay formal |
| `GET /pos/orders/{id}/kots` | Sí en ruta | Parcial | No identificado en paths | Sí | Forma y documentación deben fijarse |
| `GET /pos/kots` | Sí | Sí | Sí | Sí | Fecha opcional/estados activos dependen del SHA desplegado |
| `PUT /pos/kots/{id}/status` | Sí | Parcial | Sí | Sí | No se comprobó transición atómica/idempotente completa |
| `GET/POST/PUT/DELETE /pos/customers` | Sí | Sí | No | No | Módulo Customer ausente del checkout activo |
| `GET/POST/PUT/DELETE /customer-addresses` | Sí | Sí | No | No | No existe consumo; modelo sólo guarda address/lat/lng |
| `GET /pos/order-types` | Sí | Sí | Sí | Sí | Cliente tipa sólo tres modos; backend reconoce room service |
| `GET /pos/delivery-platforms` | Sí | Sí | No | No | `delivery_app_id` no tiene adapter directo en Mesero |
| `GET /pos/delivery-executives` | Sí | Sí | No | Sí | Sólo lectura; faltan asignación/status desde cliente |
| `GET /pos/delivery-settings` | Sí en Laravel | No alineado | No | Sí | El cliente no llama cálculo de tarifa |
| `POST /pos/delivery-fee/calculate` | Sí en Laravel | No alineado | No | No | Backend usa Haversine; falta contrato Maps/ruta |
| `PUT /pos/orders/{id}/assign-delivery` | Sí | No alineado | No | No | No hay flujo UI/adaptador |
| `PUT /pos/orders/{id}/delivery-status` | Sí | No alineado | No | No | Estados y timestamps deben alinearse |
| `GET /pos/delivery-orders` | Sí | No alineado | No | No | Filtro por fecha por defecto puede ocultar órdenes tras cambio UTC |
| `GET/POST /pos/offline/bootstrap`, `/pos/offline/sync` | Sí en rutas | Parcial | No completo | No usa como protocolo central | Existe un outbox alternativo en Mesero |
| `GET /platform/fiscal-capabilities` | Sí | Sí | Sí | Sí | Bien orientado a server authority; emisión y elección de comprobante deben mantenerse separadas |

## 4. Formas reales relevantes

### Crear orden

`submitOrder` lee, entre otros, `order_type`, `items`, `customer`, `pax`, `waiter_id`, `table_id`, `delivery_address`, `delivery_time`, `delivery_fee`, `delivery_executive_id`, `delivery_app_id`, `context_type`, `context_id`, `bill_to`, `room_number`, `placed_via`, `customer_address_id`, descuentos y cargos.

El Mesero no envía todo ese contrato. Su flujo actual crea una orden mínima con nombre visual de tipo de servicio, items y datos básicos del cliente/delivery; luego ejecuta un `PUT` y un `POST /kot`. El comentario en `App.tsx` reconoce que la creación inicial completa había producido errores genéricos y que el flujo se redujo a una forma mínima.

Brecha: debe existir un adapter de payload central que traduzca el draft de UI a la forma efectivamente aceptada, sin que cada componente invente alias.

### Actualizar orden

`UpdateOrderRequest` acepta `table_id`, `customer_id`, `customer`, `waiter_id`, items, `status`, `order_status`, `actions` y descuentos. Sus reglas aceptan valores que mezclan operación y pago (`paid`, `billed`) y valores antiguos (`ready`, `canceled`, `kot`). La validación de mesa se hace sólo para dine-in.

Brecha: documentar lo aceptado históricamente y luego añadir un campo/adapter canónico sin romper `actions=['kot']` ni los consumidores del POS web.

### Detalle y lista

`getOrder` construye manualmente una respuesta con items, variación, modificadores, cliente, repartidor, cargos, impuestos, `financials`, `order_status` y `status`. La lista también agrega items y datos resumidos.

Brecha: no se debe construir el estado financiero del cliente leyendo sólo el string `status`. La forma futura debe incluir, de manera aditiva y autoritativa, operación, pago, liquidación, total, pagado, pendiente y snapshot de destino.

### Cobro

`payOrder` valida `amount` y `method` en `cash`, `card`, `bank_transfer`, `upi`. Usa `Payment`, `amount_paid`, lock transaccional y `transaction_id` como clave cuando llega `Idempotency-Key`. Impide superar el saldo pendiente. Al completar puede actualizar legacy `status` y liberar mesa.

Brechas:

- El contrato público debe distinguir respuesta financiera de estado operativo.
- El endpoint no acepta aún settlement mode explícito.
- El frontend sólo usa el método simple y luego hidrata toda la aplicación.
- El flujo de cobro de plataforma prepagada, contra entrega, cargo a habitación y crédito no está representado como contrato canónico del Mesero.

### Split

El endpoint actual valida `amount`, `payment_method`, `status` (`pending|paid`) y opcionalmente items con `order_item_id` y quantity. Verifica que los items pertenezcan a la orden y crea `SplitOrder`/`SplitOrderItem`.

Brechas:

- No se comprobó bloqueo de la orden al acumular splits concurrentes.
- No se comprobó validación de suma de splits contra total/saldo.
- No se comprobó una clave idempotente propia.
- El endpoint crea un registro de split, no necesariamente una fila en `payments`; la documentación que muestra `payments[]` no debe aplicarse a ciegas.
- `payer_name` existe en el modelo/migración candidata, pero no forma parte del payload validado del endpoint observado.

### KOT

`createKot` identifica artículos ya enviados por `kot_items.order_item_id`, crea un KOT por estación y luego llama el mecanismo de impresión. El KOT conserva nota, variación y suplementos mediante una copia de modifiers.

Brechas:

- La consulta de “ya enviado” y la inserción no forman una operación idempotente explícita bajo una clave única.
- El cliente manda `Idempotency-Key`, pero el handler no la lee en el código auditado.
- La impresión se ejecuta después del commit, pero el tiempo de render/PrintJob forma parte de la latencia percibida.

## 5. OpenAPI y documentación pública

La página pública con `?lang=es-do` respondió, pero mostró título/navegación en inglés y claves internas de traducción. El HTML enumera endpoints que el JSON OpenAPI no expone.

La corrección posterior debe:

1. Generar el documento a partir de una única fuente de contrato o mantener una prueba que compare rutas registradas contra `paths`.
2. Incluir los endpoints reales de customers, addresses, delivery, split, KOT por orden, offline y fiscal.
3. Eliminar ejemplos que pongan `status=paid` como estado operativo.
4. Documentar exactamente `POST /pay`, incluyendo métodos permitidos, idempotencia, saldo y respuesta.
5. Documentar `GET /pos/delivery-settings` y `POST /pos/delivery-fee/calculate` sólo después de confirmar sus parámetros y que el cálculo sea la política aprobada.
6. No mostrar claves internas de traducción en `es-do`.
7. Versionar las respuestas nuevas sin retirar inmediatamente las claves legacy.

## 6. Pruebas de contrato requeridas antes de modificarlo

- Auth válida de PIN y password con el mismo restaurante/sucursal.
- Auth inválida, permiso insuficiente y token con scope insuficiente.
- Orden de una sucursal contra ID de otra.
- Crear orden con la misma clave dos veces: una orden, misma respuesta o resultado documentado.
- Crear KOT repetido/concurrente: un solo KOT por conjunto de artículos.
- Cobro repetido con la misma clave: un solo `payments` row.
- Cobro parcial, sobrepago, total exacto y payment method no permitido.
- Estado operativo paid/inpaid separado del pago después de la futura fase.
- Split por partes e items, suma exacta, reintento y dos dispositivos.
- Cliente encontrado por `customer_id`; RNC/Cédula sólo dentro del restaurante.
- Dirección con lat/lng, cambio posterior y snapshot histórico.
- Fee fixed/per-distance/tiered y fuera de radio.
- KOT sin fecha a ambos lados del cambio UTC, siempre con branch isolation.
- Offline create/retry y reconciliación por UUID.

## 7. Regla de no invención

Hasta que una fase funcional lo implemente y lo pruebe, no se deben afirmar como existentes `payment_status`, `settlement_mode`, `delivery_direct`, `delivery_platform` como campos persistentes, `place_id`, `formatted_address`, Google Places, distancia de ruta, `amount_due` canónico, customer financial statistics o un endpoint de unified detail. Son objetivos de diseño, no contrato actual.
