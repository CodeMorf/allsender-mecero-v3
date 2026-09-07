# RestaPP Mesero Web

**Versión publicada en este repositorio: `0.1.0`**
Estado: **release candidata para validación de producción con diseño editorial de hospitalidad de lujo (Light & Dark mode)**. El build web está verificado; la APK nativa y las pruebas físicas de impresora permanecen sincronizadas.
Última actualización: Rediseño editorial completo de acceso y configuración de terminal (`SetupScreen` y `PinScreen`) con identidad visual de alta hospitalidad, logo oficial de RestaPP y soporte dual claro/oscuro.

Aplicación React + TypeScript para el flujo de sala. Consume la API de producción de RestaPP y conserva el último catálogo/sesión para continuar trabajando sin conexión.

## Ejecutar en localhost

Requisitos: Node.js 20+ y pnpm (o npm equivalente).

```bash
pnpm install
pnpm dev
```

Abrir [http://127.0.0.1:5173](http://127.0.0.1:5173). Para apuntar a otra instancia:

```bash
VITE_API_BASE_URL=https://restapp.allsender.tech/api/application-integration pnpm dev
```

En PowerShell:

```powershell
$env:VITE_API_BASE_URL = "https://restapp.allsender.tech/api/application-integration"
pnpm dev
```

## Flujo real

1. El propietario inicia sesión con `/auth/login`.
2. Se elige la sucursal y se registra el dispositivo con `POST /devices`.
3. Cada empleado entra con `/auth/pin` indicando su perfil (`mesero`, `chef` o `cajero`); el servidor devuelve el `role_key` y el mapa de permisos. El PIN queda ligado al dispositivo autorizado.
4. Mesas y menú se cargan desde `/pos/tables` y `/pos/items`.
5. La app crea la orden con el contrato mínimo estable de `/pos/orders`, obtiene el ID, actualiza mesa/mesero/acción con `PUT /pos/orders/{id}` y publica el KOT en `/pos/orders/{id}/kot`. La API devuelve 500 cuando esos campos se envían todos juntos en el alta, por eso el adaptador los separa.

Cada operación de escritura tiene `Idempotency-Key` y queda en una secuencia durable de IndexedDB cuando la red falla. La app conserva el paso exacto (crear orden, asignar mesa, publicar KOT, agregar líneas, nombre del cliente, pre-cuenta, estado de cocina o cobro) y reanuda la secuencia al volver el Wi‑Fi; si la aplicación se cierra a mitad, no repite los pasos ya confirmados. La sesión PIN, el catálogo, las mesas, órdenes abiertas, KOT, avisos y configuración de Delivery se cachean en el navegador; la primera autorización del dispositivo y la primera sesión PIN sí requieren conexión.

La caché, las sesiones y la cola están aisladas por `tenant + sucursal`. Cambiar de restaurante SaaS no reutiliza mesas, menú, órdenes, pagos ni pendientes del cliente anterior.

En la sucursal Kebab auditada, la API sí publica el tipo `Delivery`, pero actualmente `/pos/delivery-settings` devuelve `null` y `/pos/delivery-executives` no devuelve repartidores. Por eso la opción queda visible para un cajero autorizado, pero el envío permanece bloqueado hasta que el dueño configure el servicio en RestaPP.

## Funciones incluidas

- Mapa de mesas con estados libre, ocupada, cocina, listo y cuenta solicitada.
- Mapa de mesas superior con mesa de madera y sillas generadas desde la capacidad real de cada mesa que devuelve la API de cada SaaS.
- Comandero con fotos reales desde `item_photo_url` del catálogo API; el default backend `food.svg`/`transparent.svg` se descarta y, si el tenant aún no publicó una foto, se muestra solo un aviso neutro, nunca una imagen inventada.
- Modificadores obligatorios, asiento por platillo, notas a cocina y cantidades.
- Cocina/KDS real para perfiles con `kitchen.manage`: consulta `GET /pos/kots`, muestra KOT pendientes/en preparación/listos y actualiza estados con `PUT /pos/kots/{id}/status`.
- Área de cocina separada por estación: consulta `GET /pos/kot-places`, muestra el filtro “Mostrar área” y accesos rápidos para Cocina, Bar, Reparto u otras zonas activas, y solicita `GET /pos/kots?kitchen_place_id=...` para que el chef vea únicamente la tabla de su área. El PIN de chef inicia en la estación predeterminada de la sucursal y no muestra “Todas”; ese consolidado queda para perfiles supervisores. El área seleccionada puede bloquearse en ese dispositivo y sucursal, y se desbloquea con una acción explícita. Una comanda nueva usa el mismo sonido, vibración y notificación local configurados para las llamadas de mesa.
- El acceso por PIN usa una interfaz de restaurante con perfil visible, teclado numérico, estados de validación y soporte offline; la autenticación continúa usando `/auth/pin` y el token/permiso devuelto por el servidor.
- El perfil `chef` abre directamente una pantalla exclusiva de cocina; no intenta cargar el mapa de mesas ni acciones de caja. Esto evita falsos avisos de permisos y deja el tablero listo para una tableta fija.
- Una mesa con `current_order_id` abre “Agregar a orden”, lee el detalle y el último KOT publicado, y usa `PUT /pos/orders/{id}/items`; después `POST /pos/orders/{id}/kot` publica solo los artículos aún no vinculados a un KOT. Así una segunda comanda no vuelve a imprimir la primera ni muestra ejemplos fijos de productos.
- La pre-cuenta usa el detalle fiscal real de `/pos/orders/{id}` y `POST /pos/orders/{id}/print` para encolar la impresión server-side en la misma impresora que el POS de PC; envía `Idempotency-Key`, respeta el tenant/sucursal y no registra pagos. La app consulta `/platform/receipt-settings` y `/platform/printers` para mostrar la configuración real de recibo e impresora; no inventa una ruta de recibo separada porque el contrato actual solo publica la impresión de pre-cuenta.
- Venta rápida, división de cuenta preparada sobre las líneas actuales y cola offline.
- Venta rápida se registra explícitamente como `Pickup` (nunca se interpreta como Delivery).
- El perfil cajero, cuando la API devuelve `orders.create`, puede elegir `Dine In`, `Delivery` o `Pickup`. Delivery captura cliente, teléfono, dirección, horario, costo y repartidor y envía esos campos al contrato real de `/pos/orders`.
- El panel Caja solo aparece con `role_key=cajero` y `payments.charge`, y cobra por el endpoint real `POST /pos/orders/{id}/pay`; mesero no puede registrar pagos.
- Campana fija en el encabezado con contador de avisos no leídos; consulta `/pos/notifications` cada 20 segundos y marca cada aviso con `POST /pos/notifications/{id}/read`. Las llamadas de mesa siguen el endpoint de Waiter Request cada 5 segundos y permiten sonido/vibración configurables.
- Panel operativo que consulta `/pos/notifications` cada 20 segundos para avisos publicados por la API. El tablero KOT separado solo se muestra con `kitchen.manage`; el catálogo respeta disponibilidad publicada, pero no inventa sincronización de stock porque la API de integración no expone inventario de ingredientes.
- Hotel: el módulo está activo en la sucursal auditada y el POS web del backend puede enlazar una orden de servicio a habitación con `context_type=HOTEL_ROOM`, `context_id` de la estancia y `bill_to=PAY_NOW|POST_TO_ROOM`. La API de integración revisada todavía no publica el selector de estancias/habitaciones; la app no simula esa vinculación hasta que el backend la exponga.
- Indicadores de estado online/offline, cola pendiente, modo oscuro y diseño responsive para tablet de 7–8 pulgadas.
- Modo offline-first: el personal puede continuar con los datos publicados más recientes; las acciones pendientes se identifican como no confirmadas por el servidor hasta que se recupere la conexión.

Push, Pay-at-Table e inventario se muestran como puntos de integración y no inventan datos: la API actual publica notificaciones por consulta, cobro normal con `payments.charge` y KOT con `kitchen.manage`, pero no un terminal Pay-at-Table ni un inventario de ingredientes. Sin conexión, un cobro o una impresión se guardan como pendientes y no se presentan como confirmados por el servidor; al volver la red se envían con su clave idempotente. Delivery también respeta la configuración de la sucursal: si `/pos/delivery-settings` devuelve `null` o está deshabilitado, la app informa al cajero y no permite enviar un delivery incompleto. Esto evita confirmar al cliente una acción que la API todavía no puede persistir.

## Asistente de voz para cocina

La pantalla de cocina ya tiene sonido, vibración y avisos locales para comandas nuevas. El asistente de voz debe incorporarse en dos capas:

1. **Primera capa, sin LLM:** botón de pulsar para hablar usando reconocimiento de voz nativo/Web Speech y un conjunto cerrado de órdenes: “mostrar bar”, “mostrar cocina”, “siguiente comanda”, “marcar lista” y “repetir aviso”. Las acciones que cambian estados siempre piden confirmación visual.
2. **Segunda capa, opcional:** un endpoint del backend puede usar Groq u otro proveedor para interpretar frases libres. La clave nunca se entrega a la APK/PWA; el servidor valida sucursal, rol `chef`, comanda y permiso antes de ejecutar. Python solo sería necesario como servicio separado, no para el cliente React.

Esta separación mantiene el tablero operativo aunque el proveedor de IA no esté disponible y evita que una orden de voz cambie el estado de una comanda por error.

## Verificación

```bash
pnpm check
pnpm lint
pnpm test
pnpm build
```

La verificación autenticada requiere credenciales reales del restaurante y debe hacerse en un entorno controlado; el proyecto no contiene credenciales ni PINs.
