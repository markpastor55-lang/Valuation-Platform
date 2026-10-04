import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  AVM_NOTICE,
  STATE_MAP_SERVICES,
  avmComparison,
  createSamplePropertyDataProvider,
  distanceKm,
  effectiveValue,
  formatAustralianDate,
  enteredSale,
  saleEntryProblems,
  saleFromProvider,
  suggestFieldsFromAttributes,
  type Comparability,
  type SaleEntry,
  type AutomatedEstimate,
  type FieldSuggestion,
  type PropertyAttributes,
  type ProviderSale,
} from '@vp/domain';
import {
  ASSET_ID,
  DATA_SOURCES,
  VALUER,
  analysesOf,
  fieldValue,
  isLocked,
  type PreviewState,
} from '../model.js';
import { Pill, aud, fieldLabel, humanise, m2, type Dispatch } from '../ui.js';

const today = () => new Date().toISOString().slice(0, 10);

/** Shown wherever provider data appears: the connection is built, the keys are not supplied. */
export function ProviderStatus(): JSX.Element {
  return (
    <div class="provider-status">
      <Pill tone="warning">CoreLogic not connected</Pill>
      <span class="muted small">
        API keys not supplied, so this shows made-up sample data. Sample data can’t go into an
        issued report.
      </span>
    </div>
  );
}

export function PropertyDataCard(props: { state: PreviewState; dispatch: Dispatch }): JSX.Element {
  const { state, dispatch } = props;
  const provider = useMemo(() => createSamplePropertyDataProvider(today()), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    attributes: PropertyAttributes;
    suggestions: FieldSuggestion[];
    history: ProviderSale[];
    avm: AutomatedEstimate | null;
  } | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const locked = isLocked(state);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const propertyId =
        state.job.propertyId ?? (await provider.matchAddress(state.job.address))[0]?.propertyId;
      if (!propertyId) {
        setError('No match for this address in the sample data. Enter the details yourself.');
        return;
      }
      const [attributes, history, avm] = await Promise.all([
        provider.attributes(propertyId),
        provider.salesHistory(propertyId),
        provider.automatedEstimate(propertyId),
      ]);
      const suggestions = suggestFieldsFromAttributes(attributes, {
        assetId: ASSET_ID,
        source: provider.source,
        retrievedAt: new Date().toISOString(),
        capturedBy: VALUER.userId,
      });
      setData({ attributes, suggestions, history, avm });
      setChosen(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const adopted = fieldValue(state, 'valuation.adoptedValue', ASSET_ID);
  return (
    <section class="card" aria-labelledby="pd">
      <div class="card-head">
        <h3 id="pd">Property data (CoreLogic)</h3>
        {!data && (
          <button
            type="button"
            class="btn small primary"
            disabled={loading}
            onClick={() => {
              void fetchData();
            }}
          >
            {loading ? 'Getting…' : 'Get property details'}
          </button>
        )}
      </div>
      <ProviderStatus />
      {error && <div class="notice blocking">{error}</div>}
      {data && (
        <>
          <p class="muted small">
            Tick the values you have checked, then use them. Nothing is filled in until you do.
          </p>
          <ul class="plain suggestion-list">
            {data.suggestions.map((s) => {
              const current = fieldValue(state, s.fieldId, s.assetId);
              const same = JSON.stringify(current) === JSON.stringify(s.value);
              const key = s.fieldId;
              return (
                <li key={key}>
                  <label class="suggestion">
                    <input
                      type="checkbox"
                      id={`sg-${key}`}
                      checked={chosen.has(key)}
                      disabled={locked || same}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.currentTarget.checked) next.add(key);
                        else next.delete(key);
                        setChosen(next);
                      }}
                    />
                    <span>
                      <strong>{fieldLabel(s.fieldId)}</strong>
                      <span class="muted small">
                        {' '}
                        {s.display}
                        {same ? ' · already used' : ''}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div class="row">
            <button
              type="button"
              class="btn primary small"
              disabled={locked || chosen.size === 0}
              onClick={() => {
                if (
                  dispatch(
                    {
                      type: 'applySuggestions',
                      suggestions: data.suggestions.filter((s) => chosen.has(s.fieldId)),
                    },
                    `Used ${chosen.size} value${chosen.size === 1 ? '' : 's'}`,
                  )
                )
                  setChosen(new Set());
              }}
            >
              Use ticked values
            </button>
            <button
              type="button"
              class="link"
              disabled={locked}
              onClick={() => {
                setChosen(
                  new Set(
                    data.suggestions
                      .filter(
                        (s) =>
                          JSON.stringify(fieldValue(state, s.fieldId, s.assetId)) !==
                          JSON.stringify(s.value),
                      )
                      .map((s) => s.fieldId),
                  ),
                );
              }}
            >
              Tick all
            </button>
          </div>
          <div class="stack">
            <span class="eyebrow">Sales history</span>
            {data.history.length === 0 ? (
              <span class="muted small">No previous sales recorded.</span>
            ) : (
              <ul class="plain">
                {data.history.map((h) => (
                  <li
                    key={h.providerSaleId}
                    class="row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <span>{formatAustralianDate(h.contractDate)}</span>
                    <strong class="num">{aud(h.price)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {data.avm && (
            <div class="avm">
              <div class="row" style={{ justifyContent: 'space-between' }}>
                <span class="eyebrow">Automated estimate (cross-check only)</span>
                <Pill tone="plain">{humanise(data.avm.confidence)} confidence</Pill>
              </div>
              <span class="big-number">{aud(data.avm.estimate)}</span>
              <span class="muted small num">
                Range {aud(data.avm.low)} – {aud(data.avm.high)} · {data.avm.model}
              </span>
              {typeof adopted === 'number' && (
                <span class="small">
                  {(() => {
                    const c = avmComparison(adopted, data.avm);
                    return `Your adopted value ${aud(adopted)} is ${Math.abs(c.differenceRatio * 100).toFixed(1)}% ${c.differenceRatio >= 0 ? 'above' : 'below'} the estimate${c.withinRange ? ', inside its range' : ', outside its range'}.`;
                  })()}
                </span>
              )}
              <span class="muted small">{AVM_NOTICE}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const COMPARABILITY: readonly (readonly [Comparability, string])[] = [
  ['superior', 'Superior'],
  ['comparable', 'Comparable'],
  ['inferior', 'Inferior'],
];

/** A sale the valuer knows of (agent, title search, own records), typed in by hand. */
function AddSaleForm(props: { state: PreviewState; dispatch: Dispatch }): JSX.Element {
  const { state, dispatch } = props;
  const unit = state.selection.propertyType === 'RESIDENTIAL_UNIT';
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [date, setDate] = useState('');
  const [price, setPrice] = useState('');
  const [land, setLand] = useState('');
  const [building, setBuilding] = useState('');
  const [source, setSource] = useState('');
  const [comparability, setComparability] = useState<Comparability>('comparable');
  const [problems, setProblems] = useState<string[]>([]);
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(/[$,\s]/g, '')));
  if (!open)
    return (
      <div class="row">
        <button
          type="button"
          class="btn small"
          id="sale-add-open"
          onClick={() => {
            setOpen(true);
          }}
        >
          + Add a sale
        </button>
      </div>
    );
  const submit = () => {
    const landAreaM2 = num(land);
    const buildingAreaM2 = num(building);
    const entry: SaleEntry = {
      address,
      contractDate: date,
      price: num(price) ?? 0,
      ...(landAreaM2 !== undefined ? { landAreaM2 } : {}),
      ...(buildingAreaM2 !== undefined ? { buildingAreaM2 } : {}),
      source,
      comparability,
    };
    const found = saleEntryProblems(entry, today());
    setProblems(found);
    if (found.length) return;
    const sale = enteredSale(entry, {
      id: `typed-${String(Date.now())}`,
      assetId: ASSET_ID,
      propertyType: state.selection.propertyType,
      by: VALUER.userId,
      at: new Date().toISOString(),
    });
    if (dispatch({ type: 'addSale', sale }, 'Sale added. Check it, then mark it checked.')) {
      setOpen(false);
      setAddress('');
      setDate('');
      setPrice('');
      setLand('');
      setBuilding('');
      setSource('');
      setProblems([]);
    }
  };
  return (
    <form
      class="sale-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label class="field-label">
        Address
        <input
          id="sale-address"
          type="text"
          value={address}
          onInput={(e) => {
            setAddress(e.currentTarget.value);
          }}
          placeholder="e.g. 14 Sample Road, Exampleton VIC 3000"
        />
      </label>
      <div class="select-grid">
        <label class="field-label">
          Contract date
          <input
            id="sale-date"
            type="date"
            value={date}
            onInput={(e) => {
              setDate(e.currentTarget.value);
            }}
          />
        </label>
        <label class="field-label">
          Price ($)
          <input
            id="sale-price"
            type="text"
            inputMode="numeric"
            value={price}
            onInput={(e) => {
              setPrice(e.currentTarget.value);
            }}
          />
        </label>
        <label class="field-label">
          {unit ? 'Site area (m², optional)' : 'Land area (m²)'}
          <input
            id="sale-land"
            type="text"
            inputMode="decimal"
            value={land}
            onInput={(e) => {
              setLand(e.currentTarget.value);
            }}
          />
        </label>
        <label class="field-label">
          {unit ? 'Internal area (m²)' : 'Building area (m², optional)'}
          <input
            id="sale-building"
            type="text"
            inputMode="decimal"
            value={building}
            onInput={(e) => {
              setBuilding(e.currentTarget.value);
            }}
          />
        </label>
      </div>
      <label class="field-label">
        Where it came from
        <input
          id="sale-source"
          type="text"
          value={source}
          onInput={(e) => {
            setSource(e.currentTarget.value);
          }}
          placeholder="e.g. Selling agent, title search, own records"
        />
      </label>
      <label class="field-label">
        Compared with the subject
        <select
          id="sale-comparability"
          value={comparability}
          onChange={(e) => {
            setComparability(e.currentTarget.value as Comparability);
          }}
        >
          {COMPARABILITY.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {problems.length > 0 && (
        <ul class="plain">
          {problems.map((p) => (
            <li key={p} class="notice blocking">
              {p}
            </li>
          ))}
        </ul>
      )}
      <div class="row">
        <button type="submit" class="btn small primary" id="sale-add">
          Add sale
        </button>
        <button
          type="button"
          class="link"
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Sales evidence for the job: add your own, check, and remove. */
export function SalesCard(props: { state: PreviewState; dispatch: Dispatch }): JSX.Element {
  const { state, dispatch } = props;
  const locked = isLocked(state);
  const analyses = analysesOf(state.sales);
  return (
    <section class="card" aria-labelledby="sales">
      <div class="card-head">
        <h3 id="sales">Sales evidence</h3>
        <span class="muted small">{state.sales.length} added</span>
      </div>
      {state.sales.length === 0 && (
        <div class="notice">No sales yet. Add one you know of, or find comparable sales below.</div>
      )}
      {!locked && <AddSaleForm state={state} dispatch={dispatch} />}
      {state.sales.map((s) => {
        const source = DATA_SOURCES.find((d) => d.id === s.provenance.sourceId);
        const sample = source && !source.licence.permitsReportReproduction;
        const rate = analyses.find((a) => a.saleId === s.id)?.landRate;
        const checked = s.provenance.verification === 'verified';
        return (
          <div key={s.id} class="sale">
            <div class="row" style={{ justifyContent: 'space-between' }}>
              <strong>{s.address}</strong>
              {sample ? (
                <Pill tone="warning">Sample</Pill>
              ) : (
                <Pill tone={checked ? 'ok' : 'plain'}>{checked ? 'Checked' : 'Not checked'}</Pill>
              )}
            </div>
            <span class="num">
              {aud(s.price)} · {formatAustralianDate(s.contractDate)}
              {s.landAreaM2 !== undefined && <> · land {m2(s.landAreaM2)}</>}
              {rate && <> · {aud(Math.round(effectiveValue(rate)))}/m² land</>}
            </span>
            <span class="muted small">
              {s.provenance.origin === 'manual_entry'
                ? `Entered by you · ${s.provenance.sourceRef ?? 'source not stated'}`
                : (source?.name ?? 'Unknown source')}
            </span>
            {!locked && (
              <div class="row">
                {!checked && (
                  <button
                    type="button"
                    class="btn small"
                    onClick={() =>
                      dispatch({ type: 'verifySale', saleId: s.id }, 'Marked as checked')
                    }
                  >
                    I’ve checked this sale
                  </button>
                )}
                <button
                  type="button"
                  class="link"
                  onClick={() => dispatch({ type: 'removeSale', saleId: s.id }, 'Sale removed')}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function ComparablesCard(props: { state: PreviewState; dispatch: Dispatch }): JSX.Element {
  const { state, dispatch } = props;
  const provider = useMemo(() => createSamplePropertyDataProvider(today()), []);
  const [radius, setRadius] = useState('2');
  const [months, setMonths] = useState('12');
  const [results, setResults] = useState<ProviderSale[] | null>(null);
  const [loading, setLoading] = useState(false);
  const locked = isLocked(state);

  const search = async () => {
    setLoading(true);
    try {
      setResults(
        await provider.comparableSales({
          propertyId: state.job.propertyId ?? state.job.id,
          latitude: state.job.lat,
          longitude: state.job.lng,
          radiusKm: Number(radius),
          months: Number(months),
          toDate: today(),
          propertyType: state.selection.propertyType,
          limit: 10,
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section class="card" aria-labelledby="comps">
      <h3 id="comps">Find comparable sales</h3>
      <ProviderStatus />
      <div class="toolbar">
        <label class="field-label inline">
          Within
          <select
            id="comp-radius"
            value={radius}
            onChange={(e) => {
              setRadius(e.currentTarget.value);
            }}
          >
            {['1', '2', '5'].map((r) => (
              <option key={r} value={r}>
                {r} km
              </option>
            ))}
          </select>
        </label>
        <label class="field-label inline">
          Sold in the last
          <select
            id="comp-months"
            value={months}
            onChange={(e) => {
              setMonths(e.currentTarget.value);
            }}
          >
            {['6', '12', '24'].map((m) => (
              <option key={m} value={m}>
                {m} months
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          class="btn small primary"
          disabled={loading || locked}
          onClick={() => {
            void search();
          }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>
      {results && results.length === 0 && (
        <div class="notice">No sales found. Widen the search.</div>
      )}
      {results && results.length > 0 && (
        <ul class="plain">
          {results.map((r) => {
            const sale = saleFromProvider(r, {
              assetId: ASSET_ID,
              source: provider.source,
              retrievedAt: new Date().toISOString(),
              capturedBy: VALUER.userId,
              propertyType: state.selection.propertyType,
            });
            const added = state.sales.some((x) => x.id === sale.id);
            return (
              <li key={r.providerSaleId} class="sale">
                <div class="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{r.address}</strong>
                  <span class="muted small num">{r.distanceKm?.toFixed(1)} km</span>
                </div>
                <span class="num">
                  {aud(r.price)} · {formatAustralianDate(r.contractDate)}
                  {r.landAreaM2 !== undefined && <> · land {m2(r.landAreaM2)}</>}
                  {r.bedrooms !== undefined && <> · {r.bedrooms} bed</>}
                </span>
                <div class="row">
                  <button
                    type="button"
                    class="btn small"
                    disabled={added || locked}
                    onClick={() =>
                      dispatch(
                        {
                          type: 'addSale',
                          sale,
                          ...(r.latitude !== undefined && r.longitude !== undefined
                            ? { location: { lat: r.latitude, lng: r.longitude } }
                            : {}),
                        },
                        'Sale added to your evidence',
                      )
                    }
                  >
                    {added ? 'Added' : 'Add to evidence'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Map ────────────────────────────────────────────────────────────────────

const TILE = 256;
const project = (lat: number, lng: number, z: number) => {
  const n = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  };
};

/**
 * The property and its sales on the state government basemap. Pages that can't load outside map
 * tiles (such as this hosted preview) fall back to a plain plan with the same points.
 */
export function MapCard(props: { state: PreviewState }): JSX.Element {
  const { state } = props;
  const service = STATE_MAP_SERVICES[state.selection.jurisdiction];
  const [tilesFailed, setTilesFailed] = useState(false);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const width = 360;
  const height = 240;
  const subject = { lat: state.job.lat, lng: state.job.lng };
  const sales = state.sales
    .map((s) => ({ s, at: state.saleLocations[s.id] }))
    .filter((x): x is { s: (typeof state.sales)[number]; at: { lat: number; lng: number } } =>
      Boolean(x.at),
    );
  const all = [subject, ...sales.map((x) => x.at)];
  let z = 17;
  for (; z > 10; z--) {
    const pts = all.map((p) => project(p.lat, p.lng, z));
    const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    if (w < width - 60 && h < height - 50) break;
  }
  const centre = project(subject.lat, subject.lng, z);
  const px = (p: { lat: number; lng: number }) => {
    const q = project(p.lat, p.lng, z);
    return { x: q.x - centre.x + width / 2, y: q.y - centre.y + height / 2 };
  };
  const tiles: { key: string; url: string; left: number; top: number }[] = [];
  if (service.basemap && !tilesFailed) {
    const x0 = Math.floor((centre.x - width / 2) / TILE);
    const y0 = Math.floor((centre.y - height / 2) / TILE);
    const x1 = Math.floor((centre.x + width / 2) / TILE);
    const y1 = Math.floor((centre.y + height / 2) / TILE);
    for (let tx = x0; tx <= x1; tx++)
      for (let ty = y0; ty <= y1; ty++)
        tiles.push({
          key: `${z}/${tx}/${ty}`,
          url: service.basemap.urlTemplate
            .replace('{z}', String(z))
            .replace('{x}', String(tx))
            .replace('{y}', String(ty)),
          left: tx * TILE - (centre.x - width / 2),
          top: ty * TILE - (centre.y - height / 2),
        });
  }
  const metresPerPx = (156543.03 * Math.cos((subject.lat * Math.PI) / 180)) / 2 ** z;
  const barM = [50, 100, 200, 500, 1000, 2000].find((m) => m / metresPerPx > 60) ?? 2000;
  return (
    <section class="card" aria-labelledby="map">
      <div class="card-head">
        <h3 id="map">Map</h3>
        <a class="link small" href={service.viewer.url} target="_blank" rel="noopener noreferrer">
          Open {service.viewer.name} ↗
        </a>
      </div>
      <div class="map" style={{ aspectRatio: `${width} / ${height}` }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          class="map-svg"
          role="img"
          aria-label="Map of the property and sales"
        >
          <g class="map-grid">
            {Array.from({ length: 13 }, (_, i) => (
              <line key={`v${i}`} x1={i * 30} y1={0} x2={i * 30} y2={height} />
            ))}
            {Array.from({ length: 9 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={i * 30} x2={width} y2={i * 30} />
            ))}
          </g>
          {tiles.map((t) => (
            <image
              key={t.key}
              href={t.url}
              x={t.left}
              y={t.top}
              width={TILE}
              height={TILE}
              onLoad={() => {
                setTilesLoaded(true);
              }}
              onError={() => {
                setTilesFailed(true);
              }}
            />
          ))}
          {sales.map(({ s, at }, i) => {
            const p = px(at);
            return (
              <g key={s.id}>
                <circle cx={p.x} cy={p.y} r={9} class="map-sale" />
                <text x={p.x} y={p.y + 3.5} class="map-sale-label">
                  {i + 1}
                </text>
              </g>
            );
          })}
          {(() => {
            const p = px(subject);
            return (
              <g>
                <circle cx={p.x} cy={p.y} r={11} class="map-subject" />
                <text x={p.x} y={p.y + 3.5} class="map-subject-label">
                  ★
                </text>
              </g>
            );
          })()}
          <g transform={`translate(10 ${height - 14})`}>
            <line x1={0} y1={0} x2={barM / metresPerPx} y2={0} class="map-scale" />
            <text x={0} y={-4} class="map-scale-label">
              {barM >= 1000 ? `${barM / 1000} km` : `${barM} m`}
            </text>
          </g>
        </svg>
      </div>
      <ul class="plain map-legend">
        <li>
          <span class="dot-subject">★</span> {state.job.address}
        </li>
        {sales.map(({ s, at }, i) => (
          <li key={s.id}>
            <span class="dot-sale">{i + 1}</span> {s.address}{' '}
            <span class="muted small num">
              {distanceKm(subject, at).toFixed(1)} km · {aud(s.price)}
            </span>
          </li>
        ))}
      </ul>
      <p class="muted small">
        {service.basemap && tilesLoaded && !tilesFailed
          ? `${service.basemap.name}: ${service.basemap.attribution}.`
          : service.basemap
            ? `Plain plan shown. The ${service.basemap.name} map appears where the app can load it (the installed app or the downloaded file, when online).`
            : `No public basemap is set up for ${service.jurisdiction} yet; use ${service.viewer.name} for planning and title layers.`}{' '}
        {service.planningViewer && (
          <a
            class="link"
            href={service.planningViewer.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {service.planningViewer.name} ↗
          </a>
        )}
      </p>
    </section>
  );
}
