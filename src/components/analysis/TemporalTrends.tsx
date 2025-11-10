import { TrendingUp, Calendar } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/common/Card';
import type { MonthlyTrend } from '@/services/csvParser';

interface TemporalTrendsProps {
  trends: MonthlyTrend[];
}

export function TemporalTrends({ trends }: TemporalTrendsProps) {
  if (trends.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-gray-500">No temporal data available</p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(...trends.map(t => t.count));
  const totalGrowth = trends.length > 1
    ? ((trends[trends.length - 1].count - trends[0].count) / trends[0].count * 100).toFixed(0)
    : 0;

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl">
              <Calendar size={24} className="text-purple-600" />
            </div>
            <div>
              <CardTitle className="text-xl">Species Temporal Trends</CardTitle>
              <p className="text-sm text-gray-600 mt-1">Monthly species count progression</p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 text-green-600">
              <TrendingUp size={20} />
              <span className="text-2xl font-bold">+{totalGrowth}%</span>
            </div>
            <p className="text-xs text-gray-500">Growth rate</p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          {trends.map((trend, index) => {
            const percentage = (trend.count / maxCount) * 100;
            const monthName = new Date(trend.month + '-01').toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            });

            // Color gradient based on position
            const colors = [
              'from-blue-500 to-blue-600',
              'from-purple-500 to-purple-600',
              'from-pink-500 to-pink-600',
            ];
            const colorClass = colors[index % colors.length];

            return (
              <div key={trend.month} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-700">{monthName}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-gray-900">{trend.count}</span>
                    <span className="text-sm text-gray-500">species</span>
                  </div>
                </div>
                <div className="relative">
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${colorClass} transition-all duration-500 rounded-full`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  {index < trends.length - 1 && (
                    <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-6 h-6 bg-white border-2 border-purple-500 rounded-full flex items-center justify-center">
                      <TrendingUp size={12} className="text-purple-600" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-gray-500">Starting</p>
              <p className="text-lg font-bold text-gray-900">{trends[0]?.count || 0}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Peak</p>
              <p className="text-lg font-bold text-gray-900">{maxCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Growth</p>
              <p className="text-lg font-bold text-green-600">+{totalGrowth}%</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
