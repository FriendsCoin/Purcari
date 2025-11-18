import { useState, useEffect, useCallback, useRef } from 'react';

export function useWebcam() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isPermissionGranted, setIsPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const requestWebcam = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });
      setStream(mediaStream);
      setIsPermissionGranted(true);
      setError(null);

      // Create video element for texture
      if (!videoRef.current) {
        const video = document.createElement('video');
        video.srcObject = mediaStream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        videoRef.current = video;
      } else {
        videoRef.current.srcObject = mediaStream;
      }

      return mediaStream;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to access webcam';
      setError(errorMessage);
      setIsPermissionGranted(false);
      return null;
    }
  }, []);

  const stopWebcam = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setIsPermissionGranted(false);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, [stopWebcam]);

  return {
    stream,
    videoElement: videoRef.current,
    isPermissionGranted,
    error,
    requestWebcam,
    stopWebcam
  };
}
