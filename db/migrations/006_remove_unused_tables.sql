-- Elimina módulos que la aplicación no usa: caja, compras, proveedores y transferencias.
-- Orden: primero las tablas hijas, después las padres.
-- Se quita antes la columna products.supplier_id, que apunta a suppliers y no la usa el código.

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_supplier_id_fkey;
ALTER TABLE products DROP COLUMN IF EXISTS supplier_id;

DROP TABLE IF EXISTS transfer_items;
DROP TABLE IF EXISTS transfers;
DROP TABLE IF EXISTS purchase_order_items;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS cash_sessions;
