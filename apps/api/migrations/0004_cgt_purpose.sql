-- CGT is a report purpose. Whether a valuation is retrospective is derived from its dates (valuation
-- date before the inspection date), for any purpose, so the purpose code no longer implies it.
ALTER TABLE job DROP CONSTRAINT job_purpose_check;
UPDATE job SET purpose = 'CGT' WHERE purpose = 'CGT_RETROSPECTIVE';
ALTER TABLE job ADD CONSTRAINT job_purpose_check CHECK (purpose IN ('MARKET_VALUE', 'CGT', 'FAMILY_LAW',
  'FINANCIAL_REPORTING', 'RENTAL_ASSESSMENT', 'INSURANCE_REPLACEMENT'));
