import { useState, useEffect, useRef, useCallback } from 'react';
import {
  GestureRecognizer,
  FilesetResolver,
  GestureRecognizerResult,
} from '@mediapipe/tasks-vision';

export type GestureType =
  | 'Thumb_Up'
  | 'Thumb_Down'
  | 'Victory'
  | 'Open_Palm'
  | 'Pointing_Up'
  | 'Closed_Fist'
  | 'ILoveYou'
  | 'None';

export interface GestureData {
  gesture: GestureType;
  confidence: number;
  handedness: 'Left' | 'Right' | 'Unknown';
  landmarks?: Array<{ x: number; y: number; z: number }>;
}

export interface HandGestureState {
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
  gesture: GestureData | null;
  gestureHistory: GestureType[];
}

interface HandGestureOptions {
  videoElement?: HTMLVideoElement;
  onGestureDetected?: (gesture: GestureData) => void;
  minConfidence?: number;
  historySize?: number;
}

export function useHandGesture(options: HandGestureOptions = {}) {
  const {
    videoElement,
    onGestureDetected,
    minConfidence = 0.7,
    historySize = 10,
  } = options;

  const [state, setState] = useState<HandGestureState>({
    isActive: false,
    isLoading: true,
    error: null,
    gesture: null,
    gestureHistory: [],
  });

  const gestureRecognizerRef = useRef<GestureRecognizer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const gestureHistoryRef = useRef<GestureType[]>([]);

  // Initialize MediaPipe Gesture Recognizer
  const initializeGestureRecognizer = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      const recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: minConfidence,
        minHandPresenceConfidence: minConfidence,
        minTrackingConfidence: minConfidence,
      });

      gestureRecognizerRef.current = recognizer;
      setState((prev) => ({ ...prev, isLoading: false, isActive: true }));

      return recognizer;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize gesture recognizer';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
        isActive: false,
      }));
      console.error('Gesture recognizer initialization error:', error);
      return null;
    }
  }, [minConfidence]);

  // Process video frame for gesture detection
  const detectGestures = useCallback(() => {
    if (!videoElement || !gestureRecognizerRef.current) return;

    const recognizer = gestureRecognizerRef.current;

    // Only process if video time has changed
    if (videoElement.currentTime === lastVideoTimeRef.current) {
      animationFrameRef.current = requestAnimationFrame(detectGestures);
      return;
    }
    lastVideoTimeRef.current = videoElement.currentTime;

    try {
      const nowInMs = Date.now();
      const results: GestureRecognizerResult = recognizer.recognizeForVideo(
        videoElement,
        nowInMs
      );

      // Process detected gestures
      if (results.gestures && results.gestures.length > 0) {
        const topGesture = results.gestures[0][0];
        const handedness = results.handednesses[0]?.[0]?.categoryName || 'Unknown';
        const landmarks = results.landmarks[0]?.map((lm) => ({
          x: lm.x,
          y: lm.y,
          z: lm.z || 0,
        }));

        if (topGesture && topGesture.score >= minConfidence) {
          const gestureData: GestureData = {
            gesture: topGesture.categoryName as GestureType,
            confidence: topGesture.score,
            handedness: handedness as 'Left' | 'Right' | 'Unknown',
            landmarks,
          };

          // Update gesture history
          gestureHistoryRef.current = [
            topGesture.categoryName as GestureType,
            ...gestureHistoryRef.current.slice(0, historySize - 1),
          ];

          setState((prev) => ({
            ...prev,
            gesture: gestureData,
            gestureHistory: gestureHistoryRef.current,
          }));

          onGestureDetected?.(gestureData);
        } else {
          // No confident gesture detected
          setState((prev) => ({
            ...prev,
            gesture: {
              gesture: 'None',
              confidence: 0,
              handedness: 'Unknown',
            },
          }));
        }
      } else {
        // No hands detected
        setState((prev) => ({
          ...prev,
          gesture: null,
        }));
      }
    } catch (error) {
      console.error('Gesture detection error:', error);
    }

    animationFrameRef.current = requestAnimationFrame(detectGestures);
  }, [videoElement, minConfidence, historySize, onGestureDetected]);

  // Start gesture detection
  const start = useCallback(async () => {
    if (!gestureRecognizerRef.current) {
      await initializeGestureRecognizer();
    }

    if (videoElement) {
      detectGestures();
    }
  }, [videoElement, initializeGestureRecognizer, detectGestures]);

  // Stop gesture detection
  const stop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      isActive: false,
      gesture: null,
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
      if (gestureRecognizerRef.current) {
        gestureRecognizerRef.current.close();
      }
    };
  }, [stop]);

  // Detect common gesture patterns from history
  const detectPattern = useCallback((pattern: GestureType[]): boolean => {
    const history = gestureHistoryRef.current;
    if (history.length < pattern.length) return false;

    return pattern.every((gesture, index) => history[index] === gesture);
  }, []);

  return {
    ...state,
    start,
    stop,
    detectPattern,
  };
}
