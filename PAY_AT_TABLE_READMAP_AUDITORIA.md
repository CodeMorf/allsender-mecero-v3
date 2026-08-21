# Readmap de auditoría — Pay-at-Table por cliente SaaS

Fecha de revisión: 2026-08-20
Producto: RestaPP Mesero Web
API: `https://restapp.allsender.tech/api/application-integration`
Backend auditado: `/www/wwwroot/restapp.allsender.tech`

## 1. Conclusión ejecutiva

Pay-at-Table/PIN **no es obligatorio** para que el POS funcione. El sistema ya puede registrar cobros normales cuando el usuario tiene `payments.charge`.

Pay-at-Table solo debe activarse para un cliente SaaS cuando estén confirmados, para ese restaurante y sucursal:

1. Proveedor de pago y país compatibles.
2. Contrato oficial de terminal/card-present o checkout QR.
3. Credenciales sandbox y después credenciales live.
4. Terminal registrado y vinculado a la sucursal.
5. Permiso de cobro para el rol que lo usará.
6. Endpoints de autorización, captura, cancelación, consulta y webhook.
7. Prueba E2E aprobada sin datos de tarjeta en RestaPP.

No se debe habilitar una opción visual de Pay-at-Table solo porque exista un botón o una credencial guardada.

## 2. Evidencia del backend actual

### Configuración por cliente SaaS

- `PlatformController::config()` obtiene `PaymentGatewayCredential` por `restaurant_id` y expone metadatos de estado/modo, moneda y funciones.
- `GET /platform/config` devuelve restaurante, sucursal, moneda, flags y metadatos del gateway.
- `GET /payment-gateways` lee la configuración del gateway del restaurante autenticado.
- La selección de sucursal cambia el contexto de usuario; cualquier cobro debe validar nuevamente restaurante y sucursal en el servidor.

### Permisos y cobro actual

- `payments.charge` protege `POST /pos/orders/{id}/pay` y `POST /pos/orders/{id}/split-payments`.
- El cobro actual actualiza el estado de la orden; no representa una autorización de tarjeta en una terminal física.
- La app React ya muestra Caja únicamente cuando el PIN devuelve `role_key=cajero` y `payments.charge=true`.

### Cocina y órdenes

- KOT real: `POST /pos/orders/{id}/kot`.
- KOT activos: `GET /pos/kots`.
- Estados de cocina: `PUT /pos/kots/{id}/status`.
- El tablero React de Cocina requiere `kitchen.manage`; el cajero solo ve avisos/capacidades.

### Gateways y país

`app/Support/CountryPaymentGateways.php` documenta que para República Dominicana:

- Permitidos/listados: `azul`, `cardnet`, `mio`, `billet`, `toke`, `qr_code`, además de métodos offline y algunos gateways generales.
- Bloqueados: `tap`, `epay`, `mollie`, `razorpay`, `flutterwave`, `paystack`, `payfast`, `xendit`, entre otros.
- El código indica que AZUL/CardNET/MIO están listados para UI/adaptadores futuros y que no se deben inventar endpoints sin credenciales oficiales.

El backend contiene integración Tap para checkout web y webhooks, pero no publica una ruta de Application Integration para terminal PIN/card-present; además Tap está bloqueado para clientes DO por la política de país.

## 3. Estado de lo realizado

| Área | Estado | Evidencia |
|---|---|---|
| Login del dueño, selección de sucursal y vinculación de dispositivo | **Completado** | `/auth/login`, `/platform/switch-branch`, `/devices` |
| Login de empleado por PIN | **Completado** | `/auth/pin`, `permission_map`, `role_key` |
| Mapa de mesas y catálogo | **Completado** | `/pos/tables`, `/pos/items` |
| Crear orden y publicar KOT | **Completado** | `/pos/orders`, `/pos/orders/{id}`, `/pos/orders/{id}/kot` |
| Agregar líneas a una orden activa sin reimprimir KOT anterior | **Completado** | `/pos/orders/{id}/items` + selección server-side de artículos no enviados |
| Pantalla de Cocina | **Completado** | `/pos/kots` + `kitchen.manage` |
| Notificaciones operativas | **Completado, por consulta** | `/pos/notifications`; React consulta periódicamente |
| Caja con cobro normal | **Completado** | `/pos/orders/{id}/pay` + `payments.charge` |
| Pay-at-Table/PIN físico | **Faltante** | No existe endpoint card-present en Application Integration |
| Terminal Bluetooth/Wi-Fi vinculado a sucursal | **Faltante** | No existe contrato de terminal para este flujo |
| Inventario de ingredientes en tiempo real | **Faltante en esta API** | `/pos/items` publica disponibilidad de catálogo, no stock de ingredientes |
| Webhook/reconciliación de pago card-present | **Faltante** | Solo hay callbacks de gateways web fuera del contrato POS |

## 4. Lo que falta para activar por cliente

### A. Decisión comercial y técnica

- Elegir proveedor para cada país/cliente: AZUL, CardNET, MIO u otro proveedor oficialmente compatible.
- Definir si el flujo será:
  - **Terminal card-present:** el cliente inserta/acerca la tarjeta en un equipo físico.
  - **QR/checkout:** el cliente paga desde su teléfono.
- Confirmar modelo de terminal, SDK/API, moneda, ambiente sandbox y proceso de certificación.

### B. Backend seguro

Crear un adaptador por proveedor, no una ruta genérica que acepte números de tarjeta. Como mínimo debe existir:

- `POST /pos/orders/{id}/payment-intents` — crea una intención idempotente.
- `GET /pos/payment-intents/{id}` — consulta el estado.
- `POST /pos/payment-intents/{id}/cancel` — cancela si el proveedor lo permite.
- `POST /pos/payment-webhooks/{provider}` — recibe confirmación firmada del proveedor.
- Validación de restaurante, sucursal, moneda, monto, orden abierta y `payments.charge`.
- Registro de proveedor, modo, terminal, referencia externa, estado, monto, errores y auditoría.
- Estados mínimos: `created`, `pending`, `authorized`, `captured`, `failed`, `cancelled`, `refunded`.
- Idempotencia por intención y protección contra doble captura.

Nunca deben llegar a RestaPP ni quedar almacenados PAN, CVV, PIN ni banda magnética.

### C. React

- Consultar la capacidad del cliente antes de mostrar Pay-at-Table.
- Mostrar solo proveedores habilitados por país y configuración del restaurante.
- Mostrar terminales de la sucursal, si el backend los publica.
- Deshabilitar el flujo offline.
- Mostrar `pending` mientras el proveedor confirma; solo cerrar la cuenta con `captured` confirmado.
- Permitir reconsulta segura después de timeout sin crear otro cobro.
- Mostrar referencia de transacción, no datos sensibles de tarjeta.

### D. Auditoría y operación

- Sandbox E2E: aprobado, rechazado, cancelado, timeout y doble clic.
- Prueba de aislamiento entre dos restaurantes y dos sucursales.
- Prueba de permisos: mesero sin cobro, cajero autorizado, chef sin cobro.
- Prueba de webhook repetido y firma inválida.
- Registro de auditoría de quién, cuándo, orden, sucursal, terminal, proveedor y resultado.
- Actualizar OpenAPI, Postman y documentación pública con los endpoints reales.
- Activar live únicamente después de la certificación del proveedor.

## 5. Matriz por cliente SaaS

Esta es la ficha que debe completarse para cada restaurante antes de activar:

| Campo | Valor a completar | Regla de aprobación |
|---|---|---|
| Restaurante / `restaurant_id` |  | Debe coincidir con la sesión |
| Sucursal / `branch_id` |  | Terminal y orden deben pertenecer a ella |
| País / moneda |  | Proveedor permitido por país |
| Proveedor |  | Contrato oficial confirmado |
| Modo | `sandbox` / `live` | Live solo después de E2E |
| Credenciales | Configuradas sin exponer secretos | Validación de conexión exitosa |
| Terminal / device ID |  | Vinculado a la sucursal |
| Feature flag |  | Activado por cliente, no global |
| Permiso de rol |  | `payments.charge` o permiso específico card-present |
| Intent API |  | Crear/consultar/cancelar/webhook probados |
| Idempotencia |  | Doble clic y retry no duplican cobro |
| E2E sandbox |  | Aprobado con evidencia |
| E2E live |  | Aprobado por dueño/proveedor |
| Estado de auditoría | `Bloqueado` / `Validando` / `Completado` | No usar “Completado” con pasos faltantes |

### Registro inicial de Kebab Luperon

| Campo | Estado actual |
|---|---|
| Cliente/sucursal | Identificados en la sesión React; completar IDs desde `/platform/config` |
| País y moneda | Deben confirmarse desde `/platform/config`; no asumirlos en código |
| Cobro normal | Disponible con permiso `payments.charge` |
| Pay-at-Table físico | **Bloqueado: proveedor/terminal/API no definidos** |
| Inventario de ingredientes | **No forma parte del contrato actual** |
| Producción modificada | **No** |

## 6. Criterio de auditoría

El cliente puede marcarse **Completado** solamente cuando:

1. El proveedor y terminal están confirmados.
2. El backend tiene las rutas y permisos específicos.
3. La intención es idempotente y está reconciliada por webhook/consulta.
4. React muestra el estado real y no procesa tarjeta localmente.
5. Sandbox y producción tienen evidencia E2E.
6. La ficha del cliente SaaS está completa y los secretos no aparecen en logs, documentación ni frontend.

Con la situación actual, el estado correcto para Pay-at-Table de Kebab Luperon es **Bloqueado / pendiente de proveedor y terminal**, no “Completado”.
