'use dom';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { findZoneByMeshName } from './stadium-model-bindings';
import { applyHighlights, disposeScene, isolateMaterials } from './scene-resources';
import { computeCameraFraming, type ModelBounds } from './camera-framing';
import { createLoadCompletionGate, getRenderableViewport } from './stadium-render-lifecycle';
import type { CameraPresetId, OperationalHighlightStatus, Stadium3DCanvasProps } from './stadium-3d.types';

// Asset reference bundled by Metro
// @ts-ignore
import nrgStadiumGlbAsset from '../../assets/nrg-stadium.glb';

function StadiumScene({
  selectedZoneId,
  highlightedZones,
  cameraPreset = 'overview',
  autoRotate = false,
  resetToken = 0,
  active = true,
  reducedMotion = false,
  onSelectZone,
  onLoadProgress,
  onLoadComplete,
  onLoadError,
}: Stadium3DCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Refs to synchronize with Three.js animation loop without re-triggering effect
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRootRef = useRef<THREE.Group | null>(null);

  // Target camera position and look-at vector for smooth lerp transitions
  const targetCamPosRef = useRef<THREE.Vector3>(new THREE.Vector3(28, 24, 36));
  const targetCamLookRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 2, 0));

  // Real bounds of the loaded model, filled once geometry exists. Framing is
  // derived from these rather than from hardcoded preset coordinates.
  const modelBoundsRef = useRef<ModelBounds | null>(null);
  const presetRef = useRef<CameraPresetId>(cameraPreset);
  presetRef.current = cameraPreset;
  const frameToPresetRef = useRef<() => void>(() => undefined);

  const transitioning = useRef(true);
  const needsRender = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const onSelectRef = useRef(onSelectZone);
  onSelectRef.current = onSelectZone;

  // Current props mirror refs
  const selectedZoneIdRef = useRef<string | null>(selectedZoneId);
  selectedZoneIdRef.current = selectedZoneId;

  const highlightedZonesRef = useRef<Record<string, OperationalHighlightStatus>>(highlightedZones);
  highlightedZonesRef.current = highlightedZones;

  const autoRotateRef = useRef<boolean>(autoRotate);
  autoRotateRef.current = autoRotate;

  useEffect(() => {
    if (active) needsRender.current = true;
  }, [active]);

  // Track pointer for tap vs drag detection
  const pointerDownPosRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });

  // Re-frame whenever the preset changes or the user resets the camera.
  useEffect(() => {
    frameToPresetRef.current();
  }, [cameraPreset, resetToken]);

  // Main Scene Setup
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let failed = false;
    let hasRenderableSize = false;
    const loadCompletionGate = createLoadCompletionGate(onLoadComplete);
    const fail = (message = 'The 3D renderer stopped. Retry or open the Operations Map.') => {
      if (disposed || failed) return;
      failed = true;
      onLoadError?.(message);
    };

    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);

    // 1. Scene & Environment
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#060D15');
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
    camera.position.set(28, 24, 36);
    cameraRef.current = camera;

    // 3. Renderer
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      onLoadError?.(`WebGL initialization failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Capped below the device ratio: 2x on a 3x phone already quadruples the
    // fragment cost, and this scene is read at arm's length on a handset.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The uploaded GLB is the visual source of truth. Avoid cinematic color
    // grading and shadows that would repaint or reshape its authored look.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = false;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    // One finger orbits, a pinch zooms. Panning is off so the stadium cannot be
    // dragged out of a phone-sized viewport; presets and reset re-frame it.
    controls.enableRotate = true;
    controls.rotateSpeed = 0.8;
    controls.enablePan = false;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.minDistance = 10;
    controls.maxDistance = 120;
    controls.minPolarAngle = 0.1;
    controls.maxPolarAngle = Math.PI * 0.48; // Prevent dipping below ground
    controls.target.set(0, 2, 0);
    controlsRef.current = controls;

    // Derives camera placement from the model's real bounds and the current
    // aspect. Until geometry exists there is nothing to frame, so this no-ops
    // and is re-run by captureModelBounds() once the model is in the scene.
    const frameToPreset = () => {
      const bounds = modelBoundsRef.current;
      if (!bounds) return;
      const framing = computeCameraFraming(presetRef.current, bounds, camera.fov, camera.aspect);
      targetCamPosRef.current.set(...framing.position);
      targetCamLookRef.current.set(...framing.target);
      controls.minDistance = framing.minDistance;
      controls.maxDistance = framing.maxDistance;
      transitioning.current = true;
      needsRender.current = true;
    };
    frameToPresetRef.current = frameToPreset;

    const captureModelBounds = (root: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      modelBoundsRef.current = {
        center: [sphere.center.x, sphere.center.y, sphere.center.z],
        radius: sphere.radius,
        minY: box.min.y,
        height: box.max.y - box.min.y,
      };
      frameToPreset();
    };

    // The source file has no embedded lights, so use a neutral studio rig.
    // White-only illumination reveals the source material without tinting it.
    scene.add(new THREE.HemisphereLight('#FFFFFF', '#555555', 2));
    const keyLight = new THREE.DirectionalLight('#FFFFFF', 2.5);
    keyLight.position.set(24, 42, 28);
    scene.add(keyLight);

    // 6. Load the uploaded GLB. Never replace a slow or failed download with a
    // synthetic stadium: users must see this asset or an honest load error.
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelRootRef.current = modelGroup;

    const assetUri =
      typeof nrgStadiumGlbAsset === 'string'
        ? nrgStadiumGlbAsset
        : (nrgStadiumGlbAsset?.uri || nrgStadiumGlbAsset?.default || '');

    const loader = new GLTFLoader();
    let hasModelLoaded = false;

    if (assetUri) {
      loader.load(
        assetUri,
        (gltf) => {
          if (disposed || failed || hasModelLoaded) { disposeScene(gltf.scene); return; }
          hasModelLoaded = true;
          try {

          // Auto-scale and center the loaded model
          const bbox = new THREE.Box3().setFromObject(gltf.scene);
          const size = bbox.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const targetScale = maxDim > 0 ? 36 / maxDim : 1;
          gltf.scene.scale.set(targetScale, targetScale, targetScale);

          // Center at ground level
          const center = bbox.getCenter(new THREE.Vector3());
          gltf.scene.position.set(-center.x * targetScale, -bbox.min.y * targetScale, -center.z * targetScale);

          // Clone only selectable materials so glow remains a reversible
          // overlay; base geometry and material values remain asset-authored.
          isolateMaterials(gltf.scene);
          modelGroup.add(gltf.scene);
          captureModelBounds(modelGroup);
          applyHighlights(modelGroup, selectedZoneIdRef.current, highlightedZonesRef.current);
          needsRender.current = true;
          onLoadProgress?.(100);
          loadCompletionGate.markModelReady();
          } catch { disposeScene(gltf.scene); fail(); }
        },
        (xhr) => {
          if (!disposed && !failed && !hasModelLoaded && xhr.lengthComputable && xhr.total > 0) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            onLoadProgress?.(percent);
          }
        },
        (error) => {
          const detail = error instanceof Error ? `: ${error.message}` : '';
          fail(`The uploaded stadium model could not be loaded${detail}`);
        }
      );
    } else {
      fail('The uploaded stadium model is missing from this build.');
    }

    // 7. Tap / Raycasting Detection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handlePointerDown = (e: PointerEvent) => {
      transitioning.current = false;
      if (!e.isPrimary) { pointerDownPosRef.current.time = -Infinity; return; }
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY, time: performance.now() };
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      const down = pointerDownPosRef.current;
      const dx = Math.abs(e.clientX - down.x);
      const dy = Math.abs(e.clientY - down.y);
      const duration = performance.now() - down.time;

      // Only treat as tap if pointer barely moved (<6px) and released quickly (<350ms)
      if (dx < 6 && dy < 6 && duration < 350) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.intersectObjects(modelGroup.children, true);

        if (intersects.length > 0) {
          for (const hit of intersects) {
            const hitName = hit.object.name;
            const binding = findZoneByMeshName(hitName);
            if (binding) {
              onSelectRef.current(binding.zoneId);
              break;
            }
          }
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    const stopTransition = () => { transitioning.current = false; };
    controls.addEventListener('start', stopTransition);
    const contextLost = (event: Event) => { event.preventDefault(); fail(); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    // Only treat an error as a renderer failure when it actually originates in
    // the 3D stack. A global handler tore the scene down for unrelated errors
    // elsewhere in the WebView, turning a working view into a false failure.
    const isRendererError = (value: unknown): boolean => {
      const message = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? '');
      return /webgl|three|gltf|glb|context lost|out of memory/i.test(message);
    };
    const onWindowError = (event: ErrorEvent) => { if (isRendererError(event.error ?? event.message)) fail(); };
    const onRejection = (event: PromiseRejectionEvent) => { if (isRendererError(event.reason)) fail(); };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onRejection);

    // 8. Resize Observer
    const handleResize = () => {
      if (!hostRef.current || !rendererRef.current || !cameraRef.current) return;
      // WKWebView can mount the DOM root one layout pass before its percentage
      // height resolves. Falling back to the WebView viewport prevents that
      // transient 0x0 measurement from permanently suppressing every frame.
      const viewport = getRenderableViewport(
        hostRef.current.clientWidth,
        hostRef.current.clientHeight,
        window.innerWidth,
        window.innerHeight,
      );
      hasRenderableSize = viewport !== null;
      if (!viewport) return;
      rendererRef.current.setSize(viewport.width, viewport.height, false);
      needsRender.current = true;
      cameraRef.current.aspect = viewport.width / viewport.height;
      cameraRef.current.updateProjectionMatrix();
      // Aspect changes what fits, so re-derive the framing.
      frameToPresetRef.current();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(host);
    handleResize();

    // 9. Animation Render Loop
    let animationFrame = 0;
    let lastGlowUpdate = 0;

    const animate = () => {
      if (disposed || failed) return;
      if (activeRef.current && hasRenderableSize) {
        try {
        // Subtle auto-rotation when enabled and user not interacting
        if (autoRotateRef.current && !reducedMotionRef.current && !transitioning.current) {
          controls.autoRotate = true;
          controls.autoRotateSpeed = 0.8;
        } else {
          controls.autoRotate = false;
        }

        const changed = controls.update();
        const moving = transitioning.current;

        // Pulse only the selected stadium area. Emissive lighting makes the
        // bound suite, club, seating, concession, or service geometry glow
        // without adding an expensive post-processing pass on mobile GPUs.
        const selectedZone = selectedZoneIdRef.current;
        const now = performance.now();
        const shouldUpdateGlow = Boolean(selectedZone) && !reducedMotionRef.current && now - lastGlowUpdate >= 33;
        if (shouldUpdateGlow && modelRootRef.current) {
          const pulse = 0.86 + ((Math.sin(now * 0.004) + 1) / 2) * 0.42;
          applyHighlights(modelRootRef.current, selectedZone, highlightedZonesRef.current, pulse);
          lastGlowUpdate = now;
          needsRender.current = true;
        }

        // Smoothly interpolate camera towards target preset
        if (transitioning.current) {
          const amount = reducedMotionRef.current ? 1 : 0.12;
          camera.position.lerp(targetCamPosRef.current, amount);
          controls.target.lerp(targetCamLookRef.current, amount);
          camera.lookAt(controls.target);
          if (camera.position.distanceTo(targetCamPosRef.current) < 0.02 && controls.target.distanceTo(targetCamLookRef.current) < 0.02) transitioning.current = false;
        }

        if (changed || moving || needsRender.current) {
          renderer.render(scene, camera);
          needsRender.current = false;
          loadCompletionGate.reportRenderedFrame();
        }
        } catch { fail(); return; }
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animate();

    // 10. Resource Cleanup on Unmount
    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onRejection);
      controls.removeEventListener('start', stopTransition);
      controls.dispose();

      // Dispose geometries and materials
      disposeScene(scene);

      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Update dynamic zone highlights when highlightedZones or selectedZoneId changes
  useEffect(() => {
    const modelGroup = modelRootRef.current;
    if (!modelGroup) return;

    applyHighlights(modelGroup, selectedZoneId, highlightedZones);
    needsRender.current = true;
  }, [selectedZoneId, highlightedZones]);

  return (
    <div
      ref={hostRef}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        minHeight: 0,
        backgroundColor: '#060D15',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    />
  );
}

class CanvasBoundary extends React.Component<React.PropsWithChildren<{ onError?: (message: string) => void }>, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError?.('The stadium scene could not initialize. Open the Operations Map or retry.'); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function Stadium3DCanvas(props: Stadium3DCanvasProps) {
  return <CanvasBoundary onError={props.onLoadError}><StadiumScene {...props} /></CanvasBoundary>;
}
