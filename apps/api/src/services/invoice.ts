import { formatAud, formatAustralianDate, roundHalfAwayFromZero, type LocalDate } from '@vp/domain';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { makeSanitiser } from './pdf.js';

export interface InvoiceData {
  readonly number: string;
  readonly issueDate: LocalDate;
  readonly supplier: { readonly name: string; readonly abn?: string };
  readonly billTo: { readonly name: string; readonly abn?: string };
  readonly jobReference: string;
  readonly reportId: string;
  readonly lines: readonly { readonly description: string; readonly amountCents: number }[];
  readonly subtotalCents: number;
  readonly gstRate: number;
  readonly gstCents: number;
  readonly totalCents: number;
  readonly currency: 'AUD';
}

/**
 * Builds the invoice for an issued report. Amounts are integer cents; GST is calculated on the
 * subtotal and rounded to the cent. Tax-invoice content requirements are [REVIEW: TAX].
 */
export function buildInvoice(params: {
  number: string;
  issueDate: LocalDate;
  supplier: InvoiceData['supplier'];
  billTo: InvoiceData['billTo'];
  jobReference: string;
  reportId: string;
  feeCents: number;
  description: string;
  gstRate: number;
}): InvoiceData {
  if (!Number.isInteger(params.feeCents) || params.feeCents < 0)
    throw new Error('fee must be a non-negative integer number of cents');
  const subtotalCents = params.feeCents;
  const gstCents = Math.round(roundHalfAwayFromZero(subtotalCents * params.gstRate, 0));
  return {
    number: params.number,
    issueDate: params.issueDate,
    supplier: params.supplier,
    billTo: params.billTo,
    jobReference: params.jobReference,
    reportId: params.reportId,
    lines: [{ description: params.description, amountCents: subtotalCents }],
    subtotalCents,
    gstRate: params.gstRate,
    gstCents,
    totalCents: subtotalCents + gstCents,
    currency: 'AUD',
  };
}

/** Deterministic invoice PDF (fixed metadata, standard fonts). */
export async function renderInvoicePdf(inv: InvoiceData, renderedAt: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const at = new Date(renderedAt);
  doc.setTitle(`Tax invoice ${inv.number}`);
  doc.setAuthor(inv.supplier.name);
  doc.setProducer('invoice-renderer@1');
  doc.setCreator('Valuation Platform');
  doc.setCreationDate(at);
  doc.setModificationDate(at);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // Names and descriptions may contain characters the standard fonts cannot encode.
  const clean = makeSanitiser(regular);
  const page = doc.addPage([595.28, 841.89]);
  let y = 780;
  const line = (text: string, opts: { size?: number; font?: typeof regular; x?: number } = {}) => {
    page.drawText(clean(text), {
      x: opts.x ?? 50,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? regular,
      color: rgb(0.1, 0.1, 0.12),
    });
    y -= (opts.size ?? 10) * 1.6;
  };
  line('TAX INVOICE', { size: 20, font: bold });
  y -= 8;
  line(`${inv.supplier.name}${inv.supplier.abn ? `  ABN ${inv.supplier.abn}` : ''}`, {
    font: bold,
  });
  line(`Invoice ${inv.number}    Date ${formatAustralianDate(inv.issueDate)}`);
  line(`Bill to: ${inv.billTo.name}${inv.billTo.abn ? `  ABN ${inv.billTo.abn}` : ''}`);
  line(`Job ${inv.jobReference}    Report ${inv.reportId}`);
  y -= 12;
  for (const l of inv.lines) {
    page.drawText(clean(l.description), { x: 50, y, size: 10, font: regular });
    const amount = formatAud(l.amountCents / 100, true);
    page.drawText(amount, {
      x: 545 - regular.widthOfTextAtSize(amount, 10),
      y,
      size: 10,
      font: regular,
    });
    y -= 18;
  }
  y -= 8;
  for (const [label, cents, f] of [
    ['Subtotal (excl. GST)', inv.subtotalCents, regular],
    [`GST (${(inv.gstRate * 100).toFixed(0)}%)`, inv.gstCents, regular],
    ['Total (incl. GST)', inv.totalCents, bold],
  ] as const) {
    const amount = formatAud(cents / 100, true);
    page.drawText(label, { x: 330, y, size: 10, font: f });
    page.drawText(amount, { x: 545 - f.widthOfTextAtSize(amount, 10), y, size: 10, font: f });
    y -= 16;
  }
  return doc.save({ useObjectStreams: false });
}
