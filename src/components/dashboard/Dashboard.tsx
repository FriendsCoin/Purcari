import { useState } from 'react';
import { StatisticsCards } from './StatisticsCards';
import { HypothesisCard } from '../analysis/HypothesisCard';
import { HypothesisModal } from '../analysis/HypothesisModal';
import { TemporalTrends } from '../analysis/TemporalTrends';
import { SiteComparison } from '../analysis/SiteComparison';
import { DetailedMetrics } from '../analysis/DetailedMetrics';
import { ProjectCard } from '../projects/ProjectCard';
import { ProjectModal } from '../projects/ProjectModal';
import { Button } from '../common/Button';
import { ArrowLeft, Database, Sparkles } from 'lucide-react';
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
  hotspots,
  isRealData = false,
  monthlyTrends = [],
  siteDiversity = [],
  detailedMetrics = [],
  onBack
}: DashboardProps) {
  const [selectedHypothesis, setSelectedHypothesis] = useState<Hypothesis | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'hypotheses' | 'projects' | 'real-data'>('overview');

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
