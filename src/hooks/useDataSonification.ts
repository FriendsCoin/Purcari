import { useRef, useCallback, useState, useEffect } from 'react';

interface SpeciesSound {
  species: string;
  frequency: number; // Hz
  duration: number; // seconds
  volume: number; // 0-1
  instrument: 'sine' | 'square' | 'sawtooth' | 'triangle';
  delay: number; // seconds
}

interface SonificationOptions {
  tempo?: number; // BPM (beats per minute)
  scale?: 'major' | 'minor' | 'pentatonic' | 'chromatic';
  baseFrequency?: number; // A4 = 440Hz
  duration?: number; // Total duration in seconds
}

export function useDataSonification(
  speciesData: Record<string, number>,
  options: SonificationOptions = {}
) {
  const {
    tempo = 120,
    scale = 'pentatonic',
    baseFrequency = 440,
    duration = 30
  } = options;

  const audioContextRef = useRef<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const scheduledNodesRef = useRef<AudioScheduledSourceNode[]>([]);

  // Musical scales (intervals in semitones from root)
  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };

  // Convert semitones to frequency
  const getFrequency = (semitones: number): number => {
    return baseFrequency * Math.pow(2, semitones / 12);
  };

  // Map species to sounds
  const mapSpeciesToSounds = useCallback((): SpeciesSound[] => {
    const species = Object.entries(speciesData)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 20); // Top 20 species

    const scaleIntervals = scales[scale];
    const instruments: SpeciesSound['instrument'][] = ['sine', 'triangle', 'sawtooth', 'square'];

    return species.map(([name, count], index) => {
      // Map species to scale degree
      const scaleDegree = index % scaleIntervals.length;
      const octave = Math.floor(index / scaleIntervals.length);
      const semitones = scaleIntervals[scaleDegree] + (octave * 12);

      // Map count to volume (logarithmic scale)
      const maxCount = Math.max(...Object.values(speciesData) as number[]);
      const volume = 0.1 + (Math.log(count as number + 1) / Math.log(maxCount + 1)) * 0.4;

      // Assign instrument based on species type (could be enhanced with actual type data)
      const instrument = instruments[index % instruments.length];

      // Calculate timing
      const beatDuration = 60 / tempo;
      const delay = (index * beatDuration * 2) % duration;
      const noteDuration = beatDuration * (1 + Math.random() * 2);

      return {
        species: name,
        frequency: getFrequency(semitones),
        duration: noteDuration,
        volume,
        instrument,
        delay
      };
    });
  }, [speciesData, scale, tempo, baseFrequency, duration]);

  // Initialize audio context
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  // Play a single note
  const playNote = useCallback((sound: SpeciesSound, startTime: number) => {
    const ctx = audioContextRef.current;
    if (!ctx) return null;

    // Create oscillator
    const oscillator = ctx.createOscillator();
    oscillator.type = sound.instrument;
    oscillator.frequency.setValueAtTime(sound.frequency, startTime);

    // Create gain node for volume control
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(sound.volume, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + sound.duration);

    // Connect nodes
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Schedule playback
    oscillator.start(startTime);
    oscillator.stop(startTime + sound.duration);

    return oscillator;
  }, []);

  // Play composition
  const play = useCallback(() => {
    const ctx = initAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Clear any existing scheduled notes
    scheduledNodesRef.current.forEach(node => {
      try {
        node.stop();
      } catch (e) {
        // Node might already be stopped
      }
    });
    scheduledNodesRef.current = [];

    const sounds = mapSpeciesToSounds();
    const startTime = ctx.currentTime;

    // Schedule all notes
    sounds.forEach(sound => {
      const node = playNote(sound, startTime + sound.delay);
      if (node) {
        scheduledNodesRef.current.push(node);
      }

      // Schedule repeating notes
      const repeatInterval = duration / 4;
      for (let i = 1; i < 4; i++) {
        const repeatNode = playNote(sound, startTime + sound.delay + (i * repeatInterval));
        if (repeatNode) {
          scheduledNodesRef.current.push(repeatNode);
        }
      }
    });

    setIsPlaying(true);

    // Auto-stop after duration
    setTimeout(() => {
      setIsPlaying(false);
      setCurrentTime(0);
    }, duration * 1000);

    // Update current time
    const interval = setInterval(() => {
      setCurrentTime(prev => {
        if (prev >= duration) {
          clearInterval(interval);
          return 0;
        }
        return prev + 0.1;
      });
    }, 100);

  }, [initAudioContext, mapSpeciesToSounds, playNote, duration]);

  // Stop playback
  const stop = useCallback(() => {
    scheduledNodesRef.current.forEach(node => {
      try {
        node.stop();
      } catch (e) {
        // Node might already be stopped
      }
    });
    scheduledNodesRef.current = [];
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stop]);

  return {
    play,
    stop,
    isPlaying,
    currentTime,
    duration,
    sounds: mapSpeciesToSounds()
  };
}
