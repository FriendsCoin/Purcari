import { useState } from 'react';
import { StatisticsCards } from './StatisticsCards';
import { HypothesisCard } from '../analysis/HypothesisCard';
import { HypothesisModal } from '../analysis/HypothesisModal';
import { TemporalTrends } from '../analysis/TemporalTrends';
import { SiteComparison } from '../analysis/SiteComparison';
import { DetailedMetrics } from '../analysis/DetailedMetrics';
import { SpeciesDistribution } from '../analysis/SpeciesDistribution';
import { HourlyActivityHeatmap } from '../analysis/HourlyActivityHeatmap';
import { DNAHelix } from '../three/DNAHelix';
import { SpeciesNetwork } from '../three/SpeciesNetwork';
import { BiodiversityGlobe } from '../three/BiodiversityGlobe';
import { InteractiveParticleSystem } from '../three/InteractiveParticles';
import { MediaControls } from '../three/MediaControls';
import { BiodiversitySynthesizer } from '../three/BiodiversitySynthesizer';
import { ARBiodiversityScene } from '../three/ARBiodiversityScene';
import { GestureController } from '../three/GestureController';
import { VoiceController } from '../three/VoiceController';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';
import { ProjectCard } from '../projects/ProjectCard';
import { ProjectModal } from '../projects/ProjectModal';
import { Button } from '../common/Button';
import { ArrowLeft, Database, Sparkles, Dna } from 'lucide-react';
import type { AnalysisData, Project, Hypothesis, Hotspot } from '@/types';
import type { MonthlyTrend, SiteDiversity, DetailedMetrics as DetailedMetricsType } from '@/services/csvParser';

interface DashboardProps {
  analysis: AnalysisData;
  projects: Project[];
  hotspots: Hotspot[];
  isRealData?: boolean;
  monthlyTrends?: MonthlyTrend[];
  siteDiversity?: SiteDiversity[];
  detailedMetrics?: DetailedMetricsType[];
  onBack: () => void;
}

export function Dashboard({
  analysis,
  projects,
  hotspots: _hotspots,
  isRealData = false,
  monthlyTrends = [],
  siteDiversity = [],
  detailedMetrics = [],
  onBack
}: DashboardProps) {
  const [selectedHypothesis, setSelectedHypothesis] = useState<Hypothesis | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'hypotheses' | 'projects' | 'real-data' | '3d-art'>('overview');

  // Interactive media state
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const [webcamVideo, setWebcamVideo] = useState<HTMLVideoElement | null>(null);

  // Audio analysis
  const { audioData } = useAudioAnalyzer(microphoneStream || undefined);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg">
        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-4xl font-bold">Purcari Biodiversity Dashboard</h1>
                {isRealData ? (
                  <span className="flex items-center gap-2 bg-blue-500 bg-opacity-30 px-3 py-1 rounded-full text-sm font-semibold">
                    <Database size={16} />
                    Real Data
                  </span>
                ) : (
                  <span className="flex items-center gap-2 bg-emerald-500 bg-opacity-30 px-3 py-1 rounded-full text-sm font-semibold">
                    <Sparkles size={16} />
                    Demo Data
                  </span>
                )}
              </div>
              <p className="text-purple-100">
                Analysis from {analysis.summary.start.toLocaleDateString()} to{' '}
                {analysis.summary.end.toLocaleDateString()}
              </p>
            </div>
            <Button variant="outline" onClick={onBack} className="bg-white text-purple-600 hover:bg-purple-50">
              <ArrowLeft size={20} className="mr-2" />
              Back to Upload
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-4 mt-6">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                activeTab === 'overview'
                  ? 'bg-white text-purple-600 shadow-md'
                  : 'bg-purple-500 bg-opacity-30 text-white hover:bg-opacity-50'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('hypotheses')}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                activeTab === 'hypotheses'
                  ? 'bg-white text-purple-600 shadow-md'
                  : 'bg-purple-500 bg-opacity-30 text-white hover:bg-opacity-50'
              }`}
            >
              Hypotheses ({analysis.hypotheses.length})
            </button>
            <button
              onClick={() => setActiveTab('projects')}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                activeTab === 'projects'
                  ? 'bg-white text-purple-600 shadow-md'
                  : 'bg-purple-500 bg-opacity-30 text-white hover:bg-opacity-50'
              }`}
            >
              Art Projects ({projects.length})
            </button>
            {isRealData && (
              <button
                onClick={() => setActiveTab('real-data')}
                className={`px-6 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                  activeTab === 'real-data'
                    ? 'bg-white text-purple-600 shadow-md'
                    : 'bg-purple-500 bg-opacity-30 text-white hover:bg-opacity-50'
                }`}
              >
                <Database size={18} />
                Real Data Analytics
              </button>
            )}
            <button
              onClick={() => setActiveTab('3d-art')}
              className={`px-6 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                activeTab === '3d-art'
                  ? 'bg-white text-purple-600 shadow-md'
                  : 'bg-purple-500 bg-opacity-30 text-white hover:bg-opacity-50'
              }`}
            >
              <Dna size={18} />
              3D Art Science
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-8 animate-fade-in">
            <StatisticsCards analysis={analysis} />

            {/* New Enhanced Visualizations */}
            <div className="grid grid-cols-1 gap-8">
              <SpeciesDistribution analysis={analysis} />
              <HourlyActivityHeatmap analysis={analysis} />
            </div>
          </div>
        )}

        {/* Hypotheses Tab */}
        {activeTab === 'hypotheses' && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Scientific Hypotheses</h2>
              <p className="text-gray-600">
                Click on any hypothesis to view detailed findings, methodology, and implications
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {analysis.hypotheses.map(hypothesis => (
                <HypothesisCard
                  key={hypothesis.id}
                  hypothesis={hypothesis}
                  onClick={() => setSelectedHypothesis(hypothesis)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Projects Tab */}
        {activeTab === 'projects' && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Recommended Art Installations
              </h2>
              <p className="text-gray-600">
                Data-driven project recommendations to showcase biodiversity insights through
                interactive art
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {projects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onClick={() => setSelectedProject(project)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Real Data Analytics Tab */}
        {activeTab === 'real-data' && isRealData && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Real Data Analytics</h2>
              <p className="text-gray-600">
                Analysis of actual field observations and biodiversity metrics from Purcari monitoring sites
              </p>
            </div>

            <div className="space-y-6">
              {/* Temporal Trends */}
              {monthlyTrends.length > 0 && <TemporalTrends trends={monthlyTrends} />}

              {/* Site Comparison */}
              {siteDiversity.length > 0 && <SiteComparison sites={siteDiversity} />}

              {/* Detailed Metrics */}
              {detailedMetrics.length > 0 && <DetailedMetrics metrics={detailedMetrics} />}

              {/* Summary Stats */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-200">
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Database className="text-blue-600" />
                  Data Summary
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg p-4">
                    <p className="text-sm text-gray-600">Total Observations</p>
                    <p className="text-3xl font-bold text-blue-600">{analysis.summary.total.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">From camera traps</p>
                  </div>
                  <div className="bg-white rounded-lg p-4">
                    <p className="text-sm text-gray-600">Unique Species</p>
                    <p className="text-3xl font-bold text-purple-600">{analysis.summary.species}</p>
                    <p className="text-xs text-gray-500 mt-1">Identified species</p>
                  </div>
                  <div className="bg-white rounded-lg p-4">
                    <p className="text-sm text-gray-600">Monitoring Sites</p>
                    <p className="text-3xl font-bold text-green-600">{siteDiversity.length}</p>
                    <p className="text-xs text-gray-500 mt-1">Active locations</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3D Art Science Tab */}
        {activeTab === '3d-art' && (
          <div>
            <div className="mb-6 text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-2 flex items-center justify-center gap-3">
                <Dna className="text-purple-600" size={32} />
                3D Art Science Visualizations
              </h2>
              <p className="text-gray-600 max-w-3xl mx-auto">
                Experience biodiversity data through immersive 3D visualizations that blend
                scientific accuracy with artistic beauty
              </p>
            </div>

            <div className="space-y-8">
              {/* Interactive Audio/Webcam Reactive Particles */}
              <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-6 border border-purple-200">
                <h3 className="text-2xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>🎨</span>
                  Interactive Particle System
                  <span className="text-xs bg-purple-600 text-white px-2 py-1 rounded-full ml-2">NEW</span>
                </h3>
                <p className="text-gray-700 mb-4">
                  <strong>Fully interactive!</strong> Enable your microphone to make particles dance to your voice.
                  Enable your webcam to see yourself become part of the art. Use your mouse to rotate and zoom.
                  Click the controls button below to activate.
                </p>
                <div className="relative w-full h-[500px] bg-gradient-to-br from-slate-900 via-purple-900 to-pink-900 rounded-xl overflow-hidden shadow-2xl">
                  <InteractiveParticleSystem
                    audioData={audioData}
                    webcamVideo={webcamVideo}
                    enableOrbitControls={true}
                    className="w-full h-full"
                  />
                </div>
              </div>

              {/* DNA Helix */}
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-6 border border-indigo-200">
                <h3 className="text-2xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>🧬</span>
                  DNA Data Flow
                </h3>
                <p className="text-gray-700 mb-4">
                  A rotating DNA helix with flowing data particles representing the genetic
                  diversity captured in biodiversity monitoring
                </p>
                <div className="w-full h-96 bg-gradient-to-br from-slate-900 to-purple-900 rounded-xl overflow-hidden shadow-2xl">
                  <DNAHelix height={4} radius={0.5} turns={3} showDataFlow={true} />
                </div>
              </div>

              {/* Species Network */}
              <div className="bg-gradient-to-br from-pink-50 to-red-50 rounded-2xl p-6 border border-pink-200">
                <h3 className="text-2xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>🕸️</span>
                  Species Ecosystem Network
                </h3>
                <p className="text-gray-700 mb-4">
                  An interactive 3D network showing the interconnected relationships between species.
                  Each node represents a species, sized by observation count. Hover to see details.
                </p>
                <div className="w-full h-96 bg-gradient-to-br from-slate-900 to-pink-900 rounded-xl overflow-hidden shadow-2xl">
                  <SpeciesNetwork
                    species={Object.entries(analysis.species).map(([name, count]) => ({
                      name,
                      count: count as number,
                      type: Object.keys(analysis.types).find(t =>
                        analysis.types[t] > 0
                      ) || 'mammal'
                    }))}
                    className="w-full h-full"
                  />
                </div>
              </div>

              {/* Biodiversity Globe */}
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl p-6 border border-blue-200">
                <h3 className="text-2xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>🌍</span>
                  Global Biodiversity Hotspots
                </h3>
                <p className="text-gray-700 mb-4">
                  A 3D globe visualization showing monitoring sites as glowing hotspots.
                  Hover over markers to see detailed statistics for each location.
                </p>
                <div className="w-full h-96 bg-gradient-to-br from-slate-900 to-blue-900 rounded-xl overflow-hidden shadow-2xl">
                  <BiodiversityGlobe
                    hotspots={_hotspots.map(h => ({
                      id: h.id,
                      name: h.name,
                      lat: h.lat,
                      lng: h.lng,
                      detections: h.detections,
                      species: h.species || 0
                    }))}
                    className="w-full h-full"
                    showParticles={true}
                  />
                </div>
              </div>

              {/* Data Sonification */}
              <div className="bg-gradient-to-br from-green-50 to-teal-50 rounded-2xl p-6 border border-green-200">
                <h3 className="text-2xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>🎵</span>
                  Data Sonification
                  <span className="text-xs bg-green-600 text-white px-2 py-1 rounded-full ml-2">NEW</span>
                </h3>
                <p className="text-gray-700 mb-4">
                  Listen to biodiversity! Each species becomes a musical note, observation counts control volume,
                  and the entire ecosystem plays as a unique composition. Science transformed into sound.
                </p>
                <BiodiversitySynthesizer speciesData={analysis.species} />
              </div>

              {/* Augmented Reality */}
              <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl p-6 border border-blue-200">
                <h3 className="text-2xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>📱</span>
                  Augmented Reality
                  <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded-full ml-2">NEW</span>
                </h3>
                <p className="text-gray-700 mb-4">
                  Step into a new dimension! Place 3D biodiversity models in your real environment using your phone's camera.
                  Experience the data in physical space, walk around species, and interact with nature in AR.
                </p>
                <ARBiodiversityScene species={Object.entries(analysis.species)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .slice(0, 5)
                  .map(([name, count]) => ({
                    name,
                    count: count as number,
                    type: 'mammal'
                  }))} />
              </div>

              {/* Gesture Controls */}
              <div className="bg-gradient-to-br from-pink-50 to-purple-50 rounded-2xl p-6 border border-pink-200">
                <h3 className="text-2xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>✨</span>
                  Gesture Controls
                  <span className="text-xs bg-pink-600 text-white px-2 py-1 rounded-full ml-2">NEW</span>
                </h3>
                <p className="text-gray-700 mb-4">
                  Control 3D visualizations with your hands! Use natural hand gestures to zoom, rotate, and interact
                  with the biodiversity data. Wave, point, make thumbs up - your hands become the controller.
                </p>
                <GestureController
                  onGestureDetected={(gesture) => {
                    console.log('Gesture detected:', gesture);
                  }}
                  showVideo={true}
                />
              </div>

              {/* Voice Commands */}
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-6 border border-indigo-200">
                <h3 className="text-2xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>🎤</span>
                  Voice Commands
                  <span className="text-xs bg-indigo-600 text-white px-2 py-1 rounded-full ml-2">NEW</span>
                </h3>
                <p className="text-gray-700 mb-4">
                  Talk to your data! Control visualizations with natural language voice commands. Say "zoom in",
                  "show species", or "play music" - your voice becomes the interface.
                </p>
                <VoiceController
                  onCommand={(command) => {
                    console.log('Voice command executed:', command);
                  }}
                />
              </div>

              {/* Art-Science Philosophy */}
              <div className="bg-gradient-to-br from-purple-100 to-pink-100 rounded-2xl p-8 border border-purple-300">
                <h3 className="text-2xl font-bold text-gray-900 mb-4 text-center">
                  💫 Art Meets Science
                </h3>
                <div className="grid md:grid-cols-3 gap-6 text-center">
                  <div>
                    <div className="text-4xl mb-2">🔬</div>
                    <h4 className="font-bold text-lg text-purple-900 mb-2">Scientific Rigor</h4>
                    <p className="text-sm text-gray-700">
                      Every visualization is built from real biodiversity data, maintaining
                      scientific accuracy while creating beauty
                    </p>
                  </div>
                  <div>
                    <div className="text-4xl mb-2">🎨</div>
                    <h4 className="font-bold text-lg text-pink-900 mb-2">Artistic Expression</h4>
                    <p className="text-sm text-gray-700">
                      Data transforms into living, breathing art that communicates the wonder
                      of biodiversity through visual storytelling
                    </p>
                  </div>
                  <div>
                    <div className="text-4xl mb-2">🌱</div>
                    <h4 className="font-bold text-lg text-green-900 mb-2">Ecological Impact</h4>
                    <p className="text-sm text-gray-700">
                      These visualizations engage audiences emotionally, inspiring conservation
                      action through the beauty of data
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <HypothesisModal
        hypothesis={selectedHypothesis}
        isOpen={!!selectedHypothesis}
        onClose={() => setSelectedHypothesis(null)}
      />

      <ProjectModal
        project={selectedProject}
        isOpen={!!selectedProject}
        onClose={() => setSelectedProject(null)}
      />

      {/* Media Controls - floating button for mic/webcam */}
      {activeTab === '3d-art' && (
        <MediaControls
          onMicrophoneStream={setMicrophoneStream}
          onWebcamStream={setWebcamVideo}
        />
      )}
    </div>
  );
}
