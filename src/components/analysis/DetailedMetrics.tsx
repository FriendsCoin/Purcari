import { useState } from 'react';
import { BarChart3, Filter } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/common/Card';
import type { DetailedMetrics as DetailedMetricsType } from '@/services/csvParser';

interface DetailedMetricsProps {
  metrics: DetailedMetricsType[];
}

export function DetailedMetrics({ metrics }: DetailedMetricsProps) {
  const [selectedFilter, setSelectedFilter] = useState<'all species' | 'wild species'>('all species');

  if (metrics.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-gray-500">No detailed metrics available</p>
        </CardContent>
      </Card>
    );
  }

  const filteredMetrics = metrics.filter(m => m.filter === selectedFilter);

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-purple-100 to-indigo-100 rounded-xl">
              <BarChart3 size={24} className="text-indigo-600" />
            </div>
            <div>
              <CardTitle className="text-xl">Detailed Biodiversity Metrics</CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Shannon, Simpson indices and species richness
              </p>
            </div>
          </div>

          {/* Filter Toggle */}
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setSelectedFilter('all species')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                selectedFilter === 'all species'
                  ? 'bg-white text-purple-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              All Species
            </button>
            <button
              onClick={() => setSelectedFilter('wild species')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                selectedFilter === 'wild species'
                  ? 'bg-white text-purple-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Wild Species
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">
          {filteredMetrics.map((metric) => (
            <div
              key={`${metric.site}-${metric.filter}`}
              className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-6 border border-gray-200 hover:border-purple-300 transition-colors"
            >
              {/* Site Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{metric.site}</h3>
                  <p className="text-sm text-gray-500">
                    {metric.filter === 'all species' ? 'Including domesticated' : 'Wild only'}
                  </p>
                </div>
                <div className="flex items-center gap-2 bg-purple-100 px-3 py-1 rounded-full">
                  <Filter size={14} className="text-purple-600" />
                  <span className="text-xs font-semibold text-purple-700">
                    {metric.richness} species
                  </span>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-3 gap-4">
                {/* Shannon Index */}
                <div className="bg-white rounded-lg p-4 border border-blue-200">
                  <p className="text-xs text-gray-500 mb-1">Shannon Index</p>
                  <p className="text-2xl font-bold text-blue-600">{metric.shannon.toFixed(2)}</p>
                  <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-400 to-blue-600"
                      style={{ width: `${(metric.shannon / 3.0) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Diversity: {getQualitativeRating(metric.shannon, 'shannon')}</p>
                </div>

                {/* Simpson Index */}
                <div className="bg-white rounded-lg p-4 border border-purple-200">
                  <p className="text-xs text-gray-500 mb-1">Simpson Index</p>
                  <p className="text-2xl font-bold text-purple-600">{metric.simpson.toFixed(2)}</p>
                  <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-400 to-purple-600"
                      style={{ width: `${metric.simpson * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Dominance: {getQualitativeRating(metric.simpson, 'simpson')}</p>
                </div>

                {/* Species Richness */}
                <div className="bg-white rounded-lg p-4 border border-green-200">
                  <p className="text-xs text-gray-500 mb-1">Species Richness</p>
                  <p className="text-2xl font-bold text-green-600">{metric.richness}</p>
                  <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-green-400 to-green-600"
                      style={{ width: `${(metric.richness / 40) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Total species count</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Understanding the Metrics</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="font-semibold text-blue-900 mb-1">Shannon Index (H&apos;)</p>
              <p className="text-blue-700">
                Measures both richness and evenness. Range: 0-5. Higher values indicate more diverse ecosystems.
              </p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3">
              <p className="font-semibold text-purple-900 mb-1">Simpson Index (D)</p>
              <p className="text-purple-700">
                Probability that two randomly selected individuals are different species. Range: 0-1. Higher = more diverse.
              </p>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <p className="font-semibold text-green-900 mb-1">Species Richness (S)</p>
              <p className="text-green-700">
                Total number of different species present. Simple count of biodiversity.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Provides qualitative rating for metrics
 */
function getQualitativeRating(value: number, type: 'shannon' | 'simpson'): string {
  if (type === 'shannon') {
    if (value >= 2.5) return 'Very High';
    if (value >= 2.0) return 'High';
    if (value >= 1.5) return 'Moderate';
    if (value >= 1.0) return 'Low';
    return 'Very Low';
  } else {
    // simpson
    if (value >= 0.85) return 'Excellent';
    if (value >= 0.75) return 'Good';
    if (value >= 0.6) return 'Moderate';
    if (value >= 0.4) return 'Low';
    return 'Poor';
  }
}
