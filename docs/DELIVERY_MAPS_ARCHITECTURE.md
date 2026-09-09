# RestaApp — delivery, direcciones y Google Maps

**Fase 0:** auditoría y arquitectura; sin integración nueva en esta rama.

## 1. Implementación actual comprobada

### Base de datos/modelos

Existe `customer_addresses` con:

- `customer_id`;
- `label`;
- `address`;
- `lat`;
- `lng`.

Existe en `orders`:

- `delivery_address`;
- `customer_lat`;
- `customer_lng`;
- `delivery_fee`;
- `is_within_radius`;
- `delivery_started_at`;
- `delivered_at`;
- `estimated_eta_min`/`estimated_eta_max`;
- `delivery_app_id`;
- `delivery_executive_id`.

Existe en `branches` `lat`/`lng` y existe en `restaurants` `map_api_key`. El `PlatformController::config` auditado no expone la clave Maps al cliente Mesero, lo cual es correcto como punto de partida; no debe enviarse una credencial sin restricciones al frontend.

### Rutas backend

`api.php` registra:

- `GET /pos/delivery-settings`;
- `POST /pos/delivery-fee/calculate`;
- `GET /pos/delivery-fee-tiers`;
- `GET/POST/PUT/DELETE /pos/delivery-platforms`;
- `GET/POST/PUT/DELETE /pos/delivery-executives` y status;
- `PUT /pos/orders/{id}/assign-delivery`;
- `PUT /pos/orders/{id}/delivery-status`;
- `GET /pos/delivery-orders`;
- CRUD compartido `/customer-addresses`.

El OpenAPI público no refleja de forma completa este conjunto.

### Cálculo actual

`calculateDeliveryFee` recibe `lat`, `lng` y `order_amount`. Obtiene la configuración de la sucursal, comprueba radio, aplica delivery gratis, y calcula por `fixed`, `per_distance` o `tiered`. La distancia es Haversine entre la sucursal y el cliente; no es distancia de ruta Google Maps.

El cliente Mesero tiene `deliverySettings()` y `deliveryExecutives()`, pero no tiene métodos para:

- listar/crear/actualizar direcciones del cliente;
- Places Autocomplete;
- geocoding/reverse geocoding;
- mapa o place ID;
- calcular la tarifa;
- asignar repartidor;
- cambiar estado de delivery;
- listar delivery orders.

## 2. Riesgos actuales

1. Las coordenadas del dispositivo del mesero no prueban que sean el domicilio del cliente.
2. `customer_lat/customer_lng` pueden existir sin una dirección textual verificable ni `place_id`.
3. `customer_addresses` no guarda snapshot enriquecido ni referencia Google.
4. La orden depende actualmente de `delivery_address` y coordenadas propias; si el cliente cambia su dirección, la orden histórica puede no conservar la representación completa del destino original.
5. Haversine sirve para un radio aproximado, pero no satisface una política comercial basada en kilómetros de recorrido.
6. Los tramos (`delivery_fee_tiers`) existen, pero el frontend no está obligado por contrato a usar la cotización backend; no se debe tomar `fee_tiers[0]` como verdad.
7. `getDeliveryOrders` usa por defecto la fecha del servidor (`now()->toDateString()` en el código auditado). Esto puede repetir el riesgo UTC/local observado en KOT.
8. `updateDeliveryOrderStatus` acepta `failed`, pero el `OrderStatus` operativo no contiene ese valor; además hay que verificar que timestamps y estado del repartidor sean coherentes con el enum de producción (`active` frente a legacy `available`).
9. `delivery_app_id` indica plataforma externa, pero no existe en Mesero una dimensión explícita `delivery_direct` versus `delivery_platform`.

## 3. Arquitectura objetivo

### Flujo de dirección

```text
Cliente o empleado
  -> seleccionar cliente
  -> Dirección de entrega
  -> Google Places Autocomplete
  -> seleccionar resultado
  -> place_id + formatted_address + lat/lng
  -> mini mapa y pin visible
  -> confirmar ubicación
  -> pedir cotización al backend
  -> guardar orden con snapshot del destino
```

La opción “Usar mi ubicación actual” debe pedir permisos GPS, hacer reverse geocoding, mostrar el resultado y exigir confirmación. Nunca debe convertir automáticamente la ubicación del teléfono del mesero en la dirección del cliente.

### Modelo de dirección

Antes de crear columnas hay que usar la tabla/modelo existente. Como extensión conceptual, se necesitaría cubrir:

- `customer_id`;
- `label`;
- dirección formateada y línea editable;
- ciudad/provincia/país/código postal si el proveedor los entrega;
- `google_place_id` o referencia equivalente;
- `latitude`/`longitude`;
- instrucciones de entrega;
- default;
- fecha de verificación.

La ampliación debe ser aditiva y tolerar las filas actuales que sólo tienen `address`, `lat`, `lng`.

### Snapshot en orden

Al confirmar un delivery, el backend debe persistir, dentro de la orden o de su snapshot fiscal/operativo ya existente, como mínimo la dirección mostrada, latitud, longitud, referencia de lugar si forma parte del contrato e instrucciones. No basta con volver a consultar la dirección actual del cliente para una orden histórica.

No se debe inventar el nombre final de columnas. Primero se revisa si el candidato `Modules/DominicanTickets`, el modelo existente o el esquema actual ya tienen un lugar compatible.

## 4. Google Maps y seguridad

La implementación futura debe separar:

- Places/autocomplete para seleccionar;
- geocoding/reverse geocoding cuando corresponda;
- mapa para confirmación visual;
- cálculo de ruta/distancia sólo si la política comercial lo necesita;
- botón “Abrir ubicación” para el operador.

Reglas de credenciales:

- ninguna clave privada o server key en el bundle del Mesero;
- una clave pública de Maps, si se requiere para el navegador, debe estar restringida por HTTP referrer, APIs y cuota;
- geocoding/routing sensible puede ejecutarse en backend mediante credencial server-side;
- no guardar claves en GitHub, logs, documentación pública ni respuestas de `/platform/config`;
- registrar sólo proveedor, lat/lng redondeado cuando sea suficiente y códigos de error no sensibles.

## 5. Precio de delivery

El flujo recomendado es:

1. Mesero confirma las coordenadas del destino.
2. Mesero solicita `POST /pos/delivery-fee/calculate` mediante un adapter.
3. Backend valida sucursal, restaurante, configuración activa y destino.
4. Backend decide distancia, unidad, disponibilidad, tramo, fee, gratuidad y ETA.
5. Frontend muestra la cotización.
6. Al crear/editar la orden, backend recalcula o verifica la cotización; nunca confía ciegamente en el fee enviado.
7. El total fiscal final usa la cifra autoritativa del servidor.

Casos de respuesta que deben tener UX profesional:

- ubicación fuera de zona: “Entrega fuera de la zona configurada.”;
- sin coordenadas confirmadas: “Selecciona una dirección de entrega.”;
- no hay ruta: “No podemos confirmar esta ubicación.”;
- Maps temporalmente no responde: “No pudimos confirmar la tarifa. Intenta nuevamente.”;
- tarifa fija: mostrar el resultado fijo, no una distancia falsa;
- tramos: elegir el tramo que corresponda a la distancia calculada;
- plataforma prepagada: no cobrar delivery al cliente si el contrato lo indica.

La información técnica queda en diagnóstico, no en la UI operativa.

## 6. Delivery directo vs plataforma

El backend actual relaciona la orden con `delivery_app_id` y `DeliveryPlatform`. La migración candidata de catálogo central agrega `slug`, `is_system`, `supported_countries` y `branch_delivery_platforms`, pero esos archivos están en `09c93b3` y no en `origin/main`.

La futura capa de adapter debe resolver:

- `delivery` + sin `delivery_app_id` = delivery directo, si la regla actual lo confirma;
- `delivery` + `delivery_app_id` = plataforma externa;
- plataforma prepagada o no prepagada según configuración/contrato real;
- comisión de plataforma separada del delivery fee del cliente;
- branch isolation del catálogo global y sus activaciones.

No se debe presentar una plataforma como prepagada sólo por tener `delivery_app_id`.

## 7. Repartidores y estados

El flujo backend actual puede asignar `delivery_executive_id`, cambiar estado del repartidor y actualizar `order_status`. La propuesta debe mantener separadas:

- estado de orden: preparing, food_ready, out_for_delivery, delivered;
- disponibilidad del repartidor: active/on_delivery/inactive y compatibilidad legacy;
- pago: unpaid/partial/paid;
- prueba de entrega: sólo si el modelo actual lo acepta y se implementa con permiso.

Las transiciones deben ser validadas server-side y deben registrar quién cambió el estado. No se debe liberar un repartidor por una respuesta local que no fue confirmada.

## 8. Plan de pruebas reales

Sin enviar una orden real en esta fase, el plan para la fase funcional es:

1. Kebab / Kebab Luperon / sucursal 9, con cliente de prueba autorizado.
2. Crear/seleccionar dirección guardada y otra nueva.
3. Confirmar que el `customer_id` corresponde al mismo restaurante.
4. Ver mapa, pin, dirección formateada y confirmación.
5. Calcular fee en fijo, por distancia y tramo, sin usar el primer tier por defecto.
6. Probar fuera de radio y error de proveedor.
7. Crear delivery, validar snapshot en `GET /pos/orders/{id}`.
8. Cambiar dirección del cliente y confirmar que la orden vieja conserva destino.
9. Asignar repartidor, pasar por cocina, en camino y entregado.
10. Probar plataforma prepagada sin segundo cobro.
11. Verificar permisos de mesero/cajero/repartidor/head y otra sucursal.
12. Repetir cerca del cambio de día local/UTC.

La aceptación de distancia de ruta y la impresión física requieren evidencia separada: respuesta backend, PrintJob/estado del agente y, sólo si se observa, papel físico. Un HTTP 200 no demuestra una entrega ni impresión real.
