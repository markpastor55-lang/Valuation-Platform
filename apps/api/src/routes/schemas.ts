import {
  ASSET_MODES,
  INSPECTION_SCOPES,
  JURISDICTIONS,
  PROPERTY_TYPES,
  REPORT_PURPOSES,
} from '@vp/domain';
import { z } from 'zod';

export const Uuid = z.uuid();
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const InstantSchema = z.iso.datetime({ offset: false });

export const JobParams = z.object({ jobId: Uuid });
export const IdParams = z.object({ id: Uuid });

export const SelectionSchema = z.object({
  jurisdiction: z.enum(JURISDICTIONS),
  purpose: z.enum(REPORT_PURPOSES),
  propertyType: z.enum(PROPERTY_TYPES),
  scope: z.enum(INSPECTION_SCOPES),
  mode: z.enum(ASSET_MODES),
});

export const JsonValue: z.ZodType = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
  ]),
);

export const ProvenanceInput = z.object({
  origin: z.enum(['manual_entry', 'external_source', 'client_supplied', 'calculated', 'measured']),
  sourceId: z.string().optional(),
  sourceRef: z.string().optional(),
  retrievedAt: InstantSchema.optional(),
  effectiveDate: LocalDateSchema.optional(),
  licenceBasis: z.string().optional(),
  verification: z.enum(['unverified', 'verified', 'disputed']).default('unverified'),
});

export const AssetInput = z.object({
  id: Uuid.optional(),
  label: z.string().min(1).max(200),
  address: z.object({ formatted: z.string().min(3) }).catchall(z.unknown()),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  geocodeConfidence: z.number().min(0).max(1).optional(),
});

export const PointSchema = z.object({ x: z.number(), y: z.number() });

/** Removes `undefined` properties (zod output) so values satisfy exactOptionalPropertyTypes. */
export function compact<T extends Record<string, unknown>>(
  o: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}
