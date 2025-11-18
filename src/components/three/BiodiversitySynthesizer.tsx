import { useState } from 'react';
import { Play, Pause, Music, Volume2, Zap } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Button } from '../common/Button';
import { useDataSonification } from '@/hooks/useDataSonification';

interface BiodiversitySynthesizerProps {
  speciesData: Record<string, number>;
}

export function BiodiversitySynthesizer({ speciesData }: BiodiversitySynthesizerProps) {
  const [tempo, setTempo] = useState(120);
  const [scale, setScale] = useState<'major' | 'minor' | 'pentatonic' | 'chromatic'>('pentatonic');
  const showWaveform = true;

  const { play, stop, isPlaying, currentTime, duration, sounds } = useDataSonification(
    speciesData,
    { tempo, scale, duration: 30 }
  );

  const handlePlayPause = () => {
    if (isPlaying) {
      stop();
    } else {
      play();
    }
  };

  const progress = (currentTime / duration) * 100;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-purple-600 to-pink-600 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white bg-opacity-20 rounded-lg">
              <Music size={24} />
            </div>
            <div>
              <CardTitle className="text-white text-xl">Biodiversity Sonification</CardTitle>
              <p className="text-purple-100 text-sm mt-1">
                Listen to your data as music
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={isPlaying ? 'outline' : 'primary'}
              size="lg"
              onClick={handlePlayPause}
              className="bg-white text-purple-600 hover:bg-purple-50"
            >
              {isPlaying ? (
                <><Pause size={20} className="mr-2" /> Pause</>
              ) : (
                <><Play size={20} className="mr-2" /> Play</>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {/* Progress Bar */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>{currentTime.toFixed(1)}s</span>
            <span>{duration}s</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-600 to-pink-600 transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Tempo Control */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Zap size={16} className="inline mr-1" />
              Tempo: {tempo} BPM
            </label>
            <input
              type="range"
              min="60"
              max="180"
              value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              disabled={isPlaying}
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Slow</span>
              <span>Fast</span>
            </div>
          </div>

          {/* Scale Control */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Music size={16} className="inline mr-1" />
              Musical Scale
            </label>
            <select
              value={scale}
              onChange={(e) => setScale(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={isPlaying}
            >
              <option value="pentatonic">Pentatonic (Asian)</option>
              <option value="major">Major (Happy)</option>
              <option value="minor">Minor (Melancholic)</option>
              <option value="chromatic">Chromatic (Experimental)</option>
            </select>
          </div>
        </div>

        {/* Waveform Visualization */}
        {showWaveform && (
          <div className="mb-6">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-semibold text-gray-900">
                Species Sound Map
              </h4>
              <span className="text-xs text-gray-500">
                {sounds.length} species
              </span>
            </div>
            <div className="relative h-32 bg-gradient-to-b from-purple-50 to-pink-50 rounded-lg p-3 overflow-hidden border border-purple-200">
              <svg className="w-full h-full">
                {sounds.map((sound, index) => {
                  const x = (sound.delay / duration) * 100;
                  const height = sound.volume * 100;
                  const color = ['#4F46E5', '#EC4899', '#10B981', '#F59E0B'][index % 4];

                  return (
                    <g key={index}>
                      {/* Vertical line for note */}
                      <line
                        x1={`${x}%`}
                        y1="100%"
                        x2={`${x}%`}
                        y2={`${100 - height}%`}
                        stroke={color}
                        strokeWidth="3"
                        opacity="0.6"
                      />
                      {/* Dot at top */}
                      <circle
                        cx={`${x}%`}
                        cy={`${100 - height}%`}
                        r="4"
                        fill={color}
                      />
                    </g>
                  );
                })}

                {/* Playhead */}
                {isPlaying && (
                  <line
                    x1={`${progress}%`}
                    y1="0"
                    x2={`${progress}%`}
                    y2="100%"
                    stroke="#DC2626"
                    strokeWidth="2"
                    strokeDasharray="4"
                  />
                )}
              </svg>
            </div>
          </div>
        )}

        {/* Species Legend */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">
            Top Species (ordered by frequency)
          </h4>
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {sounds.slice(0, 10).map((sound, index) => {
              const colors = ['bg-blue-500', 'bg-pink-500', 'bg-green-500', 'bg-orange-500'];
              const colorClass = colors[index % 4];

              return (
                <div
                  key={sound.species}
                  className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className={`w-3 h-3 rounded-full ${colorClass}`} />
                  <span className="text-xs font-medium text-gray-700 truncate flex-1">
                    {sound.species}
                  </span>
                  <span className="text-xs text-gray-500">
                    {sound.frequency.toFixed(0)}Hz
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Information */}
        <div className="mt-6 p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200">
          <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <Volume2 size={16} className="text-purple-600" />
            How it works
          </h4>
          <ul className="text-xs text-gray-700 space-y-1">
            <li>• <strong>Each species</strong> is assigned a unique musical note</li>
            <li>• <strong>Observation count</strong> determines volume (louder = more observations)</li>
            <li>• <strong>Species order</strong> creates the melodic sequence</li>
            <li>• <strong>Tempo</strong> controls the speed of playback</li>
            <li>• <strong>Scale</strong> sets the musical mood and cultural feel</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
