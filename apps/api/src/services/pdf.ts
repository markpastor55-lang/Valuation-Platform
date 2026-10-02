import type { Point, RenderBlock, ReportModel } from '@vp/domain';
import { centroid } from '@vp/domain';
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';

/** Bumped whenever rendering output changes; stored in issue snapshots. */
export const RENDERER_VERSION = 'pdf-renderer@1';

export interface SketchDrawing {
  readonly boundaries: readonly {
    readonly points: readonly Point[];
    readonly label: string;
    readonly role: 'component' | 'deduction';
    readonly level: string;
  }[];
  /** Multiplier from stored units to metres (1 for in-app sketches). */
  readonly metresPerUnit: number;
  readonly northBearingDeg?: number;
  readonly scaleStatus: string;
}

export interface RenderAssets {
  readonly sketches: Readonly<Record<string, SketchDrawing>>;
  readonly photos: Readonly<Record<string, { readonly sha256: string; readonly caption: string }>>;
  readonly mapPoints: readonly {
    readonly label: string;
    readonly lat: number;
    readonly lng: number;
  }[];
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const BOTTOM = 60;
const WIDTH = A4[0] - MARGIN * 2;
const GREY = rgb(0.4, 0.4, 0.4);
const LIGHT = rgb(0.93, 0.94, 0.96);
const BLACK = rgb(0.1, 0.1, 0.12);

function hexToRgb(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Fonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly italic: PDFFont;
}

/** Replaces characters the standard (WinAnsi) fonts cannot encode. */
function makeSanitiser(font: PDFFont): (s: string) => string {
  const cache = new Map<string, string>();
  const replacements: Record<string, string> = {
    '≥': '>=',
    '≤': '<=',
    '×': 'x',
    '÷': '/',
    '→': '->',
    '\t': ' ',
  };
  return (s) =>
    Array.from(s)
      .map((ch) => {
        const hit = cache.get(ch);
        if (hit !== undefined) return hit;
        let out = replacements[ch] ?? ch;
        try {
          font.encodeText(out);
        } catch {
          out = '?';
        }
        cache.set(ch, out);
        return out;
      })
      .join('');
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // hard-break words longer than the column
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

class Layout {
  page!: PDFPage;
  y = 0;
  readonly pages: PDFPage[] = [];

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly clean: (s: string) => string,
    readonly accent: RGB,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - MARGIN - 10;
  }

  ensure(height: number): void {
    if (this.y - height < BOTTOM) this.newPage();
  }

  text(
    s: string,
    opts: {
      font?: PDFFont;
      size?: number;
      color?: RGB;
      indent?: number;
      width?: number;
      gapAfter?: number;
    } = {},
  ): void {
    const font = opts.font ?? this.fonts.regular;
    const size = opts.size ?? 9.5;
    const lh = size * 1.35;
    const width = opts.width ?? WIDTH - (opts.indent ?? 0);
    for (const line of wrap(this.clean(s), font, size, width)) {
      this.ensure(lh);
      this.page.drawText(line, {
        x: MARGIN + (opts.indent ?? 0),
        y: this.y - size,
        size,
        font,
        color: opts.color ?? BLACK,
      });
      this.y -= lh;
    }
    this.y -= opts.gapAfter ?? 4;
  }

  heading(s: string, level: 1 | 2 | 3): void {
    const size = level === 1 ? 15 : level === 2 ? 12.5 : 10.5;
    this.ensure(size * 3);
    this.y -= level === 1 ? 6 : 4;
    this.text(s, { font: this.fonts.bold, size, color: this.accent, gapAfter: 2 });
    if (level === 1) {
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 2 },
        end: { x: MARGIN + WIDTH, y: this.y + 2 },
        thickness: 0.8,
        color: this.accent,
      });
      this.y -= 6;
    }
  }

  keyValue(rows: readonly (readonly [string, string])[], title?: string): void {
    if (title) this.heading(title, 3);
    const size = 9;
    const lh = size * 1.35;
    const labelW = WIDTH * 0.34;
    const valueW = WIDTH - labelW - 8;
    for (const [label, value] of rows) {
      const l = wrap(this.clean(label), this.fonts.bold, size, labelW);
      const v = wrap(this.clean(value), this.fonts.regular, size, valueW);
      const h = Math.max(l.length, v.length) * lh + 4;
      this.ensure(h);
      l.forEach((line, i) => {
        this.page.drawText(line, {
          x: MARGIN,
          y: this.y - size - i * lh,
          size,
          font: this.fonts.bold,
          color: BLACK,
        });
      });
      v.forEach((line, i) => {
        this.page.drawText(line, {
          x: MARGIN + labelW + 8,
          y: this.y - size - i * lh,
          size,
          font: this.fonts.regular,
          color: BLACK,
        });
      });
      this.y -= h;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 2 },
        end: { x: MARGIN + WIDTH, y: this.y + 2 },
        thickness: 0.3,
        color: LIGHT,
      });
    }
    this.y -= 6;
  }

  table(
    columns: readonly string[],
    rows: readonly (readonly string[])[],
    title?: string,
    note?: string,
  ): void {
    if (title) this.heading(title, 3);
    const size = 7.2;
    const lh = size * 1.3;
    const pad = 3;
    // column widths proportional to the longest content (bounded), so text-heavy columns get room
    const weights = columns.map((c, i) => {
      const longest = Math.max(c.length, ...rows.map((r) => (r[i] ?? '').length));
      return Math.min(Math.max(longest, 6), 60);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * WIDTH);
    const drawRow = (cells: readonly string[], header: boolean): void => {
      const font = header ? this.fonts.bold : this.fonts.regular;
      const wrapped = columns.map((_, i) =>
        wrap(this.clean(cells[i] ?? ''), font, size, (widths[i] ?? 20) - pad * 2),
      );
      const h = Math.max(...wrapped.map((w) => w.length)) * lh + pad * 2;
      if (this.y - h < BOTTOM) {
        this.newPage();
        if (!header) drawRow(columns, true);
      }
      if (header)
        this.page.drawRectangle({
          x: MARGIN,
          y: this.y - h,
          width: WIDTH,
          height: h,
          color: LIGHT,
        });
      let x = MARGIN;
      wrapped.forEach((lines, i) => {
        lines.forEach((line, j) => {
          this.page.drawText(line, {
            x: x + pad,
            y: this.y - pad - size - j * lh,
            size,
            font,
            color: BLACK,
          });
        });
        x += widths[i] ?? 0;
      });
      this.y -= h;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: MARGIN + WIDTH, y: this.y },
        thickness: 0.3,
        color: GREY,
      });
    };
    this.ensure(lh * 4);
    drawRow(columns, true);
    for (const r of rows) drawRow(r, false);
    this.y -= 4;
    if (note) this.text(note, { font: this.fonts.italic, size: 7.5, color: GREY });
    this.y -= 4;
  }

  box(
    height: number,
    draw: (x: number, y: number, w: number, h: number) => void,
    caption: string,
  ): void {
    this.ensure(height + 24);
    const top = this.y;
    this.page.drawRectangle({
      x: MARGIN,
      y: top - height,
      width: WIDTH,
      height,
      borderColor: GREY,
      borderWidth: 0.5,
    });
    draw(MARGIN, top - height, WIDTH, height);
    this.y = top - height - 4;
    this.text(caption, { font: this.fonts.italic, size: 8, color: GREY, gapAfter: 8 });
  }
}

function drawSketch(
  layout: Layout,
  sketch: SketchDrawing,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const pts = sketch.boundaries.flatMap((b) =>
    b.points.map((p) => ({ x: p.x * sketch.metresPerUnit, y: p.y * sketch.metresPerUnit })),
  );
  if (!pts.length) return;
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const pad = 24;
  const scale = Math.min(
    (w - pad * 2) / Math.max(maxX - minX, 1e-6),
    (h - pad * 2) / Math.max(maxY - minY, 1e-6),
  );
  const tx = (p: Point) => ({
    x: x + pad + (p.x * sketch.metresPerUnit - minX) * scale,
    y: y + pad + (p.y * sketch.metresPerUnit - minY) * scale,
  });
  const levels = [...new Set(sketch.boundaries.map((b) => b.level))];
  const palette = [
    rgb(0.85, 0.9, 0.97),
    rgb(0.9, 0.95, 0.88),
    rgb(0.97, 0.92, 0.85),
    rgb(0.93, 0.88, 0.95),
  ];
  for (const b of sketch.boundaries) {
    const screen = b.points.map(tx);
    const path =
      screen
        .map(
          (p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x - x).toFixed(2)} ${(-(p.y - y - h)).toFixed(2)}`,
        )
        .join(' ') + ' Z';
    const fill =
      b.role === 'deduction'
        ? rgb(1, 1, 1)
        : (palette[levels.indexOf(b.level) % palette.length] ?? LIGHT);
    layout.page.drawSvgPath(path, {
      x,
      y: y + h,
      color: fill,
      borderColor: b.role === 'deduction' ? GREY : BLACK,
      borderWidth: b.role === 'deduction' ? 0.6 : 0.9,
      ...(b.role === 'deduction' ? { borderDashArray: [3, 2] } : {}),
    });
    const c = tx(centroid(b.points));
    const label = layout.clean(b.label);
    const lw = layout.fonts.regular.widthOfTextAtSize(label, 7);
    layout.page.drawText(label, {
      x: c.x - lw / 2,
      y: c.y - 3,
      size: 7,
      font: layout.fonts.regular,
      color: BLACK,
    });
  }
  if (sketch.northBearingDeg !== undefined) {
    const cx = x + w - 22;
    const cy = y + h - 30;
    const rad = (sketch.northBearingDeg * Math.PI) / 180;
    layout.page.drawLine({
      start: { x: cx, y: cy },
      end: { x: cx + 14 * Math.sin(rad), y: cy + 14 * Math.cos(rad) },
      thickness: 1.2,
      color: BLACK,
    });
    layout.page.drawText('N', {
      x: cx + 18 * Math.sin(rad) - 3,
      y: cy + 18 * Math.cos(rad),
      size: 8,
      font: layout.fonts.bold,
      color: BLACK,
    });
  }
  layout.page.drawText(
    layout.clean(
      `Scale status: ${sketch.scaleStatus}. Levels: ${levels.join(', ')}. Dashed outlines are deductions.`,
    ),
    {
      x: x + 6,
      y: y + 6,
      size: 6.5,
      font: layout.fonts.italic,
      color: GREY,
    },
  );
}

function renderBlock(layout: Layout, block: RenderBlock, assets: RenderAssets): void {
  switch (block.kind) {
    case 'heading':
      layout.heading(block.text, block.level);
      return;
    case 'paragraph':
      layout.text(block.text, {
        font: block.style === 'normal' ? layout.fonts.regular : layout.fonts.italic,
        color: block.style === 'normal' ? BLACK : GREY,
        size: block.style === 'note' ? 8 : 9.5,
      });
      return;
    case 'key_value':
      layout.keyValue(block.rows, block.title);
      return;
    case 'table':
      layout.table(block.columns, block.rows, block.title, block.note);
      return;
    case 'page_break':
      layout.newPage();
      return;
    case 'image': {
      if (block.ref.type === 'sketch') {
        const sketch = assets.sketches[block.ref.id];
        layout.box(
          260,
          (x, y, w, h) => {
            if (sketch) drawSketch(layout, sketch, x, y, w, h);
          },
          block.caption,
        );
      } else if (block.ref.type === 'photo') {
        const photo = assets.photos[block.ref.id];
        layout.box(
          110,
          (x, y, w, h) => {
            layout.page.drawRectangle({
              x: x + 4,
              y: y + 4,
              width: w - 8,
              height: h - 8,
              color: LIGHT,
            });
            layout.page.drawText(
              layout.clean(`Photograph ${block.ref.id} — retained in the evidence store`),
              { x: x + 12, y: y + h / 2 + 4, size: 8, font: layout.fonts.bold, color: GREY },
            );
            layout.page.drawText(layout.clean(`SHA-256 ${photo?.sha256 ?? 'unknown'}`), {
              x: x + 12,
              y: y + h / 2 - 10,
              size: 6.5,
              font: layout.fonts.regular,
              color: GREY,
            });
          },
          block.caption,
        );
      } else {
        layout.box(
          70,
          (x, y, _w, h) => {
            assets.mapPoints.slice(0, 4).forEach((p, i) => {
              layout.page.drawText(
                layout.clean(`${p.label}: ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`),
                {
                  x: x + 10,
                  y: y + h - 16 - i * 11,
                  size: 7.5,
                  font: layout.fonts.regular,
                  color: BLACK,
                },
              );
            });
          },
          `${block.caption}. Map imagery is not embedded unless the provider licence permits reproduction.`,
        );
      }
      return;
    }
  }
}

/**
 * Renders a composed report deterministically: identical model, assets and issue time always
 * produce identical bytes (fixed metadata, standard fonts, no random identifiers).
 */
export async function renderReportPdf(
  model: ReportModel,
  assets: RenderAssets,
  renderedAt: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const at = new Date(renderedAt);
  doc.setTitle(`${model.meta.title} — ${model.meta.reportId} v${model.meta.version}`, {
    showInWindowTitleBar: true,
  });
  doc.setAuthor(model.meta.firmName);
  doc.setSubject(model.meta.subtitle);
  doc.setProducer(RENDERER_VERSION);
  doc.setCreator('Valuation Platform');
  doc.setCreationDate(at);
  doc.setModificationDate(at);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const accent = hexToRgb(model.meta.primaryColour);
  const layout = new Layout(doc, fonts, makeSanitiser(fonts.regular), accent);

  // Cover
  layout.y -= 120;
  layout.text(model.meta.firmName, { font: fonts.bold, size: 13, color: accent, gapAfter: 30 });
  layout.text(model.meta.title, { font: fonts.bold, size: 24, gapAfter: 10 });
  layout.text(model.meta.subtitle, { size: 12, color: GREY, gapAfter: 30 });
  layout.keyValue([
    ['Report', `${model.meta.reportId} (version ${model.meta.version})`],
    ['Status', model.meta.status === 'final' ? 'Final' : 'Draft — not for reliance'],
    ['Template', `${model.meta.templateId} v${model.meta.templateVersion}`],
    ['Rule set', model.meta.ruleSet],
    ...(model.meta.snapshotHash ? [['Snapshot', model.meta.snapshotHash] as [string, string]] : []),
  ]);

  for (const section of model.sections) {
    layout.newPage();
    layout.heading(section.title, 1);
    for (const block of section.blocks) renderBlock(layout, block, assets);
  }

  const total = layout.pages.length;
  const watermark = layout.clean(model.meta.watermark);
  const footer = layout.clean(model.meta.footer);
  layout.pages.forEach((page, i) => {
    page.drawText(watermark, {
      x: 90,
      y: 230,
      size: 34,
      font: fonts.bold,
      color: accent,
      opacity: 0.09,
      rotate: degrees(40),
    });
    const footerLines = wrap(footer, fonts.regular, 7, WIDTH - 60);
    footerLines.slice(0, 2).forEach((line, j) => {
      page.drawText(line, { x: MARGIN, y: 34 - j * 9, size: 7, font: fonts.regular, color: GREY });
    });
    const label = `Page ${i + 1} of ${total}`;
    page.drawText(label, {
      x: MARGIN + WIDTH - fonts.regular.widthOfTextAtSize(label, 7),
      y: 34,
      size: 7,
      font: fonts.regular,
      color: GREY,
    });
    if (i > 0)
      page.drawText(layout.clean(model.meta.firmName), {
        x: MARGIN,
        y: A4[1] - 34,
        size: 7,
        font: fonts.regular,
        color: GREY,
      });
  });

  return doc.save({ useObjectStreams: false });
}
