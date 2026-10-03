import { describe, expect, it } from 'vitest';
import {
  assessPhotoQuality,
  differenceHash,
  findDuplicatePhotos,
  flagPhotoPrivacy,
  hammingDistanceHex,
  laplacianVariance,
  meanLuminance,
  photoReportEligibility,
  recordConsent,
  recordRedaction,
  rgbaToGray,
  type GrayImage,
  type PhotoRecord,
} from '../src/index.js';

function image(w: number, h: number, f: (x: number, y: number) => number): GrayImage {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data[y * w + x] = Math.max(0, Math.min(255, Math.round(f(x, y))));
  return { width: w, height: h, data };
}

// A sharp checkerboard-like scene and a blurred version of it.
const sharp = image(64, 64, (x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 220 : 40));
function boxBlur(img: GrayImage, r: number): GrayImage {
  return image(img.width, img.height, (x, y) => {
    let s = 0;
    let c = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(img.width - 1, Math.max(0, x + dx));
        const yy = Math.min(img.height - 1, Math.max(0, y + dy));
        s += img.data[yy * img.width + xx]!;
        c++;
      }
    return s / c;
  });
}

describe('photo quality', () => {
  it('converts RGBA to luma', () => {
    const g = rgbaToGray(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
    expect([...g.data]).toEqual([255, 0]);
  });

  it('detects blur by Laplacian variance', () => {
    const blurred = boxBlur(sharp, 3);
    expect(laplacianVariance(sharp)).toBeGreaterThan(laplacianVariance(blurred) * 10);
    expect(assessPhotoQuality(sharp).isBlurry).toBe(false);
    expect(assessPhotoQuality(blurred).isBlurry).toBe(true);
  });

  it('detects low light', () => {
    const dark = image(32, 32, (x, y) => ((x + y) % 2 ? 30 : 10));
    expect(meanLuminance(dark)).toBe(20);
    expect(assessPhotoQuality(dark).isLowLight).toBe(true);
    expect(assessPhotoQuality(sharp).isLowLight).toBe(false);
  });

  it('gives near-identical photos a small hash distance and different photos a large one', () => {
    const gradient = image(64, 48, (x) => x * 4);
    const brighter = image(64, 48, (x) => x * 4 + 10);
    const reversed = image(64, 48, (x) => 255 - x * 4);
    const a = differenceHash(gradient);
    expect(hammingDistanceHex(a, differenceHash(brighter))).toBeLessThanOrEqual(4);
    expect(hammingDistanceHex(a, differenceHash(reversed))).toBeGreaterThan(32);
  });

  it('groups exact and near duplicates', () => {
    const groups = findDuplicatePhotos([
      { id: 'p1', sha256: 'aaa', dHash: 'ffff0000ffff0000' },
      { id: 'p2', sha256: 'aaa', dHash: 'ffff0000ffff0000' },
      { id: 'p3', sha256: 'bbb', dHash: 'ffff0000ffff0001' },
      { id: 'p4', sha256: 'ccc', dHash: '0000ffff0000ffff' },
    ]);
    expect(groups).toEqual([
      { kind: 'exact', ids: ['p1', 'p2'] },
      { kind: 'near', ids: ['p1', 'p3'] },
    ]);
  });
});

describe('photo privacy', () => {
  const photo: PhotoRecord = {
    id: 'p1',
    assetId: 'a1',
    sha256: 'aaa',
    sequence: 1,
    capturedAt: '2026-10-02T00:00:00Z',
    capturedBy: 'inspector1',
    privacyFlags: [],
    privacyStatus: 'clear',
    includeInReport: true,
  };

  it('blocks flagged photos until redacted or consented', () => {
    const flagged = flagPhotoPrivacy(photo, ['number_plate']);
    expect(photoReportEligibility(flagged)).toMatchObject({ eligible: false });
    const redacted = recordRedaction(flagged, 'p1-redacted');
    expect(photoReportEligibility(redacted)).toEqual({
      eligible: true,
      renderId: 'p1-redacted',
      reasons: [],
    });
    expect(
      photoReportEligibility(recordConsent(flagPhotoPrivacy(photo, ['person']), 'consent-form-17'))
        .eligible,
    ).toBe(true);
  });

  it('never releases photos of children on consent alone', () => {
    expect(() => recordConsent(flagPhotoPrivacy(photo, ['child']), 'form')).toThrow(/children/);
  });

  it('requires a reason to include blurry or low-light photos', () => {
    const poor = { ...photo, quality: { isBlurry: true, isLowLight: false } };
    expect(photoReportEligibility(poor).eligible).toBe(false);
    expect(
      photoReportEligibility({
        ...poor,
        qualityOverrideReason: 'Only available view of the plant room',
      }).eligible,
    ).toBe(true);
  });
});
