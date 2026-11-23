-- Phase 5 role-gated survey, GIS, and registrar review workflow.

BEGIN;

ALTER TABLE land_applications
  DROP CONSTRAINT IF EXISTS land_applications_status_check;

ALTER TABLE land_applications
  ADD CONSTRAINT land_applications_status_check CHECK (
    status IN (
      'SUBMITTED',
      'SURVEYOR_REVIEW',
      'AWAITING_GIS_REVIEW',
      'CORRECTION_REQUIRED',
      'GIS_REJECTED',
      'GIS_VALIDATED',
      'VERIFICATION_REJECTED',
      'VERIFIED',
      'AWAITING_LEGAL_REVIEW',
      'APPROVED',
      'REJECTED',
      'TITLE_ISSUED',
      'REVOKED'
    )
  );

CREATE TABLE IF NOT EXISTS application_status_history (
  id BIGSERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES land_applications(id) ON DELETE CASCADE,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_status_history_app_created
  ON application_status_history(application_id, created_at, id);

ALTER TABLE application_status_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON application_status_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON application_status_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE application_status_history_id_seq TO service_role;

INSERT INTO application_status_history (
  application_id,
  from_status,
  to_status,
  changed_by,
  actor_role,
  reason,
  created_at
)
SELECT
  la.id,
  NULL,
  la.status,
  NULL,
  'SYSTEM',
  'Existing application status preserved when Phase 5 history was enabled',
  COALESCE(la.submitted_at, NOW())
FROM land_applications la
WHERE NOT EXISTS (
  SELECT 1
  FROM application_status_history history
  WHERE history.application_id = la.id
);

CREATE OR REPLACE FUNCTION anagu_record_application_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_id INTEGER;
  v_actor_role TEXT;
  v_reason TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_actor_id := NULLIF(current_setting('anagu.actor_id', TRUE), '')::INTEGER;
  v_actor_role := NULLIF(current_setting('anagu.actor_role', TRUE), '');
  v_reason := NULLIF(current_setting('anagu.status_reason', TRUE), '');

  INSERT INTO application_status_history (
    application_id,
    from_status,
    to_status,
    changed_by,
    actor_role,
    reason
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    COALESCE(v_actor_id, CASE WHEN TG_OP = 'INSERT' THEN NEW.applicant_id END),
    COALESCE(v_actor_role, CASE WHEN TG_OP = 'INSERT' THEN 'CITIZEN' ELSE 'SYSTEM' END),
    COALESCE(v_reason, NULLIF(NEW.rejection_reason, ''), CASE
      WHEN TG_OP = 'INSERT' THEN 'Application submitted'
      ELSE 'Application status updated'
    END)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_anagu_application_status_history ON land_applications;
CREATE TRIGGER trg_anagu_application_status_history
  AFTER INSERT OR UPDATE OF status ON land_applications
  FOR EACH ROW
  EXECUTE FUNCTION anagu_record_application_status_history();

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
