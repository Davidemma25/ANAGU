-- ANAGU Phase 2 Migration 003: PostGIS Spatial Validation & Overlap Detection Function
-- Documented Overlap Tolerance: 1.0 square meter (prevents false positives on shared
-- boundary edges due to IEEE-754 floating-point rounding while rejecting real encroachments).

CREATE OR REPLACE FUNCTION anagu_validate_parcel_polygon(
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
  centroid_lat DOUBLE PRECISION,
  centroid_lng DOUBLE PRECISION
)
LANGUAGE plpgsql
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
    ST_Y(ST_Centroid(v_geom)),
    ST_X(ST_Centroid(v_geom));
END;
$$;
