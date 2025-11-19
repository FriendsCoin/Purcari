/**
 * Time Series Forecasting for Species Population Prediction
 */

import { useMemo } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { forecastTimeSeries } from '@/utils/mlAnalysis';
import { TrendingUp, Calendar, Target } from 'lucide-react';

interface TimeSeriesForecastingProps {
  historicalData?: { month: string; count: number }[];
  speciesName?: string;
  forecastSteps?: number;
}

export function TimeSeriesForecasting({
  historicalData,
  speciesName = 'All Species',
  forecastSteps = 6
}: TimeSeriesForecastingProps) {
  const { chartData, metrics } = useMemo(() => {
    // Generate sample historical data if not provided
    const data = historicalData || [
      { month: 'Jan', count: 120 },
      { month: 'Feb', count: 145 },
      { month: 'Mar', count: 180 },
      { month: 'Apr', count: 210 },
      { month: 'May', count: 250 },
      { month: 'Jun', count: 280 },
      { month: 'Jul', count: 260 },
      { month: 'Aug', count: 240 },
      { month: 'Sep', count: 200 },
      { month: 'Oct', count: 170 },
      { month: 'Nov', count: 140 },
      { month: 'Dec', count: 130 }
    ];

    const historicalCounts = data.map(d => d.count);
    const { forecast, confidence } = forecastTimeSeries(historicalCounts, forecastSteps, 3);

    // Generate future month names
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const lastMonth = data.length - 1;
    const futureMonths = Array.from({ length: forecastSteps }, (_, i) => {
      const monthIndex = (lastMonth + 1 + i) % 12;
      return months[monthIndex];
    });

    // Combine historical and forecast data
    const chartData = [
      ...data.map(d => ({
        month: d.month,
        actual: d.count,
        forecast: null,
        upperBound: null,
        lowerBound: null,
        type: 'historical' as const
      })),
      ...forecast.map((f, i) => ({
        month: futureMonths[i],
        actual: null,
        forecast: Math.round(f),
        upperBound: Math.round(f + confidence[i]),
        lowerBound: Math.round(Math.max(0, f - confidence[i])),
        type: 'forecast' as const
      }))
    ];

    // Calculate metrics
    const avgHistorical = historicalCounts.reduce((a, b) => a + b, 0) / historicalCounts.length;
    const avgForecast = forecast.reduce((a, b) => a + b, 0) / forecast.length;
    const trend = ((avgForecast - avgHistorical) / avgHistorical) * 100;
    const maxForecast = Math.max(...forecast);
    const minForecast = Math.min(...forecast);

    const metrics = {
      avgHistorical: Math.round(avgHistorical),
      avgForecast: Math.round(avgForecast),
      trend,
      maxForecast: Math.round(maxForecast),
      minForecast: Math.round(minForecast),
      avgConfidence: Math.round(confidence.reduce((a, b) => a + b, 0) / confidence.length)
    };

    return { chartData, metrics };
  }, [historicalData, forecastSteps]);

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { month: string; actual: number | null; forecast: number | null; lowerBound: number | null; upperBound: number | null } }> }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-black bg-opacity-90 text-white p-4 rounded-lg shadow-xl">
          <p className="font-bold mb-2">{data.month}</p>
          {data.actual !== null && (
            <div className="text-sm">
              <span className="text-blue-300">Actual: </span>
              <span className="font-semibold">{data.actual} observations</span>
            </div>
          )}
          {data.forecast !== null && (
            <>
              <div className="text-sm">
                <span className="text-green-300">Forecast: </span>
                <span className="font-semibold">{data.forecast} observations</span>
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Range: {data.lowerBound} - {data.upperBound}
              </div>
            </>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-xl p-6 shadow-lg">
      <div className="mb-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Time Series Forecasting</h3>
        <p className="text-gray-600">
          Predicting future {speciesName} population trends using historical data
        </p>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
          <div className="flex items-center gap-2 text-blue-700 text-sm mb-1">
            <Calendar size={16} />
            Historical Avg
          </div>
          <div className="text-2xl font-bold text-blue-900">{metrics.avgHistorical}</div>
          <div className="text-xs text-blue-600 mt-1">per month</div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
          <div className="flex items-center gap-2 text-green-700 text-sm mb-1">
            <Target size={16} />
            Forecast Avg
          </div>
          <div className="text-2xl font-bold text-green-900">{metrics.avgForecast}</div>
          <div className="text-xs text-green-600 mt-1">predicted</div>
        </div>

        <div className={`bg-gradient-to-br ${metrics.trend >= 0 ? 'from-emerald-50 to-emerald-100 border-emerald-200' : 'from-red-50 to-red-100 border-red-200'} p-4 rounded-lg border`}>
          <div className={`flex items-center gap-2 ${metrics.trend >= 0 ? 'text-emerald-700' : 'text-red-700'} text-sm mb-1`}>
            <TrendingUp size={16} className={metrics.trend < 0 ? 'rotate-180' : ''} />
            Trend
          </div>
          <div className={`text-2xl font-bold ${metrics.trend >= 0 ? 'text-emerald-900' : 'text-red-900'}`}>
            {metrics.trend >= 0 ? '+' : ''}{metrics.trend.toFixed(1)}%
          </div>
          <div className={`text-xs ${metrics.trend >= 0 ? 'text-emerald-600' : 'text-red-600'} mt-1`}>
            {metrics.trend >= 0 ? 'increasing' : 'decreasing'}
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200">
          <div className="text-purple-700 text-sm mb-1">Range</div>
          <div className="text-lg font-bold text-purple-900">
            {metrics.minForecast} - {metrics.maxForecast}
          </div>
          <div className="text-xs text-purple-600 mt-1">±{metrics.avgConfidence} avg</div>
        </div>
      </div>

      {/* Main Chart */}
      <div className="mb-6 bg-gradient-to-br from-gray-50 to-white p-4 rounded-lg border border-gray-200">
        <h4 className="font-bold text-gray-900 mb-4">Historical Data & Forecast</h4>
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.1}/>
              </linearGradient>
              <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#10B981" stopOpacity={0.1}/>
              </linearGradient>
              <linearGradient id="colorConfidence" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.05}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis label={{ value: 'Observations', angle: -90, position: 'insideLeft' }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />

            {/* Confidence interval area */}
            <Area
              type="monotone"
              dataKey="upperBound"
              stroke="none"
              fill="url(#colorConfidence)"
              name="Confidence Interval"
              fillOpacity={1}
            />
            <Area
              type="monotone"
              dataKey="lowerBound"
              stroke="none"
              fill="#fff"
              fillOpacity={1}
            />

            {/* Historical data */}
            <Area
              type="monotone"
              dataKey="actual"
              stroke="#3B82F6"
              strokeWidth={2}
              fill="url(#colorActual)"
              name="Historical Data"
              connectNulls={false}
            />

            {/* Forecast */}
            <Area
              type="monotone"
              dataKey="forecast"
              stroke="#10B981"
              strokeWidth={2}
              strokeDasharray="5 5"
              fill="url(#colorForecast)"
              name="Forecast"
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Forecast Table */}
      <div className="bg-gradient-to-br from-gray-50 to-white p-4 rounded-lg border border-gray-200 mb-6">
        <h4 className="font-bold text-gray-900 mb-3">Detailed Forecast</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b-2 border-gray-300">
              <tr>
                <th className="text-left p-3 font-semibold">Month</th>
                <th className="text-right p-3 font-semibold">Predicted</th>
                <th className="text-right p-3 font-semibold">Lower Bound</th>
                <th className="text-right p-3 font-semibold">Upper Bound</th>
                <th className="text-right p-3 font-semibold">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {chartData.filter(d => d.type === 'forecast').map((row, i) => (
                <tr key={i} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="p-3 font-medium">{row.month}</td>
                  <td className="p-3 text-right font-semibold text-green-700">{row.forecast}</td>
                  <td className="p-3 text-right text-gray-600">{row.lowerBound}</td>
                  <td className="p-3 text-right text-gray-600">{row.upperBound}</td>
                  <td className="p-3 text-right">
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                      ±{row.upperBound! - row.forecast!}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-4 rounded-lg border border-indigo-200">
        <h4 className="font-bold text-gray-900 mb-2">About This Forecast</h4>
        <div className="text-sm text-gray-700 space-y-2">
          <p>
            This forecast uses a <strong>moving average</strong> algorithm to predict future observations
            based on recent historical patterns.
          </p>
          <p>
            <strong>Confidence intervals</strong> (shown as shaded area) represent the uncertainty
            in predictions, calculated at 95% confidence level.
          </p>
          <p className="text-indigo-700">
            <strong>Note:</strong> Forecasts are probabilistic and should be used as guidance.
            Actual results may vary due to environmental changes, seasonality, and other factors.
          </p>
        </div>
      </div>
    </div>
  );
}
