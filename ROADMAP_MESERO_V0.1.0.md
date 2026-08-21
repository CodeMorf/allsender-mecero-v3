# Roadmap de producción — RestaPP Mesero `0.1.0`

## Qué contiene esta versión

Esta versión publica la aplicación React + TypeScript para meseros, cocina y caja, empaquetable con Capacitor para Android. Usa el contrato existente de RestaPP; no duplica reglas del backend.

- Acceso por PIN y vinculación persistente del dispositivo por cliente SaaS/sucursal.
- Mapa de mesas, menú API, fotos publicadas, modificadores y notas a cocina.
- Órdenes nuevas y órdenes activas: los envíos posteriores publican únicamente artículos nuevos.
- KDS/KOT, estados de preparación, avisos, campana del encabezado, sonido y vibración configurables.
- KDS separado por estación: el chef puede cambiar entre Cocina, Bar y las demás áreas activas de la sucursal; las comandas nuevas producen el mismo aviso sonoro/vibración configurado para las llamadas de mesa.
- Precuenta y recibo mediante las rutas de impresión del backend y la configuración de impresoras existente.
- Perfil cajero con cobro únicamente cuando la API devuelve el permiso `payments.charge`.
- Delivery visible solo cuando la sucursal tiene el servicio configurado; no se inventan repartidores ni costos.
- Modo offline-first con IndexedDB, cola durable, aislamiento por `tenant + sucursal` y claves idempotentes para evitar duplicados.
- PWA, iconos de Mesero y proyecto Capacitor Android.

## Verificación local realizada

En el workspace de esta versión se ejecutaron correctamente:

```text
pnpm check   ✅
pnpm lint    ✅
pnpm test    ✅  (14 pruebas)
pnpm build   ✅
```

El build genera `dist/` de forma local. `dist/` y `node_modules/` no se versionan.

## Pendientes para declarar producción final

1. Publicar el build validado en `https://mesero.allsender.tech` y confirmar que el dominio sirve exactamente este commit.
2. Ejecutar una prueba autenticada controlada con una sucursal de prueba: vinculación, PIN de mesero/cajero/chef, mesa, orden, KOT, agregado posterior, precuenta y cobro.
3. Validar impresión física en el terminal configurado, incluida la vista de precuenta y recibo.
4. Probar en Android/tableta real: offline → online, reinicio de la aplicación, reinicio del dispositivo, sincronización sin duplicados, vibración, sonido y notificaciones.
5. Ejecutar `npx cap sync android` y generar la APK firmada cuando la validación web y física esté aprobada.
6. Mantener e-CF/Pay-at-Table como funciones condicionadas a que la API las publique y acepte oficialmente. La facturación tradicional B01/B02 sí pertenece al flujo actual.

## Límites conocidos del contrato actual

- La API de integración publica notificaciones consultables, pero no un canal Push obligatorio.
- Pay-at-Table, inventario de ingredientes y selector de habitaciones del módulo Hotel no están publicados como contratos completos para esta app.
- Delivery requiere configuración de la sucursal en RestaPP.
- La primera vinculación del dispositivo y la primera sesión PIN requieren conexión; después se conserva la sesión y el catálogo local.

## Publicación

- Repositorio: `https://github.com/CodeMorf/allsender-mecero-v3`
- Aplicación web: `https://mesero.allsender.tech`
- Versión: `0.1.0`
- Stack: React, TypeScript, Vite, Capacitor Android, IndexedDB.

No se incluyen credenciales, PIN, certificados, copias del backend ni parches internos en el repositorio público.
