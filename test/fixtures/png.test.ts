import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, encodeSolidPng } from '../../fixtures/png.js';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Chunk {
  type: string;
  data: Buffer;
  crcOk: boolean;
}

/** Splits a PNG into chunks and checks each stored CRC against the recomputed value. */
function readChunks(png: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('latin1');
    const data = png.subarray(offset + 8, offset + 8 + length);
    const stored = png.readUInt32BE(offset + 8 + length);
    const typeAndData = png.subarray(offset + 4, offset + 8 + length);
    chunks.push({ type, data, crcOk: crc32(typeAndData) === stored });
    offset += 12 + length;
  }
  return chunks;
}

describe('crc32', () => {
  it('matches the standard check value for "123456789"', () => {
    expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926);
  });

  it('returns 0 for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('encodeSolidPng', () => {
  const rgb = [200, 40, 40] as const;

  it('starts with the PNG signature', () => {
    const png = encodeSolidPng(16, 9, rgb);
    expect([...png.subarray(0, 8)]).toEqual(SIGNATURE);
  });

  it('writes width and height into IHDR, as 8-bit RGB', () => {
    const png = encodeSolidPng(160, 90, rgb);
    const [ihdr] = readChunks(png);
    expect(ihdr?.type).toBe('IHDR');
    expect(ihdr?.data.readUInt32BE(0)).toBe(160);
    expect(ihdr?.data.readUInt32BE(4)).toBe(90);
    expect(ihdr?.data[8]).toBe(8); // bit depth
    expect(ihdr?.data[9]).toBe(2); // colour type: truecolour RGB
    expect(ihdr?.data[10]).toBe(0); // compression
    expect(ihdr?.data[11]).toBe(0); // filter method
    expect(ihdr?.data[12]).toBe(0); // no interlace
  });

  it('has IHDR, IDAT and IEND chunks in order, each with a valid CRC', () => {
    const chunks = readChunks(encodeSolidPng(8, 8, rgb));
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    expect(chunks[2]?.data.length).toBe(0);
  });

  it('stores every pixel as the requested colour', () => {
    const width = 5;
    const height = 3;
    const idat = readChunks(encodeSolidPng(width, height, rgb)).find((c) => c.type === 'IDAT');
    const raw = inflateSync(idat?.data ?? Buffer.alloc(0));
    expect(raw.length).toBe(height * (1 + width * 3));
    for (let y = 0; y < height; y++) {
      const row = y * (1 + width * 3);
      expect(raw[row]).toBe(0); // filter type "None" for every scanline
      for (let x = 0; x < width; x++) {
        const px = row + 1 + x * 3;
        expect([raw[px], raw[px + 1], raw[px + 2]]).toEqual([...rgb]);
      }
    }
  });

  it('is deterministic: the same input gives the same bytes', () => {
    const a = encodeSolidPng(160, 90, [40, 80, 200]);
    const b = encodeSolidPng(160, 90, [40, 80, 200]);
    expect(a.equals(b)).toBe(true);
  });

  it('gives different bytes for different colours', () => {
    const a = encodeSolidPng(160, 90, [40, 80, 200]);
    const b = encodeSolidPng(160, 90, [230, 160, 30]);
    expect(a.equals(b)).toBe(false);
  });

  it('rejects dimensions and colours outside the valid range', () => {
    expect(() => encodeSolidPng(0, 9, rgb)).toThrow();
    expect(() => encodeSolidPng(16.5, 9, rgb)).toThrow();
    expect(() => encodeSolidPng(16, 70000, rgb)).toThrow();
    expect(() => encodeSolidPng(16, 9, [256, 0, 0])).toThrow();
  });
});
