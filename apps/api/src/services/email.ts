import { hashCanonical } from '@vp/domain';

export interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly attachments: readonly {
    readonly filename: string;
    readonly contentType: string;
    readonly sha256: string;
    readonly bytes: Uint8Array;
  }[];
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

/** Hash of everything that defines a delivery (attachment content by hash). */
export const emailPayloadHash = (m: EmailMessage): string =>
  hashCanonical({
    from: m.from,
    to: m.to.toLowerCase(),
    subject: m.subject,
    text: m.text,
    attachments: m.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      sha256: a.sha256,
    })),
  });

/**
 * Local transport used in development and tests: records messages instead of sending them.
 * Production wires a provider adapter (e.g. an Australian-region transactional email service).
 */
export class RecordingEmailTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    this.sent.push(message);
    return Promise.resolve({
      providerMessageId: `local-${emailPayloadHash(message).slice(0, 20)}`,
    });
  }
}
