import { useState, useEffect } from 'react';

interface ARSupportInfo {
  isSupported: boolean;
  isLoading: boolean;
  error: string | null;
  platformInfo: {
    isAndroid: boolean;
    isIOS: boolean;
    isDesktop: boolean;
    browser: string;
  };
}

export function useARSupport(): ARSupportInfo {
  const [supportInfo, setSupportInfo] = useState<ARSupportInfo>({
    isSupported: false,
    isLoading: true,
    error: null,
    platformInfo: {
      isAndroid: false,
      isIOS: false,
      isDesktop: true,
      browser: 'unknown',
    },
  });

  useEffect(() => {
    const checkARSupport = async () => {
      try {
        // Detect platform
        const userAgent = navigator.userAgent.toLowerCase();
        const isAndroid = /android/.test(userAgent);
        const isIOS = /iphone|ipad|ipod/.test(userAgent);
        const isDesktop = !isAndroid && !isIOS;

        // Detect browser
        let browser = 'unknown';
        if (userAgent.includes('chrome')) browser = 'chrome';
        else if (userAgent.includes('safari')) browser = 'safari';
        else if (userAgent.includes('firefox')) browser = 'firefox';
        else if (userAgent.includes('edge')) browser = 'edge';

        const platformInfo = { isAndroid, isIOS, isDesktop, browser };

        // Check WebXR support
        if (!('xr' in navigator)) {
          setSupportInfo({
            isSupported: false,
            isLoading: false,
            error: 'WebXR not available in this browser',
            platformInfo,
          });
          return;
        }

        // Check for AR session support
        const xr = (navigator as any).xr;
        if (!xr) {
          setSupportInfo({
            isSupported: false,
            isLoading: false,
            error: 'XR not available',
            platformInfo,
          });
          return;
        }

        const isARSupported = await xr.isSessionSupported('immersive-ar');

        if (!isARSupported) {
          let error = 'AR mode not supported on this device';

          if (isIOS) {
            error = 'iOS does not support WebXR AR. Try on Android with Chrome.';
          } else if (isAndroid && browser !== 'chrome') {
            error = 'Please use Chrome browser on Android for AR features.';
          } else if (isDesktop) {
            error = 'AR requires a mobile device with ARCore support.';
          }

          setSupportInfo({
            isSupported: false,
            isLoading: false,
            error,
            platformInfo,
          });
          return;
        }

        // AR is supported!
        setSupportInfo({
          isSupported: true,
          isLoading: false,
          error: null,
          platformInfo,
        });
      } catch (err) {
        setSupportInfo({
          isSupported: false,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to check AR support',
          platformInfo: {
            isAndroid: false,
            isIOS: false,
            isDesktop: true,
            browser: 'unknown',
          },
        });
      }
    };

    checkARSupport();
  }, []);

  return supportInfo;
}
