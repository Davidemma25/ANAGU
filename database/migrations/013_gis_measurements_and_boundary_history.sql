-- Phase 4 GIS metrics and immutable parcel boundary versions.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE land_applications
  ADD COLUMN IF NOT EXISTS boundary_source VARCHAR(30),
  ADD COLUMN IF NOT EXISTS boundary_change_reason TEXT,
  ADD COLUMN IF NOT EXISTS boundary_changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE land_parcels
  ADD COLUMN IF NOT EXISTS boundary_geojson JSONB,
  ADD COLUMN IF NOT EXISTS boundary_change_reason TEXT;

ALTER TABLE parcel_boundary_versions
  ALTER COLUMN parcel_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_parcel_boundary_versions_app_version
  ON parcel_boundary_versions(application_id, version_number);

UPDATE land_parcels
SET boundary_geojson = ST_AsGeoJSON(boundary)::jsonb
WHERE boundary_geojson IS NULL
  AND boundary IS NOT NULL;

UPDATE land_parcels
SET geometry_hash = encode(
  digest(convert_to(boundary_geojson::text, 'UTF8'), 'sha256'),
  'hex'
)
WHERE boundary_geojson IS NOT NULL
  AND geometry_hash IS NULL;

INSERT INTO parcel_boundary_versions (
  parcel_id,
  application_id,
  version_number,
  boundary_geojson,
  boundary,
  geometry_hash,
  boundary_source,
  change_reason,
  changed_by,
  created_at
)
SELECT
  lp.id,
  lp.application_id,
  COALESCE(lp.boundary_version, 1),
  lp.boundary_geojson,
  lp.boundary,
  lp.geometry_hash,
  lp.boundary_source,
  'Existing boundary preserved during Phase 4 migration',
  lp.validated_by,
  COALESCE(lp.validated_at, lp.created_at)
FROM land_parcels lp
WHERE lp.boundary_geojson IS NOT NULL
  AND lp.geometry_hash IS NOT NULL
ON CONFLICT (parcel_id, version_number) DO NOTHING;

INSERT INTO parcel_boundary_versions (
  application_id,
  version_number,
  boundary_geojson,
  boundary,
  geometry_hash,
  boundary_source,
  change_reason,
  changed_by,
  created_at
)
SELECT
  la.id,
  1,
  la.coordinates_geojson,
  ST_SetSRID(ST_GeomFromGeoJSON(la.coordinates_geojson::text), 4326),
  encode(digest(convert_to(la.coordinates_geojson::text, 'UTF8'), 'sha256'), 'hex'),
  la.boundary_source,
  'Existing submitted boundary preserved during Phase 4 migration',
  la.applicant_id,
  la.submitted_at
FROM land_applications la
WHERE la.coordinates_geojson IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM parcel_boundary_versions version
    WHERE version.application_id = la.id
      AND version.version_number = 1
  )
ON CONFLICT (application_id, version_number) DO NOTHING;

CREATE OR REPLACE FUNCTION anagu_record_application_boundary_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_version INTEGER;
  v_boundary GEOMETRY(Polygon, 4326);
  v_hash CHAR(64);
BEGIN
  IF NEW.coordinates_geojson IS NULL OR (
    TG_OP = 'UPDATE' AND NEW.coordinates_geojson IS NOT DISTINCT FROM OLD.coordinates_geojson
  ) THEN
    RETURN NEW;
  END IF;

  v_boundary := ST_SetSRID(ST_GeomFromGeoJSON(NEW.coordinates_geojson::text), 4326);
  v_hash := encode(digest(convert_to(NEW.coordinates_geojson::text, 'UTF8'), 'sha256'), 'hex');
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_version
  FROM parcel_boundary_versions
  WHERE application_id = NEW.id;

  INSERT INTO parcel_boundary_versions (
    application_id,
    version_number,
    boundary_geojson,
    boundary,
    geometry_hash,
    boundary_source,
    change_reason,
    changed_by
  ) VALUES (
    NEW.id,
    v_version,
    NEW.coordinates_geojson,
    v_boundary,
    v_hash,
    NEW.boundary_source,
    COALESCE(NULLIF(BTRIM(NEW.boundary_change_reason), ''), 'Boundary submitted with application'),
    COALESCE(NEW.boundary_changed_by, NEW.applicant_id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_anagu_record_application_boundary_version ON land_applications;
CREATE TRIGGER trg_anagu_record_application_boundary_version
  AFTER INSERT OR UPDATE OF coordinates_geojson ON land_applications
  FOR EACH ROW
  EXECUTE FUNCTION anagu_record_application_boundary_version();

CREATE OR REPLACE FUNCTION anagu_prepare_parcel_boundary_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_history_version INTEGER;
  v_next_version INTEGER;
BEGIN
  IF NEW.boundary_geojson IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.boundary := ST_SetSRID(ST_GeomFromGeoJSON(NEW.boundary_geojson::text), 4326);

  IF TG_OP = 'INSERT' THEN
    NEW.geometry_hash := encode(
      digest(convert_to(NEW.boundary_geojson::text, 'UTF8'), 'sha256'),
      'hex'
    );
    SELECT version_number INTO v_history_version
    FROM parcel_boundary_versions
    WHERE application_id = NEW.application_id
      AND geometry_hash = NEW.geometry_hash
    ORDER BY version_number DESC
    LIMIT 1;
    IF v_history_version IS NULL THEN
      SELECT COALESCE(MAX(version_number), 0) + 1
      INTO v_next_version
      FROM parcel_boundary_versions
      WHERE application_id = NEW.application_id;
      NEW.boundary_version := v_next_version;
    ELSE
      NEW.boundary_version := v_history_version;
    END IF;
    NEW.boundary_change_reason := COALESCE(
      NULLIF(BTRIM(NEW.boundary_change_reason), ''),
      'Initial GIS validation'
    );
  ELSIF NEW.boundary_geojson IS DISTINCT FROM OLD.boundary_geojson THEN
    NEW.geometry_hash := encode(
      digest(convert_to(NEW.boundary_geojson::text, 'UTF8'), 'sha256'),
      'hex'
    );
    SELECT version_number INTO v_history_version
    FROM parcel_boundary_versions
    WHERE application_id = NEW.application_id
      AND geometry_hash = NEW.geometry_hash
    ORDER BY version_number DESC
    LIMIT 1;
    IF v_history_version IS NULL THEN
      SELECT COALESCE(MAX(version_number), COALESCE(OLD.boundary_version, 0)) + 1
      INTO v_next_version
      FROM parcel_boundary_versions
      WHERE application_id = NEW.application_id;
      NEW.boundary_version := v_next_version;
    ELSE
      NEW.boundary_version := v_history_version;
    END IF;
    NEW.boundary_change_reason := COALESCE(
      NULLIF(BTRIM(NEW.boundary_change_reason), ''),
      'GIS boundary revalidation'
    );
  ELSE
    NEW.boundary_version := COALESCE(OLD.boundary_version, 1);
    NEW.geometry_hash := OLD.geometry_hash;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION anagu_record_parcel_boundary_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
BEGIN
  IF NEW.boundary_geojson IS NOT NULL AND (
    TG_OP = 'INSERT' OR NEW.boundary_geojson IS DISTINCT FROM OLD.boundary_geojson
  ) THEN
    INSERT INTO parcel_boundary_versions (
      parcel_id,
      application_id,
      version_number,
      boundary_geojson,
      boundary,
      geometry_hash,
      boundary_source,
      change_reason,
      changed_by
    ) VALUES (
      NEW.id,
      NEW.application_id,
      NEW.boundary_version,
      NEW.boundary_geojson,
      NEW.boundary,
      NEW.geometry_hash,
      NEW.boundary_source,
      NEW.boundary_change_reason,
      NEW.validated_by
    )
    ON CONFLICT (application_id, version_number) DO UPDATE
    SET parcel_id = EXCLUDED.parcel_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_anagu_prepare_parcel_boundary_version ON land_parcels;
CREATE TRIGGER trg_anagu_prepare_parcel_boundary_version
  BEFORE INSERT OR UPDATE OF boundary_geojson ON land_parcels
  FOR EACH ROW
  EXECUTE FUNCTION anagu_prepare_parcel_boundary_version();

DROP TRIGGER IF EXISTS trg_anagu_record_parcel_boundary_version ON land_parcels;
CREATE TRIGGER trg_anagu_record_parcel_boundary_version
  AFTER INSERT OR UPDATE OF boundary_geojson ON land_parcels
  FOR EACH ROW
  EXECUTE FUNCTION anagu_record_parcel_boundary_version();

CREATE OR REPLACE FUNCTION anagu_validate_parcel_polygon_phase4(
  p_geojson_text TEXT,
  p_exclude_application_id INTEGER DEFAULT NULL,
  p_overlap_tolerance_sqm DOUBLE PRECISION DEFAULT 1.0
)
RETURNS TABLE (
  is_valid BOOLEAN,
  validity_reason TEXT,
  has_overlap BOOLEAN,
  overlapping_parcel_codes TEXT[],
  computed_area_sqm DOUBLE PRECISION,
  computed_perimeter_m DOUBLE PRECISION,
  centroid_lat DOUBLE PRECISION,
  centroid_lng DOUBLE PRECISION
)
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_geom GEOMETRY(Polygon, 4326);
  v_valid BOOLEAN;
  v_reason TEXT;
  v_overlaps TEXT[];
BEGIN
  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geojson_text), 4326);
  v_valid := ST_IsValid(v_geom);
  v_reason := CASE WHEN v_valid THEN 'Valid Geometry' ELSE ST_IsValidReason(v_geom) END;

  IF NOT v_valid THEN
    RETURN QUERY SELECT
      FALSE,
      v_reason,
      FALSE,
      ARRAY[]::TEXT[],
      0.0::DOUBLE PRECISION,
      0.0::DOUBLE PRECISION,
      0.0::DOUBLE PRECISION,
      0.0::DOUBLE PRECISION;
    RETURN;
  END IF;

  SELECT COALESCE(ARRAY_AGG(lp.parcel_code), ARRAY[]::TEXT[])
  INTO v_overlaps
  FROM land_parcels lp
  WHERE lp.status IN ('VALIDATED', 'ACTIVE')
    AND (p_exclude_application_id IS NULL OR lp.application_id <> p_exclude_application_id)
    AND ST_Intersects(lp.boundary, v_geom)
    AND ST_Area(ST_Intersection(lp.boundary::geography, v_geom::geography)) > p_overlap_tolerance_sqm;

  RETURN QUERY SELECT
    TRUE,
    v_reason,
    COALESCE(ARRAY_LENGTH(v_overlaps, 1), 0) > 0,
    v_overlaps,
    ST_Area(v_geom::geography),
    ST_Perimeter(v_geom::geography),
    ST_Y(ST_Centroid(v_geom)),
    ST_X(ST_Centroid(v_geom));
END;
$$;

COMMIT;
