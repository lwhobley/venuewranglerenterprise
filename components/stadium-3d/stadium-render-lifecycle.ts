export function getRenderableViewport(
  width: number,
  height: number,
  fallbackWidth?: number,
  fallbackHeight?: number,
) {
  const resolvedWidth = Number.isFinite(width) && width > 0 ? width : fallbackWidth;
  const resolvedHeight = Number.isFinite(height) && height > 0 ? height : fallbackHeight;

  if (!Number.isFinite(resolvedWidth) || !Number.isFinite(resolvedHeight) || resolvedWidth! <= 0 || resolvedHeight! <= 0) {
    return null;
  }

  return { width: resolvedWidth!, height: resolvedHeight! };
}

export function createLoadCompletionGate(onLoadComplete?: (fallback?: boolean) => void) {
  let pendingFallback: boolean | null = null;

  return {
    markModelReady(fallback = false) {
      pendingFallback = fallback;
    },
    reportRenderedFrame() {
      if (pendingFallback === null) return;
      const fallback = pendingFallback;
      pendingFallback = null;
      onLoadComplete?.(fallback || undefined);
    },
  };
}
