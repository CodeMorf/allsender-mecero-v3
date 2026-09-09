# RestaApp — plan de migración del dominio de órdenes

**Estado:** plan por fases; Fase 0 no cambia comportamiento.

## 1. Principios de ejecución

- Una fase = una rama + un PR.
- No hacer push directo a `main`.
- No crear APK ni aplicación Windows.
- No borrar pedidos, pagos, KOT, clientes, tablas ni base de datos.
- No resetear, limpiar ni sobrescribir el checkout backend/producción sucio.
- Primero cambios aditivos y adapters; después migración controlada.
- Cada PR debe incluir build, tests, typecheck, lint, diff y riesgos reales.
- Fiscales, totales y permisos siguen siendo autoridad del backend.
- Cada comportamiento nuevo debe probarse en POS web, Mesero, KDS/cocina, delivery, caja y cliente afectado.

## 2. Punto de partida

El backend de producción es `main` SHA `757f9f3` y el checkout backend `09c93b3` contiene trabajo no fusionado. El Mesero activo está en SHA `83a2c6f`. La primera rama de esta iniciativa es `codex/order-domain-phase-0-audit` en el repositorio Mesero y sólo contiene documentación transversal.

La rama backend candidata no se debe presentar como producción. En particular, los cambios de fiscal-customer por RNC/Cédula, room service, tickets dominicanos, impresión y KOT sin fecha requieren PR/backend separado o una decisión explícita de promoción.

## 3. Compatibilidad de valores históricos

| Dimensión | Histórico observado | Valor canónico objetivo | Regla de transición |
|---|---|---|---|
| Servicio | `Dine In`, `dine in`, `dinein`, `mesa` | `dine_in` | Adapter, conservar display traducido |
| Servicio | `Pickup`, `pick up`, `takeaway`, `take away`, `para llevar` | `pickup` | Adapter; no crear mesa falsa |
| Servicio | `Delivery`, `online` | `delivery` | Adapter |
| Servicio | `room service`, `room_service` | `room_service` | Sólo si Hotel/stay activo y contexto validado |
| Delivery origen | `delivery_app_id` null/no null | direct/platform derivado | No inventar campo persistente antes de contrato |
| Operación | `draft` | placed o draft interno | No tratar draft como venta |
| Operación | `kot`/`billed`/`payment_due` en `status` | adapter financiero/legacy | No usar como estado de cocina nuevo |
| Operación | `order_status` enum | estado operativo | Validar transiciones server-side |
| Pago | `amount_paid=0`, pagos | unpaid | Selector autoritativo |
| Pago | pagos parciales | partial | Suma de pagos confirmados, no string status |
| Pago | saldo cero/COD recogido | paid | Nunca cambiar operación a paid |
| Liquidación | `bill_to`, contexto Hotel, método | modo explícito | Sólo donde exista soporte comprobado |
| Cancelación | `canceled` y `cancelled` | `cancelled` | Adapter; no contar como venta |

## 4. Fases y dependencias

### Fase 0 — auditoría

Rama: `codex/order-domain-phase-0-audit`.

Entregables de esta rama:

- `docs/ORDER_DOMAIN_AUDIT.md`;
- `docs/API_CONTRACT_GAPS.md`;
- `docs/OFFLINE_ARCHITECTURE_V2.md`;
- `docs/DELIVERY_MAPS_ARCHITECTURE.md`;
- `docs/ORDER_MIGRATION_PLAN.md`.

Sin cambios funcionales. Abrir PR y detenerse.

### Fase 1 — núcleo de dominio y state machine

Rama: `codex/order-domain-phase-1-core`.

Orden recomendado:

1. Crear adapter central de aliases usando valores ya presentes.
2. Crear selectors puros para operación, pago, saldo y acciones.
3. Agregar tests unitarios con ejemplos de mesa/pickup/delivery/room service.
4. Si backend mezcla paid, añadir campos/respuesta aditiva o un adapter server-side antes de cambiar escrituras.
5. Mantener nombres legacy durante la transición.

No cambiar enum/migraciones a ciegas.

### Fase 2 — mesas y pedidos fuera de mesa

Rama: `codex/order-domain-phase-2-queue`.

Agregar un área de pedidos fuera de mesa y un Unified Order Detail usando rutas actuales. Debe consumir órdenes reales con filtros, no crear mesas ficticias.

Dependencias: Fase 1, contrato de lista/detalle y permisos.

### Fase 3 — clientes e historial financiero

Rama: `codex/order-domain-phase-3-customers`.

Usar `customer_id` como vínculo principal. Calcular pedidos pagados, compras pagadas, órdenes abiertas y crédito real desde datos autoritativos. No llamar deuda a una orden normal abierta. Si se promueve la búsqueda RNC/Cédula, probar separadores y aislamiento por restaurante.

Dependencias: Fase 1 y contrato de órdenes.

### Fase 4 — direcciones y Maps

Rama: `codex/order-domain-phase-4-maps`.

Extender `customer_addresses` sólo después de comprobar columnas/modelos existentes. Implementar selección, confirmación, snapshot y apertura de mapa. Las credenciales deben quedar restringidas.

Dependencias: Fase 3 y contrato de dirección.

### Fase 5 — precio delivery

Rama: `codex/order-domain-phase-5-delivery-pricing`.

Conectar el cliente con la cotización backend. Definir si el negocio usa Haversine o distancia de ruta; no presentar Google route como implementado antes de tener proveedor/configuración. Probar fijo, distancia, tramo, fuera de zona y plataforma.

Dependencias: Fase 4.

### Fase 6 — totales/fiscal

Rama: `codex/order-domain-phase-6-totals`.

Eliminar decisiones fiscales del frontend. Añadir un selector que lea la respuesta autoritativa, `fiscal_snapshot` y `payment_summary` existentes. ITBIS, propina legal, cargos y delivery deben venir del backend. Probar multi-país, aunque la localización inicial sea es-DO.

Dependencias: Fase 1, 3, 4 y 5.

### Fase 7 — cobro por servicio

Rama: `codex/order-domain-phase-7-payment-flow`.

Diferenciar UX para mesa, pickup, delivery directo, plataforma, room service y crédito sin duplicar el motor financiero. Primero alinear `payOrder`, split, cargo a habitación y prepagado con el contrato real. No usar `status === paid` como permiso de cocina.

Dependencias: Fase 1, 6 y permisos/caja.

### Fase 8 — offline V2

Rama: `codex/order-domain-phase-8-offline`.

Evolucionar IndexedDB/outbox sin eliminar V1. Implementar dependencias, single-flight, backoff, reconciliación UUID, conflictos y reglas de pago seguro.

Dependencias: Fases 1, 6, 7 y contrato idempotente backend.

### Fase 9 — refactor incremental

Rama: `codex/order-domain-phase-9-refactor`.

Extraer use cases/repositorios/hooks desde `App.tsx` sin rewrite. Separar API, offline, Maps, pagos, órdenes, clientes, mesas y delivery gradualmente.

Dependencias: interfaces estables de fases anteriores.

### Fase 10 — pruebas

Rama: `codex/order-domain-phase-10-tests`.

Agregar unit/integration/E2E con backend de prueba o fixture transaccional. No usar mocks cuando se exige flujo real de producción; los mocks sólo pueden cubrir reglas puras aisladas.

Dependencias: fases funcionales completas.

### Fase 11 — documentación pública

Rama: `codex/order-domain-phase-11-docs`.

Regenerar/alinear OpenAPI, guía pública y ejemplos es-DO. Probar rutas, schemas y traducciones contra producción. No documentar endpoints de una rama que no esté desplegada.

Dependencias: todos los contratos cerrados.

## 5. Estrategia de base de datos

1. **Expand:** añadir sólo columnas/tablas aditivas cuando una fase lo justifique y con índices/foreign keys comprobados.
2. **Backfill seguro:** migrar por lotes, idempotente, con conteos antes/después; nunca borrar históricos.
3. **Dual read:** leer canónico y fallback legacy.
4. **Dual write controlado:** escribir canónico y legacy sólo cuando la operación esté probada.
5. **Observación:** logs con tenant/branch/order ID y métricas de discrepancia.
6. **Contract:** retirar legacy únicamente con evidencia de que ningún consumidor lo usa.

Para `orders.status`/`order_status`, el primer cambio debe ser de interpretación y respuesta, no de eliminación ni alteración destructiva del enum.

## 6. Estrategia de despliegue

- PR revisado y checks verdes.
- Backup específico de cada archivo existente que se vaya a editar; en Fase 0 no hay archivo existente editado.
- Staging con tenant/sucursal aislados.
- Smoke tests de GET y permisos.
- Feature flag por módulo/tenant cuando el código lo soporte.
- Deploy backend antes de que el cliente dependa de campos nuevos.
- Deploy Mesero después del contrato aditivo.
- Invalidación controlada de caché sólo si es necesaria; no limpiar IndexedDB del usuario sin migración.
- Verificar health, logs, rutas, respuesta, PrintJob y estado real del dispositivo.

## 7. Rollback

### Código

Revertir el release de la fase/volver al commit anterior mediante el procedimiento de despliegue existente. No usar `git reset --hard`, `clean` ni checkout destructivo sobre producción.

### Base

Mantener columnas aditivas sin lectura si el código anterior las ignora. No ejecutar `down` si hay datos creados por la fase. Si una migración debe deshacerse, hacerlo con un script reversible revisado y una copia comprobada, nunca como limpieza general.

### Offline

Conservar filas V1/V2, detener el worker nuevo y permitir recuperación manual. No eliminar el outbox para “resolver” duplicados.

### Fiscal/pagos

Nunca revertir escribiendo sobre pagos o documentos fiscales. Corregir con el flujo de reverso/refund/void que exista y esté autorizado; si no existe, bloquear la acción y escalar.

## 8. Definition of Done por fase

Una fase no se marca lista sólo por compilar. Debe incluir:

- diff revisado y limitado;
- backend tests pertinentes;
- frontend tests, typecheck, lint y build;
- pruebas de autorización y tenant isolation;
- prueba UI afectada;
- prueba de datos/estado posterior;
- resultado de impresión como cola/PrintJob y papel físico sólo si fue observado;
- compatibilidad con POS/KDS/caja/cliente;
- riesgos y rollback;
- commit, push y PR;
- detenerse antes de iniciar la fase siguiente.
