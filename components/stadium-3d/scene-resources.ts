import * as THREE from 'three';
import { findZoneByMeshName, getHighlightColor } from './stadium-model-bindings';
import type { OperationalHighlightStatus } from './stadium-3d.types';

/**
 * Clones materials so highlighting never mutates a material shared with other
 * meshes. Only meshes that can actually be highlighted are isolated: cloning
 * all of them turned 15 shared materials into ~94 unique ones and cost GPU
 * state changes for geometry that never changes colour.
 */
export function isolateMaterials(root: THREE.Object3D) {
  const originals = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!findZoneByMeshName(mesh.name)) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) originals.add(material);
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => material.clone()) : mesh.material.clone();
  });
  // Only dispose an original that no remaining mesh still references, otherwise
  // an un-isolated mesh sharing that material would lose its GPU program.
  const stillInUse = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) stillInUse.add(material);
  });
  originals.forEach((material) => { if (!stillInUse.has(material)) material.dispose(); });
}

export function applyHighlights(
  root: THREE.Object3D,
  selectedId: string | null,
  states: Record<string, OperationalHighlightStatus>,
  selectedPulse = 1,
) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const binding = findZoneByMeshName(mesh.name);
    if (!binding) return;
    const operational = states[binding.zoneId] ?? 'normal';
    const isSelected = selectedId === binding.zoneId;
    const status = isSelected && !['critical', 'attention'].includes(operational)
      ? 'selected' : operational;
    const color = getHighlightColor(status);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.isMeshStandardMaterial) {
        standard.emissive.set(color.emissiveColor);
        // Selection must remain obvious even when the zone keeps its critical
        // or attention colour. The canvas varies selectedPulse to create the
        // glow; unselected operational lighting stays completely stable.
        standard.emissiveIntensity = isSelected
          ? Math.max(color.intensity, 1.3) * selectedPulse
          : color.intensity;
      }
    }
  });
}

export function disposeScene(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
}
