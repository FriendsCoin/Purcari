/**
 * Neural Network Architecture Visualization
 */

import { useEffect, useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import * as THREE from 'three';

interface NeuralNetworkVizProps {
  architecture?: number[]; // e.g., [6, 16, 8, 4] for input -> hidden1 -> hidden2 -> output
  isTraining?: boolean;
  accuracy?: number;
}

interface Neuron {
  position: [number, number, number];
  layer: number;
  index: number;
  activation: number;
}

interface Connection {
  from: [number, number, number];
  to: [number, number, number];
  weight: number;
}

function AnimatedNeuron({
  position,
  activation,
  isTraining
}: {
  position: [number, number, number];
  activation: number;
  isTraining: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    if (meshRef.current && isTraining) {
      // Pulse effect during training
      const pulse = Math.sin(state.clock.elapsedTime * 3) * 0.1 + 1;
      meshRef.current.scale.setScalar(pulse);
    }
  });

  const color = new THREE.Color().setHSL(0.6 - activation * 0.4, 0.8, 0.5);

  return (
    <mesh
      ref={meshRef}
      position={position}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      scale={hovered ? 1.3 : 1}
    >
      <sphereGeometry args={[0.15, 32, 32]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={activation * 0.5}
        metalness={0.5}
        roughness={0.3}
      />
    </mesh>
  );
}

function NeuronConnection({ from, to, weight }: Connection) {
  const opacity = Math.abs(weight);
  const color = weight > 0 ? '#4ECDC4' : '#FF6B6B';

  return (
    <Line
      points={[from, to]}
      color={color}
      lineWidth={Math.abs(weight) * 2}
      transparent
      opacity={opacity * 0.5}
    />
  );
}

function NetworkLayer({
  neurons,
  isTraining
}: {
  neurons: Neuron[];
  isTraining: boolean;
}) {
  return (
    <group>
      {neurons.map((neuron, i) => (
        <AnimatedNeuron
          key={i}
          position={neuron.position}
          activation={neuron.activation}
          isTraining={isTraining}
        />
      ))}
    </group>
  );
}

function NetworkConnections({ connections }: { connections: Connection[] }) {
  return (
    <group>
      {connections.map((conn, i) => (
        <NeuronConnection key={i} {...conn} />
      ))}
    </group>
  );
}

function DataFlow() {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 50;

  useFrame(() => {
    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3;
        // Move particles from left to right (through network layers)
        positions[idx] += 0.05; // x

        // Reset when reaching end
        if (positions[idx] > 10) {
          positions[idx] = -10;
          positions[idx + 1] = (Math.random() - 0.5) * 4;
          positions[idx + 2] = (Math.random() - 0.5) * 4;
        }
      }

      particlesRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 8;
  }

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.1}
        color="#FFA07A"
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  );
}

export function NeuralNetworkViz({
  architecture = [6, 16, 8, 4],
  isTraining = false,
  accuracy = 0
}: NeuralNetworkVizProps) {
  const [neurons, setNeurons] = useState<Neuron[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);

  useEffect(() => {
    // Generate neuron positions
    const allNeurons: Neuron[] = [];
    const allConnections: Connection[] = [];

    const layerSpacing = 5;
    const startX = -(architecture.length - 1) * layerSpacing / 2;

    architecture.forEach((layerSize, layerIdx) => {
      const x = startX + layerIdx * layerSpacing;
      const startY = -(layerSize - 1) / 2;

      for (let i = 0; i < layerSize; i++) {
        const neuron: Neuron = {
          position: [x, startY + i, 0],
          layer: layerIdx,
          index: i,
          activation: Math.random()
        };
        allNeurons.push(neuron);

        // Create connections to next layer
        if (layerIdx < architecture.length - 1) {
          const nextLayerSize = architecture[layerIdx + 1];
          const nextStartY = -(nextLayerSize - 1) / 2;
          const nextX = x + layerSpacing;

          for (let j = 0; j < nextLayerSize; j++) {
            allConnections.push({
              from: [x, startY + i, 0],
              to: [nextX, nextStartY + j, 0],
              weight: Math.random() * 2 - 1 // Random weight between -1 and 1
            });
          }
        }
      }
    });

    setNeurons(allNeurons);
    setConnections(allConnections);

    // Animate activations during training
    if (isTraining) {
      const interval = setInterval(() => {
        setNeurons(prev => prev.map(n => ({
          ...n,
          activation: Math.random()
        })));
      }, 500);

      return () => clearInterval(interval);
    }
  }, [architecture, isTraining]);

  const layerNames = ['Input', ...Array(architecture.length - 2).fill('Hidden'), 'Output'];

  return (
    <div className="w-full h-full bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900">
      <Canvas camera={{ position: [0, 0, 20], fov: 60 }}>
        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <pointLight position={[-10, 10, -10]} intensity={0.5} color="#4ECDC4" />

        {/* Network visualization */}
        <NetworkConnections connections={connections} />
        <NetworkLayer neurons={neurons} isTraining={isTraining} />

        {/* Data flow particles */}
        {isTraining && <DataFlow />}

        {/* Layer labels */}
        {architecture.map((size, idx) => {
          const layerSpacing = 5;
          const startX = -(architecture.length - 1) * layerSpacing / 2;
          const x = startX + idx * layerSpacing;

          return (
            <group key={idx}>
              <Text
                position={[x, -(size / 2) - 1, 0]}
                fontSize={0.4}
                color="white"
                anchorX="center"
              >
                {layerNames[idx]}
              </Text>
              <Text
                position={[x, -(size / 2) - 1.5, 0]}
                fontSize={0.25}
                color="#9CA3AF"
                anchorX="center"
              >
                ({size} neurons)
              </Text>
            </group>
          );
        })}

        <OrbitControls enableDamping dampingFactor={0.05} />
      </Canvas>

      {/* Info overlay */}
      <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white p-4 rounded-lg text-sm space-y-2">
        <div>
          <span className="font-bold">Architecture:</span> {architecture.join(' → ')}
        </div>
        <div>
          <span className="font-bold">Total Neurons:</span>{' '}
          {architecture.reduce((a, b) => a + b, 0)}
        </div>
        <div>
          <span className="font-bold">Connections:</span> {connections.length}
        </div>
        {accuracy > 0 && (
          <div>
            <span className="font-bold">Accuracy:</span> {(accuracy * 100).toFixed(1)}%
          </div>
        )}
        <div className={`flex items-center gap-2 ${isTraining ? 'text-green-400' : 'text-gray-400'}`}>
          <div className={`w-2 h-2 rounded-full ${isTraining ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
          {isTraining ? 'Training...' : 'Idle'}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-black bg-opacity-75 text-white p-4 rounded-lg text-xs space-y-2">
        <div className="font-bold mb-2">Legend:</div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-cyan-400" />
          <span>Positive Weight</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <span>Negative Weight</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-500 to-cyan-300" />
          <span>Neuron Activation</span>
        </div>
      </div>
    </div>
  );
}
