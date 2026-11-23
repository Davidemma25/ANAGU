-- Use an application-level SQLSTATE for stale review transitions instead of a
-- PostgreSQL transaction-retry state.

BEGIN;

CREATE OR REPLACE FUNCTION anagu_transition_land_application_status(
  p_application_id INTEGER,
  p_expected_status TEXT,
  p_next_status TEXT,
  p_actor_id INTEGER,
  p_actor_role TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_application land_applications%ROWTYPE;
BEGIN
  PERFORM set_config('anagu.actor_id', p_actor_id::TEXT, TRUE);
  PERFORM set_config('anagu.actor_role', p_actor_role, TRUE);
  PERFORM set_config('anagu.status_reason', p_reason, TRUE);

  UPDATE land_applications
  SET status = p_next_status,
      rejection_reason = CASE
        WHEN p_next_status IN ('CORRECTION_REQUIRED', 'GIS_REJECTED', 'VERIFICATION_REJECTED', 'REJECTED')
          THEN p_reason
        ELSE NULL
      END,
      updated_at = NOW()
  WHERE id = p_application_id
    AND status = p_expected_status
  RETURNING * INTO v_application;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application status changed before review could be saved.'
      USING ERRCODE = 'P2001';
  END IF;

  RETURN TO_JSONB(v_application);
END;
$$;

REVOKE ALL ON FUNCTION anagu_transition_land_application_status(
  INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION anagu_transition_land_application_status(
  INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT
) TO service_role;

COMMIT;
