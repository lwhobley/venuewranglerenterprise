/**
 * Splits a single-mesh stadium scan (e.g. a Meshy AI export) into one named
 * mesh per operational zone, so the 3D viewer can raycast, glow, and bind taps
 * to zones by mesh name (see components/stadium-3d/stadium-model-bindings.ts).
 *
 * Triangles are assigned by where their centroid sits in the bowl: normalised
 * elliptical distance from the field centre (the field's long axis runs along
 * Z) and normalised height. Band edges are tuned for the Texans stadium aerial
 * scan; run with --stats to print the distribution before retuning.
 *
 * Usage (from a directory with @gltf-transform/core + functions installed):
 *   node scripts/partition-stadium-glb.mjs <simplified.glb> assets/nrg-stadium.glb [--stats]
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune, quantize, weld } from '@gltf-transform/functions';

const [, , input, output, flag] = process.argv;
if (!input || !output) {
  console.error('usage: partition-stadium-glb.mjs <in.glb> <out.glb> [--stats]');
  process.exit(1);
}

/** Zone meshes, checked in order; the first matching rule claims the triangle. */
const SECTIONS = [
  // The scan is open over the field and its top rim belongs to the upper deck,
  // so there is no roof band. The field is flat at ~5% height inside r 0.4.
  { name: 'Node_Field_GrassTurf', color: [0.11, 0.42, 0.22], test: (r, h) => r < 0.4 && h < 0.12 },
  { name: 'Node_Bowl_100_Lower', color: [0.05, 0.13, 0.22], test: (r) => r < 0.53 },
  { name: 'Node_Bowl_200_Club', color: [0.07, 0.17, 0.29], test: (r) => r < 0.66 },
  { name: 'Node_Suites_300_Balcony', color: [0.83, 0.69, 0.22], test: (r) => r < 0.76 },
  { name: 'Node_Bowl_500_UpperRed', color: [0.54, 0.08, 0.13], test: (r) => r < 0.93 },
  { name: 'Node_Gate_Exterior', color: [0.8, 0.83, 0.86], test: () => true },
];

const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const source = await io.read(input);
const prim = source.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION').getArray();
const nrm = prim.getAttribute('NORMAL')?.getArray();
const idx = prim.getIndices().getArray();

let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i += 3) {
  for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], pos[i + a]);
    max[a] = Math.max(max[a], pos[i + a]);
  }
}
const cx = (min[0] + max[0]) / 2;
const cz = (min[2] + max[2]) / 2;
const ax = (max[0] - min[0]) / 2;
const az = (max[2] - min[2]) / 2;
const hy = max[1] - min[1];

const triCount = idx.length / 3;
const radial = new Float32Array(triCount);
const height = new Float32Array(triCount);
for (let t = 0; t < triCount; t++) {
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 3; k++) {
    const v = idx[t * 3 + k] * 3;
    x += pos[v]; y += pos[v + 1]; z += pos[v + 2];
  }
  x /= 3; y /= 3; z /= 3;
  radial[t] = Math.hypot((x - cx) / ax, (z - cz) / az);
  height[t] = (y - min[1]) / hy;
}

if (flag === '--stats') {
  console.log(`triangles ${triCount}  bounds`, min, max);
  const bins = 20;
  const grid = Array.from({ length: bins }, () => new Array(10).fill(0));
  for (let t = 0; t < triCount; t++) {
    const rb = Math.min(bins - 1, Math.floor(radial[t] * (bins / 1.4)));
    const hb = Math.min(9, Math.floor(height[t] * 10));
    grid[rb][hb]++;
  }
  console.log('rows: radial bin (x0.07), cols: height decile — mean height per radial bin');
  grid.forEach((row, rb) => {
    const n = row.reduce((a, b) => a + b, 0);
    const mean = n ? row.reduce((a, c, i) => a + c * (i + 0.5), 0) / n / 10 : 0;
    console.log(`r ${(rb * 0.07).toFixed(2)}  n=${String(n).padStart(7)}  meanH=${mean.toFixed(2)}  ${row.join(' ')}`);
  });
  process.exit(0);
}

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Stadium');
const assignment = new Uint8Array(triCount);
for (let t = 0; t < triCount; t++) {
  assignment[t] = SECTIONS.findIndex((s) => s.test(radial[t], height[t]));
}

SECTIONS.forEach((section, s) => {
  const remap = new Map();
  const outPos = [];
  const outNrm = [];
  const outIdx = [];
  for (let t = 0; t < triCount; t++) {
    if (assignment[t] !== s) continue;
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      let n = remap.get(v);
      if (n === undefined) {
        n = remap.size;
        remap.set(v, n);
        outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        if (nrm) outNrm.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
      }
      outIdx.push(n);
    }
  }
  if (!outIdx.length) return;
  const p = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(outPos)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR')
      .setArray(remap.size > 65535 ? new Uint32Array(outIdx) : new Uint16Array(outIdx)).setBuffer(buffer))
    .setMaterial(doc.createMaterial(section.name.replace(/^Node_/, 'Mat_'))
      .setBaseColorFactor([...section.color, 1]).setRoughnessFactor(0.7).setMetallicFactor(0.1));
  if (nrm) p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(outNrm)).setBuffer(buffer));
  const mesh = doc.createMesh(section.name).addPrimitive(p);
  scene.addChild(doc.createNode(section.name).setMesh(mesh));
  console.log(`${section.name.padEnd(26)} ${String(outIdx.length / 3).padStart(8)} tris ${String(remap.size).padStart(8)} verts`);
});

await doc.transform(weld(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10 }));
await io.write(output, doc);
