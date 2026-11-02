CREATE TABLE IF NOT EXISTS branch_cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 3),
  name text NOT NULL,
  stream_url text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, position)
);

-- Cada sucursal activa recibe tres cámaras (posiciones 1 a 3). No pisa cámaras existentes.
INSERT INTO branch_cameras (branch_id, position, name)
SELECT b.id, n, 'Cámara ' || n
FROM branches b CROSS JOIN generate_series(1, 3) AS n
WHERE b.active = true
ON CONFLICT (branch_id, position) DO NOTHING;
