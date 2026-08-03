/**
 * Reduced-motion mode support (F4: WCAG 2.3.1 safeguard)
 *
 * Manages reduced-motion preferences and provides utilities for
 * honoring accessibility preferences to reduce photosensitivity risk.
 *
 * Per ideas-ledger.md F4 (2026-07-31 finalist, grade S):
 * - Reduced-motion mode lowers frame rate and reduces flash area
 * - Honors system prefers-reduced-motion setting
 * - Integrates with animation loops for safer viewing
 *
 * Reference: plan.md D10, D12. Phase 5.
 */

/**
 * Reduced-motion configuration
 */
export interface ReducedMotionConfig {
  /** Whether reduced-motion mode is enabled */
  enabled: boolean;
  /** Maximum frame rate in reduced-motion mode (Hz) */
  maxFrameRate?: number;
  /** Whether to limit flash area (bounded display) */
  boundedDisplay?: boolean;
}

/**
 * Reduced-motion manager
 *
 * Tracks system preferences and manual overrides for reduced-motion mode.
 */
export class ReducedMotionManager {
  private enabled: boolean = false;
  private maxFrameRate: number;
  private boundedDisplay: boolean;
  private mediaQuery: MediaQueryList | null = null;
  private listeners: Set<(enabled: boolean) => void> = new Set();

  constructor(config: ReducedMotionConfig = {}) {
    this.enabled = config.enabled ?? false;
    this.maxFrameRate = config.maxFrameRate ?? 3; // WCAG 2.3.1 safe threshold
    this.boundedDisplay = config.boundedDisplay ?? true;

    // Listen for system preference changes
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

      // Initialize from system preference
      if (this.mediaQuery.matches) {
        this.enabled = true;
      }

      // Listen for changes
      try {
        this.mediaQuery.addEventListener('change', this.handleMediaQueryChange);
      } catch {
        // Fallback for older browsers
        this.mediaQuery.addListener(this.handleMediaQueryChange);
      }
    }
  }

  /**
   * Handle system preference changes
   */
  private handleMediaQueryChange = (e: MediaQueryListEvent | MediaQueryList): void => {
    const matches = 'matches' in e ? e.matches : e.matches;
    this.setEnabled(matches);
  };

  /**
   * Check if reduced-motion mode is currently enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable reduced-motion mode
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.notifyListeners();
    }
  }

  /**
   * Get the maximum frame rate for reduced-motion mode
   */
  getMaxFrameRate(): number {
    return this.enabled ? this.maxFrameRate : Infinity;
  }

  /**
   * Check if bounded display is enabled
   */
  isBoundedDisplay(): boolean {
    return this.boundedDisplay;
  }

  /**
   * Calculate appropriate frame update interval
   *
   * Returns the minimum time (in ms) between frame updates based on
   * reduced-motion settings.
   */
  getFrameInterval(targetFps: number): number {
    const maxFps = this.getMaxFrameRate();
    const effectiveFps = Math.min(targetFps, maxFps);
    return 1000 / effectiveFps;
  }

  /**
   * Calculate throttled frame rate
   *
   * Returns the effective frame rate after applying reduced-motion limits.
   */
  getThrottledFrameRate(targetFps: number): number {
    const maxFps = this.getMaxFrameRate();
    return Math.min(targetFps, maxFps);
  }

  /**
   * Subscribe to reduced-motion state changes
   */
  onChange(callback: (enabled: boolean) => void): () => void {
    this.listeners.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners of state changes
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.enabled);
      } catch (error) {
        console.error('[ReducedMotion] Listener error:', error);
      }
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.mediaQuery) {
      try {
        this.mediaQuery.removeEventListener('change', this.handleMediaQueryChange);
      } catch {
        // Fallback for older browsers
        this.mediaQuery.removeListener(this.handleMediaQueryChange);
      }
      this.mediaQuery = null;
    }
    this.listeners.clear();
  }
}

/**
 * Global reduced-motion manager instance
 */
let globalManager: ReducedMotionManager | null = null;

/**
 * Get or create the global reduced-motion manager
 */
export function getReducedMotionManager(config?: ReducedMotionConfig): ReducedMotionManager {
  if (!globalManager) {
    globalManager = new ReducedMotionManager(config);
  }
  return globalManager;
}

/**
 * Check if reduced-motion mode is currently enabled (convenience function)
 */
export function isReducedMotionEnabled(): boolean {
  return getReducedMotionManager().isEnabled();
}

/**
 * Get the throttled frame rate for reduced-motion mode (convenience function)
 */
export function getThrottledFrameRate(targetFps: number): number {
  return getReducedMotionManager().getThrottledFrameRate(targetFps);
}

/**
 * Get the frame interval for reduced-motion mode (convenience function)
 */
export function getFrameInterval(targetFps: number): number {
  return getReducedMotionManager().getFrameInterval(targetFps);
}
