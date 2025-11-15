import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';

interface ParticleSystemProps {
  count?: number;
  species?: Array<{ name: string; count: number; color: string }>;
}

function ParticleField({ count = 2000, species }: ParticleSystemProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);

  // Generate particle positions and colors based on biodiversity data
  const [positions, colors] = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    // Color palette for different species types
    const colorPalette = species
      ? species.map(s => new THREE.Color(s.color))
      : [
          new THREE.Color('#4F46E5'), // Indigo - Mammals
          new THREE.Color('#EC4899'), // Pink - Birds
          new THREE.Color('#10B981'), // Green - Plants
          new THREE.Color('#F59E0B'), // Amber - Insects
          new THREE.Color('#8B5CF6'), // Purple - Rare species
        ];

    for (let i = 0; i < count; i++) {
      // Create spherical distribution with clustered regions (hotspots)
      const radius = 2 + Math.random() * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      // Assign colors based on species distribution
      const colorIndex = Math.floor(Math.random() * colorPalette.length);
      const color = colorPalette[colorIndex];
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    return [positions, colors];
  }, [count, species]);

  // Animate particles in organic, flowing patterns
  useFrame(() => {
    if (!pointsRef.current) return;

    timeRef.current += 0.01;
    const time = timeRef.current;

    // Rotate the entire system slowly
    pointsRef.current.rotation.y = time * 0.05;
    pointsRef.current.rotation.x = Math.sin(time * 0.02) * 0.1;

    // Animate individual particles
    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const x = positions[i3];
      const y = positions[i3 + 1];
      const z = positions[i3 + 2];

      // Add gentle wave motion
      positions[i3] = x + Math.sin(time + i * 0.1) * 0.002;
      positions[i3 + 1] = y + Math.cos(time + i * 0.1) * 0.002;
      positions[i3 + 2] = z + Math.sin(time * 0.5 + i * 0.05) * 0.002;
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true;

    // Pulse effect
    const scale = 1 + Math.sin(time * 0.5) * 0.05;
    pointsRef.current.scale.set(scale, scale, scale);
  });

  return (
    <Points ref={pointsRef} positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        vertexColors
        size={0.015}
        sizeAttenuation
        depthWrite={false}
        opacity={0.8}
        blending={THREE.AdditiveBlending}
      />
      <bufferAttribute
        attach="geometry-attributes-color"
        args={[colors, 3]}
        count={count}
        itemSize={3}
      />
    </Points>
  );
}

// Connection lines between particles (ecosystem relationships)
function Connections({ count = 50 }: { count?: number }) {
  const linesRef = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 6); // 2 points per line
    const colors = new Float32Array(count * 6);

    for (let i = 0; i < count; i++) {
      const i6 = i * 6;

      // Random start and end points
      const radius1 = 2 + Math.random() * 3;
      const theta1 = Math.random() * Math.PI * 2;
      const phi1 = Math.acos(Math.random() * 2 - 1);

      const radius2 = 2 + Math.random() * 3;
      const theta2 = Math.random() * Math.PI * 2;
      const phi2 = Math.acos(Math.random() * 2 - 1);

      positions[i6] = radius1 * Math.sin(phi1) * Math.cos(theta1);
      positions[i6 + 1] = radius1 * Math.sin(phi1) * Math.sin(theta1);
      positions[i6 + 2] = radius1 * Math.cos(phi1);

      positions[i6 + 3] = radius2 * Math.sin(phi2) * Math.cos(theta2);
      positions[i6 + 4] = radius2 * Math.sin(phi2) * Math.sin(theta2);
      positions[i6 + 5] = radius2 * Math.cos(phi2);

      // Subtle purple-blue gradient for connections
      const color = new THREE.Color('#8B5CF6');
      for (let j = 0; j < 6; j += 3) {
        colors[i6 + j] = color.r;
        colors[i6 + j + 1] = color.g;
        colors[i6 + j + 2] = color.b;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geom;
  }, [count]);

  useFrame(() => {
    if (!linesRef.current) return;
    linesRef.current.rotation.y += 0.001;
  });

  return (
    <lineSegments ref={linesRef} geometry={geometry}>
      <lineBasicMaterial
        transparent
        vertexColors
        opacity={0.15}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

interface ParticleEcosystemProps {
  particleCount?: number;
  showConnections?: boolean;
  species?: Array<{ name: string; count: number; color: string }>;
}

export function ParticleEcosystem({
  particleCount = 2000,
  showConnections = true,
  species,
}: ParticleEcosystemProps) {
  return (
    <div className="absolute inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 75 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#000000']} />
        <fog attach="fog" args={['#000000', 5, 15]} />

        {/* Ambient lighting */}
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={0.8} color="#4F46E5" />
        <pointLight position={[-10, -10, -10]} intensity={0.6} color="#EC4899" />

        {/* Main particle field */}
        <ParticleField count={particleCount} species={species} />

        {/* Ecosystem connections */}
        {showConnections && <Connections count={100} />}
      </Canvas>
    </div>
  );
}
