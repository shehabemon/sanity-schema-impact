import { deflateSync } from 'node:zlib';

// Pure PNG encoder for fixture images. No I/O. Only node:zlib is used, for DEFLATE.
// The CRC-32 and chunk layout are written out by hand, as the PNG spec describes them.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_DIMENSION = 0xffff;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as used by PNG chunks. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'latin1');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return out;
}

function assertInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max} (got ${value})`);
  }
}

/**
 * Encodes a solid-colour 8-bit RGB PNG. Every scanline uses filter type 0 (None),
 * so the output depends only on the inputs and the zlib version.
 */
export function encodeSolidPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Buffer {
  assertInteger('width', width, 1, MAX_DIMENSION);
  assertInteger('height', height, 1, MAX_DIMENSION);
  for (const [i, channel] of rgb.entries()) assertInteger(`rgb[${i}]`, channel, 0, 255);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression method: deflate
  ihdr[11] = 0; // filter method: adaptive (per-row type bytes)
  ihdr[12] = 0; // interlace: none

  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes;
    raw[row] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const px = row + 1 + x * 3;
      raw[px] = rgb[0];
      raw[px + 1] = rgb[1];
      raw[px + 2] = rgb[2];
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
