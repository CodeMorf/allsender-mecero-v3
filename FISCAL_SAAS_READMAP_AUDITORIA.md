# RestaPP — Readmap fiscal SaaS y auditoría

Fecha de revisión: 2026-08-20. Alcance: país, restaurante, sucursal, tipos de servicio, cálculo fiscal y API. No se implementan ni se investigan proveedores de pago.

## Evidencia encontrada antes del cambio

- `restaurants` ya tenía `country_id`, `currency_id`, `timezone`, `tax_mode`, `tax_inclusive`, `include_charges_in_tax_base` y banderas de propina.
- `branches` pertenece a un restaurante; `taxes` ya tenía `restaurant_id` + `branch_id`.
- `order_types` ya distinguía `dine_in`, `delivery`, `pickup` y `room_service` por sucursal.
- El alta pública y el alta Livewire ya sembraban defaults desde `storage/app/countries_tax_config_2026.json`.
- RD ya tenía ITBIS 18% y `Propina por ley` 10% restringida a `dine_in`.
- La API POS, sin embargo, aceptaba `taxes[].amount` del cliente y las tablas `order_taxes`/`order_charges` guardaban solamente IDs.

## Cambio aplicado

1. `FiscalOrderCalculator` resuelve país, moneda, impuestos, cargos, herencia y tipo de servicio usando únicamente el restaurante/sucursal autenticados.
2. `POST /pos/orders` ignora montos fiscales enviados por React, calcula en servidor y devuelve `cart.summary` con subtotal, base, impuestos, propina legal, cargos, delivery y total.
3. Cada orden nueva guarda `fiscal_snapshot`; `order_taxes` y `order_charges` guardan nombre, tasa/valor, importe y tipo del cargo.
4. `PUT /pos/orders/{id}/items` vuelve a usar el calculador y actualiza el snapshot de la orden activa.
5. `GET /platform/config` ahora publica `country`, `fiscal`, reglas efectivas, herencia y tipos de servicio sin secretos de pago.
6. `switch-branch` y la resolución inicial verifican que la sucursal pertenezca al restaurante del usuario.
7. Mesero Web consulta `/platform/config`, usa la moneda publicada y muestra el resumen que devuelve el backend; no contiene reglas `DO = 18% + 10%`.

## Evidencia de publicación y verificación

- Host/código verificado: `root@157.173.193.135:/www/wwwroot/restapp.allsender.tech`.
- La migración `2026_08_20_120000_add_fiscal_snapshots_to_orders` figura como `Ran` (#42); están presentes `orders.fiscal_snapshot`, `order_taxes.amount` y `order_charges.charge_kind`.
- Se dejó respaldo previo en `/www/wwwroot/restapp.allsender.tech/backups/fiscal_saas_20260820_214842` antes de sustituir los cuatro archivos productivos.
- `php -l` pasó para el calculador, los controladores y `OrderResource`. El aviso de PHP 8.4 sobre un parámetro nullable preexistente en `PosProxyController` no fue introducido por este cambio.
- Cliente local: `pnpm check`, `pnpm lint`, `pnpm test -- --run` (8/8) y `pnpm build` pasaron; el tab `http://localhost:5173/` cargó sin errores de consola.
- No se crearon, cobraron ni imprimieron órdenes reales durante la prueba de producción.

## Casos comprobados en producción (lectura, sin crear órdenes)

| Caso | Resultado esperado | Resultado observado |
|---|---:|---:|
| RD + mesa, subtotal 1,000 | ITBIS 180 + propina 100 = 1,280 | Cumple |
| RD + pickup, subtotal 1,000 | ITBIS 180, propina 0 = 1,180 | Cumple |
| RD + delivery, subtotal 1,000 | ITBIS 180, propina 0 = 1,180 | Cumple |
| India + mesa, subtotal 1,000 | reglas del restaurante (2.5% + 2.5%), sin propina RD | Cumple |
| India, sucursal Jaipur (1) vs Delhi (2) | cada sucursal resuelve sus propios impuestos | Cumple |
| Configuración API | país, moneda, herencia, taxes, cargos y servicios | Cumple |

## Tabla de auditoría

| Área | Antes | Cambio realizado | Estado |
|---|---|---|---|
| País del restaurante | Existía `country_id`; no se exponía completo en config | País ISO/nombre en configuración fiscal | COMPLETADO |
| Configuración por país | JSON de defaults ya existía | Consumida como fallback extensible, sin IDs hardcodeados | COMPLETADO |
| Configuración fiscal | Tax/charge existían, pero API confiaba en el cliente | Calculador fiscal único y herencia por sucursal | COMPLETADO |
| ITBIS RD | Sembrado 18%; no era autoridad de la API | Se calcula desde tax de sucursal y se congela | COMPLETADO |
| Propina legal RD | Cargo dine-in existente; monto no quedaba congelado | Automática solo para `dine_in`, snapshot por orden | COMPLETADO |
| Mesa | `order_types.dine_in` y mesa existentes | Se usa el tipo resuelto por backend | COMPLETADO |
| Takeout | `pickup` existente | Sin propina legal | COMPLETADO |
| Delivery | `delivery` existente | Sin propina legal; delivery fee separado | COMPLETADO |
| Herencia restaurante/sucursal | Copia al crear sucursal; podía cruzarse en resolución | Resolución branch-first + fallback controlado | COMPLETADO |
| Persistencia histórica | IDs sin tasa/importe | Snapshot y columnas históricas | COMPLETADO |
| `/platform/config` | País/moneda parcial | `fiscal` + servicios + herencia | COMPLETADO |
| Mesero Web | Mostraba moneda RD$ fija y no mostraba desglose | Moneda de API y resumen fiscal del servidor | COMPLETADO |
| Pruebas | No había pruebas de esta frontera | Smoke read-only en RD/otro país/servicio; falta suite PHPUnit en CI | PARCIAL |

## Pendiente explícito

La suite PHPUnit/CI con factories aisladas para dos restaurantes, dos sucursales y cambio de configuración debe agregarse antes de declarar la cobertura automática completa. El smoke real de producción no creó ni cobró órdenes para no contaminar datos. Los proveedores de pago quedan fuera de este trabajo.

Las órdenes históricas creadas antes del snapshot pueden no tener desglose congelado; se conservan sus totales existentes cuando no existe `fiscal_snapshot`. Las órdenes nuevas y las ampliaciones de una orden activa sí guardan el snapshot fiscal del servidor.
