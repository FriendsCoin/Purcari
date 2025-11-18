import { TrendingUp, Clock, MapPin, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/components/common/Card';
import type { AnalysisData } from '@/types';

interface StatisticsCardsProps {
  analysis: AnalysisData;
}

export function StatisticsCards({ analysis }: StatisticsCardsProps) {
  const { summary, hourly, types } = analysis;

  const totalDetections = summary.total;
  const totalSpecies = summary.species;
  const hotspots = 6; // From mock data
  const peakHour = Object.entries(hourly).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {/* Total Detections */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Detections</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {totalDetections.toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-xl">
              <BarChart3 size={24} className="text-blue-600" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">May 29 - Aug 16, 2025</p>
        </CardContent>
      </Card>

      {/* Species Diversity */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Species Observed</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{totalSpecies}</p>
            </div>
            <div className="p-3 bg-green-100 rounded-xl">
              <TrendingUp size={24} className="text-green-600" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">
            Birds: {types.bird || 0} | Mammals: {types.mammal || 0}
          </p>
        </CardContent>
      </Card>

      {/* Monitoring Hotspots */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Hotspots</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{hotspots}</p>
            </div>
            <div className="p-3 bg-purple-100 rounded-xl">
              <MapPin size={24} className="text-purple-600" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">Camera trap locations</p>
        </CardContent>
      </Card>

      {/* Peak Activity */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Peak Activity</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {peakHour ? `${peakHour[0]}:00` : 'N/A'}
              </p>
            </div>
            <div className="p-3 bg-orange-100 rounded-xl">
              <Clock size={24} className="text-orange-600" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">
            {peakHour ? `${peakHour[1]} detections` : 'No data'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
