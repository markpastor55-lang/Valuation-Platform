import type { ConnectorFailure } from '@vp/domain';

/**
 * A property data call failed after the connector policy ran (timeout, retries, rate limit or open
 * circuit). Field work carries on with manual entry. The message never carries credentials or
 * response bodies.
 */
export class PropertyDataUnavailableError extends Error {
  readonly fallback = 'manual_entry' as const;

  constructor(
    readonly failure: ConnectorFailure,
    readonly attempts: number,
    message: string,
  ) {
    super(message);
    this.name = 'PropertyDataUnavailableError';
  }
}

/** The provider has no property with this identifier. */
export class PropertyNotFoundError extends Error {
  constructor(readonly propertyId: string) {
    super('the data provider has no property with this identifier');
    this.name = 'PropertyNotFoundError';
  }
}
