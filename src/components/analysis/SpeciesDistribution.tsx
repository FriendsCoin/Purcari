import { PieChart, BarChart3 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/common/Card';
import type { AnalysisData } from '@/types';

interface SpeciesDistributionProps {
  analysis: AnalysisData;
}

export function SpeciesDistribution({ analysis }: SpeciesDistributionProps) {
  // Get top 10 species by count
  const topSpecies = Object.entries(analysis.species)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 10);

  const maxCount = topSpecies[0]?.[1] || 1;

  // Color palette for species
  const colors = [
    'from-blue-500 to-blue-600',
    'from-purple-500 to-purple-600',
    'from-pink-500 to-pink-600',
    'from-red-500 to-red-600',
    'from-orange-500 to-orange-600',
    'from-yellow-500 to-yellow-600',
    'from-green-500 to-green-600',
    'from-teal-500 to-teal-600',
    'from-cyan-500 to-cyan-600',
    'from-indigo-500 to-indigo-600',
  ];

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-orange-100 to-red-100 rounded-xl">
              <BarChart3 size={24} className="text-red-600" />
            </div>
            <div>
              <CardTitle className="text-xl">Species Distribution</CardTitle>
              <p className="text-sm text-gray-600 mt-1">Top 10 most observed species</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-red-100 px-4 py-2 rounded-full">
            <PieChart size={20} className="text-red-600" />
            <span className="text-sm font-bold text-red-700">
              {Object.keys(analysis.species).length} total species
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          {topSpecies.map(([species, count], index) => {
            const percentage = (count / maxCount) * 100;
            const colorClass = colors[index];

            return (
              <div key={species} className="space-y-2 animate-fade-in" style={{ animationDelay: `${index * 50}ms` }}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-gray-400 w-6">
                      #{index + 1}
                    </span>
                    <span className="font-medium text-gray-700">{species}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-gray-900">{count as number}</span>
                    <span className="text-sm text-gray-500 w-24 text-right">
                      {(((count as number) / analysis.summary.total) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="relative">
                  <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${colorClass} transition-all duration-700 rounded-full`}
                      style={{
                        width: `${percentage}%`,
                        transitionDelay: `${index * 50}ms`
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary Statistics */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3">
              <p className="text-xs text-blue-600 font-semibold">Total Species</p>
              <p className="text-2xl font-bold text-blue-900">
                {Object.keys(analysis.species).length}
              </p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3">
              <p className="text-xs text-green-600 font-semibold">Observations</p>
              <p className="text-2xl font-bold text-green-900">
                {analysis.summary.total}
              </p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3">
              <p className="text-xs text-purple-600 font-semibold">Most Common</p>
              <p className="text-lg font-bold text-purple-900 truncate">
                {topSpecies[0]?.[0] || 'N/A'}
              </p>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-3">
              <p className="text-xs text-orange-600 font-semibold">Rare Species</p>
              <p className="text-2xl font-bold text-orange-900">
                {Object.values(analysis.species).filter(count => count === 1).length}
              </p>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 p-4 bg-gradient-to-r from-gray-50 to-white rounded-lg border border-gray-200">
          <p className="text-xs text-gray-600 leading-relaxed">
            <span className="font-semibold text-gray-900">Distribution Analysis:</span> The chart shows the top 10 most frequently observed species.
            Species with only one observation are considered rare and may indicate recent arrivals or transient visitors to the ecosystem.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
