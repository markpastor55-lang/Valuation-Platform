import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  INSPECTION_SCOPES,
  INSPECTION_SCOPE_LABELS,
  JURISDICTIONS,
  JURISDICTION_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  REPORT_PURPOSES,
  REPORT_PURPOSE_LABELS,
  addDays,
  createSamplePropertyDataProvider,
  matchesJobSearch,
  type JobSelection,
  type Jurisdiction,
  type PropertyMatch,
} from '@vp/domain';
import { wipJobs, type AppState } from '../app-state.js';
import { ProviderStatus } from './property-data.js';

/** Rough centre of each state's capital, for addresses typed without a match. */
const CAPITALS: Readonly<Record<Jurisdiction, { lat: number; lng: number }>> = {
  NSW: { lat: -33.87, lng: 151.21 },
  VIC: { lat: -37.81, lng: 144.96 },
  QLD: { lat: -27.47, lng: 153.03 },
  WA: { lat: -31.95, lng: 115.86 },
  SA: { lat: -34.93, lng: 138.6 },
  TAS: { lat: -42.88, lng: 147.33 },
  ACT: { lat: -35.28, lng: 149.13 },
  NT: { lat: -12.46, lng: 130.84 },
};

const stateOf = (address: string): Jurisdiction | undefined =>
  JURISDICTIONS.find((j) => new RegExp(`\\b${j}\\b`).test(address.toUpperCase()));

export function NewJobScreen(props: {
  app: AppState;
  onCreate: (input: {
    address: string;
    lat: number;
    lng: number;
    propertyId?: string;
    clientName: string;
    selection: JobSelection;
    dueDate?: string;
    inspectionDate?: string;
  }) => boolean;
  onOpen: (jobId: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const provider = useMemo(() => createSamplePropertyDataProvider(today), [today]);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<PropertyMatch[]>([]);
  const [picked, setPicked] = useState<{
    address: string;
    lat: number;
    lng: number;
    propertyId?: string;
  } | null>(null);
  const [client, setClient] = useState('');
  const [selection, setSelection] = useState<JobSelection>({
    jurisdiction: 'VIC',
    purpose: 'MARKET_VALUE',
    propertyType: 'RESIDENTIAL',
    scope: 'FULL',
    mode: 'SINGLE',
  });
  const [due, setDue] = useState(addDays(today, 7));
  const [inspection, setInspection] = useState(addDays(today, 3));

  useEffect(() => {
    let live = true;
    void provider.matchAddress(query).then((m) => {
      if (live) setMatches(m);
    });
    return () => {
      live = false;
    };
  }, [query, provider]);

  const existing =
    query.trim().length >= 3
      ? wipJobs(props.app).filter((j) => matchesJobSearch(j, query, today))
      : [];

  const pick = (p: { address: string; lat: number; lng: number; propertyId?: string }) => {
    setPicked(p);
    const st = stateOf(p.address);
    if (st) setSelection((s) => ({ ...s, jurisdiction: st }));
  };

  const picker = <K extends keyof JobSelection>(
    key: K,
    label: string,
    values: readonly JobSelection[K][],
    labels: Readonly<Record<JobSelection[K], string>>,
  ) => (
    <label class="field-label">
      {label}
      <select
        id={`new-${key}`}
        value={selection[key]}
        onChange={(e) => {
          setSelection({ ...selection, [key]: e.currentTarget.value });
        }}
      >
        {values.map((v) => (
          <option key={v} value={v}>
            {labels[v]}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div class="tab-intro">
        <h2>New job</h2>
        <p class="muted">Find the property, then add the instruction details.</p>
      </div>
      <section class="card" aria-labelledby="find">
        <h3 id="find">1. Find the property</h3>
        <ProviderStatus />
        <input
          id="property-search"
          type="search"
          placeholder="Start typing an address, e.g. 22 Demo Avenue"
          aria-label="Search for a property"
          value={query}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setPicked(null);
          }}
        />
        {existing.length > 0 && (
          <div class="notice warning">
            <strong>Already in work in progress:</strong>{' '}
            {existing.map((j, i) => (
              <span key={j.id}>
                {i > 0 && ', '}
                <button
                  type="button"
                  class="link"
                  onClick={() => {
                    props.onOpen(j.id);
                  }}
                >
                  {j.reference} ({j.addresses[0]})
                </button>
              </span>
            ))}
          </div>
        )}
        {query.trim() && !picked && (
          <ul class="plain match-list">
            {matches.map((m) => (
              <li key={m.propertyId}>
                <button
                  type="button"
                  class="match"
                  onClick={() => {
                    pick({
                      address: m.address,
                      lat: m.latitude ?? CAPITALS.VIC.lat,
                      lng: m.longitude ?? CAPITALS.VIC.lng,
                      propertyId: m.propertyId,
                    });
                  }}
                >
                  {m.address}
                </button>
              </li>
            ))}
            {query.trim().length >= 8 && (
              <li>
                <button
                  type="button"
                  class="match typed"
                  onClick={() => {
                    const st = stateOf(query) ?? 'VIC';
                    pick({ address: query.trim(), ...CAPITALS[st] });
                  }}
                >
                  Use “{query.trim()}” as typed
                </button>
              </li>
            )}
          </ul>
        )}
        {picked && (
          <div class="notice ok">
            <strong>{picked.address}</strong>{' '}
            <button
              type="button"
              class="link"
              onClick={() => {
                setPicked(null);
              }}
            >
              Change
            </button>
          </div>
        )}
      </section>
      <section class="card" aria-labelledby="details" aria-disabled={!picked}>
        <h3 id="details">2. Instruction</h3>
        <label class="field-label">
          Client
          <input
            id="new-client"
            type="text"
            placeholder="Who instructs and pays, e.g. the lender or the tax agent"
            value={client}
            disabled={!picked}
            onInput={(e) => {
              setClient(e.currentTarget.value);
            }}
          />
        </label>
        <div class="select-grid">
          {picker('purpose', 'Purpose', REPORT_PURPOSES, REPORT_PURPOSE_LABELS)}
          {picker('propertyType', 'Property type', PROPERTY_TYPES, PROPERTY_TYPE_LABELS)}
          {picker('scope', 'Inspection', INSPECTION_SCOPES, INSPECTION_SCOPE_LABELS)}
          {picker('jurisdiction', 'State or territory', JURISDICTIONS, JURISDICTION_LABELS)}
          <label class="field-label">
            Inspection booked for
            <input
              id="new-inspection"
              type="date"
              value={inspection}
              onInput={(e) => {
                setInspection(e.currentTarget.value);
              }}
            />
          </label>
          <label class="field-label">
            Due
            <input
              id="new-due"
              type="date"
              value={due}
              onInput={(e) => {
                setDue(e.currentTarget.value);
              }}
            />
          </label>
        </div>
        <div class="row">
          <button
            type="button"
            class="btn primary"
            disabled={!picked || !client.trim()}
            onClick={() => {
              if (!picked) return;
              props.onCreate({
                ...picked,
                clientName: client,
                selection,
                ...(due ? { dueDate: due } : {}),
                ...(inspection ? { inspectionDate: inspection } : {}),
              });
            }}
          >
            Create job
          </button>
          <button type="button" class="link" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </section>
    </>
  );
}
