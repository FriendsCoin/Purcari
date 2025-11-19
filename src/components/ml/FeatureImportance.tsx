/**
 * Feature Importance Visualization
 */

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { calculateFeatureImportance, extractSpeciesFeatures, normalizeFeatures } from '@/utils/mlAnalysis';

interface FeatureImportanceProps {
  speciesData: Record<string, number>;
}

const featureDescriptions: Record<string, string> = {
  'Observation Count': 'Total number of observations for the species',
  'Night Activity': 'Proportion of nocturnal observations',
  'Day Activity': 'Proportion of diurnal observations',
  'Relative Diversity': 'Species contribution to overall diversity',
  'Seasonal Variance': 'Variation in observations across seasons',
  'Spatial Spread': 'Geographic distribution of observations'
};

export function FeatureImportance({ speciesData }: FeatureImportanceProps) {
  const importanceData = useMemo(() => {
    // Extract features
    const features = extractSpeciesFeatures(speciesData);

    // Convert to matrix
    const featureMatrix = features.map(f => [
      f.count,
      f.nightRatio,
      f.dayRatio,
      f.diversity,
      f.seasonalVariance,
      f.spatialSpread
    ]);

    // Normalize
    const normalized = normalizeFeatures(featureMatrix);

    // Calculate importance
    const featureNames = [
      'Observation Count',
      'Night Activity',
      'Day Activity',
      'Relative Diversity',
      'Seasonal Variance',
      'Spatial Spread'
    ];

    const importance = calculateFeatureImportance(normalized, featureNames);

    return importance.map(item => ({
      name: item.name,
      importance: item.importance * 100,
      description: featureDescriptions[item.name] || ''
    }));
  }, [speciesData]);

  const getColor = (importance: number) => {
    if (importance > 80) return '#10B981'; // green
    if (importance > 60) return '#3B82F6'; // blue
    if (importance > 40) return '#F59E0B'; // yellow
    if (importance > 20) return '#EF4444'; // red
    return '#6B7280'; // gray
  };

  return (
    <div className="bg-white rounded-xl p-6 shadow-lg">
      <div className="mb-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Feature Importance Analysis</h3>
        <p className="text-gray-600">
          Understanding which features contribute most to species classification and patterns
        </p>
      </div>

      <div className="mb-6">
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={importanceData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 150, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" domain={[0, 100]} label={{ value: 'Importance (%)', position: 'insideBottom', offset: -5 }} />
            <YAxis type="category" dataKey="name" width={140} />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-black bg-opacity-90 text-white p-3 rounded-lg shadow-xl max-w-xs">
                      <p className="font-bold mb-1">{data.name}</p>
                      <p className="text-sm mb-2">{data.description}</p>
                      <p className="text-lg font-bold" style={{ color: getColor(data.importance) }}>
                        {data.importance.toFixed(1)}%
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
            <Bar dataKey="importance" name="Importance Score" radius={[0, 8, 8, 0]}>
              {importanceData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getColor(entry.importance)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {importanceData.map((feature, index) => (
          <div
            key={index}
            className="bg-gradient-to-r from-gray-50 to-white p-4 rounded-lg border-l-4"
            style={{ borderColor: getColor(feature.importance) }}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="font-semibold text-gray-900">{feature.name}</div>
              <div
                className="text-lg font-bold"
                style={{ color: getColor(feature.importance) }}
              >
                {feature.importance.toFixed(1)}%
              </div>
            </div>
            <p className="text-sm text-gray-600">{feature.description}</p>
            <div className="mt-2 bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${feature.importance}%`,
                  backgroundColor: getColor(feature.importance)
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
        <h4 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
          <span>💡</span>
          Interpretation Guide
        </h4>
        <div className="text-sm text-gray-700 space-y-1">
          <p>
            <strong className="text-green-600">High Importance (80-100%):</strong> Critical features
            that strongly differentiate species behavior patterns
          </p>
          <p>
            <strong className="text-blue-600">Medium-High (60-80%):</strong> Important features
            that contribute significantly to understanding
          </p>
          <p>
            <strong className="text-yellow-600">Medium (40-60%):</strong> Moderate features
            with some predictive value
          </p>
          <p>
            <strong className="text-red-600">Low (&lt;40%):</strong> Features with minimal
            variance or predictive power
          </p>
        </div>
      </div>
    </div>
  );
}
