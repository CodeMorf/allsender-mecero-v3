# RestaPP Mesero — clientes por mesa y órdenes activas

Fecha: 2026-08-20

## Hecho

- El endpoint existente `/pos/tables` ya entregaba el cliente de la orden activa; ahora la app normaliza `customer_id`, `customer_name`, total, pendiente y estado sin inventar datos locales.
- Al abrir una mesa aparece **Cliente de la mesa**. En una mesa nueva, el nombre viaja con la primera comanda; en una orden activa se puede guardar con **Guardar nombre**.
- El nombre se muestra en la tarjeta de mesa y en una sección visible **Órdenes activas**, con mesa, número de orden, cliente, estado y monto pendiente.
- Se limpió el formato de números como `Order #43` para mostrar `#43` en la interfaz.
- El backend evita fusionar automáticamente a todos los clientes sin teléfono en el mismo registro: usa teléfono, email o nombre como clave de identificación.
- En una orden activa, **Pre-cuenta** consulta el detalle existente con `GET /pos/orders/{id}` y presenta una vista informativa con artículos, subtotal, impuestos, propina legal, total y saldo pendiente cuando esos campos están publicados por la API.
- La pre-cuenta es de solo lectura: no llama a pago, no cierra la mesa, no cambia el estado y no crea una comanda. **Agregar más** vuelve al mismo borrador de la orden activa para que el flujo existente publique únicamente los artículos nuevos mediante el KOT adicional.
- Si una orden antigua no publica líneas o desglose fiscal completo, la interfaz muestra **No publicado** y conserva únicamente los importes confirmados por `/pos/tables` o `/pos/orders/{id}`; no inventa `RD$0.00`.
- La pre-cuenta incluye **Imprimir pre-cuenta** y usa `POST /pos/orders/{id}/print` con `Idempotency-Key`; el backend encola el mismo trabajo de impresión que el POS de escritorio, resolviendo dinámicamente la impresora de `MultipleOrder` o la impresora directa activa de la sucursal.

## Verificación

- `pnpm check` pasó.
- `pnpm lint` pasó.
- `pnpm test -- --run`: 9/9 pasó.
- `pnpm build` pasó.
- En `http://127.0.0.1:5173/` se verificó el bloque **Órdenes activas**, la apertura de una mesa y el campo **Nombre**; escribir un nombre habilita el guardado sin crear una orden de prueba.
- En `http://127.0.0.1:5173/` se verificó una mesa con orden activa: **Pre-cuenta** mostró el total y saldo publicados por la API, y **Agregar más** regresó al mismo panel sin crear una segunda orden ni iniciar cobro.
- Backend real verificado y publicado: `POST /api/application-integration/pos/orders/{id}/print` responde `202 queued`; el trabajo se creó para sucursal 9, restaurante 8, impresora 37 y terminó `done` con el agente de impresión. La orden 710 quedó `confirmed`, total RD$1073.92 y pagado RD$0.00; imprimir no cobró ni cambió su estado.
- Antes de esta publicación solo existían las rutas web `/ajax/pos/orders/{orderId}/print` y `/orders/print/{id}`; la nueva ruta pública reutiliza su flujo interno sin exponer la sesión web ni crear una segunda cola.
- Backend remoto: `php -l` pasó para `PosProxyController.php`; respaldo previo en `/www/wwwroot/restapp.allsender.tech/backups/table_customer_20260820_221409`.
- En localhost se simuló pérdida y recuperación de red: el estado cambió a **Offline**, la vista permaneció disponible con el tenant Kebab cacheado, y volvió a **En vivo** sin errores de consola.

## Nota operativa

Una mesa nueva no puede persistir un nombre en el servidor hasta que exista una orden; por eso la app lo conserva en el formulario y lo envía al crear la primera comanda. Las órdenes existentes sí permiten guardar el nombre inmediatamente.

## Offline-first por tenant

- La app conserva sesión PIN, catálogo, mesas, órdenes abiertas, KOT, avisos y configuración de Delivery por clave `tenant + sucursal`.
- Las escrituras offline se guardan como workflows reanudables en IndexedDB: alta de orden, asignación de mesa, KOT, artículos adicionales, cliente, pre-cuenta, estado de cocina y cobro.
- Cada paso conserva su `Idempotency-Key` y el cursor de avance; al recuperar Wi‑Fi solo se reintentan los pasos pendientes. Un SaaS nunca lee la cola ni la caché de otro SaaS.
- Cobros e impresiones offline quedan visibles como pendientes hasta que el servidor los confirme; no se simula una confirmación financiera ni una impresión física sin conexión.
