export interface StadiumModelChunk {
  base64: string;
  bytesRead: number;
}

export type ReadStadiumModelChunk = (position: number) => Promise<StadiumModelChunk>;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function readModelBytes(
  byteLength: number,
  readChunk: ReadStadiumModelChunk,
  onProgress?: (progressPercent: number) => void,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new Error('The stadium model byte length is invalid.');
  }

  const modelBytes = new Uint8Array(byteLength);
  let position = 0;

  while (position < byteLength) {
    const chunk = await readChunk(position);
    if (!Number.isSafeInteger(chunk.bytesRead) || chunk.bytesRead <= 0) {
      throw new Error('The stadium model ended before all bytes were read.');
    }

    const decoded = decodeBase64(chunk.base64);
    if (decoded.length !== chunk.bytesRead) {
      throw new Error('The stadium model chunk was corrupted during transfer.');
    }
    if (position + decoded.length > byteLength) {
      throw new Error('The stadium model exceeded its expected byte length.');
    }

    modelBytes.set(decoded, position);
    position += decoded.length;
    onProgress?.(Math.round((position / byteLength) * 100));
  }

  return modelBytes;
}
