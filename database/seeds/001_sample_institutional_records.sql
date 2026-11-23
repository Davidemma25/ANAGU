-- ANAGU Phase 2 Seed Data: Sample Institutional & Community Ownership Records
-- IMPORTANT: These are strictly SAMPLE academic prototype records for testing the
-- Community Ownership Verification Oracle and fraud detection scenarios.
-- They do NOT represent real government registry records.

INSERT INTO ownership_records (
  record_source,
  source_reference,
  parcel_code,
  registered_owner_name,
  owner_national_id,
  boundary_geojson,
  claim_status,
  notes,
  is_sample_record
)
VALUES
  (
    'SAMPLE_MUNICIPAL_ARCHIVE',
    'INST-2024-001',
    'ANG-PARCEL-1001',
    'Amara Okafor',
    'NID-1001-AMA',
    '{"type":"Polygon","coordinates":[[[3.3750,6.5200],[3.3765,6.5200],[3.3765,6.5215],[3.3750,6.5215],[3.3750,6.5200]]]}'::jsonb,
    'ACTIVE_RECORD',
    'Sample baseline record matching Plot A in Zone 1.',
    TRUE
  ),
  (
    'SAMPLE_COMMUNITY_ELDERS_COUNCIL',
    'COMM-2024-002',
    'ANG-PARCEL-1002',
    'Chidi Nwosu',
    'NID-1002-CHI',
    '{"type":"Polygon","coordinates":[[[3.3780,6.5200],[3.3795,6.5200],[3.3795,6.5215],[3.3780,6.5215],[3.3780,6.5200]]]}'::jsonb,
    'ACTIVE_RECORD',
    'Sample community customary allocation verified by council minutes.',
    TRUE
  ),
  (
    'SAMPLE_CUSTOMARY_LEDGER',
    'INST-2024-003',
    'ANG-PARCEL-1003',
    'Fatima Bello',
    'NID-1003-FAT',
    '{"type":"Polygon","coordinates":[[[3.3810,6.5220],[3.3825,6.5220],[3.3825,6.5235],[3.3810,6.5235],[3.3810,6.5220]]]}'::jsonb,
    'DISPUTED',
    'Sample disputed parcel flagged for overlapping customary inheritance claim.',
    TRUE
  )
ON CONFLICT (source_reference) DO NOTHING;
