import { DomainError } from '../core/errors.js';

/** 8-bit greyscale image, row-major. */
export interface GrayImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

function assertImage(img: GrayImage): void {
  if (img.width < 1 || img.height < 1 || img.data.length !== img.width * img.height) {
    throw new DomainError('INVALID_ARGUMENT', 'image data does not match its dimensions');
  }
}

/** Converts RGBA pixels to greyscale using Rec. 601 luma weights. */
export function rgbaToGray(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): GrayImage {
  if (rgba.length !== width * height * 4)
    throw new DomainError('INVALID_ARGUMENT', 'RGBA buffer size mismatch');
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    data[i] = Math.round(
      0.299 * (rgba[o] ?? 0) + 0.587 * (rgba[o + 1] ?? 0) + 0.114 * (rgba[o + 2] ?? 0),
    );
  }
  return { width, height, data };
}

export function meanLuminance(img: GrayImage): number {
  assertImage(img);
  let sum = 0;
  for (const v of img.data) sum += v;
  return sum / img.data.length;
}

/** Variance of the 4-neighbour Laplacian: low values indicate blur. */
export function laplacianVariance(img: GrayImage): number {
  assertImage(img);
  const { width: w, height: h, data } = img;
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        (data[i - 1] ?? 0) +
        (data[i + 1] ?? 0) +
        (data[i - w] ?? 0) +
        (data[i + w] ?? 0) -
        4 * (data[i] ?? 0);
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function resizeArea(img: GrayImage, tw: number, th: number): number[] {
  const out: number[] = [];
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * img.width) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * img.width) / tw));
      const y0 = Math.floor((ty * img.height) / th);
      const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * img.height) / th));
      let s = 0;
      let c = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          s += img.data[y * img.width + x] ?? 0;
          c++;
        }
      }
      out.push(s / c);
    }
  }
  return out;
}

/** 64-bit difference hash (hex). Near-identical photos have a small Hamming distance. */
export function differenceHash(img: GrayImage): string {
  assertImage(img);
  const px = resizeArea(img, 9, 8);
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += (px[y * 9 + x] ?? 0) > (px[y * 9 + x + 1] ?? 0) ? '1' : '0';
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) throw new DomainError('INVALID_ARGUMENT', 'hashes differ in length');
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i] as string, 16) ^ parseInt(b[i] as string, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export interface QualityThresholds {
  /** Mean luminance (0–255) below which a photo is low-light. */
  readonly minLuminance: number;
  /** Laplacian variance below which a photo is blurry (calibrated on a reference set). */
  readonly minSharpness: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = { minLuminance: 50, minSharpness: 60 };

export interface PhotoQuality {
  readonly luminance: number;
  readonly sharpness: number;
  readonly isLowLight: boolean;
  readonly isBlurry: boolean;
  readonly dHash: string;
}

export function assessPhotoQuality(
  img: GrayImage,
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): PhotoQuality {
  const luminance = meanLuminance(img);
  const sharpness = laplacianVariance(img);
  return {
    luminance,
    sharpness,
    isLowLight: luminance < thresholds.minLuminance,
    isBlurry: sharpness < thresholds.minSharpness,
    dHash: differenceHash(img),
  };
}

export interface DuplicateGroup {
  readonly kind: 'exact' | 'near';
  readonly ids: readonly string[];
}

/** Groups exact (same SHA-256) and near (dHash within `maxDistance`) duplicate photos. */
export function findDuplicatePhotos(
  photos: readonly { id: string; sha256: string; dHash?: string }[],
  maxDistance = 4,
): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const bySha = new Map<string, string[]>();
  for (const p of photos) bySha.set(p.sha256, [...(bySha.get(p.sha256) ?? []), p.id]);
  const grouped = new Set<string>();
  for (const ids of bySha.values()) {
    if (ids.length > 1) {
      groups.push({ kind: 'exact', ids });
      ids.slice(1).forEach((id) => grouped.add(id));
    }
  }
  const candidates = photos.filter((p) => p.dHash && !grouped.has(p.id));
  const used = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i] as (typeof candidates)[number];
    if (used.has(a.id)) continue;
    const ids = [a.id];
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j] as (typeof candidates)[number];
      if (used.has(b.id) || a.sha256 === b.sha256) continue;
      if (hammingDistanceHex(a.dHash as string, b.dHash as string) <= maxDistance) {
        ids.push(b.id);
        used.add(b.id);
      }
    }
    if (ids.length > 1) {
      used.add(a.id);
      groups.push({ kind: 'near', ids });
    }
  }
  return groups;
}
