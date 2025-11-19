/**
 * 3D Species Clustering Visualization using PCA/t-SNE
 */

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { performPCA, performKMeans, extractSpeciesFeatures, normalizeFeatures } from '@/utils/mlAnalysis';

interface SpeciesClustering3DProps {
  speciesData: Record<string, number>;
  numClusters?: number;
  showLabels?: boolean;
  autoRotate?: boolean;
}

interface ClusterPoint {
  position: [number, number, number];
  label: string;
  cluster: number;
  size: number;
}

function ClusterPoints({ points, showLabels }: { points: ClusterPoint[]; showLabels: boolean }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.001;
    }
  });

  const clusterColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7B801', '#E83F6F', '#2AB7CA', '#FE4A49', '#00B4D8'
  ];

  return (
    <group ref={groupRef}>
      {points.map((point, i) => (
        <group key={i} position={point.position}>
          <mesh>
            <sphereGeometry args={[point.size, 32, 32]} />
            <meshStandardMaterial
              color={clusterColors[point.cluster % clusterColors.length]}
              emissive={clusterColors[point.cluster % clusterColors.length]}
              emissiveIntensity={0.3}
              metalness={0.8}
              roughness={0.2}
            />
          </mesh>

          {showLabels && (
            <Html distanceFactor={10}>
              <div className="bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded whitespace-nowrap pointer-events-none">
                {point.label}
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}

function ClusterCentroids({ centroids }: { centroids: [number, number, number][] }) {
  const clusterColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7B801', '#E83F6F', '#2AB7CA', '#FE4A49', '#00B4D8'
  ];

  return (
    <group>
      {centroids.map((position, i) => (
        <group key={i} position={position}>
          <mesh>
            <octahedronGeometry args={[0.3, 0]} />
            <meshStandardMaterial
              color={clusterColors[i % clusterColors.length]}
              wireframe
              emissive={clusterColors[i % clusterColors.length]}
              emissiveIntensity={0.5}
            />
          </mesh>
          <Text
            position={[0, 0.5, 0]}
            fontSize={0.2}
            color="white"
            anchorX="center"
            anchorY="middle"
          >
            Cluster {i + 1}
          </Text>
        </group>
      ))}
    </group>
  );
}

function Axes() {
  return (
    <group>
      {/* X axis - Red */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([-10, 0, 0, 10, 0, 0])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#ff0000" />
      </line>
      <Text position={[10.5, 0, 0]} fontSize={0.3} color="#ff0000">
        PC1
      </Text>

      {/* Y axis - Green */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0, -10, 0, 0, 10, 0])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#00ff00" />
      </line>
      <Text position={[0, 10.5, 0]} fontSize={0.3} color="#00ff00">
        PC2
      </Text>

      {/* Z axis - Blue */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0, 0, -10, 0, 0, 10])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#0000ff" />
      </line>
      <Text position={[0, 0, 10.5]} fontSize={0.3} color="#0000ff">
        PC3
      </Text>
    </group>
  );
}

export function SpeciesClustering3D({
  speciesData,
  numClusters = 3,
  showLabels = false,
  autoRotate = true
}: SpeciesClustering3DProps) {
  const clusterData = useMemo(() => {
    // Extract features from species data
    const features = extractSpeciesFeatures(speciesData);

    // Convert to numeric array
    const featureMatrix = features.map(f => [
      f.count,
      f.nightRatio,
      f.dayRatio,
      f.diversity,
      f.seasonalVariance,
      f.spatialSpread
    ]);

    // Normalize features
    const normalized = normalizeFeatures(featureMatrix);

    // Perform PCA to reduce to 3D
    const pca = performPCA(normalized, 3);

    // Perform K-means clustering
    const clusters = performKMeans(normalized, numClusters);

    // Calculate point sizes based on count
    const maxCount = Math.max(...features.map(f => f.count));
    const minSize = 0.1;
    const maxSize = 0.5;

    // Create cluster points
    const points: ClusterPoint[] = features.map((f, i) => {
      const size = minSize + (f.count / maxCount) * (maxSize - minSize);
      return {
        position: [
          pca.data[i][0] * 8,
          pca.data[i][1] * 8,
          pca.data[i][2] * 8
        ] as [number, number, number],
        label: f.name,
        cluster: clusters.clusters[i],
        size
      };
    });

    // Convert centroids to 3D positions
    const centroids3D = clusters.centroids.map(centroid => {
      // Project centroid to PCA space (approximate)
      return [
        (centroid[0] - 0.5) * 16,
        (centroid[1] - 0.5) * 16,
        (centroid[2] - 0.5) * 16
      ] as [number, number, number];
    });

    return {
      points,
      centroids: centroids3D,
      variance: pca.variance
    };
  }, [speciesData, numClusters]);

  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-900 to-purple-900">
      <Canvas camera={{ position: [15, 15, 15], fov: 60 }}>
        {/* Lighting */}
        <ambientLight intensity={0.3} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <pointLight position={[-10, -10, -10]} intensity={0.5} color="#4ECDC4" />

        {/* Background stars */}
        <mesh>
          <sphereGeometry args={[50, 32, 32]} />
          <meshBasicMaterial color="#000000" side={THREE.BackSide} />
        </mesh>

        {/* Axes */}
        <Axes />

        {/* Cluster Points */}
        <ClusterPoints points={clusterData.points} showLabels={showLabels} />

        {/* Centroids */}
        <ClusterCentroids centroids={clusterData.centroids} />

        {/* Controls */}
        <OrbitControls
          autoRotate={autoRotate}
          autoRotateSpeed={0.5}
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>

      {/* Stats overlay */}
      <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white p-4 rounded-lg text-sm">
        <h4 className="font-bold mb-2">PCA Variance Explained</h4>
        <div className="space-y-1">
          <div>PC1: {(clusterData.variance[0] * 100).toFixed(1)}%</div>
          <div>PC2: {(clusterData.variance[1] * 100).toFixed(1)}%</div>
          <div>PC3: {(clusterData.variance[2] * 100).toFixed(1)}%</div>
          <div className="pt-2 border-t border-gray-600">
            Total: {(clusterData.variance.reduce((a, b) => a + b, 0) * 100).toFixed(1)}%
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-600">
          <div className="font-semibold">Controls:</div>
          <div className="text-xs text-gray-300 mt-1">
            Drag to rotate • Scroll to zoom
          </div>
        </div>
      </div>
    </div>
  );
}
