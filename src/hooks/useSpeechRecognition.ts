import { useState, useEffect, useRef, useCallback } from 'react';

export interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

export interface VoiceCommand {
  command: string;
  keywords: string[];
  action: string;
  description: string;
}

export interface SpeechRecognitionState {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  detectedCommand: VoiceCommand | null;
}

const VOICE_COMMANDS: VoiceCommand[] = [
  {
    command: 'show_species',
    keywords: ['show species', 'display species', 'species list'],
    action: 'Show species visualization',
    description: 'Display the species network',
  },
  {
    command: 'zoom_in',
    keywords: ['zoom in', 'closer', 'enlarge'],
    action: 'Zoom In',
    description: 'Zoom into the visualization',
  },
  {
    command: 'zoom_out',
    keywords: ['zoom out', 'farther', 'smaller'],
    action: 'Zoom Out',
    description: 'Zoom out of the visualization',
  },
  {
    command: 'rotate_left',
    keywords: ['rotate left', 'turn left', 'spin left'],
    action: 'Rotate Left',
    description: 'Rotate visualization counterclockwise',
  },
  {
    command: 'rotate_right',
    keywords: ['rotate right', 'turn right', 'spin right'],
    action: 'Rotate Right',
    description: 'Rotate visualization clockwise',
  },
  {
    command: 'play_music',
    keywords: ['play music', 'start music', 'play sonification', 'play sound'],
    action: 'Play Sonification',
    description: 'Play data sonification',
  },
  {
    command: 'stop_music',
    keywords: ['stop music', 'pause music', 'stop sonification', 'stop sound'],
    action: 'Stop Sonification',
    description: 'Stop data sonification',
  },
  {
    command: 'enter_ar',
    keywords: ['enter ar', 'start ar', 'augmented reality', 'show ar'],
    action: 'Enter AR Mode',
    description: 'Activate augmented reality',
  },
  {
    command: 'reset',
    keywords: ['reset', 'restart', 'go back', 'start over'],
    action: 'Reset View',
    description: 'Reset to default view',
  },
  {
    command: 'help',
    keywords: ['help', 'commands', 'what can i say', 'voice commands'],
    action: 'Show Help',
    description: 'Display available commands',
  },
];

interface UseSpeechRecognitionOptions {
  continuous?: boolean;
  interimResults?: boolean;
  language?: string;
  onCommand?: (command: VoiceCommand) => void;
  onTranscript?: (transcript: string, isFinal: boolean) => void;
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const {
    continuous = true,
    interimResults = true,
    language = 'en-US',
    onCommand,
    onTranscript,
  } = options;

  const [state, setState] = useState<SpeechRecognitionState>({
    isListening: false,
    isSupported: false,
    transcript: '',
    interimTranscript: '',
    error: null,
    detectedCommand: null,
  });

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const commandHistoryRef = useRef<VoiceCommand[]>([]);

  // Check browser support
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      setState((prev) => ({ ...prev, isSupported: true }));
    } else {
      setState((prev) => ({
        ...prev,
        isSupported: false,
        error: 'Speech recognition not supported in this browser',
      }));
    }
  }, []);

  // Match transcript to voice commands
  const matchCommand = useCallback(
    (transcript: string): VoiceCommand | null => {
      const lowerTranscript = transcript.toLowerCase().trim();

      for (const command of VOICE_COMMANDS) {
        for (const keyword of command.keywords) {
          if (lowerTranscript.includes(keyword.toLowerCase())) {
            return command;
          }
        }
      }

      return null;
    },
    []
  );

  // Start listening
  const startListening = useCallback(() => {
    if (!state.isSupported) {
      setState((prev) => ({
        ...prev,
        error: 'Speech recognition not supported',
      }));
      return;
    }

    try {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!recognitionRef.current) {
        const recognition = new SpeechRecognition();
        recognition.continuous = continuous;
        recognition.interimResults = interimResults;
        recognition.lang = language;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          setState((prev) => ({
            ...prev,
            isListening: true,
            error: null,
          }));
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript + ' ';
            } else {
              interimTranscript += transcript;
            }
          }

          // Update state with transcripts
          if (finalTranscript) {
            setState((prev) => ({
              ...prev,
              transcript: finalTranscript.trim(),
              interimTranscript: '',
            }));

            onTranscript?.(finalTranscript.trim(), true);

            // Check for command match
            const command = matchCommand(finalTranscript);
            if (command) {
              setState((prev) => ({
                ...prev,
                detectedCommand: command,
              }));

              // Add to command history
              commandHistoryRef.current = [
                command,
                ...commandHistoryRef.current.slice(0, 9),
              ];

              onCommand?.(command);

              // Clear detected command after 3 seconds
              setTimeout(() => {
                setState((prev) => ({
                  ...prev,
                  detectedCommand: null,
                }));
              }, 3000);
            }
          } else if (interimTranscript) {
            setState((prev) => ({
              ...prev,
              interimTranscript: interimTranscript.trim(),
            }));

            onTranscript?.(interimTranscript.trim(), false);
          }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.error('Speech recognition error:', event.error);

          let errorMessage = 'Speech recognition error';
          switch (event.error) {
            case 'no-speech':
              errorMessage = 'No speech detected. Please try again.';
              break;
            case 'audio-capture':
              errorMessage = 'No microphone found. Please check your device.';
              break;
            case 'not-allowed':
              errorMessage = 'Microphone permission denied.';
              break;
            case 'network':
              errorMessage = 'Network error. Please check your connection.';
              break;
            default:
              errorMessage = `Speech recognition error: ${event.error}`;
          }

          setState((prev) => ({
            ...prev,
            error: errorMessage,
            isListening: false,
          }));
        };

        recognition.onend = () => {
          setState((prev) => ({
            ...prev,
            isListening: false,
          }));

          // Restart if continuous mode and no error
          if (continuous && !state.error) {
            try {
              recognition.start();
            } catch (error) {
              // Ignore restart errors
            }
          }
        };

        recognitionRef.current = recognition;
      }

      if (recognitionRef.current) {
        recognitionRef.current.start();
      }
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      setState((prev) => ({
        ...prev,
        error: 'Failed to start speech recognition',
        isListening: false,
      }));
    }
  }, [state.isSupported, state.error, continuous, interimResults, language, matchCommand, onCommand, onTranscript]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setState((prev) => ({
        ...prev,
        isListening: false,
        transcript: '',
        interimTranscript: '',
      }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    startListening,
    stopListening,
    commands: VOICE_COMMANDS,
    commandHistory: commandHistoryRef.current,
  };
}
