import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import type { StadiumModelChunk } from './stadium-model-transfer';

// Keep the GLB in the native Metro asset graph, then hand its resolved device
// URI to the DOM WebView. Importing the GLB inside a `use dom` module emits a
// relative URL next to the DOM JavaScript even though Expo stores the asset in
// the native assets directory, which makes WKWebView request a missing file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stadiumModelModule = require('../../assets/nrg-stadium.glb');

export interface StadiumModelAssetReference {
  uri: string;
  byteLength: number;
}

const MODEL_CHUNK_BYTE_LENGTH = 192 * 1024;
let pendingModelAsset: Promise<StadiumModelAssetReference> | null = null;

export function loadStadiumModelAsset(): Promise<StadiumModelAssetReference> {
  if (!pendingModelAsset) {
    pendingModelAsset = Asset.loadAsync(stadiumModelModule)
      .then(async ([asset]) => {
        const uri = asset.localUri ?? asset.uri;
        if (!uri) throw new Error('The stadium model has no device asset URI.');
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists || info.isDirectory || info.size <= 0) {
          throw new Error('The stadium model is not available on this device.');
        }
        return { uri, byteLength: info.size };
      })
      .catch((error) => {
        pendingModelAsset = null;
        throw error;
      });
  }

  return pendingModelAsset;
}

export async function readStadiumModelChunk(
  asset: StadiumModelAssetReference,
  position: number,
): Promise<StadiumModelChunk> {
  if (!Number.isSafeInteger(position) || position < 0 || position >= asset.byteLength) {
    throw new Error('The requested stadium model position is invalid.');
  }

  const bytesRead = Math.min(MODEL_CHUNK_BYTE_LENGTH, asset.byteLength - position);
  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
    position,
    length: bytesRead,
  });
  return { base64, bytesRead };
}
