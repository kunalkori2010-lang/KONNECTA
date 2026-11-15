import { useEffect, useState } from 'react';

export type DeviceTier = 'mobile' | 'tablet' | 'desktop' | 'wide';
export type ViewportOrientation = 'portrait' | 'landscape';

export interface DeviceViewport {
  width: number;
  height: number;
  deviceTier: DeviceTier;
  orientation: ViewportOrientation;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouch: boolean;
  isCompactHeight: boolean;
}

function getTier(width: number): DeviceTier {
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  if (width < 1536) return 'desktop';
  return 'wide';
}

function readViewport(): DeviceViewport {
  if (typeof window === 'undefined') {
    return {
      width: 1280,
      height: 800,
      deviceTier: 'desktop',
      orientation: 'landscape',
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isTouch: false,
      isCompactHeight: false,
    };
  }

  const vv = window.visualViewport;
  const width = Math.round(vv?.width || window.innerWidth);
  const height = Math.round(vv?.height || window.innerHeight);
  const deviceTier = getTier(width);
  const orientation: ViewportOrientation = width >= height ? 'landscape' : 'portrait';
  const isTouch =
    window.matchMedia?.('(pointer: coarse)').matches ||
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0;

  return {
    width,
    height,
    deviceTier,
    orientation,
    isMobile: deviceTier === 'mobile',
    isTablet: deviceTier === 'tablet',
    isDesktop: deviceTier === 'desktop' || deviceTier === 'wide',
    isTouch,
    isCompactHeight: height < 520,
  };
}

export function useDeviceViewport(): DeviceViewport {
  const [viewport, setViewport] = useState<DeviceViewport>(readViewport);

  useEffect(() => {
    const sync = () => {
      const next = readViewport();
      setViewport(next);
      const root = document.documentElement;
      root.dataset.deviceTier = next.deviceTier;
      root.dataset.orientation = next.orientation;
      root.style.setProperty('--app-dvh', `${next.height}px`);
    };

    sync();
    window.addEventListener('resize', sync, { passive: true });
    window.addEventListener('orientationchange', sync, { passive: true });
    window.visualViewport?.addEventListener('resize', sync, { passive: true });

    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      window.visualViewport?.removeEventListener('resize', sync);
    };
  }, []);

  return viewport;
}
