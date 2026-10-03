import { inflateSync } from 'node:zlib';
import { MAX_SIGNATURE_DATA_URL_LENGTH, signatureHash } from '@vp/domain';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO,
  approveConfiguration,
  createTestApp,
  marketValueFieldValues,
  newJobBody,
  rect,
  saleBody,
  type TestApp,
  type UserKey,
} from './helpers.js';

/** A valid 1×1 PNG, standing in for a drawn signature. */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Text drawn on the pages of a PDF made by our renderer (standard fonts, hex-encoded strings). */
async function pdfText(bytes: Uint8Array): Promise<{ text: string; images: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts: string[] = [];
  let images = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') {
      images++;
      continue;
    }
    let data: Uint8Array = obj.contents;
    if (obj.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode') {
      try {
        data = inflateSync(data);
      } catch {
        continue;
      }
    }
    const content = Buffer.from(data).toString('latin1');
    for (const m of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g))
      parts.push(Buffer.from(m[1] ?? '', 'hex').toString('latin1'));
  }
  return { text: parts.join('\n'), images };
}

interface ProfileView {
  profile: {
    fullName: string;
    credentials: string[];
    apiMemberNumber: string | null;
    registrations: { jurisdiction: string; number: string; expiresOn?: string }[];
    signature: { kind: string; value: string; sha256: string } | null;
  };
  saved: boolean;
  signingRole: boolean;
  problems: string[];
  readyToSign: boolean;
  stateRegistrations: { jurisdiction: string; label: string; satisfied: boolean }[];
}

const profileBody = (over: Record<string, unknown> = {}) => ({
  fullName: 'Vic Valuer',
  credentials: ['AAPI', 'CPV'],
  apiMemberNumber: '00001-DEMO',
  registrations: [],
  ...over,
});

describe('valuer profile', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('returns the caller’s own profile with registration status per state', async () => {
    const res = await t.call<ProfileView>('valuer', 'GET', '/v1/me/profile');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      saved: true,
      signingRole: true,
      problems: [],
      readyToSign: true,
      profile: { fullName: 'Val Valuer', apiMemberNumber: '00000-DEMO' },
    });
    expect(res.body.stateRegistrations).toEqual([
      expect.objectContaining({
        jurisdiction: 'QLD',
        label: 'Queensland registered valuer number',
        satisfied: true,
      }),
      expect.objectContaining({ jurisdiction: 'WA', satisfied: true }),
    ]);
    const other = await t.call<ProfileView>('valuer2', 'GET', '/v1/me/profile');
    expect(other.body.stateRegistrations.every((s) => !s.satisfied)).toBe(true);
  });

  it('defaults an unsaved profile from the user record', async () => {
    const res = await t.call<ProfileView>('reviewer', 'GET', '/v1/me/profile');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      saved: false,
      signingRole: false,
      readyToSign: false,
      profile: { fullName: 'Rae Reviewer', credentials: ['FAPI', 'CPV'], signature: null },
    });
  });

  it('only valuers update a profile, with MFA, and only their own', async () => {
    for (const user of ['reviewer', 'inspector', 'finance'] as UserKey[]) {
      const res = await t.call<{ error: { code: string } }>(
        user,
        'PUT',
        '/v1/me/profile',
        profileBody({ fullName: 'Someone Else' }),
      );
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NO_ROLE_GRANT');
    }
    const noMfa = await t.call<{ error: { code: string } }>(
      'valuer2',
      'PUT',
      '/v1/me/profile',
      profileBody(),
      { mfa: false },
    );
    expect(noMfa.status).toBe(403);
    expect(noMfa.body.error.code).toBe('MFA_REQUIRED');
    const ai = await t.call('valuer2', 'PUT', '/v1/me/profile', profileBody(), { kind: 'ai' });
    expect(ai.status).toBe(403);

    // A user id in the body is ignored: the caller can only ever change their own profile.
    const own = await t.call<ProfileView>(
      'valuer2',
      'PUT',
      '/v1/me/profile',
      profileBody({ userId: DEMO.users.valuer, fullName: 'Victoria Valuer' }),
    );
    expect(own.status).toBe(200);
    expect(own.body.profile.fullName).toBe('Victoria Valuer');
    // The saved signature is kept when the body leaves it out.
    expect(own.body.profile.signature).toMatchObject({ kind: 'typed', value: 'Vic Valuer' });
    const valuer = await t.call<ProfileView>('valuer', 'GET', '/v1/me/profile');
    expect(valuer.body.profile.fullName).toBe('Val Valuer');
  });

  it('refuses incomplete profiles and signatures that are not PNG images', async () => {
    const problemsOf = async (body: Record<string, unknown>) => {
      const res = await t.call<{ error: { code: string; details: { problems: string[] } } }>(
        'valuer2',
        'PUT',
        '/v1/me/profile',
        body,
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_PROFILE');
      return res.body.error.details.problems.join('; ');
    };
    expect(await problemsOf(profileBody({ fullName: ' ', credentials: [] }))).toMatch(
      /full name.*designations/,
    );
    expect(await problemsOf(profileBody({ apiMemberNumber: 'no spaces allowed' }))).toMatch(
      /API member number/,
    );
    expect(
      await problemsOf(
        profileBody({ signature: { kind: 'drawn', value: 'data:image/jpeg;base64,AAAA' } }),
      ),
    ).toMatch(/must be a PNG image/);
    expect(
      await problemsOf(
        profileBody({
          signature: {
            kind: 'drawn',
            value: `data:image/png;base64,${Buffer.from('GIF89a not really a png').toString('base64')}`,
          },
        }),
      ),
    ).toMatch(/not a readable PNG/);
    expect(
      await problemsOf(
        profileBody({
          signature: {
            kind: 'drawn',
            value: `data:image/png;base64,${'A'.repeat(MAX_SIGNATURE_DATA_URL_LENGTH)}`,
          },
        }),
      ),
    ).toMatch(/too large/);

    // Registrations are recorded only for states that require one.
    const vic = await t.call(
      'valuer2',
      'PUT',
      '/v1/me/profile',
      profileBody({ registrations: [{ jurisdiction: 'VIC', number: '123' }] }),
    );
    expect(vic.status).toBe(400);
  });

  it('saves a drawn signature and audits its fingerprint, not the image', async () => {
    const res = await t.call<ProfileView>(
      'valuer2',
      'PUT',
      '/v1/me/profile',
      profileBody({
        registrations: [{ jurisdiction: 'WA', number: 'WA-0042', expiresOn: '2027-06-30' }],
        signature: { kind: 'drawn', value: PNG_DATA_URL },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.readyToSign).toBe(true);
    expect(res.body.profile.signature?.value).toBe(PNG_DATA_URL);
    expect(res.body.stateRegistrations).toEqual([
      expect.objectContaining({ jurisdiction: 'QLD', satisfied: false }),
      expect.objectContaining({ jurisdiction: 'WA', satisfied: true }),
    ]);
    const { rows } = await t.db.query<{ event: { after: Record<string, unknown> } }>(
      "SELECT event FROM audit_event WHERE action = 'profile.updated' AND entity_id = $1 ORDER BY seq DESC LIMIT 1",
      [DEMO.users.valuer2],
    );
    const after = rows[0]?.event.after;
    expect(after?.['signature']).toEqual({
      kind: 'drawn',
      sha256: signatureHash({ kind: 'drawn', value: PNG_DATA_URL, updatedAt: '' }),
    });
    expect(JSON.stringify(rows[0]?.event)).not.toContain('base64');
  });
});

/**
 * A Queensland job signed by a valuer who first has to add their QLD registration. The issued
 * PDF prints the API member number, the registration and the drawn signature, and still
 * reproduces byte for byte from the issue snapshot.
 */
describe('signing a Queensland report', () => {
  let t: TestApp;
  let jobId: string;
  let assetId: string;
  let reportId: string;
  let signatureSha: string;

  const must = <T>(res: { status: number; body: T }, step: string): T => {
    if (res.status !== 200)
      throw new Error(`${step} failed (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body;
  };

  const certification = {
    inspectionScopeStatement: 'Full internal and external inspection on 30 September 2026.',
    valuationDate: '2026-09-30',
    basisOfValue: 'Market value',
    amount: { value: 1_150_000, kind: 'value' },
    independenceStatement: 'I have no interest in the property or the parties.',
    conflictsStatement: 'No conflict of interest identified.',
    assumptions: ['Title is free of unregistered interests'],
    specialAssumptions: [],
    limitations: ['No structural or pest survey was undertaken'],
    standardsReliedOn: ['Firm valuation methodology v1 (mapped by the standards owner)'],
    attestationText: 'I certify that this valuation is my independent professional opinion.',
  };

  beforeAll(async () => {
    t = await createTestApp();
    await approveConfiguration(t);
    must(
      await t.call('allocator', 'POST', `/v1/admin/clients/${DEMO.clientId}/recipients`, {
        email: 'credit@lender.example',
      }),
      'approve recipient',
    );
    const job = must(
      await t.call<{ id: string; assets: { id: string }[] }>(
        'allocator',
        'POST',
        '/v1/jobs',
        newJobBody({
          selection: {
            jurisdiction: 'QLD',
            purpose: 'MARKET_VALUE',
            propertyType: 'RESIDENTIAL',
            scope: 'FULL',
            mode: 'SINGLE',
          },
          responsibleValuerId: DEMO.users.valuer2,
          assets: [
            {
              label: '10 Sample Street, Exampleton QLD 4000',
              address: { formatted: '10 Sample Street, Exampleton QLD 4000' },
              latitude: -27.47,
              longitude: 153.02,
            },
          ],
        }),
      ),
      'create job',
    );
    jobId = job.id;
    assetId = job.assets[0]!.id;
    must(
      await t.call('valuer2', 'PUT', `/v1/jobs/${jobId}/fields`, {
        values: marketValueFieldValues(assetId),
      }),
      'capture fields',
    );
    must(
      await t.call('valuer2', 'POST', `/v1/jobs/${jobId}/engagement/accept`, {}),
      'accept engagement',
    );
    for (const [n, price, land, date] of [
      [1, 1_100_000, 640, '2026-06-01'],
      [2, 1_180_000, 660, '2026-07-15'],
      [3, 1_150_000, 655, '2026-08-20'],
    ] as const) {
      must(
        await t.call(
          'valuer2',
          'POST',
          `/v1/jobs/${jobId}/sales`,
          saleBody(assetId, n, price, land, date),
        ),
        `sale ${n}`,
      );
    }
    const sketch = must(
      await t.call<{ version: { id: string } }>(
        'valuer2',
        'POST',
        `/v1/jobs/${jobId}/assets/${assetId}/sketches`,
        {
          useForReport: true,
          units: 'metres',
          basis: 'BUILDING_AREA',
          conventionId: 'res-under-main-roof',
          changeSummary: 'Measured on site',
          boundaries: [
            {
              level: 'Ground',
              label: 'Dwelling',
              role: 'component',
              componentType: 'living',
              points: rect(0, 0, 15, 12),
              closed: true,
              dimensionSource: 'measured',
            },
            {
              level: 'Ground',
              label: 'Garage',
              role: 'component',
              componentType: 'garage',
              points: rect(15, 0, 6, 6),
              closed: true,
              dimensionSource: 'measured',
            },
          ],
        },
      ),
      'sketch',
    );
    must(
      await t.call(
        'valuer2',
        'POST',
        `/v1/jobs/${jobId}/sketch-versions/${sketch.version.id}/approve`,
      ),
      'approve areas',
    );
    const v = must(
      await t.call<{ findings: { code: string; path: string; severity: string }[] }>(
        'valuer2',
        'POST',
        `/v1/jobs/${jobId}/validate`,
        { stage: 'submit' },
      ),
      'validate',
    );
    expect(v.findings.filter((f) => f.severity === 'blocking')).toEqual([]);
    for (const f of v.findings.filter((x) => x.severity === 'warning')) {
      must(
        await t.call('valuer2', 'POST', `/v1/jobs/${jobId}/acknowledgements`, {
          code: f.code,
          path: f.path,
          reason: 'Considered; not applicable to this property',
        }),
        'acknowledge',
      );
    }
  });
  afterAll(async () => t.close());

  it('refuses to sign until the valuer’s profile has their QLD registration', async () => {
    const res = await t.call<{ error: { code: string; details: { problems: string[] } } }>(
      'valuer2',
      'POST',
      `/v1/jobs/${jobId}/certification`,
      certification,
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(res.body.error.details.problems).toEqual([
      'Add your Queensland registered valuer number in your profile',
    ]);

    // An expired registration does not count either (today in Brisbane is 2026-10-02).
    must(
      await t.call(
        'valuer2',
        'PUT',
        '/v1/me/profile',
        profileBody({
          registrations: [{ jurisdiction: 'QLD', number: 'QLD-0123', expiresOn: '2026-09-30' }],
        }),
      ),
      'save expired registration',
    );
    const expired = await t.call<{ error: { code: string; details: { problems: string[] } } }>(
      'valuer2',
      'POST',
      `/v1/jobs/${jobId}/certification`,
      certification,
    );
    expect(expired.status).toBe(422);
    expect(expired.body.error.details.problems.join()).toMatch(/expired on 2026-09-30/);
  });

  it('signs with the registration, API member number and drawn signature from the profile', async () => {
    must(
      await t.call(
        'valuer2',
        'PUT',
        '/v1/me/profile',
        profileBody({
          registrations: [{ jurisdiction: 'QLD', number: 'QLD-0123', expiresOn: '2027-09-30' }],
          signature: { kind: 'drawn', value: PNG_DATA_URL },
        }),
      ),
      'save profile',
    );
    const cert = await t.call<{
      valuer: {
        fullName: string;
        apiMemberNumber: string;
        registration: { jurisdiction: string; number: string };
        signatureSha256: string;
      };
    }>('valuer2', 'POST', `/v1/jobs/${jobId}/certification`, {
      ...certification,
      // Ignored: identity always comes from the signer's profile.
      valuer: { fullName: 'Somebody Else', credentials: ['FAPI'] },
    });
    expect(cert.status).toBe(200);
    expect(cert.body.valuer).toMatchObject({
      fullName: 'Vic Valuer',
      apiMemberNumber: '00001-DEMO',
      registration: { jurisdiction: 'QLD', number: 'QLD-0123' },
    });
    signatureSha = cert.body.valuer.signatureSha256;
    expect(signatureSha).toBe(signatureHash({ kind: 'drawn', value: PNG_DATA_URL, updatedAt: '' }));

    // Changing the profile after signing does not change what the certification shows.
    must(
      await t.call(
        'valuer2',
        'PUT',
        '/v1/me/profile',
        profileBody({
          registrations: [{ jurisdiction: 'QLD', number: 'QLD-0123' }],
          signature: { kind: 'typed', value: 'V. Valuer' },
        }),
      ),
      'change signature',
    );
    await expect(
      t.db.query("UPDATE valuer_signature SET value = 'x' WHERE user_id = $1", [
        DEMO.users.valuer2,
      ]),
    ).rejects.toThrow(/immutable/);
  });

  it('issues a PDF showing the API member number, registration and signature', async () => {
    must(await t.call('valuer2', 'POST', `/v1/jobs/${jobId}/submit`), 'submit');
    const review = must(
      await t.call<{ checklist: { id: string }[] }>(
        'reviewer',
        'POST',
        `/v1/jobs/${jobId}/qa/start`,
      ),
      'start QA',
    );
    for (const item of review.checklist)
      must(
        await t.call('reviewer', 'POST', `/v1/jobs/${jobId}/qa/checklist`, {
          itemId: item.id,
          response: 'yes',
        }),
        'checklist',
      );
    must(await t.call('reviewer', 'POST', `/v1/jobs/${jobId}/qa/approve`), 'QA approve');
    const issued = must(
      await t.call<{ reportId: string }>('valuer2', 'POST', `/v1/jobs/${jobId}/issue`, {
        recipients: ['credit@lender.example'],
      }),
      'issue',
    );
    reportId = issued.reportId;

    const pdf = await t.call('valuer2', 'GET', `/v1/reports/${reportId}/pdf`);
    expect(pdf.status).toBe(200);
    const { text, images } = await pdfText(pdf.raw);
    expect(text).toContain('API member number');
    expect(text).toContain('00001-DEMO');
    expect(text).toContain('QLD-0123');
    expect(text).toContain('Signature of Vic Valuer');
    expect(text).toContain(signatureSha);
    expect(images).toBeGreaterThan(0);

    // The snapshot carries the signature used at signing (not the later typed one).
    const { rows } = await t.db.query<{
      snapshot: { renderAssets: { signatures: Record<string, { kind: string; value: string }> } };
    }>('SELECT snapshot FROM report WHERE id = $1', [reportId]);
    expect(rows[0]?.snapshot.renderAssets.signatures).toEqual({
      [signatureSha]: { kind: 'drawn', value: PNG_DATA_URL },
    });
  });

  it('reproduces the issued PDF from the snapshot', async () => {
    const res = await t.call<{ reproducible: boolean; pdf: { match: boolean } }>(
      'reviewer',
      'POST',
      `/v1/reports/${reportId}/reproduce`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reproducible: true, pdf: { match: true } });
  });
});
