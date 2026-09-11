# Auditoría de Arquitectura Responsive, PWA y Wrappers Nativos: RestaApp Mesero

**Fecha:** 2026-09-10  
**Proyecto:** RestaApp Mesero (`allsender-mecero-v3` / `Allsender-Restapp`)  
**Mercado Principal:** República Dominicana (`es-DO`)  
**Restaurante / Sucursal de Prueba:** Kebab (`id: 8`, `hash: kebab`) / Kebab Luperon (`id: 9`)  
**Servidor de Producción:** `root@157.173.193.135`  
**Web Root Mesero:** `/www/wwwroot/mesero.allsender.tech`  
**Backend Root:** `/www/wwwroot/restapp.allsender.tech`  
**Rama Base:** `origin/Morf/mesero-responsive-layout` (`d5d7cf62b08bd2362cc499197e2e80f4bcfff692`)  
**Rama de Trabajo:** `Morf/mesero-native-responsive`

---

## 1. Qué Existe en el Código y en Producción

### Frontend / PWA (`app/`)
1. **Pila Tecnológica:**
   - React 19 + TypeScript + Vite 8.
   - Capacitor 8 (`@capacitor/core`, `@capacitor/android`, `@capacitor/haptics`, `@capacitor/local-notifications`, `@capacitor/network`).
   - Vitest para suite de pruebas unitarias (`src/foundation.test.ts`, `src/receipt/renderer.test.ts`, `src/receipt/profile.test.ts`).
   - Lucide React para iconografía.
2. **Estructura Modular:**
   - Shell y orquestador principal: `src/App.tsx`.
   - Barra de navegación / Sidebar POSDAN: `src/components/PosDanSidebar.tsx`.
   - Selector modal de tipos de orden y plataformas: `src/components/OrderTypeModal.tsx`.
   - Módulos operativos: `PosModule`, `OrdersModule`, `CashModule`, `InvoicesModule`, `CustomersModule`, `ProductsModule`, `InventoryModule`, `AnalyticsModule`, `DiscountsModule`, `ReturnsModule`, `UsersModule`, `SettingsModule`.
3. **PWA y Caché:**
   - Manifest: `public/manifest.webmanifest` configurado con `display: standalone`, colores de marca `#0b1118` / `#0f172a`, `lang: es-DO`.
   - Service Worker: `public/sw.js` con estrategia stale-while-revalidate para el shell y bypass de `/api/`. Versión de caché activa en producción: `mesero-shell-v8`.
4. **Offline y Persistencia:**
   - `src/storage/offline.ts`: Soporte de aislamiento multi-tenant y por sucursal (`tenantScope`), IndexedDB `restapp-offline` con almacén `outbox` para operaciones y workflows secuenciales con `idempotencyKey`.

### Backend Real (`restapp.allsender.tech`)
1. **Laravel 12 (PHP 8.2/8.3, MySQL):**
   - API de integración: `/api/application-integration/*`.
   - Autenticación: PIN (`/auth/pin`) y Admin (`/auth/login`), resolución de terminal/dispositivo (`/devices/resolve`).
   - Catálogo y Menú: `/pos/categories`, `/pos/items`, `/pos/items/{id}/modifier-groups`, `/pos/items/{id}/variations`.
   - Operaciones y Órdenes: `/pos/tables`, `/pos/orders`, `/pos/orders/{id}`, `/pos/orders/{id}/kot`, `/pos/orders/{id}/pay`, `/pos/orders/{id}/fiscal`.
   - KDS / KOT: `/pos/kots`, `/pos/kot-places`, `/pos/kots/{id}/status`, `/pos/kot-items/{id}/status`.
   - Caja / Turnos: `/pos/cash-register/*`.
   - Fiscalidad RD: `/platform/fiscal-capabilities`, DGII Lookup `/pos/customers/dgii-lookup`.
   - Impresión térmica: `/platform/printers`, `/platform/receipt-settings`.

---

## 2. Qué Está Funcionando

1. **Autenticación e Identidad:**
   - Login por PIN del mesero y login administrativo por correo.
   - Vinculación automática del dispositivo (`devices/resolve`) para evitar reconfiguración innecesaria.
2. **Cálculos y Precios:**
   - Desglose de Subtotal, Descuento, ITBIS (18%) y Tarifas de Delivery (fija o por rangos).
   - Impresión térmica configurable (ESC/POS, 58mm / 80mm) con perfiles y previsualización.
3. **Categorías Dinámicas:**
   - Normalización de traducciones JSON (`{"es-do":"...", "es":"..."}`) mapeadas directamente desde el backend.
4. **Idempotencia y Cola Offline:**
   - Envío protegido con cabecera `Idempotency-Key` en creación de órdenes, pagos, emisión fiscal y transiciones de KOT.
5. **Aislamiento Multi-Sucursal:**
   - Contexto cerrado por `restaurant_id` y `branch_id`.

---

## 3. Qué Está Roto o Requiere Corrección

1. **Responsive en Pantallas Medianas y Tablets (768px - 1024px):**
   - En tablets verticales (e.g. iPad 768x1024), el sidebar lateral y el carrito del POS aplastan la cuadrícula de productos, dejando poco espacio para los platillos.
   - En tablets horizontales (e.g. 1024x768), falta una transición limpia entre barra lateral compacta y panel derecho de orden.
2. **Dispositivos Móviles / Celulares (360px - 412px):**
   - La barra de navegación inferior en teléfonos puede solaparse con el footer flotante del carrito o los botones de acción fija ("Enviar a cocina", "Cobrar").
   - El KDS en móvil muestra columnas comprimidas en vez de un sistema de pestañas o tarjeta deslizable por etapas (Nuevos / En preparación / Listos).
3. **Modales y Diálogos:**
   - Algunos modales de cobro y personalización de productos no respetan la zona segura (`safe-area-inset`) o se extienden más allá de la altura de la pantalla (`100dvh`), dificultando pulsar botones de confirmación en teclados virtuales abiertos.
4. **Interacción Táctil vs. Mouse:**
   - Elementos con target táctil inferior a 44x44px en selectores de cantidad y botones de eliminación.
   - Falta de feedback visual táctil inmediato (`active:scale` o feedback táctil con Haptics en Capacitor).
5. **KDS Operativo:**
   - Comportamiento de actualización (polling): evitar parpadeo o pantallas vacías temporales durante la re-consulta en segundo plano.

---

## 4. Qué Está Duplicado

- Redundancias menores en estilos CSS entre reglas desktop heredadas y sobreescrituras móviles. Se debe unificar en un sistema de variables y media queries organizadas (Desktop > 1200px, Tablet 768px-1199px, Mobile < 768px).

---

## 5. Qué Se Debe Conservar Intacto

1. **Lógica de Negocio y Endpoints:**
   - No duplicar cálculos en frontend; mantener el backend como fuente de verdad.
   - Protocolo de comunicación con `/api/application-integration`.
2. **Estructura de Datos Offline e IndexedDB:**
   - Almacén `outbox`, `scopeKey`, flujos secuenciales y llaves de idempotencia.
3. **Seguridad e Integridad de Base de Datos:**
   - **PROHIBIDO** borrar órdenes reales (#9, #10, #781, #783, #784, etc.) o alterar datos del restaurante en producción.
4. **Capacitor y Configuración Nativa:**
   - Mantener `appId: tech.allsender.mesero`, esquemas https y plugins ya integrados.

---

## 6. Qué Se Debe Modificar

1. **Layout y Shell Principal (`src/App.tsx`, `src/styles.css`):**
   - Implementar sidebar colapsable/compacto en tablet y barra inferior flotante optimizada en celular con drawer lateral/inferior para el carrito actual.
   - Respetar `env(safe-area-inset-bottom)` y `env(safe-area-inset-top)` en todos los footers y barras.
2. **Punto de Venta (`src/modules/PosModule.tsx`):**
   - Cuadrícula responsiva: 1-2 columnas en celular, 2-3 en tablet vertical, 3-4 en tablet horizontal, 4-6 en desktop.
   - Acceso táctil directo al personalizador y selector de servicio ("Comer aquí", "Para llevar / Recoger", "Entrega a domicilio", "Servicio a habitación").
   - Botones de acción claros y accesibles en todo momento: "Enviar a cocina", "Cobrar", "Ver precuenta".
3. **Módulo de Órdenes y Cobro (`src/modules/OrdersModule.tsx`, Checkout):**
   - Modal de cobro responsive de 2 pasos claros: Resumen/Fiscal y Método de Pago/Liquidación.
4. **Tablero de Cocina KDS (`src/App.tsx` vista KDS):**
   - Vistas adaptativas: Columnas completas en Desktop/TV, columnas colapsables en Tablet, pestañas táctiles (Nuevos / En preparación / Listos) en Celular.

---

## 7. Qué No Se Debe Tocar

- Base de datos en producción (no ejecutar truncate, drops ni migraciones destructivas).
- Credenciales y tokens de producción.
- Archivos fuera del alcance del módulo mesero.

---

## 8. Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Regresión en versión Desktop | Alto | Pruebas visuales en 1920x1080, 1366x768 antes de build |
| Solapamiento de UI por teclado virtual | Medio | Uso de `dvh` / `interactive-widget=resizes-content` |
| Interrupción de Service Worker | Alto | Incremento controlado de `CACHE_VERSION` (`mesero-shell-v9`) y preservación de fallback |
| Incompatibilidad táctil | Medio | `min-height: 44px`, `touch-action: manipulation` en botones |

---

## 9. Estrategia de Producción y Rollback

1. **Backup Previo:**
   - Crear directorio de respaldo con timestamp en `/www/wwwroot/mesero.allsender.tech/.deploy-backups/backup-YYYYMMDD-HHMMSS`.
2. **Build Verificado:**
   - Ejecutar `pnpm test`, `pnpm run check` (TypeScript), `pnpm run lint` y `pnpm run build` localmente.
3. **Despliegue Atómico:**
   - Copiar artefactos de `dist/` a `/www/wwwroot/mesero.allsender.tech/`.
4. **Verificación en Vivo:**
   - Comprobación de HTTP 200 en `https://mesero.allsender.tech/`, index.html, JS, CSS, SW.
5. **Procedimiento de Rollback:**
   - En caso de anomalía, restaurar inmediatamente los archivos desde el directorio de backup con comando SSH.

---

## 10. Matriz de Pruebas de Dispositivos y Resoluciones

| Dispositivo / Resolución | Tipo | Orientación | Estado de Prueba |
|---|---|---|---|
| 360 x 800 (Android compacto) | Celular | Vertical | Pendiente Fase 1 |
| 390 x 844 (iPhone 12/13/14) | Celular | Vertical | Pendiente Fase 1 |
| 412 x 915 (Pixel / Galaxy) | Celular | Vertical | Pendiente Fase 1 |
| 768 x 1024 (iPad vertical) | Tablet | Vertical | Pendiente Fase 1 |
| 834 x 1194 (iPad Pro 11") | Tablet | Vertical | Pendiente Fase 1 |
| 1024 x 768 (iPad horizontal) | Tablet | Horizontal | Pendiente Fase 1 |
| 1280 x 720 (HD Laptop/POS) | PC / POS | Horizontal | Pendiente Fase 1 |
| 1366 x 768 (Estándar POS) | PC / POS | Horizontal | Pendiente Fase 1 |
| 1600 x 900 (Desktop) | PC | Horizontal | Pendiente Fase 1 |
| 1920 x 1080 (Full HD / KDS TV)| PC / KDS | Horizontal | Pendiente Fase 1 |\n