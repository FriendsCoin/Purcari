import { useState, useEffect, useRef, useCallback } from 'react';

interface AudioAnalyzerData {
  frequencies: Uint8Array;
  averageFrequency: number;
  bassFrequency: number;
  midFrequency: number;
  trebleFrequency: number;
  volume: number;
}

export function useAudioAnalyzer(audioSource?: MediaStream | HTMLAudioElement) {
  const [isActive, setIsActive] = useState(false);
  const [audioData, setAudioData] = useState<AudioAnalyzerData>({
    frequencies: new Uint8Array(0),
    averageFrequency: 0,
    bassFrequency: 0,
    midFrequency: 0,
    trebleFrequency: 0,
    volume: 0,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const initializeAudioContext = useCallback((source: MediaStream | HTMLAudioElement) => {
    try {
      // Create audio context
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Create analyzer
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 256;
      analyzerRef.current = analyzer;

      const bufferLength = analyzer.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;

      // Connect source
      let sourceNode: MediaStreamAudioSourceNode | MediaElementAudioSourceNode;

      if (source instanceof MediaStream) {
        sourceNode = audioContext.createMediaStreamSource(source);
      } else {
        sourceNode = audioContext.createMediaElementSource(source);
      }

      sourceNode.connect(analyzer);
      // Don't connect to destination to avoid feedback

      setIsActive(true);
      return true;
    } catch (error) {
      console.error('Error initializing audio context:', error);
      return false;
    }
  }, []);

  const analyze = useCallback(() => {
    if (!analyzerRef.current || !dataArrayRef.current) return;

    const analyzer = analyzerRef.current;
    const dataArray = dataArrayRef.current;

    analyzer.getByteFrequencyData(dataArray as any);

    // Calculate frequency ranges
    const bufferLength = dataArray.length;
    const bassEnd = Math.floor(bufferLength * 0.2);
    const midStart = bassEnd;
    const midEnd = Math.floor(bufferLength * 0.6);
    const trebleStart = midEnd;

    let bassSum = 0;
    let midSum = 0;
    let trebleSum = 0;
    let totalSum = 0;

    for (let i = 0; i < bufferLength; i++) {
      const value = dataArray[i];
      totalSum += value;

      if (i < bassEnd) {
        bassSum += value;
      } else if (i < midEnd) {
        midSum += value;
      } else {
        trebleSum += value;
      }
    }

    const bassFrequency = bassSum / bassEnd;
    const midFrequency = midSum / (midEnd - midStart);
    const trebleFrequency = trebleSum / (bufferLength - trebleStart);
    const averageFrequency = totalSum / bufferLength;
    const volume = Math.max(...dataArray) / 255;

    setAudioData({
      frequencies: new Uint8Array(dataArray),
      averageFrequency,
      bassFrequency,
      midFrequency,
      trebleFrequency,
      volume,
    });

    animationFrameRef.current = requestAnimationFrame(analyze);
  }, []);

  useEffect(() => {
    if (audioSource) {
      if (initializeAudioContext(audioSource)) {
        analyze();
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      setIsActive(false);
    };
  }, [audioSource, initializeAudioContext, analyze]);

  return { audioData, isActive };
}

export function useMicrophone() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isPermissionGranted, setIsPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestMicrophone = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      setStream(mediaStream);
      setIsPermissionGranted(true);
      setError(null);
      return mediaStream;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(errorMessage);
      setIsPermissionGranted(false);
      return null;
    }
  }, []);

  const stopMicrophone = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setIsPermissionGranted(false);
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      stopMicrophone();
    };
  }, [stopMicrophone]);

  return {
    stream,
    isPermissionGranted,
    error,
    requestMicrophone,
    stopMicrophone
  };
}
