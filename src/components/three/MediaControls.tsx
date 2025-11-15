import { useState } from 'react';
import { Mic, MicOff, Video, VideoOff, Volume2 } from 'lucide-react';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { useMicrophone } from '@/hooks/useAudioAnalyzer';
import { useWebcam } from '@/hooks/useWebcam';

interface MediaControlsProps {
  onMicrophoneStream?: (stream: MediaStream | null) => void;
  onWebcamStream?: (video: HTMLVideoElement | null) => void;
}

export function MediaControls({ onMicrophoneStream, onWebcamStream }: MediaControlsProps) {
  const [showControls, setShowControls] = useState(false);
  const {
    isPermissionGranted: micGranted,
    error: micError,
    requestMicrophone,
    stopMicrophone
  } = useMicrophone();

  const {
    videoElement,
    isPermissionGranted: webcamGranted,
    error: webcamError,
    requestWebcam,
    stopWebcam
  } = useWebcam();

  const handleMicToggle = async () => {
    if (micGranted) {
      stopMicrophone();
      onMicrophoneStream?.(null);
    } else {
      const stream = await requestMicrophone();
      if (stream) {
        onMicrophoneStream?.(stream);
      }
    }
  };

  const handleWebcamToggle = async () => {
    if (webcamGranted) {
      stopWebcam();
      onWebcamStream?.(null);
    } else {
      await requestWebcam();
      // Small delay to ensure video element is ready
      setTimeout(() => {
        onWebcamStream?.(videoElement);
      }, 100);
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setShowControls(!showControls)}
        className="fixed bottom-6 right-6 z-50 bg-gradient-to-r from-purple-600 to-pink-600 text-white p-4 rounded-full shadow-2xl hover:scale-110 transition-transform duration-200 animate-bounce-subtle"
        title="Interactive Controls"
      >
        <Volume2 size={24} />
      </button>

      {/* Control panel */}
      {showControls && (
        <div className="fixed bottom-24 right-6 z-50 animate-scale-in">
          <Card className="bg-gray-900 bg-opacity-95 backdrop-blur-md border-purple-500 border-2 shadow-2xl">
            <div className="p-6 space-y-4 w-80">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold text-lg flex items-center gap-2">
                  <span className="text-2xl">🎨</span>
                  Interactive Controls
                </h3>
                <button
                  onClick={() => setShowControls(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Microphone Control */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white text-sm font-medium">
                    Microphone Reactivity
                  </span>
                  <Button
                    variant={micGranted ? 'primary' : 'outline'}
                    size="sm"
                    onClick={handleMicToggle}
                  >
                    {micGranted ? (
                      <Mic size={16} className="mr-1" />
                    ) : (
                      <MicOff size={16} className="mr-1" />
                    )}
                    {micGranted ? 'On' : 'Off'}
                  </Button>
                </div>
                <p className="text-gray-400 text-xs">
                  Particles respond to your voice and sounds
                </p>
                {micError && (
                  <p className="text-red-400 text-xs">⚠️ {micError}</p>
                )}
                {micGranted && (
                  <div className="flex items-center gap-2 text-green-400 text-xs">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    Microphone active
                  </div>
                )}
              </div>

              {/* Webcam Control */}
              <div className="space-y-2 pt-3 border-t border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-white text-sm font-medium">
                    Webcam Integration
                  </span>
                  <Button
                    variant={webcamGranted ? 'primary' : 'outline'}
                    size="sm"
                    onClick={handleWebcamToggle}
                  >
                    {webcamGranted ? (
                      <Video size={16} className="mr-1" />
                    ) : (
                      <VideoOff size={16} className="mr-1" />
                    )}
                    {webcamGranted ? 'On' : 'Off'}
                  </Button>
                </div>
                <p className="text-gray-400 text-xs">
                  Your video feed becomes part of the art
                </p>
                {webcamError && (
                  <p className="text-red-400 text-xs">⚠️ {webcamError}</p>
                )}
                {webcamGranted && (
                  <div className="flex items-center gap-2 text-green-400 text-xs">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    Webcam active
                  </div>
                )}
              </div>

              {/* Mouse Controls Info */}
              <div className="pt-3 border-t border-gray-700">
                <div className="text-white text-sm font-medium mb-2">
                  🖱️ Mouse Controls
                </div>
                <ul className="text-gray-400 text-xs space-y-1">
                  <li>• <span className="text-purple-300">Click + Drag</span> to rotate</li>
                  <li>• <span className="text-purple-300">Scroll</span> to zoom</li>
                  <li>• <span className="text-purple-300">Hover</span> for details</li>
                </ul>
              </div>

              {/* Privacy Note */}
              <div className="pt-3 border-t border-gray-700">
                <p className="text-gray-500 text-xs">
                  🔒 All processing happens locally in your browser.
                  No data is stored or transmitted.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
