// Pure definitions for the fixture image assets. No I/O.

export const FIXTURE_IMAGE_WIDTH = 160;
export const FIXTURE_IMAGE_HEIGHT = 90;

export interface FixtureImage {
  filename: string;
  rgb: readonly [number, number, number];
}

/** Four small solid-colour PNGs. Seed uploads them and gets content-hashed asset IDs back. */
export const FIXTURE_IMAGES: readonly FixtureImage[] = [
  { filename: 'fixture-red.png', rgb: [200, 40, 40] },
  { filename: 'fixture-blue.png', rgb: [40, 80, 200] },
  { filename: 'fixture-green.png', rgb: [40, 160, 90] },
  { filename: 'fixture-amber.png', rgb: [230, 160, 30] },
];

/**
 * Obviously fake asset IDs for `--dry-run`. They are never sent to Sanity. A real run
 * uses the IDs returned by client.assets.upload instead.
 */
export function placeholderAssetIds(): string[] {
  return FIXTURE_IMAGES.map(
    (_, i) =>
      `image-dry-run-${String(i + 1)}-${String(FIXTURE_IMAGE_WIDTH)}x${String(FIXTURE_IMAGE_HEIGHT)}-png`,
  );
}
