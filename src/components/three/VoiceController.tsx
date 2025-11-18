import { useState, useEffect } from 'react';
import { Mic, MicOff, Volume2, Info, Zap } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Button } from '../common/Button';
import { useSpeechRecognition, type VoiceCommand } from '@/hooks/useSpeechRecognition';

interface VoiceControllerProps {
  onCommand?: (command: VoiceCommand) => void;
}

export function VoiceController({ onCommand }: VoiceControllerProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);

  const {
    isListening,
    isSupported,
    transcript,
    interimTranscript,
    error,
    detectedCommand,
    startListening,
    stopListening,
    commands,
    commandHistory,
  } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
    language: 'en-US',
    onCommand: (command) => {
      console.log('Voice command detected:', command);
      onCommand?.(command);
    },
    onTranscript: (text, isFinal) => {
      console.log('Transcript:', text, isFinal ? '(final)' : '(interim)');
    },
  });

  // Auto-scroll transcript
  useEffect(() => {
    const transcriptEl = document.getElementById('voice-transcript');
    if (transcriptEl) {
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }
  }, [transcript, interimTranscript]);

  if (!isSupported) {
    return (
      <Card className="border-orange-200 bg-orange-50">
        <CardHeader className="bg-gradient-to-r from-orange-500 to-red-500 text-white">
          <div className="flex items-center gap-3">
            <MicOff size={24} />
            <div>
              <CardTitle className="text-white">Voice Commands Not Available</CardTitle>
              <p className="text-orange-100 text-sm mt-1">
                Browser does not support speech recognition
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="bg-white rounded-lg p-4 border border-orange-200">
            <p className="font-semibold text-orange-900 mb-2">
              ⚠️ Speech recognition not supported
            </p>
            <p className="text-sm text-gray-700">
              Voice commands require a modern browser with Web Speech API support.
              Try using Chrome, Edge, or Safari on desktop or mobile.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white bg-opacity-20 rounded-lg">
              {isListening ? (
                <Mic size={24} className="animate-pulse" />
              ) : (
                <MicOff size={24} />
              )}
            </div>
            <div>
              <CardTitle className="text-white text-xl">Voice Commands</CardTitle>
              <p className="text-purple-100 text-sm mt-1">
                Control with natural language
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
          <div className="mb-6 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-4 border border-purple-200">
            <h4 className="font-bold text-gray-900 mb-3">Available Voice Commands</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {commands.map((cmd) => (
                <div
                  key={cmd.command}
                  className="bg-white rounded-lg p-3 border border-purple-100"
                >
                  <p className="text-sm font-semibold text-purple-900">
                    "{cmd.keywords[0]}"
                  </p>
                  <p className="text-xs text-gray-600 mt-1">{cmd.description}</p>
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
              {isListening ? (
                <>
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-sm font-medium text-green-700">Listening...</span>
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
            <p className="text-xs text-gray-600 mb-1">Commands Executed</p>
            <div className="flex items-center gap-2">
              <Volume2 size={16} className="text-purple-600" />
              <span className="text-sm font-medium text-gray-900">
                {commandHistory.length}
              </span>
            </div>
          </div>
        </div>

        {/* Detected Command Banner */}
        {detectedCommand && (
          <div className="mb-4 bg-gradient-to-r from-purple-500 to-indigo-500 text-white px-4 py-3 rounded-lg animate-scale-in">
            <div className="flex items-center gap-2">
              <Zap size={20} />
              <div className="flex-1">
                <p className="font-bold">{detectedCommand.action}</p>
                <p className="text-sm text-purple-100">
                  Command: "{detectedCommand.keywords[0]}"
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Transcript Display */}
        {showTranscript && isListening && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-900">Live Transcript</h4>
              <button
                onClick={() => setShowTranscript(false)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Hide
              </button>
            </div>
            <div
              id="voice-transcript"
              className="bg-gray-50 rounded-lg p-3 border border-gray-200 min-h-[100px] max-h-[200px] overflow-y-auto"
            >
              {transcript && (
                <p className="text-sm text-gray-900 mb-2">
                  <strong>Final:</strong> {transcript}
                </p>
              )}
              {interimTranscript && (
                <p className="text-sm text-gray-500 italic">
                  <strong>Listening:</strong> {interimTranscript}
                </p>
              )}
              {!transcript && !interimTranscript && (
                <p className="text-sm text-gray-400 text-center py-8">
                  Speak a command to get started...
                </p>
              )}
            </div>
          </div>
        )}

        {!showTranscript && isListening && (
          <button
            onClick={() => setShowTranscript(true)}
            className="mb-4 text-sm text-purple-600 hover:text-purple-700 font-medium"
          >
            Show live transcript
          </button>
        )}

        {/* Command History */}
        {commandHistory.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Recent Commands</h4>
            <div className="space-y-1 max-h-[150px] overflow-y-auto">
              {commandHistory.slice(0, 5).map((cmd, index) => (
                <div
                  key={`${cmd.command}-${index}`}
                  className="flex items-center gap-2 bg-purple-50 rounded-lg px-3 py-2 border border-purple-100"
                >
                  <Zap size={14} className="text-purple-600" />
                  <span className="text-xs font-medium text-purple-900 flex-1">
                    {cmd.action}
                  </span>
                  <span className="text-xs text-gray-500">
                    {index === 0 ? 'Just now' : `${index}m ago`}
                  </span>
                </div>
              ))}
            </div>
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
          {!isListening ? (
            <Button
              variant="primary"
              size="lg"
              onClick={startListening}
              className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
            >
              <Mic size={20} className="mr-2" />
              Start Voice Control
            </Button>
          ) : (
            <Button
              variant="outline"
              size="lg"
              onClick={stopListening}
              className="flex-1 border-red-500 text-red-600 hover:bg-red-50"
            >
              <MicOff size={20} className="mr-2" />
              Stop Listening
            </Button>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-4 p-3 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200">
          <p className="text-xs text-gray-700">
            <strong>💡 Tip:</strong> Speak clearly and naturally. Try saying "show species",
            "zoom in", "play music", or "help" to see available commands. Works best in a
            quiet environment.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
