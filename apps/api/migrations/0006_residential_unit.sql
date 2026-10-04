-- Units, apartments and townhouses (including strata, community, stratum and company title) are
-- a property type of their own: they are valued on internal area and bring strata questions.
ALTER TABLE job DROP CONSTRAINT job_property_type_check;
ALTER TABLE job ADD CONSTRAINT job_property_type_check CHECK (property_type IN ('VACANT_LAND',
  'RESIDENTIAL', 'RESIDENTIAL_UNIT', 'COMMERCIAL_OFFICE', 'COMMERCIAL_RETAIL', 'INDUSTRIAL',
  'SPECIALISED_MIXED_USE'));
