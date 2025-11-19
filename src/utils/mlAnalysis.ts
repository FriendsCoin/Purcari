/**
 * Machine Learning utilities for biodiversity data analysis
 */

import { PCA } from 'ml-pca';
import { Matrix } from 'ml-matrix';
import { kmeans } from 'ml-kmeans';
import * as tf from '@tensorflow/tfjs';

export interface SpeciesFeatures {
  name: string;
  count: number;
  nightRatio: number;
  dayRatio: number;
  diversity: number;
  seasonalVariance: number;
  spatialSpread: number;
}

export interface ClusterResult {
  clusters: number[];
  centroids: number[][];
  labels: string[];
}

export interface PCAResult {
  data: number[][];
  variance: number[];
  labels: string[];
}

export interface AnomalyResult {
  isAnomaly: boolean[];
  scores: number[];
  threshold: number;
}

/**
 * Normalize features to 0-1 range
 */
export function normalizeFeatures(data: number[][]): number[][] {
  const matrix = new Matrix(data);
  const cols = matrix.columns;
  const normalized: number[][] = [];

  for (let i = 0; i < matrix.rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      const col = matrix.getColumn(j);
      const min = Math.min(...col);
      const max = Math.max(...col);
      const value = matrix.get(i, j);
      row.push(max === min ? 0 : (value - min) / (max - min));
    }
    normalized.push(row);
  }

  return normalized;
}

/**
 * Perform PCA dimensionality reduction
 */
export function performPCA(data: number[][], components: number = 2): PCAResult {
  const matrix = new Matrix(data);
  const pca = new PCA(matrix, { scale: true });

  const reducedData = pca.predict(matrix, { nComponents: components }).to2DArray();
  const variance = pca.getExplainedVariance();

  return {
    data: reducedData,
    variance: variance.slice(0, components),
    labels: Array.from({ length: data.length }, (_, i) => `Point ${i + 1}`)
  };
}

/**
 * Perform K-means clustering
 */
export function performKMeans(data: number[][], k: number = 3): ClusterResult {
  const result = kmeans(data, k, {
    initialization: 'kmeans++',
    maxIterations: 100
  });

  return {
    clusters: result.clusters,
    centroids: result.centroids,
    labels: result.clusters.map((c) => `Cluster ${c + 1}`)
  };
}

/**
 * t-SNE dimensionality reduction (simplified PCA-based approximation)
 * For true t-SNE, consider using a dedicated library
 */
export function performTSNE(data: number[][], _perplexity: number = 30): PCAResult {
  // For now, using PCA as a fast approximation
  // In production, integrate a proper t-SNE library like tsne-js
  const normalized = normalizeFeatures(data);
  return performPCA(normalized, 2);
}

/**
 * Detect anomalies using Isolation Forest approximation
 */
export function detectAnomalies(data: number[][], threshold: number = 2): AnomalyResult {
  const normalized = normalizeFeatures(data);
  const matrix = new Matrix(normalized);

  // Calculate distance from mean as anomaly score
  const means = matrix.mean('column');
  const stds = matrix.standardDeviation('column', { mean: means });

  const scores: number[] = [];
  const isAnomaly: boolean[] = [];

  for (let i = 0; i < matrix.rows; i++) {
    let score = 0;
    for (let j = 0; j < matrix.columns; j++) {
      const value = matrix.get(i, j);
      const mean = means[j];
      const std = stds[j] || 1;
      score += Math.abs((value - mean) / std);
    }
    score /= matrix.columns;
    scores.push(score);
    isAnomaly.push(score > threshold);
  }

  return {
    isAnomaly,
    scores,
    threshold
  };
}

/**
 * Calculate feature importance using variance
 */
export function calculateFeatureImportance(
  data: number[][],
  featureNames: string[]
): { name: string; importance: number }[] {
  const matrix = new Matrix(data);
  const variances = matrix.standardDeviation('column');

  const maxVar = Math.max(...variances);

  return featureNames.map((name, i) => ({
    name,
    importance: variances[i] / maxVar
  })).sort((a, b) => b.importance - a.importance);
}

/**
 * Simple time series forecasting using moving average
 */
export function forecastTimeSeries(
  data: number[],
  steps: number = 7,
  windowSize: number = 5
): { forecast: number[]; confidence: number[] } {
  const forecast: number[] = [];
  const confidence: number[] = [];

  let current = [...data];

  for (let i = 0; i < steps; i++) {
    const window = current.slice(-windowSize);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const std = Math.sqrt(
      window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / window.length
    );

    forecast.push(mean);
    confidence.push(std * 1.96); // 95% confidence interval
    current.push(mean);
  }

  return { forecast, confidence };
}

/**
 * Train a simple neural network for species classification
 * Returns the model for visualization
 */
export async function trainSpeciesClassifier(
  features: number[][],
  labels: number[],
  epochs: number = 50
): Promise<tf.LayersModel> {
  const inputDim = features[0].length;
  const numClasses = Math.max(...labels) + 1;

  // Create a simple feedforward neural network
  const model = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [inputDim], units: 16, activation: 'relu' }),
      tf.layers.dropout({ rate: 0.2 }),
      tf.layers.dense({ units: 8, activation: 'relu' }),
      tf.layers.dense({ units: numClasses, activation: 'softmax' })
    ]
  });

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'sparseCategoricalCrossentropy',
    metrics: ['accuracy']
  });

  const xs = tf.tensor2d(features);
  const ys = tf.tensor1d(labels, 'int32');

  await model.fit(xs, ys, {
    epochs,
    validationSplit: 0.2,
    shuffle: true,
    verbose: 0
  });

  xs.dispose();
  ys.dispose();

  return model;
}

/**
 * Extract species features from biodiversity data
 */
export function extractSpeciesFeatures(
  speciesData: Record<string, number>,
  additionalMetrics?: {
    nightCounts?: Record<string, number>;
    dayCounts?: Record<string, number>;
    seasonalData?: Record<string, number[]>;
  }
): SpeciesFeatures[] {
  const species = Object.keys(speciesData);
  const counts = Object.values(speciesData);
  const totalCount = counts.reduce((a, b) => a + b, 0);

  return species.map((name) => {
    const count = speciesData[name];
    const nightCount = additionalMetrics?.nightCounts?.[name] || count * 0.5;
    const dayCount = additionalMetrics?.dayCounts?.[name] || count * 0.5;

    return {
      name,
      count,
      nightRatio: nightCount / count,
      dayRatio: dayCount / count,
      diversity: count / totalCount,
      seasonalVariance: additionalMetrics?.seasonalData?.[name]
        ? calculateVariance(additionalMetrics.seasonalData[name])
        : 0.5,
      spatialSpread: Math.random() // Placeholder - would calculate from spatial data
    };
  });
}

/**
 * Calculate variance of an array
 */
function calculateVariance(data: number[]): number {
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
  return Math.sqrt(variance);
}

/**
 * Create confusion matrix from predictions and true labels
 */
export function createConfusionMatrix(
  predictions: number[],
  trueLabels: number[],
  numClasses: number
): number[][] {
  const matrix: number[][] = Array.from({ length: numClasses }, () =>
    Array(numClasses).fill(0)
  );

  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const actual = trueLabels[i];
    matrix[actual][pred]++;
  }

  return matrix;
}
