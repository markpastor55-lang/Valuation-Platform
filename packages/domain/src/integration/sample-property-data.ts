import { addMonths, type LocalDate } from '../core/dates.js';
import type { DataSource } from '../core/data-source.js';
import { sha256Hex } from '../core/hash.js';
import type { Jurisdiction } from '../config/codes.js';
import type {
  AutomatedEstimate,
  ComparableSearch,
  PropertyAttributes,
  PropertyDataProvider,
  PropertyMatch,
  ProviderSale,
} from './property-data.js';
import { distanceKm } from './state-maps.js';

/**
 * Made-up property data used while no CoreLogic keys are supplied (development, demos and tests).
 * Deterministic, clearly labelled, and never reproducible in a report: VAL-PROV-003 blocks issue
 * if sample sales are relied on.
 */
export const SAMPLE_PROPERTY_SOURCE: DataSource = {
  id: 'ds-sample-property-data',
  name: 'Sample property data (CoreLogic keys not supplied)',
  provider: 'Valuation Platform sample data',
  kind: 'sales',
  licence: {
    basis: 'internal',
    reference: 'Synthetic data for trying the app; not for reports',
    permitsStorage: true,
    permitsReportReproduction: false,
    permitsBulkUse: false,
  },
  freshnessDays: 3650,
  status: 'active',
};

export const SAMPLE_AVM_SOURCE: DataSource = {
  ...SAMPLE_PROPERTY_SOURCE,
  id: 'ds-sample-avm',
  name: 'Sample automated estimate (CoreLogic keys not supplied)',
  kind: 'other',
};

interface Place {
  readonly propertyId: string;
  readonly address: string;
  readonly suburb: string;
  readonly jurisdiction: Jurisdiction;
  readonly lga: string;
  readonly lat: number;
  readonly lng: number;
}

/** Fictional addresses the sample search recognises. */
export const SAMPLE_PLACES: readonly Place[] = [
  {
    propertyId: 'S-VIC-0001',
    address: '10 Sample Road, Exampleton VIC 3000',
    suburb: 'Exampleton VIC 3000',
    jurisdiction: 'VIC',
    lga: 'Example City Council',
    lat: -37.81,
    lng: 144.96,
  },
  {
    propertyId: 'S-VIC-0002',
    address: '22 Demo Avenue, Exampleton VIC 3000',
    suburb: 'Exampleton VIC 3000',
    jurisdiction: 'VIC',
    lga: 'Example City Council',
    lat: -37.8131,
    lng: 144.9652,
  },
  {
    propertyId: 'S-VIC-0003',
    address: '7 Placeholder Parade, Mockbury VIC 3011',
    suburb: 'Mockbury VIC 3011',
    jurisdiction: 'VIC',
    lga: 'Mockbury City Council',
    lat: -37.799,
    lng: 144.901,
  },
  {
    propertyId: 'S-NSW-0001',
    address: '3 Example Street, Sampleville NSW 2000',
    suburb: 'Sampleville NSW 2000',
    jurisdiction: 'NSW',
    lga: 'City of Sampleville',
    lat: -33.87,
    lng: 151.21,
  },
  {
    propertyId: 'S-QLD-0001',
    address: '15 Test Crescent, Demo Heights QLD 4000',
    suburb: 'Demo Heights QLD 4000',
    jurisdiction: 'QLD',
    lga: 'Demo City Council',
    lat: -27.47,
    lng: 153.02,
  },
  {
    propertyId: 'S-WA-0001',
    address: '41 Trial Way, Testford WA 6000',
    suburb: 'Testford WA 6000',
    jurisdiction: 'WA',
    lga: 'City of Testford',
    lat: -31.95,
    lng: 115.86,
  },
];

const ZONES: Readonly<Record<Jurisdiction, string>> = {
  VIC: 'General Residential Zone (GRZ1)',
  NSW: 'R2 Low Density Residential',
  QLD: 'Low density residential',
  WA: 'Residential R20',
  SA: 'General Neighbourhood',
  TAS: 'General Residential',
  ACT: 'RZ1 Suburban',
  NT: 'LR Low Density Residential',
};

const STREETS = [
  'Wattle Court',
  'Banksia Street',
  'Grevillea Avenue',
  'Acacia Drive',
  'Bottlebrush Lane',
  'Kurrajong Road',
  'Ironbark Close',
  'Waratah Street',
  'Bluegum Way',
  'Tea Tree Grove',
];

/** Deterministic pseudo-random numbers from a seed string. */
function rng(seed: string): () => number {
  let state = sha256Hex(seed);
  let i = 0;
  return () => {
    if (i + 8 > state.length) {
      state = sha256Hex(state);
      i = 0;
    }
    const n = parseInt(state.slice(i, i + 8), 16) / 0xffffffff;
    i += 8;
    return n;
  };
}

const between = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

const placeOf = (propertyId: string): Place | undefined =>
  SAMPLE_PLACES.find((p) => p.propertyId === propertyId);

function attributesFor(place: Place, asAt: LocalDate): PropertyAttributes {
  const r = rng(place.propertyId);
  const land = roundTo(between(r, 420, 900), 5);
  const beds = Math.floor(between(r, 3, 6));
  return {
    propertyId: place.propertyId,
    address: place.address,
    propertyType: 'House',
    landAreaM2: land,
    floorAreaM2: roundTo(between(r, 150, 260), 1),
    bedrooms: beds,
    bathrooms: Math.max(1, beds - 2),
    carSpaces: Math.floor(between(r, 1, 3)),
    yearBuilt: Math.floor(between(r, 1965, 2015)),
    titleReference: `Lot ${Math.floor(between(r, 1, 60))} ${place.jurisdiction === 'NSW' ? 'DP' : place.jurisdiction === 'QLD' ? 'RP' : 'PS'}${Math.floor(between(r, 100000, 999999))}`,
    lga: place.lga,
    zoning: ZONES[place.jurisdiction],
    latitude: place.lat,
    longitude: place.lng,
    asAt,
  };
}

/** Rough sample rate per m² of land by state (only to make the sample numbers plausible). */
const LAND_RATE: Readonly<Record<Jurisdiction, number>> = {
  VIC: 1450,
  NSW: 2100,
  QLD: 1150,
  WA: 1050,
  SA: 950,
  TAS: 800,
  ACT: 1500,
  NT: 700,
};

export function createSamplePropertyDataProvider(today: LocalDate): PropertyDataProvider {
  return {
    id: 'sample',
    source: SAMPLE_PROPERTY_SOURCE,
    avmSource: SAMPLE_AVM_SOURCE,
    matchAddress(query): Promise<PropertyMatch[]> {
      const words = query
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean);
      const matches = SAMPLE_PLACES.filter((p) =>
        words.every((w) => p.address.toLowerCase().includes(w)),
      ).map((p) => ({
        propertyId: p.propertyId,
        address: p.address,
        latitude: p.lat,
        longitude: p.lng,
        confidence: 0.95,
      }));
      return Promise.resolve(words.length ? matches.slice(0, 5) : []);
    },
    attributes(propertyId) {
      const place = placeOf(propertyId);
      if (!place) return Promise.reject(new Error(`unknown sample property ${propertyId}`));
      return Promise.resolve(attributesFor(place, today));
    },
    salesHistory(propertyId) {
      const place = placeOf(propertyId);
      if (!place) return Promise.resolve([]);
      const r = rng(`${propertyId}:history`);
      const a = attributesFor(place, today);
      const current = (a.landAreaM2 ?? 600) * LAND_RATE[place.jurisdiction] * 1.25;
      const count = 1 + Math.floor(r() * 2.99);
      const sales: ProviderSale[] = [];
      for (let i = 0; i < count; i++) {
        const yearsAgo = 3 + i * 6 + Math.floor(r() * 3);
        sales.push({
          providerSaleId: `${propertyId}-H${i + 1}`,
          propertyId,
          address: place.address,
          contractDate: addMonths(today, -12 * yearsAgo - Math.floor(r() * 11)),
          price: roundTo(current / 1.06 ** yearsAgo, 5000),
          ...(a.landAreaM2 !== undefined ? { landAreaM2: a.landAreaM2 } : {}),
          ...(a.floorAreaM2 !== undefined ? { floorAreaM2: a.floorAreaM2 } : {}),
        });
      }
      return Promise.resolve(sales);
    },
    comparableSales(search: ComparableSearch) {
      const place = placeOf(search.propertyId);
      const jurisdiction = place?.jurisdiction ?? 'VIC';
      const suburb = place?.suburb ?? '';
      const r = rng(`${search.propertyId}:comps`);
      const out: ProviderSale[] = [];
      for (let i = 0; i < Math.min(search.limit, 10); i++) {
        const bearing = r() * 2 * Math.PI;
        const km = between(r, 0.2, Math.max(0.4, search.radiusKm));
        const lat = search.latitude + (km / 111) * Math.cos(bearing);
        const lng =
          search.longitude +
          (km / (111 * Math.cos((search.latitude * Math.PI) / 180))) * Math.sin(bearing);
        const land = roundTo(between(r, 450, 820), 5);
        const beds = Math.floor(between(r, 3, 6));
        const price = roundTo(land * LAND_RATE[jurisdiction] * between(r, 1.1, 1.45), 5000);
        const contractDate = addMonths(search.toDate, -Math.floor(between(r, 0, search.months)));
        out.push({
          providerSaleId: `${search.propertyId}-C${i + 1}`,
          address: `${Math.floor(between(r, 1, 120))} ${STREETS[i % STREETS.length] ?? 'Sample Street'}, ${suburb}`,
          contractDate,
          price,
          landAreaM2: land,
          floorAreaM2: roundTo(between(r, 150, 260), 1),
          bedrooms: beds,
          bathrooms: Math.max(1, beds - 2),
          latitude: lat,
          longitude: lng,
          distanceKm:
            Math.round(
              distanceKm({ lat: search.latitude, lng: search.longitude }, { lat, lng }) * 100,
            ) / 100,
        });
      }
      return Promise.resolve(
        out
          .filter((s) => (s.distanceKm ?? 0) <= search.radiusKm)
          .sort((a, b) => b.contractDate.localeCompare(a.contractDate)),
      );
    },
    automatedEstimate(propertyId): Promise<AutomatedEstimate | null> {
      const place = placeOf(propertyId);
      if (!place) return Promise.resolve(null);
      const a = attributesFor(place, today);
      const estimate = roundTo((a.landAreaM2 ?? 600) * LAND_RATE[place.jurisdiction] * 1.27, 5000);
      return Promise.resolve({
        estimate,
        low: roundTo(estimate * 0.92, 5000),
        high: roundTo(estimate * 1.08, 5000),
        confidence: 'medium',
        asAt: today,
        model: 'Sample estimate (not CoreLogic)',
      });
    },
  };
}
