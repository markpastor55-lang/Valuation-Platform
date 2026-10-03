-- 0005 valuer profiles: sign-off signature, API member number and state registrations (01 D13).

-- One profile per valuer. Only the valuer edits it (PUT /v1/me/profile); certifications copy the
-- identity they print from it at the moment of signing.
CREATE TABLE valuer_profile (
  user_id            uuid PRIMARY KEY REFERENCES app_user(id),
  org_id             uuid NOT NULL REFERENCES organisation(id),
  full_name          text NOT NULL,
  -- designations as held, e.g. ["AAPI", "CPV"]
  credentials        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Australian Property Institute member number
  api_member_number  text,
  -- [{ "jurisdiction": "QLD" | "WA", "number": "...", "expiresOn"?: "YYYY-MM-DD" }]
  registrations      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- { "kind": "drawn" | "typed", "value": PNG data URL or typed name, "updatedAt": instant }
  signature          jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Every signature used to sign a certification, stored once per valuer by its fingerprint
-- (signatureHash). Reports render the signature recorded at signing, so a later profile change
-- never alters an existing certification or issued report.
CREATE TABLE valuer_signature (
  user_id     uuid NOT NULL REFERENCES app_user(id),
  sha256      text NOT NULL,
  org_id      uuid NOT NULL REFERENCES organisation(id),
  kind        text NOT NULL CHECK (kind IN ('drawn', 'typed')),
  value       text NOT NULL,
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, sha256)
);

CREATE TRIGGER valuer_signature_append_only
  BEFORE UPDATE OR DELETE ON valuer_signature
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
