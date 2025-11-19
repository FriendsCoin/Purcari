/**
 * Anomaly Detection Visualization for biodiversity data
 */

import { useMemo, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ZAxis, Cell } from 'recharts';
import { detectAnomalies, extractSpeciesFeatures, normalizeFeatures, performPCA } from '@/utils/mlAnalysis';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

interface AnomalyDetectionProps {
  speciesData: Record<string, number>;
  threshold?: number;
}

interface AnomalyPoint {
  x: number;
  y: number;
  name: string;
  score: number;
  isAnomaly: boolean;
  count: number;
}

export function AnomalyDetection({ speciesData, threshold = 2 }: AnomalyDetectionProps) {
  const [selectedPoint, setSelectedPoint] = useState<AnomalyPoint | null>(null);

  const { anomalies, normalData, stats } = useMemo(() => {
    // Extract and normalize features
    const features = extractSpeciesFeatures(speciesData);
    const featureMatrix = features.map(f => [
      f.count,
      f.nightRatio,
      f.dayRatio,
      f.diversity,
      f.seasonalVariance,
      f.spatialSpread
    ]);

    const normalized = normalizeFeatures(featureMatrix);

    // Detect anomalies
    const anomalyResult = detectAnomalies(normalized, threshold);

    // Reduce to 2D for visualization using PCA
    const pca = performPCA(normalized, 2);

    // Create visualization data
    const points: AnomalyPoint[] = features.map((f, i) => ({
      x: pca.data[i][0],
      y: pca.data[i][1],
      name: f.name,
      score: anomalyResult.scores[i],
      isAnomaly: anomalyResult.isAnomaly[i],
      count: f.count
    }));

    const anomalies = points.filter(p => p.isAnomaly);
    const normalData = points.filter(p => !p.isAnomaly);

    const stats = {
      total: points.length,
      anomalies: anomalies.length,
      normal: normalData.length,
      anomalyRate: (anomalies.length / points.length) * 100,
      avgScore: anomalyResult.scores.reduce((a, b) => a + b, 0) / anomalyResult.scores.length,
      maxScore: Math.max(...anomalyResult.scores),
      threshold: anomalyResult.threshold
    };

    return { anomalies, normalData, stats };
  }, [speciesData, threshold]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as AnomalyPoint;
      return (
        <div className="bg-black bg-opacity-90 text-white p-4 rounded-lg shadow-xl max-w-xs">
          <p className="font-bold text-lg mb-2">{data.name}</p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-gray-300">Observations:</span>
              <span className="font-semibold">{data.count}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-300">Anomaly Score:</span>
              <span className={`font-semibold ${data.isAnomaly ? 'text-red-400' : 'text-green-400'}`}>
                {data.score.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-300">Status:</span>
              <span className={`font-semibold ${data.isAnomaly ? 'text-red-400' : 'text-green-400'}`}>
                {data.isAnomaly ? 'Anomaly' : 'Normal'}
              </span>
            </div>
          </div>
          {data.isAnomaly && (
            <div className="mt-2 pt-2 border-t border-gray-600 text-xs text-yellow-300">
              This species shows unusual patterns compared to others
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-xl p-6 shadow-lg">
      <div className="mb-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">Anomaly Detection Analysis</h3>
        <p className="text-gray-600">
          Identifying unusual species patterns using statistical outlier detection
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
          <div className="text-sm text-blue-700 mb-1">Total Species</div>
          <div className="text-3xl font-bold text-blue-900">{stats.total}</div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
          <div className="text-sm text-green-700 mb-1">Normal Patterns</div>
          <div className="text-3xl font-bold text-green-900">{stats.normal}</div>
        </div>

        <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 rounded-lg border border-red-200">
          <div className="text-sm text-red-700 mb-1">Anomalies Detected</div>
          <div className="text-3xl font-bold text-red-900">{stats.anomalies}</div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200">
          <div className="text-sm text-purple-700 mb-1">Anomaly Rate</div>
          <div className="text-3xl font-bold text-purple-900">{stats.anomalyRate.toFixed(1)}%</div>
        </div>
      </div>

      {/* Scatter Plot */}
      <div className="mb-6 bg-gradient-to-br from-gray-50 to-white p-4 rounded-lg border border-gray-200">
        <h4 className="font-bold text-gray-900 mb-4">Species Distribution (PCA Projection)</h4>
        <ResponsiveContainer width="100%" height={500}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name="Principal Component 1"
              label={{ value: 'PC1', position: 'insideBottom', offset: -10 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Principal Component 2"
              label={{ value: 'PC2', angle: -90, position: 'insideLeft' }}
            />
            <ZAxis type="number" dataKey="count" range={[50, 400]} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              height={36}
              iconType="circle"
            />
            <Scatter
              name="Normal Species"
              data={normalData}
              fill="#10B981"
              onClick={(data) => setSelectedPoint(data)}
            >
              {normalData.map((_entry, index) => (
                <Cell key={`normal-${index}`} fill="#10B981" opacity={0.7} />
              ))}
            </Scatter>
            <Scatter
              name="Anomalous Species"
              data={anomalies}
              fill="#EF4444"
              onClick={(data) => setSelectedPoint(data)}
            >
              {anomalies.map((_entry, index) => (
                <Cell key={`anomaly-${index}`} fill="#EF4444" opacity={0.9} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Anomalies List */}
      {anomalies.length > 0 && (
        <div className="mb-6">
          <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="text-red-500" size={20} />
            Detected Anomalies
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {anomalies
              .sort((a, b) => b.score - a.score)
              .map((anomaly, index) => (
                <div
                  key={index}
                  className="bg-red-50 border border-red-200 rounded-lg p-4 hover:bg-red-100 transition-colors cursor-pointer"
                  onClick={() => setSelectedPoint(anomaly)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">{anomaly.name}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        {anomaly.count} observations
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Score</div>
                      <div className="text-lg font-bold text-red-600">
                        {anomaly.score.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 bg-red-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-red-600 h-full rounded-full"
                      style={{ width: `${Math.min((anomaly.score / stats.maxScore) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Info Panel */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
        <h4 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
          <Info size={18} className="text-blue-600" />
          How Anomaly Detection Works
        </h4>
        <div className="text-sm text-gray-700 space-y-2">
          <p>
            This analysis uses <strong>statistical outlier detection</strong> to identify species with
            unusual behavioral patterns compared to the overall ecosystem.
          </p>
          <p>
            <strong>Features analyzed:</strong> observation count, day/night activity ratios,
            diversity contribution, seasonal variance, and spatial spread.
          </p>
          <p>
            <strong>Anomaly Score:</strong> Higher scores indicate greater deviation from typical patterns.
            Threshold is set at {stats.threshold.toFixed(1)} standard deviations.
          </p>
          <p className="text-blue-700">
            <CheckCircle2 className="inline mr-1" size={14} />
            Anomalies may represent rare species, unusual behaviors, or data quality issues requiring further investigation.
          </p>
        </div>
      </div>

      {/* Selected Point Detail */}
      {selectedPoint && (
        <div className="mt-4 bg-gray-800 text-white p-4 rounded-lg">
          <div className="flex justify-between items-start mb-2">
            <h4 className="font-bold text-lg">{selectedPoint.name}</h4>
            <button
              onClick={() => setSelectedPoint(null)}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-gray-400 text-sm">Observations</div>
              <div className="text-xl font-bold">{selectedPoint.count}</div>
            </div>
            <div>
              <div className="text-gray-400 text-sm">Anomaly Score</div>
              <div className={`text-xl font-bold ${selectedPoint.isAnomaly ? 'text-red-400' : 'text-green-400'}`}>
                {selectedPoint.score.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
