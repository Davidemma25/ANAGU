INSERT INTO roles (code, name, description)
VALUES
  (
    'SURVEYOR',
    'Surveyor',
    'Reviews survey documents and assigned parcel boundaries.'
  ),
  (
    'COMMUNITY_OFFICER',
    'Community Verification Officer',
    'Verifies ownership claims against institutional and community records.'
  ),
  (
    'REGISTRAR',
    'Registrar',
    'Completes legal review and authorizes eligible title issuance.'
  ),
  (
    'GOVERNOR',
    'Governor',
    'Executes legally authorized statutory title revocation.'
  )
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description;
