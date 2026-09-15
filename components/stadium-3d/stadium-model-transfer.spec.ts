import { describe, expect, it, vi } from 'vitest';
import { readModelBytes } from './stadium-model-transfer';

describe('readModelBytes', () => {
  it('reassembles bounded native chunks into the original model bytes', async () => {
    const source = Uint8Array.from({ length: 19 }, (_, index) => index * 7);
    const readChunk = vi.fn(async (position: number) => {
      const bytes = source.slice(position, position + 6);
      return {
        base64: Buffer.from(bytes).toString('base64'),
        bytesRead: bytes.length,
      };
    });

    const progress: number[] = [];
    const result = await readModelBytes(source.length, readChunk, (value) => progress.push(value));

    expect(Array.from(result)).toEqual(Array.from(source));
    expect(readChunk.mock.calls.map(([position]) => position)).toEqual([0, 6, 12, 18]);
    expect(progress.at(-1)).toBe(100);
  });

  it('rejects an empty chunk before the expected byte length', async () => {
    await expect(
      readModelBytes(10, async () => ({ base64: '', bytesRead: 0 }))
    ).rejects.toThrow('ended before all bytes were read');
  });
});
