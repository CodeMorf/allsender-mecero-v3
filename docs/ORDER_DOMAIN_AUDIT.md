# RestaApp — auditoría Fase 0 del dominio de órdenes

**Estado:** auditoría documental; sin cambios funcionales, sin migraciones y sin cambios en producción.

**Fecha de corte:** 2026-09-09 (America/Santo_Domingo).

## 1. Alcance y bases verificadas

Esta auditoría compara el contrato público, las rutas/controladores Laravel, los modelos/migraciones y el cliente PWA Mesero. No toma como verdad una captura de pantalla, un respaldo local ni un nombre de componente que no exista en el checkout activo.

| Capa | Base verificada |
|---|---|
| Mesero | `https://github.com/CodeMorf/allsender-mecero-v3`, checkout local `codex/order-domain-phase-0-audit`, SHA base `83a2c6f4f379394a975dc30ea538e573f2dcc3a7` |
| Backend producción | `/www/wwwroot/restapp.allsender.tech`, `origin/main` SHA `757f9f34169efcea4a8af2f88b5407806b9edb0e`; el checkout remoto está sucio y no se debe resetear |
| Backend checkout auxiliar | `backend_work`, rama `Morf/dominican-tickets`, SHA `09c93b3d3520ca1347b5c1b9cd70e145bbbd78c9`; contiene trabajo dominicano no presente en `origin/main` |
| Mesero producción | `/www/wwwroot/mesero.allsender.tech`; bundle publicado observado por separado. No se modificó |
| API base | `https://restapp.allsender.tech/api/application-integration` |
| Documentación pública | [`docs/public/...`](https://restapp.allsender.tech/application-integration/docs/public/kHfyEzZjpFytQ3xMBDx532aFSGEY6znzkTDNcC1ufvY6z0S1?lang=es-do) |
| OpenAPI publicado | `https://restapp.allsender.tech/api/application-integration/openapi.json` |

El backend auxiliar incluye, entre otros, el módulo `Modules/DominicanTickets` y ajustes de room service, impresión, clientes fiscales y KOT. Es un **candidato no fusionado**, no una prueba de que esos cambios estén en producción. Esta distinción queda obligatoria para las siguientes fases.

La Fase 0 no crea backup de un archivo existente porque sólo agrega cinco documentos nuevos en Mesero; no se modifica ningún archivo de código, migración, configuración, base de datos ni bundle.

## 2. Mapa real de la implementación

### Mesero activo

La aplicación real concentra la orquestación en `src/App.tsx` y el acceso HTTP en `src/api/client.ts`.

Existen en el checkout activo:

- `src/App.tsx` para pantallas, carga, orden, KOT, cobro, caja, polling y workflow offline.
- `src/api/client.ts` para las llamadas REST.
- `src/types.ts` para tipos de UI y almacenamiento.
- `src/storage/offline.ts` para `localStorage`/IndexedDB, caché, outbox y claves idempotentes.
- `src/receipt/*` para normalización/render de la vista previa de recibos.

No existen como código activo los archivos solicitados en el enunciado `src/modules/PosModule.tsx`, `src/modules/CustomersModule.tsx`, `src/components/OrderTypeModal.tsx` ni `src/utils/orderService.ts`. Hay copias con nombres prefijados dentro de `.codex-backups/`, pero son respaldos y no deben auditarse como runtime ni restaurarse automáticamente.

### Backend activo de referencia

La API de integración está registrada en `Modules/RestApi/Routes/api.php`. El grupo protegido usa `auth:sanctum`, `EnsurePosFeatureEnabled` y `LogApiMutation`; las rutas sensibles agregan `EnsureApiPermission` con slugs comerciales.

La lógica POS está principalmente en `Modules/RestApi/Http/Controllers/PosProxyController.php`, con `PlatformController`, `FiscalDocumentController`, `OfflineSyncController` y modelos compartidos. Esto funciona como compatibilidad con el POS existente, pero deja demasiadas decisiones de negocio en un controlador de gran tamaño.

## 3. Lo que sí está bien

1. Las órdenes se consultan con `branch_id` y las rutas críticas verifican restaurante/sucursal. `getOrder`, `getOrders`, KOT y delivery deben conservar este aislamiento.
2. Existe `customer_id` en la orden y la relación `Order::customer()`. El vínculo por ID es la relación autoritativa.
3. Existe `waiter_id`/relación `waiter`, además de `added_by`; por tanto, el empleado que atendió puede vivir en la orden y no como único atributo permanente del cliente.
4. Existe `order_status` como dominio operativo en `App\Enums\OrderStatus`: `placed`, `confirmed`, `preparing`, `food_ready`, `ready_for_pickup`, `picked_up`, `out_for_delivery`, `reached_destination`, `served`, `delivered`, `cancelled` y `completed`.
5. Existe el legado `orders.status`, originalmente con `draft`, `kot`, `billed`, `paid`, `canceled`, `payment_due`. El sistema ya tiene la separación física parcial de columnas, aunque todavía no la separación semántica correcta.
6. Existe la tabla `payments`, `amount_paid`, `Order::isFullyPaid()` y `remainingAmount()`. `payOrder` usa transacción y bloqueo de la orden, y reconoce una clave idempotente para pagos repetidos.
7. Existe `split_type` (`even`, `custom`, `items`), `split_orders` y `split_order_items`. El backend tiene un endpoint de split; el cliente Mesero no lo consume.
8. Existe `OrderStatus::progressStepsForOrderType`, que ya diferencia parcialmente el flujo de pickup, delivery y mesa.
9. Existe `OrderType` por sucursal, con slugs `dine_in`, `delivery`, `pickup`; el modelo reconoce aliases y `room_service` si el módulo Hotel está habilitado.
10. Existe `customer_addresses` con `customer_id`, `label`, `address`, `lat` y `lng`, y el backend expone CRUD bajo `/customer-addresses`.
11. Existe configuración de delivery por sucursal, tarifa fija, tarifa por distancia, tramos, radio máximo, horarios y coordenadas de sucursal.
12. Existe `delivery_app_id` para vincular una orden con `delivery_platforms`, y `delivery_executive_id` para el repartidor.
13. Existe `fiscal_snapshot` y `FiscalOrderCalculator`; el backend calcula impuestos/cargos según restaurante, sucursal, país, tipo de servicio y configuración, en lugar de aceptar el ITBIS del frontend como autoridad.
14. Existe un flujo de KOT por artículos no enviados y separación por `kot_place_id`, con preservación de variantes, notas y suplementos en la copia del KOT.
15. Existe una corrección candidata para KOT sin fecha explícita: filtrar sólo los estados activos y no por el día UTC. Esa corrección está en `09c93b3`, pero no se debe confundir con `origin/main` `757f9f3` hasta verificarse/desplegarse explícitamente.

## 4. Problemas de dominio encontrados

### P0 — pago y operación todavía se mezclan

`orders.status` continúa representando el ciclo financiero heredado, mientras `orders.order_status` representa el flujo operativo. `payOrder` registra el pago correctamente con bloqueo e idempotencia, pero cuando el saldo queda en cero puede escribir `status = paid` y, si la enumeración lo permite, `order_status = paid`. También devuelve `status = paid` o `payment_due`.

Esto contradice el dominio requerido: una orden puede estar `preparing` y `paid`, o `ready_for_pickup` y `unpaid`. La corrección debe ser aditiva y backward-compatible: primero definir adapter/mapping y una respuesta canónica; después cambiar escrituras de manera controlada. No se debe cambiar el enum en producción durante esta fase.

### P0 — contrato de documentación no es contrato ejecutable

La página pública con `lang=es-do` respondió HTTP 200, pero su título y navegación siguen en inglés y se observaron claves internas como `applicationintegration-docs::doc.customers_delete`. El HTML enumera `POST /pos/orders/{id}/split-payments`, clientes y otros recursos, pero el OpenAPI JSON estático no los contiene como `paths`.

El OpenAPI publicado contiene, entre otros, `/pos/orders`, `/pos/orders/{id}`, `/pos/orders/{id}/status`, `/pos/orders/{id}/pay`, `/pos/orders/{id}/kot`, `/pos/kots`, `/pos/tables` y `/pos/order-types`. No contiene de forma equivalente `/pos/orders/{id}/split-payments`, `/pos/customers`, `/pos/delivery-platforms`, `/pos/delivery-executives`, `/pos/delivery-settings`, `/pos/delivery-fee/calculate` ni `/customer-addresses`, aunque varias de esas rutas sí están registradas en Laravel.

La fuente de `/openapi.json` es un archivo estático (`public/docs/application-integration/openapi.json` o `Modules/RestApi/Resources/openapi/openapi.json`), no el registro de rutas. Hay que regenerarlo/alinearlo en la fase de documentación, después de congelar el contrato real.

### P0 — creación de orden no tiene replay protection demostrada

El cliente envía `Idempotency-Key` al crear, actualizar, cambiar artículos y crear KOT. En el controlador auditado, la lectura explícita de la clave aparece para impresión y cobro; no se comprobó una deduplicación equivalente para `submitOrder`, `updateOrder`, `updateOrderItems` ni `createKot`. Crear KOT evita normalmente reenviar artículos ya ligados, pero la comprobación no está protegida con el mismo lock de extremo a extremo.

No basta con que el header viaje por HTTP: cada mutación crítica debe documentar si la clave se persiste, qué respuesta se repite, su alcance por tenant/sucursal/usuario/operación y qué ocurre si el cuerpo cambia.

### P1 — tipo de servicio no está completamente canonicalizado

El cliente tipa `OrderMode` sólo como `dine_in | delivery | pickup` y al crear envía nombres presentacionales `Dine In`, `Pickup` y `Delivery`. El backend normaliza algunos aliases, pero guarda/lee `order_type`, `order_type_id`, `delivery_app_id` y nombres traducidos en distintos puntos.

`room_service` aparece en el modelo de `OrderType` y en el candidato `09c93b3`, pero no existe en `OrderMode` activo del Mesero. `delivery_direct` y `delivery_platform` tampoco son dimensiones explícitas del cliente; la plataforma externa se infiere hoy mediante `delivery_app_id`.

### P1 — respuesta de orden no es un Unified Order Detail

`getOrder` arma manualmente items, modifiers, cliente, repartidor y `financials`, y expone `status` con fallback entre columnas. No se observó un campo canónico estable `payment_status`, `settlement_mode`, `amount_due` ni un snapshot de destino con `place_id`.

`OrderResource` también construye una forma diferente, incluyendo etiquetas en inglés, `payment.mode` y `totals`. Tener dos formas públicas para una misma orden aumenta el riesgo de que POS, KDS, Mesero y delivery interpreten distinto la misma operación.

### P1 — room service necesita contexto verificable

El candidato `09c93b3` valida `HOTEL_ROOM`, una estancia `checked_in`, habitación activa y aislamiento por restaurante/sucursal. La rama `origin/main` auditada no contiene esos cambios de integración en `submitOrder`. Por tanto, room service no debe declararse completo en producción hasta probar el vínculo `context_type/context_id/bill_to` con una estancia real y confirmar qué vista de Hotel lo consume.

### P1 — delivery calcula distancia en línea recta

`calculateDeliveryFee` usa Haversine entre `branches.lat/lng` y las coordenadas recibidas, y aplica `fixed`, `per_distance` o `tiered`. No calcula distancia de ruta Google Maps ni recibe `place_id`, dirección formateada o instrucciones. El cliente Mesero sólo carga settings/ejecutivos; no expone un método para pedir la cotización backend ni para gestionar direcciones.

### P1 — offline es durable, pero todavía es V1

IndexedDB guarda un outbox con `id`, scope, método, ruta, body, clave idempotente, fecha y workflow opcional. El workflow permite crear orden, actualizarla y crear KOT como secuencia.

Faltan en el registro persistido `attempts`, `nextRetryAt`, `syncStatus`, categoría del último fallo, dependencias explícitas, versión del servidor y timestamps de actualización. El sincronizador no muestra una resolución formal de conflictos por versión. El endpoint backend `/pos/offline/sync` deduplica la orden por `uuid` cuando existe la columna, pero delega la escritura normal y no constituye todavía un protocolo completo de sincronización de todas las mutaciones.

### P1 — polling KDS puede ocultar caché válida

`KitchenPanel` no borra deliberadamente pedidos al fallar: conserva `tickets` si la llamada lanza error y usa un guard contra respuestas después de desmontar. Sin embargo, cada respuesta exitosa reemplaza la lista y guarda `kots: values`; si se consulta una estación filtrada, esa respuesta parcial reemplaza el caché global de KOT. Al pasar offline, las otras estaciones pueden dejar de aparecer en ese dispositivo. Esto no es un borrado de base de datos, pero sí una pérdida de caché válida que debe corregirse con merge por scope/estación en una fase funcional.

### P1 — orquestación y latencia

`hydrate()` ejecuta muchas consultas en paralelo y puede enriquecer cada producto consultando sus grupos de modificadores. Al enviar una orden, el Mesero puede ejecutar una secuencia de POST/PUT/POST y, al cobrar, vuelve a ejecutar `hydrate()` completo. El detalle de orden solicita `getOrder` y `orderKots`, y existe además una carga separada de KOT en el mismo ciclo.

Esto explica una parte plausible de la lentitud observada, pero la auditoría no convierte una hipótesis en medición. Antes de optimizar hay que instrumentar duración, respuesta, reintento, impresión y cola por operación.

## 5. Matriz de función — documentación vs backend vs Mesero

| Función | Documentado | Backend real | Mesero usa | Diferencia | Acción posterior |
|---|---|---|---|---|---|
| `POST /pos/orders` | Sí, HTML; ejemplo usa `order_type` presentacional | Sí, `submitOrder`; calcula fiscal en servidor y acepta items/cliente/delivery/contexto según checkout | Sí, `App.tsx` | El cliente usa aliases/nombres visuales; no hay replay protection demostrada | Adapter de entrada + contrato idempotente |
| `PUT /pos/orders/{id}` | Sí | Sí, `UpdateOrderRequest`; acciones heredadas `kot/bill/cancel/draft` y campos de estado mezclados | Sí, principalmente para adjuntar KOT/mesero | UI y backend no comparten state machine explícita | Separar operación de pago y acciones |
| `GET /pos/orders` | Sí | Sí, paginado, branch-scoped, filtros status/fecha/búsqueda | Sí | La forma lista no es el Unified Order Detail y usa fallback de estados | DTO canónico aditivo |
| `GET /pos/orders/{id}` | Sí | Sí, payload manual con items, modifiers, cargos, impuestos y financials | Sí | No hay `payment_status`/`settlement_mode` canónicos confirmados | Respuesta versionada/aditiva |
| `POST /pos/orders/{id}/status` | Sí, pero el ejemplo usa `status=paid` | Sí, escribe sólo `order_status` cuando puede, pero acepta un conjunto combinado y devuelve un campo ambiguo | No como acción principal; Mesero actualiza KOT | Documentación contradice la separación requerida | Corregir docs y luego state machine |
| `POST /pos/orders/{id}/pay` | Sí | Sí; métodos `cash/card/bank_transfer/upi`, bloqueo de orden, payment row y `transaction_id` idempotente | Sí | Devuelve `status=paid/payment_due` y escribe legacy paid; no hay settlement mode | Normalizar pago sin romper legacy |
| Split payments | HTML sí; OpenAPI no | Sí, crea `split_orders` y opcionalmente `split_order_items` | No | No valida exhaustivamente total pendiente, no usa idempotencia propia ni crea necesariamente `payments` | Contrato financiero y pruebas de split |
| `POST /pos/orders/{id}/kot` | HTML sí | Sí; sólo artículos no enviados, divide por `kot_place`, imprime después del commit | Sí | Header viaja, dedupe es por item y no hay lock/replay formal | Idempotencia y corrida concurrente |
| `GET /pos/kots` | HTML/OpenAPI sí | En candidato sin fecha: estados activos; `origin/main` debe verificarse porque el código estático auditado muestra filtro por fecha con `$date` | Sí, sin fecha en `api.kots('pin')` | El runtime depende de qué SHA esté desplegado; filtro por estación reemplaza caché | Prueba UTC/local + merge de caché |
| Customers | HTML sí; OpenAPI no | Sí, GET/POST/PUT/DELETE, scope por restaurante; RNC/Cédula normalizado sólo en candidato `09c93b3` | No hay módulo ni métodos Customer activos en este checkout | Cédula/DGII candidato no está en main 757f9 confirmado | Promover sólo con prueba de producción |
| Customer addresses | HTML sí; OpenAPI no | Sí, CRUD global bajo `/customer-addresses`, columnas simples | No | Sin `place_id`, formatted address o snapshot explícito en orden | Ampliación aditiva y Maps |
| Tables | Sí | Sí, branch-scoped, locks/sesiones y estados legacy | Sí | La ocupación usa reglas históricas y status/payment | Adapter de ocupación |
| Order types | Sí | Sí, activos por branch; modelo reconoce room service si Hotel está habilitado | Sólo recibe lista; tipo TS no incluye room service | Cliente y backend tienen vocabularios distintos | Canonical service adapter |
| Delivery platforms | HTML sí | GET y CRUD reales; `delivery_app_id`; catálogo central candidato no está en main 757f9 | No tiene método de plataformas | Inferencia de platform/direct y OpenAPI ausente | Definir dimensión/adaptador |
| Delivery executives | HTML sí | GET/CRUD, asignación y status reales | Sólo GET inicial | Faltan acciones de asignación/despacho/entrega en cliente | Unified delivery workflow |
| Delivery settings | No aparece correctamente en OpenAPI; HTML público no la mostró | GET real con settings, tiers y coordenadas | GET settings, no cálculo | El cliente no consume la cotización autoritativa | Integrar cálculo backend |
| Delivery fee calculation | No alineado en OpenAPI | POST real, Haversine y políticas fija/distancia/tramos | No | Sin ruta Google Maps; frontend podría seguir fee antiguo | Maps + fee quote |
| Fiscal capabilities | Sí | GET real; backend decide capacidad/preparación | GET real | La emisión depende de datos fiscales no modelados en el cliente | Mantener server authority |
| Offline bootstrap/sync | Documentación parcial | Rutas reales; sync por `client_uuid` para órdenes | Cliente usa outbox propio, no el protocolo completo de bootstrap/sync | Dos mecanismos que deben converger | Offline V2 |

## 6. Diseño objetivo, todavía no implementado

La propuesta aprobada para fases posteriores debe tener cuatro dimensiones independientes:

1. **Servicio:** `dine_in`, `pickup`, `delivery`, `room_service`. Dentro de delivery, `delivery_direct` o `delivery_platform` debe ser una clasificación derivada/adaptada de `delivery_app_id`, no una duplicación inconsistente.
2. **Operación:** los valores existentes de `OrderStatus` son la base; el adapter debe traducir `draft`, `kot`, `billed`, `paid`, `payment_due`, `canceled` y otros legacy sin eliminar datos.
3. **Pago:** `unpaid`, `partial`, `paid` calculado desde pagos confirmados, cobro COD y autoridad backend. `paid` no debe representar cocina ni entrega.
4. **Liquidación:** `pay_now`, `pay_at_table`, `pay_at_pickup`, `pay_on_delivery`, `platform_prepaid`, `room_charge`, `credit`, sólo si cada valor se apoya en una regla/configuración existente o se implementa de forma comprobable.

Ejemplos válidos del diseño objetivo:

- pickup + preparing + paid;
- pickup + ready_for_pickup + unpaid;
- delivery + out_for_delivery + unpaid + pay_on_delivery;
- room_service + served + room_charge.

No se agregarán enums, columnas o endpoints en Fase 0. Toda ampliación debe comenzar por un contrato aditivo, migración expand/contract y pruebas de compatibilidad.

## 7. Compatibilidad, despliegue y rollback

- Mantener `orders.status`, `orders.order_status`, `amount_paid`, `payments`, `split_orders`, `order_type_id`, `delivery_app_id` y `delivery_executive_id`. Los campos `context_type`, `context_id` y `bill_to` sólo deben promoverse si el contrato de Hotel de la versión desplegada los confirma; en la auditoría actual aparecen en el checkout candidato, no como integración verificada en `origin/main`.
- No borrar pedidos, KOT, pagos, clientes, órdenes `#9`/`#10` ni limpiar la base.
- No cambiar `main` directamente. Cada fase funcional tendrá una rama y PR independiente.
- Las migraciones nuevas serán aditivas, reversibles sólo si no destruyen datos, y se ejecutarán primero en staging/fixture aislado.
- El backend debe aceptar entradas históricas y devolver campos legacy junto a los canónicos durante la transición.
- Rollback de código: revertir el release de la fase y mantener las columnas aditivas sin usarlas. Rollback de base: sólo aplicar `down` si se demuestra que no hay datos nuevos; nunca usar rollback destructivo en producción como reacción rápida.
- Validar tenant/restaurante/sucursal/permiso en cada fase. Un HTTP 200 no prueba aislamiento ni autorización.

## 8. Criterio de salida de esta Fase 0

La Fase 0 queda completa cuando los cinco documentos de esta rama estén revisados, los tests/build de línea base pasen sin cambios funcionales, el diff contenga sólo documentación, se publique la rama y se abra el PR. Después se detiene el trabajo hasta una decisión explícita sobre Fase 1.
