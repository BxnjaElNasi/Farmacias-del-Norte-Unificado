# Farmacias del Norte

Aplicación de gestión multi-sucursal con Next.js y Neon PostgreSQL. Las solicitudes comerciales se procesan en el servidor; no se usa el almacenamiento del navegador como base de datos.

## Requisitos

- Node.js 20.9 o posterior.
- Una base PostgreSQL en Neon y su cadena de conexión.

## Configuración inicial

1. Instala las dependencias con `npm install`.
2. Copia `.env.example` como `.env.local` y reemplaza los valores de ejemplo. También se admite `.env` en la raíz del proyecto. Obtén `DATABASE_URL` desde el panel de Neon; usa una conexión segura y, para despliegues serverless, la cadena recomendada por Neon. Si una contraseña se compartió en un chat, rótala en Neon antes de volver a usarla.
3. Ejecuta `npm run db:migrate` para crear el esquema.
4. Define `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` y una contraseña única de al menos 12 caracteres en `.env.local`; ejecuta `npm run db:bootstrap-admin` una sola vez. El script no cambia una cuenta existente. Elimina las variables de bootstrap al terminar.
5. Inicia el sitio con `npm run dev` y entra con la cuenta creada.

Para producción, configura `DATABASE_URL` y las variables de bootstrap desde el gestor de secretos del entorno; no subas `.env.local` al repositorio. Usa HTTPS para que la cookie de sesión sea segura.

## Comandos

| Comando | Uso |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Compilación de producción |
| `npm run start` | Servidor de producción |
| `npm run lint` | ESLint |
| `npm test` | Pruebas de roles, alcance de sucursal y asignación FEFO |
| `npm run db:migrate` | Aplicar todas las migraciones pendientes de forma idempotente |
| `npm run db:bootstrap-admin` | Crear el administrador inicial sin credenciales predeterminadas |
| `npm run db:seed-demo` | Poblar una base aislada con datos de ensayo (no usar en una base operativa) |

## Funcionalidad disponible

- Landing pública en español en `/` y administración en `/admin`, con navegación de regreso al sitio.
- Catálogo público limitado a productos activos, expresamente aprobados para venta online, no sujetos a receta y con stock vigente; imágenes por URL HTTPS. Las categorías se derivan de esos productos y el sitio explica cuando no hay artículos elegibles; si no puede consultar la base, informa que el catálogo se está actualizando y no inventa productos.
- Pedidos como invitado con sucursal manual para retiro o zona de entrega configurada, reserva de existencias por 20 minutos y estados de seguimiento en administración. Los pedidos quedan pendientes de revisión; el pago se coordina con la sucursal y no se procesa en el sitio.
- Administración persistente de categorías; usuarios, sucursales y productos se desactivan/archivan en lugar de borrar referencias históricas. Los cambios de datos y estado quedan sujetos a autorización y auditoría; no se puede desactivar la cuenta propia ni el último administrador activo.
- Imágenes de sucursales y productos por URL HTTPS, con vista previa para la portada de producto; no hay almacenamiento de archivos propio ni carga de imágenes.
- Exportación XLSX de ventas recientes con hojas separadas de operaciones y detalle por producto. El detalle repite ID y número de operación, fecha, sucursal y responsable en cada artículo, además de cantidad e importes en columnas independientes.
- Comprobantes imprimibles y envío opcional por SMTP para movimientos de inventario. Incluyen sucursal, producto, lote cuando corresponde, cantidad, fecha, responsable y motivo. Son comprobantes internos, explícitamente no fiscales y no reemplazan una factura ni tienen validez fiscal ante ARCA.
- Constancia descargable, imprimible y compartible de cada pedido guardado; no es factura ni comprobante de pago. Las cuentas creadas desde el acceso público son solo cuentas de compra y nunca obtienen permisos administrativos.
- Mapa de Google Maps con búsquedas por zona Norte, Sur, Este y Oeste de Formosa Capital. Publica las direcciones oficiales en cada sucursal para que Maps muestre sus ubicaciones exactas.
- Panel de cámaras visible solo para administradores, con acceso por patrón y autorización de sesión/rol.
- Inicio/cierre de sesión con contraseñas protegidas mediante scrypt y sesiones aleatorias persistidas como hash. La cookie de administración es de sesión (sin `Max-Age`) y el servidor limita cada sesión a 12 horas; normalmente se elimina al cerrar el navegador, aunque la restauración de sesión del navegador puede conservar cookies de sesión.
- Dos roles: gerente general (admin) y empleado. La API deriva identidad y sucursal de la sesión; el empleado solo puede operar en su sucursal. Las cuentas antiguas de encargado se convierten en empleado con la migración de roles.
- Alta, edición y desactivación de sucursales y productos; alta de usuarios operativos; catálogo con búsqueda, precios/costos, historial de cambio, margen bruto estimado, mínimo y requisito de receta.
- Inventario independiente por sucursal, existencias por lote, vencimientos, FEFO al vender, movimientos de entrada/salida/merma y auditoría. La vista global de administración suma existencias por producto y conserva el detalle por sucursal y lote.
- Registro de ventas con precio y stock leídos en el servidor, descuentos solo para el gerente general, clave de idempotencia, consumo de lotes vigentes y transacción atómica.
- Dashboard y reportes iniciales derivados de datos reales: ventas diarias, comparación por sucursal, productos más vendidos, stock bajo, vencimientos y movimientos recientes. Administración puede consultar las ventas recientes consolidadas; registrar una venta requiere seleccionar la sucursal.
- Exportación a CSV de productos, existencias por lote y ventas consultadas.
- El empleado puede registrar ventas y consultar catálogo, stock, resumen e historial de ventas de su sucursal; solo el gerente general administra sucursales, usuarios, catálogo, precios y existencias.
- Interfaz adaptable para dashboard, catálogo, sucursales, usuarios, inventario y ventas. El comando `npm run db:seed-demo` agrega registros de ensayo: úsalo solo en una base descartable, nunca en una base operativa.

## Esquema de datos

Las migraciones en `db/migrations/` definen sucursales, usuarios y sesiones, catálogo central, precios por sucursal e historial, existencias, lotes, movimientos, ventas e ítems, caja, proveedores, órdenes de compra, transferencias, auditoría y cuentas de compra separadas del personal. La segunda migración convierte las cuentas manager existentes en empleados y limita los roles disponibles a admin/employee; el script registra cada migración en `schema_migrations`.

El script `npm run db:seed-demo` agrega etiquetas, nombres, códigos y existencias sintéticos; no lo ejecutes sobre una base con datos reales. Las contraseñas temporales se guardan en `.demo-credentials.txt`, un archivo local ignorado por Git; consúltalo solo en tu equipo y elimínalo cuando ya no necesites esas cuentas.

Las ventas y los movimientos de inventario se escriben dentro de transacciones. El endpoint de venta vuelve a consultar precios y lotes vigentes en el servidor; el inventario no puede quedar negativo y las peticiones repetidas con la misma clave no descuentan stock dos veces.

## Pendiente antes de operación comercial

Esta primera entrega no cubre todas las funciones del pliego. Deben completarse y validarse antes de usarla como sistema operativo de una farmacia:

- Actualización masiva de precios, incluidos cambios por sucursal.
- Administración de cuentas: invitaciones y recuperación/autoservicio de contraseña; MFA y límites de intentos por IP además del bloqueo temporal por cuenta.
- Transferencias con despacho/recepción, órdenes y recepciones de compra, anulaciones/devoluciones, apertura/cierre de caja y registro detallado de pagos.
- Reglas regulatorias y permisos de medicamentos por jurisdicción, vencimiento por lote en bajas y políticas de autorización adicionales.
- Informes históricos configurables.
- Pruebas end-to-end y una suite automatizada de integración Neon que cubra todos los flujos comerciales y de autorización.
- Antes de habilitar ventas reales: configurar y validar medios de pago (Mercado Pago/tarjetas/transferencia/efectivo), entrega por zona, contacto oficial/WhatsApp, correo al cliente, privacidad/retención, seguridad y obligaciones fiscales/facturación con ARCA. No habilitar cobros ni afirmar que el comprobante interno reemplaza una factura.

Para habilitar el envío de comprobantes internos por correo, configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM`. Si no hay SMTP, los comprobantes pueden imprimirse desde administración. Son documentos internos no fiscales: no son facturas ni comprobantes de pago y no afirman validez ante ARCA. Las imágenes se enlazan mediante URL HTTPS; todavía no hay proveedor de carga/almacenamiento de archivos configurado.

## Conectar Neon

1. Crea una base PostgreSQL en Neon y copia su cadena de conexión desde el panel de Neon.
2. En la raíz del proyecto, copia `.env.example` a `.env.local` y asigna esa cadena a `DATABASE_URL`. No pegues la URL en el chat, no la agregues a Git y no la publiques en capturas.
3. En una terminal local, ejecuta `npm run db:migrate` para crear las tablas. Este comando se ejecuta contra la base definida por `DATABASE_URL`; verifica que sea la base correcta antes de aplicarlo. No se ejecutó ninguna migración durante esta implementación. Después configura el correo del administrador inicial y una contraseña fuerte en `.env.local`, y ejecuta `npm run db:bootstrap-admin`.
4. Inicia la aplicación con `npm run dev`. Para un despliegue, guarda `DATABASE_URL` y las credenciales de administración en el gestor de secretos del proveedor, nunca en archivos públicos.

Sin una `DATABASE_URL` válida y las migraciones aplicadas, el catálogo, las sucursales y las operaciones comerciales no pueden consultar o guardar datos. Las zonas del mapa son accesos de búsqueda; carga las cuatro direcciones reales en Administración antes de presentarlas como locales con ubicación confirmada.

El acceso a PostgreSQL se mantiene exclusivamente del lado servidor. Para desplegar, además de credenciales, revisa las políticas internas de contraseñas, retención de auditoría, copias de seguridad y requisitos regulatorios locales.
