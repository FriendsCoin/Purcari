import { useState, useRef, useEffect, useCallback } from 'react';
import { Hand, Video, VideoOff, Zap, X, Info } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Button } from '../common/Button';
import { useHandGesture, type GestureType, type GestureData } from '@/hooks/useHandGesture';

interface GestureControllerProps {
  onGestureDetected?: (gesture: GestureData) => void;
  showVideo?: boolean;
}

const gestureEmojis: Record<GestureType, string> = {
  Thumb_Up: '👍',
  Thumb_Down: '👎',
  Victory: '✌️',
  Open_Palm: '✋',
  Pointing_Up: '☝️',
  Closed_Fist: '✊',
  ILoveYou: '🤟',
  None: '🚫',
};

const gestureDescriptions: Record<GestureType, string> = {
  Thumb_Up: 'Thumbs Up - Zoom In',
  Thumb_Down: 'Thumbs Down - Zoom Out',
  Victory: 'Victory - Rotate Right',
  Open_Palm: 'Open Palm - Stop/Reset',
  Pointing_Up: 'Pointing Up - Move Up',
  Closed_Fist: 'Fist - Grab/Hold',
  ILoveYou: 'I Love You - Special Effect',
  None: 'No Gesture Detected',
};

export function GestureController({ onGestureDetected, showVideo = true }: GestureControllerProps) {
  const [isActive, setIsActive] = useState(false);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [currentAction, setCurrentAction] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Handle gesture detection callback
  const handleGestureDetected = useCallback(
    (gesture: GestureData) => {
      // Update current action based on gesture
      if (gesture.gesture !== 'None') {
        setCurrentAction(gestureDescriptions[gesture.gesture]);

        // Auto-clear action after 2 seconds
        setTimeout(() => setCurrentAction(null), 2000);
      }

      // Call parent callback
      onGestureDetected?.(gesture);
    },
    [onGestureDetected]
  );

  const {
    isActive: gestureActive,
    isLoading,
    error,
    gesture,
    start: startGestureDetection,
    stop: stopGestureDetection,
  } = useHandGesture({
    videoElement: videoRef.current || undefined,
    onGestureDetected: handleGestureDetected,
    minConfidence: 0.7,
    historySize: 10,
  });

  // Request camera access
  const requestCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
        };
      }

      streamRef.current = stream;
      setCameraGranted(true);
      return true;
    } catch (err) {
      console.error('Camera access error:', err);
      return false;
    }
  }, []);

  // Start gesture control
  const handleStart = useCallback(async () => {
    if (!cameraGranted) {
      const granted = await requestCamera();
      if (!granted) return;
    }

    // Wait for video to be ready
    await new Promise((resolve) => setTimeout(resolve, 500));
    await startGestureDetection();
    setIsActive(true);
  }, [cameraGranted, requestCamera, startGestureDetection]);

  // Stop gesture control
  const handleStop = useCallback(() => {
    stopGestureDetection();
    setIsActive(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setCameraGranted(false);
  }, [stopGestureDetection]);

  // Draw hand landmarks on canvas
  useEffect(() => {
    if (!canvasRef.current || !videoRef.current || !gesture?.landmarks) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw landmarks
    const landmarks = gesture.landmarks;
    ctx.fillStyle = '#EC4899';
    ctx.strokeStyle = '#9333EA';
    ctx.lineWidth = 2;

    // Draw connections between landmarks
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8], // Index
      [0, 9], [9, 10], [10, 11], [11, 12], // Middle
      [0, 13], [13, 14], [14, 15], [15, 16], // Ring
      [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
      [5, 9], [9, 13], [13, 17], // Palm
    ];

    connections.forEach(([start, end]) => {
      const startPoint = landmarks[start];
      const endPoint = landmarks[end];
      if (startPoint && endPoint) {
        ctx.beginPath();
        ctx.moveTo(startPoint.x * canvas.width, startPoint.y * canvas.height);
        ctx.lineTo(endPoint.x * canvas.width, endPoint.y * canvas.height);
        ctx.stroke();
      }
    });

    // Draw landmark points
    landmarks.forEach((landmark) => {
      ctx.beginPath();
      ctx.arc(
        landmark.x * canvas.width,
        landmark.y * canvas.height,
        5,
        0,
        2 * Math.PI
      );
      ctx.fill();
    });
  }, [gesture]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      handleStop();
    };
  }, [handleStop]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-pink-600 to-purple-600 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white bg-opacity-20 rounded-lg">
              <Hand size={24} />
            </div>
            <div>
              <CardTitle className="text-white text-xl">Gesture Controls</CardTitle>
              <p className="text-pink-100 text-sm mt-1">
                Control with hand gestures
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInfo(!showInfo)}
              className="bg-white bg-opacity-20 text-white border-white hover:bg-opacity-30"
            >
              <Info size={16} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {showInfo && (
          <div className="mb-6 bg-gradient-to-r from-pink-50 to-purple-50 rounded-lg p-4 border border-pink-200">
            <h4 className="font-bold text-gray-900 mb-2">Supported Gestures</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(gestureDescriptions)
                .filter(([key]) => key !== 'None')
                .map(([key, description]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-2xl">{gestureEmojis[key as GestureType]}</span>
                    <span className="text-gray-700">{description}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Status Display */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-xs text-gray-600 mb-1">Status</p>
            <div className="flex items-center gap-2">
              {isLoading ? (
                <>
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                  <span className="text-sm font-medium">Loading...</span>
                </>
              ) : isActive && gestureActive ? (
                <>
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-sm font-medium text-green-700">Active</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 bg-gray-400 rounded-full" />
                  <span className="text-sm font-medium text-gray-600">Inactive</span>
                </>
              )}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-xs text-gray-600 mb-1">Detected Gesture</p>
            <div className="flex items-center gap-2">
              {gesture && gesture.gesture !== 'None' ? (
                <>
                  <span className="text-2xl">{gestureEmojis[gesture.gesture]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{gesture.gesture}</p>
                    <p className="text-xs text-gray-500">
                      {(gesture.confidence * 100).toFixed(0)}% • {gesture.handedness}
                    </p>
                  </div>
                </>
              ) : (
                <span className="text-sm text-gray-500">No gesture</span>
              )}
            </div>
          </div>
        </div>

        {/* Current Action Banner */}
        {currentAction && (
          <div className="mb-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white px-4 py-2 rounded-lg animate-scale-in">
            <div className="flex items-center gap-2">
              <Zap size={16} />
              <span className="font-medium">{currentAction}</span>
            </div>
          </div>
        )}

        {/* Video Preview */}
        {showVideo && (
          <div className="mb-4 relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
            {cameraGranted ? (
              <>
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover transform scale-x-[-1]"
                  playsInline
                  muted
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full transform scale-x-[-1]"
                />
                {!isActive && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
                    <p className="text-white text-sm">Camera ready. Start gesture detection below.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <VideoOff size={48} className="mx-auto mb-2" />
                  <p className="text-sm">Camera not active</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-700">⚠️ {error}</p>
          </div>
        )}

        {/* Control Buttons */}
        <div className="flex gap-2">
          {!isActive ? (
            <Button
              variant="primary"
              size="lg"
              onClick={handleStart}
              disabled={isLoading}
              className="flex-1 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700"
            >
              <Video size={20} className="mr-2" />
              {isLoading ? 'Loading...' : 'Start Gesture Control'}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="lg"
              onClick={handleStop}
              className="flex-1 border-red-500 text-red-600 hover:bg-red-50"
            >
              <X size={20} className="mr-2" />
              Stop Gesture Control
            </Button>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-4 p-3 bg-gradient-to-r from-pink-50 to-purple-50 rounded-lg border border-pink-200">
          <p className="text-xs text-gray-700">
            <strong>💡 Tip:</strong> Hold your hand in front of the camera and make gestures.
            Works best with good lighting and a clear background. Keep hand within camera frame.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
