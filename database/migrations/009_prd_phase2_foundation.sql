CREATE TABLE IF NOT EXISTS countries (
  id SERIAL PRIMARY KEY,
  iso_code CHAR(2) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO countries (iso_code, name)
VALUES ('NG', 'Nigeria')
ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name;

CREATE TABLE IF NOT EXISTS states (
  id SERIAL PRIMARY KEY,
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(country_id, name)
);

INSERT INTO states (country_id, code, name)
SELECT c.id, v.code, v.name
FROM countries c
CROSS JOIN (
  VALUES
    ('AB', 'Abia'), ('AD', 'Adamawa'), ('AK', 'Akwa Ibom'), ('AN', 'Anambra'),
    ('BA', 'Bauchi'), ('BY', 'Bayelsa'), ('BE', 'Benue'), ('BO', 'Borno'),
    ('CR', 'Cross River'), ('DE', 'Delta'), ('EB', 'Ebonyi'), ('ED', 'Edo'),
    ('EK', 'Ekiti'), ('EN', 'Enugu'), ('FC', 'Federal Capital Territory'),
    ('GO', 'Gombe'), ('IM', 'Imo'), ('JI', 'Jigawa'), ('KD', 'Kaduna'),
    ('KN', 'Kano'), ('KT', 'Katsina'), ('KE', 'Kebbi'), ('KO', 'Kogi'),
    ('KW', 'Kwara'), ('LA', 'Lagos'), ('NA', 'Nasarawa'), ('NI', 'Niger'),
    ('OG', 'Ogun'), ('ON', 'Ondo'), ('OS', 'Osun'), ('OY', 'Oyo'),
    ('PL', 'Plateau'), ('RI', 'Rivers'), ('SO', 'Sokoto'), ('TA', 'Taraba'),
    ('YO', 'Yobe'), ('ZA', 'Zamfara')
) AS v(code, name)
WHERE c.iso_code = 'NG'
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

CREATE TABLE IF NOT EXISTS local_government_areas (
  id SERIAL PRIMARY KEY,
  state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(state_id, name)
);

CREATE TABLE IF NOT EXISTS communities (
  id SERIAL PRIMARY KEY,
  lga_id INTEGER NOT NULL REFERENCES local_government_areas(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lga_id, name)
);

ALTER TABLE land_applications
  ADD COLUMN IF NOT EXISTS state_id INTEGER REFERENCES states(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS lga_id INTEGER REFERENCES local_government_areas(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS community_id INTEGER REFERENCES communities(id) ON DELETE RESTRICT;

ALTER TABLE land_parcels
  ADD COLUMN IF NOT EXISTS state_id INTEGER REFERENCES states(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS lga_id INTEGER REFERENCES local_government_areas(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS community_id INTEGER REFERENCES communities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS boundary_source VARCHAR(30),
  ADD COLUMN IF NOT EXISTS boundary_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS geometry_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS surveyor_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS perimeter_m NUMERIC(14, 2);

CREATE TABLE IF NOT EXISTS parcel_boundary_versions (
  id BIGSERIAL PRIMARY KEY,
  parcel_id INTEGER NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES land_applications(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  boundary_geojson JSONB NOT NULL,
  boundary GEOMETRY(Polygon, 4326),
  geometry_hash CHAR(64) NOT NULL,
  boundary_source VARCHAR(30),
  change_reason TEXT,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(parcel_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_parcel_boundary_versions_geometry_gist
  ON parcel_boundary_versions USING GIST (boundary);

CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGSERIAL PRIMARY KEY,
  aggregate_type VARCHAR(60) NOT NULL,
  aggregate_id VARCHAR(60) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
  ON outbox_events (created_at)
  WHERE published_at IS NULL;

ALTER TABLE countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE states ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_government_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcel_boundary_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
