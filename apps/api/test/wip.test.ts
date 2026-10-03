import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, createTestApp, newJobBody, type TestApp } from './helpers.js';

interface WipList {
  today: string;
  jobs: {
    id: string;
    reference: string;
    status: string;
    selection: { jurisdiction: string };
    responsibleValuerId: string | null;
    stage: string;
    due: string;
    clientName: string;
    addresses: string[];
    valuerName: string | null;
    dueDate: string | null;
    inspectionDate: string | null;
  }[];
  counts: Record<string, number>;
  overdue: number;
}

const asset = (address: string) => ({ label: address, address: { formatted: address } });

describe('work in progress and job search', () => {
  let t: TestApp;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    t = await createTestApp();
    const create = async (key: string, body: Record<string, unknown>) => {
      const res = await t.call<{ id: string }>('allocator', 'POST', '/v1/jobs', newJobBody(body));
      expect(res.status).toBe(200);
      ids[key] = res.body.id;
    };
    // Today (Australia/Sydney) is 2026-10-02 with the test clock.
    await create('overdue', {
      reference: 'WIP-OVERDUE-1',
      dueDate: '2026-09-30',
      assets: [asset('5 Banksia Street, Exampleton VIC 3000')],
    });
    await create('inspected', {
      reference: 'WIP-INSPECTED-2',
      dueDate: '2026-10-03',
      assets: [asset('8 Wattle Court, Mockbury VIC 3011')],
    });
    await create('later', {
      reference: 'WIP-LATER-3',
      dueDate: '2026-10-20',
      responsibleValuerId: DEMO.users.valuer2,
      reviewerId: DEMO.users.reviewer,
      assets: [asset('3 Example Street, Sampleville NSW 2000')],
      selection: {
        jurisdiction: 'NSW',
        purpose: 'MARKET_VALUE',
        propertyType: 'RESIDENTIAL',
        scope: 'FULL',
        mode: 'SINGLE',
      },
    });
    await create('restricted', {
      reference: 'WIP-SECRET-4',
      dueDate: '2026-09-01',
      responsibleValuerId: DEMO.users.valuer2,
      assets: [asset('1 Hidden Way, Exampleton VIC 3000')],
    });
    // Workflow shortcuts for the test: accepted jobs are active; one has been inspected.
    await t.db.query("UPDATE job SET status = 'active' WHERE id = ANY($1::uuid[])", [
      [ids['inspected'], ids['later']],
    ]);
    const put = await t.call('valuer', 'PUT', `/v1/jobs/${ids['inspected']}/fields`, {
      values: [{ fieldId: 'dates.inspection', assetId: null, value: '2026-10-01' }],
    });
    expect(put.status).toBe(200);
    // Move one job behind the information barrier (valuer2 is the only member).
    await t.db.query('UPDATE job SET portfolio_id = $2 WHERE id = $1', [
      ids['restricted'],
      DEMO.restrictedPortfolioId,
    ]);
  });
  afterAll(async () => t.close());

  const list = (user: 'allocator' | 'valuer' | 'valuer2' | 'client', query = '') =>
    t.call<WipList>(user, 'GET', `/v1/jobs${query}`);

  it('lists jobs with stage, due state and WIP fields, most urgent first', async () => {
    const res = await list('allocator');
    expect(res.status).toBe(200);
    expect(res.body.today).toBe('2026-10-02');
    const mine = res.body.jobs.filter((j) => j.reference.startsWith('WIP-'));
    expect(mine.map((j) => j.reference)).toEqual([
      'WIP-OVERDUE-1',
      'WIP-INSPECTED-2',
      'WIP-LATER-3',
    ]);
    const [overdue, inspected, later] = mine;
    expect(overdue).toMatchObject({
      status: 'draft',
      stage: 'new',
      due: 'overdue',
      dueDate: '2026-09-30',
      clientName: 'Example Lending Pty Ltd',
      addresses: ['5 Banksia Street, Exampleton VIC 3000'],
      valuerName: 'Val Valuer',
      responsibleValuerId: DEMO.users.valuer,
      inspectionDate: null,
    });
    expect(overdue?.selection.jurisdiction).toBe('VIC');
    expect(inspected).toMatchObject({
      stage: 'in_progress',
      due: 'due_soon',
      inspectionDate: '2026-10-01',
    });
    expect(later).toMatchObject({ stage: 'to_inspect', due: 'on_track', valuerName: 'Vic Valuer' });
    expect(res.body.overdue).toBe(1);
    expect(res.body.counts).toMatchObject({ new: 1, to_inspect: 1, in_progress: 1, issued: 0 });
  });

  it('searches by address, reference, client and state', async () => {
    const byAddress = await list('allocator', '?q=banksia%20exampleton');
    expect(byAddress.body.jobs.map((j) => j.reference)).toEqual(['WIP-OVERDUE-1']);
    const byReference = await list('allocator', '?q=wip-later');
    expect(byReference.body.jobs.map((j) => j.reference)).toEqual(['WIP-LATER-3']);
    const byState = await list('allocator', '?q=wip%20new%20south%20wales');
    expect(byState.body.jobs.map((j) => j.reference)).toEqual(['WIP-LATER-3']);
    const byClient = await list('allocator', '?q=example%20lending%20mockbury');
    expect(byClient.body.jobs.map((j) => j.reference)).toEqual(['WIP-INSPECTED-2']);
    // Counts follow the search, before the stage filter.
    expect(byClient.body.counts).toMatchObject({ in_progress: 1, new: 0 });
  });

  it('filters by stage, status and responsible valuer', async () => {
    const stage = await list('allocator', '?stage=in_progress&q=wip');
    expect(stage.body.jobs.map((j) => j.reference)).toEqual(['WIP-INSPECTED-2']);
    expect(stage.body.counts).toMatchObject({ new: 1, to_inspect: 1, in_progress: 1 });
    const status = await list('allocator', '?status=active&q=wip');
    expect(status.body.jobs.map((j) => j.reference).sort()).toEqual([
      'WIP-INSPECTED-2',
      'WIP-LATER-3',
    ]);
    const valuer = await list('allocator', `?valuerId=${DEMO.users.valuer2}&q=wip`);
    expect(valuer.body.jobs.map((j) => j.reference)).toEqual(['WIP-LATER-3']);
    const bad = await list('allocator', '?stage=sideways');
    expect(bad.status).toBe(400);
  });

  it('hides restricted-portfolio jobs from non-members, in the list and in search', async () => {
    const allocator = await list('allocator', '?q=wip');
    expect(allocator.body.jobs.map((j) => j.id)).not.toContain(ids['restricted']);
    const hidden = await list('allocator', '?q=hidden%20way');
    expect(hidden.body.jobs).toEqual([]);
    expect(hidden.body.overdue).toBe(0);
    const member = await list('valuer2', '?q=wip');
    expect(member.body.jobs.map((j) => j.reference)).toEqual(['WIP-SECRET-4', 'WIP-LATER-3']);
    expect(member.body.overdue).toBe(1);
    const search = await t.call<{ jobs: { id: string }[] }>(
      'allocator',
      'GET',
      '/v1/property-search?q=hidden%20way',
    );
    expect(search.body.jobs).toEqual([]);
    // Assigned (not a portfolio member) is not enough behind the barrier; the valuer sees only
    // their own assignments.
    const valuer = await list('valuer', '?q=wip');
    expect(valuer.body.jobs.map((j) => j.reference)).toEqual(['WIP-OVERDUE-1', 'WIP-INSPECTED-2']);
    // Clients see no unissued jobs.
    const client = await list('client');
    expect(client.body.jobs).toEqual([]);
  });
});
