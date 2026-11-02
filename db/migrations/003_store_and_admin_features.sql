CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO categories (name) VALUES ('General') ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name)
SELECT DISTINCT coalesce(nullif(trim(category), ''), 'General')
FROM products
ON CONFLICT (name) DO NOTHING;

ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id);
UPDATE products p SET category_id = c.id
FROM categories c
WHERE p.category_id IS NULL AND c.name = coalesce(nullif(trim(p.category), ''), 'General');
ALTER TABLE products ALTER COLUMN category_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS products_category_id_idx ON products(category_id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS cover_image_url text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS online_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS online_featured boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS online_description text NOT NULL DEFAULT '';

ALTER TABLE branches ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS delivery_zone text NOT NULL DEFAULT '';

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES users(id);

CREATE TABLE IF NOT EXISTS online_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled')),
  fulfillment_mode text NOT NULL CHECK (fulfillment_mode IN ('pickup', 'delivery')),
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text NOT NULL,
  delivery_address text NOT NULL DEFAULT '',
  delivery_zone text NOT NULL DEFAULT '',
  payment_method text NOT NULL DEFAULT 'to_confirm'
    CHECK (payment_method IN ('to_confirm', 'cash', 'transfer', 'card', 'mercado_pago')),
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  total numeric(12,2) NOT NULL CHECK (total >= 0),
  reservation_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS online_orders_branch_time_idx ON online_orders(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS online_orders_reservation_idx ON online_orders(reservation_expires_at)
  WHERE status NOT IN ('completed', 'cancelled');

CREATE TABLE IF NOT EXISTS online_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES online_orders(id),
  product_id uuid NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  internal_code text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(12,2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS online_order_items_order_idx ON online_order_items(order_id);

CREATE TABLE IF NOT EXISTS online_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES online_orders(id),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS online_order_events_order_idx ON online_order_events(order_id, created_at DESC);
