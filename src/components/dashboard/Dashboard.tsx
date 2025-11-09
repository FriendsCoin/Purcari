import { useState } from 'react';
import { StatisticsCards } from './StatisticsCards';
import { HypothesisCard } from '../analysis/HypothesisCard';
import { HypothesisModal } from '../analysis/HypothesisModal';
import { ProjectCard } from '../projects/ProjectCard';
import { ProjectModal } from '../projects/ProjectModal';
import { Button } from '../common/Button';
import { ArrowLeft } from 'lucide-react';
import type { AnalysisData, Project, Hypothesis, Hotspot } from '@/types';

interface DashboardProps {
  analysis: AnalysisData;
  projects: Project[];
  hotspots: Hotspot[];
  onBack: () => void;
}

export function Dashboard({ analysis, projects, hotspots, onBack }: DashboardProps) {
  const [selectedHypothesis, setSelectedHypothesis] = useState<Hypothesis | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'hypotheses' | 'projects'>('overview');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg">
        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2">Purcari Biodiversity Dashboard</h1>
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
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <StatisticsCards analysis={analysis} />

            {/* Species Distribution */}
            <div className="bg-white rounded-2xl shadow-md p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Species Distribution</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Birds</p>
                  <p className="text-3xl font-bold text-blue-600">{analysis.types.bird || 0}</p>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Mammals</p>
                  <p className="text-3xl font-bold text-orange-600">{analysis.types.mammal || 0}</p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Common Species</p>
                  <p className="text-3xl font-bold text-green-600">{analysis.common?.length || 0}</p>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Rare Species</p>
                  <p className="text-3xl font-bold text-purple-600">{analysis.rare?.length || 0}</p>
                </div>
              </div>
            </div>

            {/* Top Species */}
            <div className="bg-white rounded-2xl shadow-md p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Top Species Detected</h2>
              <div className="space-y-3">
                {Object.entries(analysis.species)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([species, count]) => {
                    const maxCount = Math.max(...Object.values(analysis.species));
                    const percentage = (count / maxCount) * 100;
                    return (
                      <div key={species}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-gray-700">{species}</span>
                          <span className="text-gray-500">{count} detections</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-purple-600 to-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
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
    </div>
  );
}
