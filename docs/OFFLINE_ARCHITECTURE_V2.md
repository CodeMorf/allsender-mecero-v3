# RestaApp Mesero — arquitectura offline V2 propuesta

**Fase 0:** diagnóstico y diseño; no implementado en esta rama.

## 1. Estado actual comprobado

El Mesero ya tiene un mecanismo offline funcional de primera generación:

- `src/storage/offline.ts` mantiene caché por scope en `localStorage`.
- El outbox usa IndexedDB `restapp-offline`, object store `outbox`, key path `id`.
- Cada operación tiene `id`, `scope`, método, ruta, body, `idempotencyKey` y `createdAt`.
- `OfflineWorkflow` permite una secuencia durable con `stage`, pasos, `remoteOrderId`, `localOrderId` y etiqueta.
- `App.tsx` encola y ejecuta workflows para crear orden, actualizar orden, actualizar items, crear KOT, cobrar, imprimir, KOT status, llamadas y caja.
- Se intenta sincronizar al iniciar/recuperar conexión y mediante acciones de la aplicación.
- Hay caché de tablas, catálogo, KOT, detalle de orden, order KOTs, delivery settings, ejecutivos, recibos, impresoras y caja.
- El cliente envía `Idempotency-Key` en muchas mutaciones.

El backend también tiene `/pos/offline/bootstrap` y `/pos/offline/sync`. `OfflineSyncController` valida un envelope de órdenes, usa `client_uuid`, reconoce `already_synced` por `orders.uuid` y delega la creación en `PosProxyController`. El cliente actual no usa este endpoint como protocolo central; mantiene un outbox de requests REST individuales/secuenciales.

## 2. Brechas V1

El registro actual no tiene estado persistente de sync, intentos, backoff, errores clasificados, dependencias explícitas ni versión de servidor. Una operación fallida queda sujeta a la decisión de `isRetryableOffline` y al flujo que la ejecuta; no existe un ledger visible con la razón del conflicto.

El workflow conserva los pasos, pero no modela de manera explícita:

- dependencia `create order -> update order -> create KOT -> payment`;
- reconciliación de cada local ID con remote ID;
- respuesta repetible por clave y cuerpo;
- conflicto de dos dispositivos;
- estado financiero confirmado por servidor;
- límite y programación de reintentos;
- recuperación tras cierre forzado del navegador;
- migración/versionado del esquema IndexedDB.

No se debe interpretar que “está en IndexedDB” equivale a “pago offline seguro”.

## 3. Registro V2 propuesto

No se debe crear esta estructura hasta auditar primero el esquema existente y mantener compatibilidad con las filas V1. Conceptualmente, cada operación debería contener:

| Campo | Finalidad |
|---|---|
| `id` | Identificador local inmutable |
| `scope` | Tenant + restaurante + sucursal + dispositivo |
| `user` | Usuario/rol que originó la acción |
| `device` | `getDeviceId()` o binding vigente |
| `operation` | Nombre comercial estable, no sólo HTTP |
| `entity_type` | order, order_item, kot, payment, cash, etc. |
| `local_entity_id` | Referencia local antes del servidor |
| `remote_entity_id` | ID/UUID confirmado por servidor |
| `method`/`path` | Compatibilidad con transporte actual |
| `body` | Payload original versionado |
| `idempotency_key` | Clave única por operación lógica |
| `created_at` | Momento de creación local |
| `attempts` | Número de intentos |
| `next_retry_at` | Siguiente ventana de backoff |
| `sync_status` | `pending`, `syncing`, `synced`, `conflict`, `failed` |
| `last_failure_category` | network, timeout, auth, validation, conflict, server, unknown |
| `last_failure_at`/`last_error_code` | Diagnóstico sin exponerlo en UI |
| `dependencies` | IDs de operaciones previas requeridas |
| `server_version`/`updated_at` | Control optimista cuando el backend lo soporte |
| `schema_version` | Evolución del registro local |

Los nombres anteriores son diseño de trabajo, no campos que ya existan en backend. No deben agregarse a la API pública sólo por documentarlos.

## 4. Máquina de sync

La operación debe seguir este ciclo:

`pending -> syncing -> synced`

Con salidas:

- `syncing -> pending` para error transitorio y reintento permitido;
- `syncing -> conflict` cuando el servidor tiene una versión financiera/operativa incompatible;
- `syncing -> failed` cuando el error requiere intervención o supera el máximo de intentos.

Requisitos:

1. **Single-flight:** una sola sincronización por scope/dispositivo. Un evento online y un botón manual no deben ejecutar dos workers simultáneos.
2. **Dependencias:** crear la orden antes de referenciar su ID remoto en update/KOT/payment.
3. **Backoff:** exponencial con jitter y máximo configurable; nunca un loop agresivo de requests.
4. **Retry seguro:** reusar la misma clave de la operación lógica; no generar una clave nueva para repetir el mismo cobro o KOT.
5. **Reconciliación:** guardar `client_uuid -> order_id` y actualizar todos los pasos dependientes.
6. **Persistencia:** escribir el avance después de cada paso y antes de cerrar la app.
7. **Límite:** después de varios fallos, pasar a `failed` y mostrar una acción profesional de reintento, no un stack trace.

## 5. Autoridad y conflictos

### Servidor autoritativo

Siempre prevalece el servidor para:

- pagos confirmados;
- estado de pago;
- total fiscal, impuestos, cargos, propina y delivery fee;
- NCF/e-CF y estado fiscal;
- stock o disponibilidad que afecte una venta;
- estado KOT cuando ya fue procesado por cocina;
- entrega confirmada y pruebas de entrega.

Una copia offline antigua nunca debe escribir encima silenciosamente de un pago o estado confirmado recientemente.

### Reconciliación de órdenes

- Si `client_uuid` ya existe y el servidor devuelve `already_synced`, enlazar la operación y continuar dependencias sin crear otra orden.
- Si el servidor devuelve una orden con versión más nueva, conservar el servidor y registrar un conflicto local explicable.
- Si el cambio offline es de una nota o campo no financiero y el contrato permite merge, hacerlo sólo con regla explícita.
- Si dos dispositivos agregan artículos, el merge debe resolverse en backend por item/version; no concatenar arrays ciegamente en el cliente.

### Pagos offline

- Tarjeta/electrónico: no mostrar éxito sin confirmación real del proveedor y backend.
- Efectivo: sólo permitir offline si la política del negocio lo autoriza, la orden tiene clave durable, existe conciliación y el cajero entiende que queda pendiente de sincronización.
- Nunca usar `status=paid` local como prueba de pago confirmado.
- Un retry con la misma clave no puede producir dos `payments` rows.

## 6. Triggers de sincronización

El worker V2 debe despertar al:

- iniciar la aplicación;
- recuperar conectividad;
- volver a foreground;
- acción manual “Sincronizar ahora”;
- creación de una operación cuando existe conexión, con debounce/single-flight.

Debe comprobar token, scope, branch binding y permisos antes de reintentar. Un 401/403 no es un error de red: pasa a estado que requiere reautenticación o permiso.

## 7. Caché y KDS

El KDS actual consulta `GET /pos/kots` sin fecha y filtra localmente estados activos. Debe conservar la mejora de fecha del candidato sin borrar datos de otras estaciones.

Problema comprobado: al refrescar con `kitchen_place_id`, `KitchenPanel` guarda `kots: values` aunque `values` sólo sea una estación. Al trabajar offline después, el caché puede carecer de KOT de las demás estaciones. La V2 debe guardar entidades por ID y fusionar por `scope + kitchen_place_id`, o mantener un índice de consultas separado del conjunto normalizado.

Una respuesta vacía exitosa puede reemplazar la vista si es realmente autoritativa para el mismo scope/filtro. Una respuesta tardía de otra sucursal, token o filtro no debe reemplazar el estado actual. Para ello se requiere una clave de consulta que incluya scope, branch, estación y generación de request.

## 8. UX offline

Mensajes permitidos:

- “Sin conexión. Tus cambios se sincronizarán automáticamente.”
- “Hay cambios pendientes de sincronización.”
- “No pudimos completar esta acción. Intenta nuevamente.”
- “El servidor confirmó una versión más reciente; revisa la orden.”

No mostrar rutas, nombres de tablas, excepciones, tokens, headers ni categorías internas. El diagnóstico detallado queda en logs protegidos o una vista de desarrollo no expuesta al cliente.

## 9. Migración sin romper V1

1. Versionar el object store o añadir un store V2 sin eliminar filas V1.
2. Leer V1 y adaptarlo a V2 en memoria/upgrade reversible.
3. Mantener `workflow` existente hasta que todas sus operaciones tengan representación V2.
4. Activar V2 por feature flag de dispositivo/sucursal, empezando con lectura/observación.
5. Probar reconexión, doble pestaña, cierre abrupto, token expirado, cambio de sucursal y dos dispositivos.
6. Sólo cuando los contadores coincidan, activar nuevas mutaciones.
7. Retirar V1 únicamente en una fase posterior, con backup y rollback documentados.

## 10. Tests de aceptación

- crear orden offline y sincronizar una sola vez;
- perder conexión después de crear y antes de KOT;
- repetir la sincronización con timeout después de respuesta del servidor;
- pago repetido con la misma clave;
- dos KOT concurrentes para la misma orden;
- dos dispositivos editando artículos;
- servidor confirma pago mientras un dispositivo está offline;
- cambio de sucursal con outbox pendiente;
- reintento tras cierre/reapertura del navegador;
- KDS filtrado por Cocina y Bar sin pérdida de caché cruzada;
- recovery cuando una orden remota ya existe por UUID;
- UI sin lenguaje técnico y logs con correlación protegida.

## 11. Límites de esta fase

No se modificó `offline.ts`, `types.ts`, `App.tsx`, el controlador de sync, IndexedDB ni ningún endpoint. Este documento define el plan para Fase 8 y sus dependencias, no demuestra que offline V2 ya exista.
