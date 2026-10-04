import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE, composeReport, type MarketCommentary } from '@vp/domain';
import { loadAggregate, reportDataOf, validate } from '../src/services/aggregate.js';
import { DEMO, createTestApp, newJobBody, submitDirectly, type TestApp } from './helpers.js';

const SOURCE = {
  origin: 'external_source',
  sourceId: 'ds-demo-research',
  sourceRef: 'Quarterly market review, September 2026 (demonstration content)',
  retrievedAt: '2026-09-30T00:00:00Z',
  effectiveDate: '2026-09-30',
  licenceBasis: 'internal',
  verification: 'verified',
};

const paragraph = (over: Record<string, unknown> = {}) => ({
  moduleId: 'local-newtown',
  level: 'local',
  jurisdiction: 'VIC',
  localities: ['Newtown', 'Newtown Shire'],
  title: 'Newtown (test suburb)',
  asAtDate: '2026-09-30',
  text: 'Newtown is a small country town with a primary school, a supermarket and a weekly market. Houses on large blocks sell steadily to local families and retirees.',
  sources: [SOURCE],
  ...over,
});

interface Module {
  id: string;
  moduleId: string;
  version: number;
  status: string;
  asAtDate: string;
  authoredBy: string;
  approvedBy?: string;
}

interface Suggestion {
  level: string;
  fieldId: string;
  text: string;
  asAtDate?: string;
  coversPropertyType: boolean;
  modules: Module[];
}

interface Suggestions {
  assetId: string;
  valuationDate: string;
  localities: string[];
  suggestions: Suggestion[];
}

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

const ids = (s: Suggestions, level: string): string[] =>
  s.suggestions.find((x) => x.level === level)?.modules.map((m) => `${m.moduleId}@${m.version}`) ??
  [];

describe('market commentary library', () => {
  let t: TestApp;
  let approvedId: string;
  let draftId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('is seeded with the approved demonstration library', async () => {
    const res = await t.call<{ modules: Module[] }>(
      'valuer',
      'GET',
      '/v1/commentary-library?level=national',
    );
    expect(res.status).toBe(200);
    const overview = res.body.modules.filter((m) => m.moduleId === 'au-overview');
    // newest first per paragraph
    expect(overview.map((m) => m.version)).toEqual([2, 1]);
    expect(res.body.modules.every((m) => m.status === 'approved')).toBe(true);
  });

  it('a standards owner writes a draft; another standards owner approves it', async () => {
    const created = await t.call<Module>(
      'standardsOwner',
      'POST',
      '/v1/commentary-library',
      paragraph(),
    );
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      moduleId: 'local-newtown',
      version: 1,
      status: 'draft',
      authoredBy: DEMO.users.standardsOwner,
    });
    approvedId = created.body.id;

    const byAuthor = await t.call<ErrorBody>(
      'standardsOwner',
      'POST',
      `/v1/commentary-library/${approvedId}/approve`,
    );
    expect(byAuthor.status).toBe(403);
    expect(byAuthor.body.error.code).toBe('SEPARATION_OF_DUTIES');
    const noMfa = await t.call<ErrorBody>(
      'legal',
      'POST',
      `/v1/commentary-library/${approvedId}/approve`,
      undefined,
      { mfa: false },
    );
    expect(noMfa.status).toBe(403);
    expect(noMfa.body.error.code).toBe('MFA_REQUIRED');

    const approved = await t.call<Module>(
      'legal',
      'POST',
      `/v1/commentary-library/${approvedId}/approve`,
    );
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'approved', approvedBy: DEMO.users.legal });
    const again = await t.call<ErrorBody>(
      'legal',
      'POST',
      `/v1/commentary-library/${approvedId}/approve`,
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('IMMUTABLE_RECORD');

    // The next quarter's view is a new version.
    const next = await t.call<Module>(
      'standardsOwner',
      'POST',
      '/v1/commentary-library',
      paragraph({ asAtDate: '2026-12-31' }),
    );
    expect(next.body).toMatchObject({ version: 2, status: 'draft' });
    draftId = next.body.id;
    const list = await t.call<{ modules: Module[] }>(
      'standardsOwner',
      'GET',
      '/v1/commentary-library?level=local&jurisdiction=VIC',
    );
    expect(
      list.body.modules
        .filter((m) => m.moduleId === 'local-newtown')
        .map((m) => [m.version, m.status]),
    ).toEqual([
      [2, 'draft'],
      [1, 'approved'],
    ]);

    const security = await t.call<{ events: { action: string; metadata?: { code: string } }[] }>(
      'admin',
      'GET',
      '/v1/admin/security-events',
    );
    const actions = security.body.events.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['commentary.version_created', 'commentary.version_approved']),
    );
    expect(
      security.body.events.some(
        (e) => e.action === 'auth.denied' && e.metadata?.code === 'SEPARATION_OF_DUTIES',
      ),
    ).toBe(true);
  });

  it('refuses paragraphs with problems and lists them', async () => {
    const res = await t.call<ErrorBody & { error: { details: { problems: string[] } } }>(
      'standardsOwner',
      'POST',
      '/v1/commentary-library',
      paragraph({
        moduleId: 'local-elsewhere',
        localities: [],
        text: 'Too short.',
        sources: [{ ...SOURCE, sourceId: 'ds-unregistered' }],
      }),
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_COMMENTARY');
    expect(res.body.error.details.problems).toEqual(
      expect.arrayContaining([
        'the paragraph is too short to be useful',
        'local commentary needs at least one suburb, town or council',
        'source: ds-unregistered is not a registered source',
      ]),
    );
    const moved = await t.call<ErrorBody & { error: { details: { problems: string[] } } }>(
      'standardsOwner',
      'POST',
      '/v1/commentary-library',
      paragraph({ jurisdiction: 'NSW' }),
    );
    expect(moved.status).toBe(422);
    expect(moved.body.error.details.problems).toContain(
      'a new version must keep the level and state of the earlier versions',
    );
  });

  it('never changes an approved version (database guard)', async () => {
    await expect(
      t.db.query(
        `UPDATE commentary_module SET data = jsonb_set(data, '{text}', '"Rewritten"') WHERE id = $1`,
        [approvedId],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      t.db.query("UPDATE commentary_module SET as_at_date = '2020-01-01' WHERE id = $1", [
        approvedId,
      ]),
    ).rejects.toThrow(/immutable/);
    await expect(
      t.db.query('DELETE FROM commentary_module WHERE id = $1', [approvedId]),
    ).rejects.toThrow(/immutable/);
    // Retiring is the one change allowed, and a retired version is then frozen too.
    await t.db.query(
      `UPDATE commentary_module SET status = 'retired',
         data = data || jsonb_build_object('status', 'retired', 'retiredBy', $2::text, 'retiredAt', '2026-10-02T01:00:00.000Z')
       WHERE id = $1`,
      [approvedId, DEMO.users.legal],
    );
    await expect(
      t.db.query(
        `UPDATE commentary_module SET status = 'approved', data = data || '{"status":"approved"}' WHERE id = $1`,
        [approvedId],
      ),
    ).rejects.toThrow(/immutable/);
    // Drafts may still be withdrawn.
    await t.db.query('DELETE FROM commentary_module WHERE id = $1', [draftId]);
  });

  it('only standards owners write the library; clients cannot read it', async () => {
    const valuer = await t.call<ErrorBody>(
      'valuer',
      'POST',
      '/v1/commentary-library',
      paragraph({ moduleId: 'local-by-valuer' }),
    );
    expect(valuer.status).toBe(403);
    expect(valuer.body.error.code).toBe('NO_ROLE_GRANT');
    const approve = await t.call('valuer', 'POST', `/v1/commentary-library/${approvedId}/approve`);
    expect(approve.status).toBe(403);
    expect((await t.call('client', 'GET', '/v1/commentary-library')).status).toBe(403);
  });
});

describe('library commentary for a job', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  /** Creates a job and records its dates and council. */
  async function job(over: Record<string, unknown>, fields: Record<string, unknown>) {
    const res = await t.call<{ id: string; assets: { id: string }[] }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody(over),
    );
    expect(res.status).toBe(200);
    const jobId = res.body.id;
    const assetId = res.body.assets[0]!.id;
    const values = Object.entries(fields).map(([fieldId, value]) => ({
      fieldId,
      assetId: fieldId.startsWith('location.') ? assetId : null,
      value,
    }));
    if (values.length) {
      const put = await t.call('valuer', 'PUT', `/v1/jobs/${jobId}/fields`, { values });
      expect(put.status).toBe(200);
    }
    return { jobId, assetId };
  }

  const suggestionsOf = (jobId: string, assetId?: string) =>
    t.call<Suggestions>(
      'valuer',
      'GET',
      `/v1/jobs/${jobId}/commentary/suggestions${assetId ? `?assetId=${assetId}` : ''}`,
    );

  const EXAMPLETON = { 'dates.valuation': '2026-09-30', 'location.lga': 'Example City Council' };

  it('suggests the approved paragraphs for the property type, state and suburb', async () => {
    const house = await job({}, EXAMPLETON);
    const res = await suggestionsOf(house.jobId, house.assetId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      assetId: house.assetId,
      valuationDate: '2026-09-30',
      localities: ['Exampleton', 'Example City Council'],
    });
    expect(ids(res.body, 'national')).toEqual(['au-overview@2', 'au-houses@2']);
    expect(ids(res.body, 'state')).toEqual(['vic-overview@1', 'vic-houses@1']);
    expect(ids(res.body, 'local')).toEqual(['local-exampleton@1']);
    // without an asset id, the job's first asset is used
    expect((await suggestionsOf(house.jobId)).body.assetId).toBe(house.assetId);

    const unit = await job(
      {
        selection: { ...newJobBody().selection, propertyType: 'RESIDENTIAL_UNIT' },
        assets: [
          {
            label: '4/12 Station Street, Exampleton VIC 3000',
            address: { formatted: '4/12 Station Street, Exampleton VIC 3000' },
          },
        ],
      },
      EXAMPLETON,
    );
    const units = await suggestionsOf(unit.jobId);
    expect(ids(units.body, 'national')).toEqual(['au-overview@2', 'au-units@2']);
    expect(ids(units.body, 'state')).toEqual(['vic-overview@1', 'vic-units@1']);
    expect(ids(units.body, 'local')).toEqual(['local-exampleton@1', 'local-exampleton-units@1']);
  });

  it('applies the library commentary: fields, dated records, audit and the report', async () => {
    const { jobId, assetId } = await job({}, EXAMPLETON);
    const suggested = (await suggestionsOf(jobId, assetId)).body;
    const res = await t.call<{ records: MarketCommentary[] }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/commentary/apply`,
      { assetId, levels: ['national', 'state', 'local'] },
    );
    expect(res.status).toBe(200);
    const [national, state, local] = res.body.records;
    expect(national).toMatchObject({
      level: 'national',
      asAtDate: '2026-08-31',
      authoredBy: DEMO.users.valuer,
      library: [
        { moduleId: 'au-overview', version: 2 },
        { moduleId: 'au-houses', version: 2 },
      ],
    });
    expect(national?.assetId).toBeUndefined();
    expect(state?.assetId).toBeUndefined();
    expect(local).toMatchObject({ level: 'local', assetId });
    expect(national?.sources.map((s) => s.sourceId)).toEqual(
      expect.arrayContaining(['ds-demo-research', 'ds-public-releases']),
    );

    const fields = await t.db.query<{
      field_id: string;
      asset_id: string | null;
      value: string;
      provenance: Record<string, unknown>;
    }>(
      "SELECT field_id, asset_id, value, provenance FROM field_value WHERE job_id = $1 AND field_id LIKE 'market.%' ORDER BY field_id",
      [jobId],
    );
    expect(fields.rows.map((f) => [f.field_id, f.asset_id])).toEqual([
      ['market.local', assetId],
      ['market.national', null],
      ['market.state', null],
    ]);
    for (const f of fields.rows) {
      const s = suggested.suggestions.find((x) => x.fieldId === f.field_id);
      expect(f.value).toBe(s?.text);
    }
    expect(fields.rows.find((f) => f.field_id === 'market.national')?.provenance).toMatchObject({
      origin: 'external_source',
      sourceId: 'ds-commentary-library',
      sourceRef: 'au-overview@2+au-houses@2',
      effectiveDate: '2026-08-31',
      licenceBasis: 'internal',
      verification: 'verified',
      verifiedBy: DEMO.users.valuer,
      capturedBy: DEMO.users.valuer,
    });
    const stored = await t.db.query<{ level: string; asset_id: string | null }>(
      'SELECT level, asset_id FROM market_commentary WHERE job_id = $1 ORDER BY level',
      [jobId],
    );
    expect(stored.rows).toEqual([
      { level: 'local', asset_id: assetId },
      { level: 'national', asset_id: null },
      { level: 'state', asset_id: null },
    ]);

    const audit = await t.call<{
      events: { action: string; metadata?: { level: string; library: unknown[] } }[];
    }>('reviewer', 'GET', `/v1/jobs/${jobId}/audit`);
    const added = audit.body.events.filter((e) => e.action === 'evidence.commentary_added');
    expect(added.map((e) => e.metadata?.level)).toEqual(['national', 'state', 'local']);
    expect(added[0]?.metadata?.library).toEqual([
      { moduleId: 'au-overview', version: 2 },
      { moduleId: 'au-houses', version: 2 },
    ]);

    // The report prints each level under its heading with the as-at date and sources.
    const agg = await loadAggregate(t.db, jobId);
    expect(agg.commentary).toHaveLength(3);
    const data = reportDataOf(agg, { id: 'draft', version: 0, status: 'draft' }, 'Example');
    expect(data.commentary).toEqual(agg.commentary);
    const market = composeReport(data, DEFAULT_TEMPLATE).sections.find(
      (s) => s.sectionId === 'market',
    );
    const text = (market?.blocks ?? []).flatMap((b) => ('text' in b ? [b.text] : []));
    expect(text).toEqual(
      expect.arrayContaining([
        'National market',
        'State market — Victoria',
        'Local market — Exampleton',
      ]),
    );
    const notes = text.filter((s) => s.startsWith('Commentary as at 31 August 2026.'));
    expect(notes).toHaveLength(3);
    expect(notes[0]).toContain('Quarterly market review, August 2026 (demonstration content)');
    // Library commentary is complete and long enough: no missing or brief commentary findings.
    const findings = validate(agg, 'submit', t.ctx).findings.filter(
      (f) => f.path.includes('field:market.') || f.code === 'VAL-MKT-001',
    );
    expect(findings).toEqual([]);

    const pdf = await t.call('valuer', 'GET', `/v1/jobs/${jobId}/report/draft.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.raw.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('gives a retrospective valuation only the commentary of its day', async () => {
    const sampleville = {
      selection: { ...newJobBody().selection, jurisdiction: 'NSW' },
      assets: [
        {
          label: '5 Example Street, Sampleville NSW 2000',
          address: { formatted: '5 Example Street, Sampleville NSW 2000' },
        },
      ],
    };
    // Until a date is recorded, commentary is offered as at today in the property's state.
    const undated = await job(sampleville, {});
    expect((await suggestionsOf(undated.jobId)).body.valuationDate).toBe('2026-10-02');

    const { jobId, assetId } = await job(sampleville, {
      'dates.valuation': '2019-07-15',
      'dates.inspection': '2026-09-30',
      'location.lga': 'City of Sampleville',
    });
    const res = await suggestionsOf(jobId, assetId);
    expect(res.body.valuationDate).toBe('2019-07-15');
    expect(ids(res.body, 'national')).toEqual(['au-overview@1', 'au-houses@1']);
    expect(ids(res.body, 'state')).toEqual(['nsw-overview@1']);
    expect(ids(res.body, 'local')).toEqual(['local-sampleville@1']);
    const dates = res.body.suggestions.flatMap((s) => s.modules.map((m) => m.asAtDate));
    expect(dates.every((d) => d <= '2019-07-15')).toBe(true);

    const applied = await t.call<{ records: MarketCommentary[] }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/commentary/apply`,
      { assetId, levels: ['national', 'state', 'local'] },
    );
    expect(applied.status).toBe(200);
    expect(applied.body.records.map((r) => r.asAtDate)).toEqual([
      '2019-06-30',
      '2019-06-30',
      '2019-06-30',
    ]);
  });

  it('refuses a level the library has no commentary for, and changes nothing', async () => {
    // The VIC library has nothing as at 2019 at state or local level.
    const { jobId, assetId } = await job(
      {},
      { 'dates.valuation': '2019-07-15', 'location.lga': 'Example City Council' },
    );
    const res = await t.call<ErrorBody>('valuer', 'POST', `/v1/jobs/${jobId}/commentary/apply`, {
      assetId,
      levels: ['national', 'state'],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_LIBRARY_COMMENTARY');
    expect(res.body.error.message).toContain('state');
    expect(res.body.error.details).toEqual({ levels: ['state'] });
    const written = await t.db.query(
      "SELECT 1 FROM field_value WHERE job_id = $1 AND field_id LIKE 'market.%' UNION ALL SELECT 1 FROM market_commentary WHERE job_id = $1",
      [jobId],
    );
    expect(written.rows).toEqual([]);
  });

  it('applies only for the assigned valuer on an editable job', async () => {
    const { jobId, assetId } = await job({}, EXAMPLETON);
    const body = { assetId, levels: ['national'] };
    const inspector = await t.call('inspector', 'POST', `/v1/jobs/${jobId}/commentary/apply`, body);
    expect(inspector.status).toBe(403);
    expect(
      (await t.call('valuer2', 'GET', `/v1/jobs/${jobId}/commentary/suggestions`)).status,
    ).toBe(403);
    const other = await job({}, EXAMPLETON);
    const wrongAsset = await t.call<ErrorBody>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/commentary/apply`,
      { assetId: other.assetId, levels: ['national'] },
    );
    expect(wrongAsset.status).toBe(422);
    expect(wrongAsset.body.error.code).toBe('UNKNOWN_ASSET');
    await submitDirectly(t, jobId);
    const locked = await t.call<ErrorBody>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/commentary/apply`,
      body,
    );
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('RECORD_LOCKED');
  });

  // Last in this block: it adds a newer Exampleton paragraph to the library.
  it('keeps local commentary current to the day the report is prepared', async () => {
    const { jobId, assetId } = await job({}, EXAMPLETON);
    const apply = () =>
      t.call('valuer', 'POST', `/v1/jobs/${jobId}/commentary/apply`, {
        assetId,
        levels: ['local'],
      });
    const notCurrent = async () =>
      validate(await loadAggregate(t.db, jobId), 'submit', t.ctx).findings.filter(
        (f) => f.code === 'VAL-MKT-002',
      );
    expect((await apply()).status).toBe(200);
    expect(await notCurrent()).toEqual([]);

    // The firm approves an updated view of Exampleton after the valuation date (30 September).
    const created = await t.call<Module>(
      'standardsOwner',
      'POST',
      '/v1/commentary-library',
      paragraph({
        moduleId: 'local-exampleton',
        localities: ['Exampleton', 'Example City Council'],
        title: 'Exampleton (updated)',
        asAtDate: '2026-10-01',
        sources: [{ ...SOURCE, effectiveDate: '2026-10-01' }],
      }),
    );
    expect(created.body).toMatchObject({ moduleId: 'local-exampleton', version: 2 });
    expect(
      (await t.call('legal', 'POST', `/v1/commentary-library/${created.body.id}/approve`)).status,
    ).toBe(200);
    expect((await notCurrent()).map((f) => f.message)).toEqual([
      'newer local commentary has been approved (Exampleton (updated), as at 2026-10-01); use it before the report goes out',
    ]);

    // A current valuation is offered it for local commentary (as at today, 2 October), while
    // national and state stay at the valuation date.
    const s = (await suggestionsOf(jobId, assetId)).body as Suggestions & { localAsAt: string };
    expect(s.localAsAt).toBe('2026-10-02');
    expect(ids(s, 'local')).toEqual(['local-exampleton@2']);
    expect(ids(s, 'national')).toEqual(['au-overview@2', 'au-houses@2']);
    t.clock.advance(60_000);
    expect((await apply()).status).toBe(200);
    expect(await notCurrent()).toEqual([]);
  });
});
