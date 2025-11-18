import { MapPin, Award, TrendingUp } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/common/Card';
import type { SiteDiversity } from '@/services/csvParser';

interface SiteComparisonProps {
  sites: SiteDiversity[];
}

export function SiteComparison({ sites }: SiteComparisonProps) {
  if (sites.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-gray-500">No site data available</p>
        </CardContent>
      </Card>
    );
  }

  // Sort by Shannon diversity (highest first)
  const sortedSites = [...sites].sort((a, b) => b.shannon - a.shannon);
  const maxShannon = sortedSites[0]?.shannon || 1;
  const topSite = sortedSites[0];

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-green-100 to-emerald-100 rounded-xl">
              <MapPin size={24} className="text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-xl">Site Biodiversity Comparison</CardTitle>
              <p className="text-sm text-gray-600 mt-1">Shannon diversity index across locations</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-emerald-100 px-4 py-2 rounded-full">
            <Award size={20} className="text-emerald-600" />
            <span className="text-sm font-bold text-emerald-700">Winner: {topSite?.site}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">
          {sortedSites.map((site, index) => {
            const percentage = (site.shannon / maxShannon) * 100;
            const isTop = index === 0;

            // Medal colors
            const borderColor = isTop
              ? 'border-l-yellow-500'
              : index === 1
              ? 'border-l-gray-400'
              : index === 2
              ? 'border-l-orange-400'
              : 'border-l-blue-400';

            return (
              <div
                key={site.site}
                className={`relative border-l-4 ${borderColor} pl-4 py-2 ${
                  isTop ? 'bg-gradient-to-r from-yellow-50 to-transparent' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {index < 3 && (
                      <span className="text-2xl">
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                      </span>
                    )}
                    <div>
                      <h3 className="font-semibold text-gray-900">{site.site}</h3>
                      <p className="text-xs text-gray-500">Monitoring location #{index + 1}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-gray-900">{site.shannon.toFixed(2)}</p>
                    <p className="text-xs text-gray-500">Shannon Index</p>
                  </div>
                </div>

                <div className="relative h-4 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-700 ${
                      isTop
                        ? 'bg-gradient-to-r from-yellow-400 to-yellow-600'
                        : 'bg-gradient-to-r from-emerald-400 to-emerald-600'
                    }`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>

                {isTop && (
                  <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-yellow-400 border-2 border-white rounded-full flex items-center justify-center shadow-lg">
                    <TrendingUp size={16} className="text-white" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Info Box */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <span>📊</span>
              About Shannon Diversity Index
            </h4>
            <p className="text-xs text-gray-600 leading-relaxed">
              The Shannon Diversity Index measures both species richness and evenness. Higher values (2.0-3.0) indicate greater biodiversity.
              <span className="font-semibold text-emerald-700"> {topSite?.site}</span> shows the highest diversity at{' '}
              <span className="font-semibold text-emerald-700">{topSite?.shannon.toFixed(2)}</span>, suggesting a
              healthy and balanced ecosystem.
            </p>
          </div>
        </div>

        {/* Statistics */}
        <div className="mt-4 grid grid-cols-3 gap-4 text-center">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Sites Monitored</p>
            <p className="text-xl font-bold text-gray-900">{sites.length}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Highest Index</p>
            <p className="text-xl font-bold text-emerald-600">{maxShannon.toFixed(2)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Avg. Diversity</p>
            <p className="text-xl font-bold text-gray-900">
              {(sites.reduce((sum, s) => sum + s.shannon, 0) / sites.length).toFixed(2)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
