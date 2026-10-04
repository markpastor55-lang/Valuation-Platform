import {
  SAMPLE_PLACES,
  createSamplePropertyDataProvider,
  type LocalDate,
  type PropertyDataProvider,
  type PropertyDataStatus,
} from '@vp/domain';
import type { AppConfig } from '../config.js';
import { CoreLogicProvider, type CoreLogicOptions } from './corelogic.js';
import { PropertyNotFoundError } from './errors.js';

export { PropertyDataUnavailableError, PropertyNotFoundError } from './errors.js';

/** Reason shown wherever live property data is unavailable because no keys were supplied. */
export const KEYS_NOT_SUPPLIED = 'CoreLogic API keys not supplied';

const CORELOGIC_NAME = 'CoreLogic (Cotality)';

/** Chooses the property data provider from configuration and reports its status. */
export interface PropertyDataService {
  readonly status: PropertyDataStatus;
  /** The provider to use for a request made on `today`, or null when property data is off. */
  provider(today: LocalDate): PropertyDataProvider | null;
}

/**
 * Sample data, with unknown property ids reported as "not found" (the sample provider itself
 * rejects with a plain error).
 */
function sampleProvider(today: LocalDate): PropertyDataProvider {
  const p = createSamplePropertyDataProvider(today);
  return {
    ...p,
    attributes: (propertyId, signal) =>
      SAMPLE_PLACES.some((x) => x.propertyId === propertyId)
        ? p.attributes(propertyId, signal)
        : Promise.reject(new PropertyNotFoundError(propertyId)),
  };
}

/** A live CoreLogic service (also used by tests with a stubbed fetch). */
export function corelogicService(provider: CoreLogicProvider): PropertyDataService {
  return {
    status: { state: 'connected', provider: CORELOGIC_NAME },
    provider: () => provider,
  };
}

export function sampleService(): PropertyDataService {
  return {
    status: {
      state: 'sample',
      provider: 'Sample property data',
      reason: `${KEYS_NOT_SUPPLIED}: using made-up sample data that cannot be relied on in a report`,
    },
    provider: sampleProvider,
  };
}

export function offService(reason: string = KEYS_NOT_SUPPLIED): PropertyDataService {
  return {
    status: { state: 'not_configured', provider: CORELOGIC_NAME, reason },
    provider: () => null,
  };
}

/**
 * Builds the service from configuration: `corelogic` when both keys are supplied, `sample` in
 * development and test, otherwise `off`. The keys are read from configuration only (the
 * server's secret store) and are never logged or returned.
 */
export function createPropertyDataService(
  config: AppConfig['propertyData'],
  overrides: Pick<CoreLogicOptions, 'fetch' | 'policy' | 'clock'> = {},
): PropertyDataService {
  const c = config.corelogic;
  if (config.mode === 'corelogic' && c.clientId && c.clientSecret) {
    return corelogicService(
      new CoreLogicProvider({
        clientId: c.clientId,
        clientSecret: c.clientSecret,
        baseUrl: c.baseUrl,
        tokenUrl: c.tokenUrl,
        tokenAuth: c.tokenAuth,
        paths: c.paths,
        ...overrides,
      }),
    );
  }
  if (config.mode === 'sample') return sampleService();
  return offService(
    config.keysSupplied
      ? 'Property data is turned off (PROPERTY_DATA_MODE=off)'
      : KEYS_NOT_SUPPLIED,
  );
}
