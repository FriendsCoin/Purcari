import { Clock, Sunrise, Sunset, Moon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/common/Card';
import type { AnalysisData } from '@/types';

interface HourlyActivityHeatmapProps {
  analysis: AnalysisData;
}

export function HourlyActivityHeatmap({ analysis }: HourlyActivityHeatmapProps) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const maxActivity = Math.max(...Object.values(analysis.hourly).map(v => v as number), 1);

  // Get activity level for each hour
  const getActivity = (hour: number) => analysis.hourly[hour] || 0;

  // Get color intensity based on activity
  const getHeatColor = (activity: number): string => {
    const intensity = activity / maxActivity;
    if (intensity === 0) return 'bg-gray-100';
    if (intensity < 0.2) return 'bg-blue-200';
    if (intensity < 0.4) return 'bg-blue-300';
    if (intensity < 0.6) return 'bg-blue-400';
    if (intensity < 0.8) return 'bg-blue-500';
    return 'bg-blue-600';
  };

  // Get time period icon and label
  const getTimePeriod = (hour: number) => {
    if (hour >= 5 && hour < 12) return { icon: Sunrise, label: 'Morning', color: 'text-yellow-600' };
    if (hour >= 12 && hour < 17) return { icon: Clock, label: 'Afternoon', color: 'text-orange-600' };
    if (hour >= 17 && hour < 21) return { icon: Sunset, label: 'Evening', color: 'text-red-600' };
    return { icon: Moon, label: 'Night', color: 'text-indigo-600' };
  };

  // Calculate peak activity time
  const peakHour = Object.entries(analysis.hourly)
    .sort(([, a], [, b]) => (b as number) - (a as number))[0];

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-indigo-100 to-blue-100 rounded-xl">
              <Clock size={24} className="text-indigo-600" />
            </div>
            <div>
              <CardTitle className="text-xl">24-Hour Activity Pattern</CardTitle>
              <p className="text-sm text-gray-600 mt-1">Species observation heatmap by hour</p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 bg-indigo-100 px-4 py-2 rounded-full">
              <Clock size={20} className="text-indigo-600" />
              <span className="text-sm font-bold text-indigo-700">
                Peak: {peakHour ? `${peakHour[0]}:00` : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Heatmap Grid */}
        <div className="grid grid-cols-12 gap-2 mb-6">
          {hours.map((hour) => {
            const activity = getActivity(hour);
            const percentage = maxActivity > 0 ? (activity / maxActivity) * 100 : 0;
            const period = getTimePeriod(hour);
            const Icon = period.icon;

            return (
              <div
                key={hour}
                className="group relative"
              >
                <div
                  className={`
                    ${getHeatColor(activity)}
                    rounded-lg p-3 transition-all duration-300
                    hover:scale-110 hover:shadow-lg cursor-pointer
                    flex flex-col items-center justify-center
                    animate-scale-in
                  `}
                  style={{ animationDelay: `${hour * 30}ms` }}
                >
                  <div className="text-xs font-bold text-gray-700 mb-1">
                    {hour.toString().padStart(2, '0')}
                  </div>
                  <Icon size={16} className={period.color} />
                  <div className="text-xs font-semibold text-gray-900 mt-1">
                    {activity}
                  </div>
                </div>

                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                  <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                    <div className="font-semibold">{hour}:00 - {hour}:59</div>
                    <div className="text-gray-300">{activity} observations</div>
                    <div className="text-gray-400">{percentage.toFixed(0)}% of peak</div>
                  </div>
                  <div className="w-2 h-2 bg-gray-900 rotate-45 absolute left-1/2 -translate-x-1/2 -bottom-1"></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Time Period Summary */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { period: 'Morning', hours: '5-11', icon: Sunrise, range: [5, 11], color: 'yellow' },
            { period: 'Afternoon', hours: '12-16', icon: Clock, range: [12, 16], color: 'orange' },
            { period: 'Evening', hours: '17-20', icon: Sunset, range: [17, 20], color: 'red' },
            { period: 'Night', hours: '21-4', icon: Moon, range: [21, 4], color: 'indigo' },
          ].map(({ period, hours, icon: Icon, range, color }) => {
            const [start, end] = range;
            const periodActivity = Array.from(
              { length: end >= start ? end - start + 1 : 24 - start + end + 1 },
              (_, i) => {
                const hour = (start + i) % 24;
                return getActivity(hour);
              }
            ).reduce((sum, val) => sum + val, 0);

            return (
              <div
                key={period}
                className={`bg-gradient-to-br from-${color}-50 to-${color}-100 rounded-lg p-4 border border-${color}-200`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={18} className={`text-${color}-600`} />
                  <span className="text-xs font-semibold text-gray-700">{period}</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">{periodActivity}</div>
                <div className="text-xs text-gray-500">{hours} hours</div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="border-t border-gray-200 pt-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900">Activity Intensity</h4>
            <span className="text-xs text-gray-500">Lighter = Less Active | Darker = More Active</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Low</span>
            <div className="flex-1 flex gap-1">
              {['bg-gray-100', 'bg-blue-200', 'bg-blue-300', 'bg-blue-400', 'bg-blue-500', 'bg-blue-600'].map((color, i) => (
                <div key={i} className={`flex-1 h-6 ${color} rounded`}></div>
              ))}
            </div>
            <span className="text-xs text-gray-600">High</span>
          </div>
        </div>

        {/* Insights */}
        <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
          <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <span>🔍</span>
            Activity Insights
          </h4>
          <p className="text-xs text-gray-700 leading-relaxed">
            Peak wildlife activity occurs at <span className="font-semibold text-indigo-700">{peakHour?.[0]}:00</span> with{' '}
            <span className="font-semibold text-indigo-700">{peakHour?.[1]}</span> observations. This pattern helps identify optimal
            times for wildlife monitoring and can inform conservation strategies.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
