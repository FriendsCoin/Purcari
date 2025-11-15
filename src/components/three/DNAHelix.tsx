import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, Cylinder } from '@react-three/drei';
import * as THREE from 'three';

interface DNAStrandProps {
  height?: number;
  radius?: number;
  turns?: number;
  dataPoints?: number;
}

function DNAStrand({ height = 4, radius = 0.5, turns = 3, dataPoints = 60 }: DNAStrandProps) {
  const groupRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);

  // Generate helix positions
  const helixData = useMemo(() => {
    const points1: THREE.Vector3[] = [];
    const points2: THREE.Vector3[] = [];
    const connections: Array<{ start: THREE.Vector3; end: THREE.Vector3 }> = [];

    for (let i = 0; i < dataPoints; i++) {
      const t = (i / dataPoints) * turns * Math.PI * 2;
      const y = (i / dataPoints) * height - height / 2;

      // First strand
      const x1 = Math.cos(t) * radius;
      const z1 = Math.sin(t) * radius;
      points1.push(new THREE.Vector3(x1, y, z1));

      // Second strand (opposite side)
      const x2 = Math.cos(t + Math.PI) * radius;
      const z2 = Math.sin(t + Math.PI) * radius;
      points2.push(new THREE.Vector3(x2, y, z2));

      // Connections every few points
      if (i % 3 === 0) {
        connections.push({
          start: new THREE.Vector3(x1, y, z1),
          end: new THREE.Vector3(x2, y, z2),
        });
      }
    }

    return { points1, points2, connections };
  }, [height, radius, turns, dataPoints]);

  useFrame(() => {
    if (!groupRef.current) return;

    timeRef.current += 0.005;
    groupRef.current.rotation.y = timeRef.current;

    // Gentle floating motion
    groupRef.current.position.y = Math.sin(timeRef.current * 0.5) * 0.1;
  });

  return (
    <group ref={groupRef}>
      {/* First strand */}
      {helixData.points1.map((point, i) => (
        <Sphere key={`strand1-${i}`} args={[0.04, 16, 16]} position={point}>
          <meshStandardMaterial
            color="#4F46E5"
            emissive="#4F46E5"
            emissiveIntensity={0.3}
            metalness={0.8}
            roughness={0.2}
          />
        </Sphere>
      ))}

      {/* Second strand */}
      {helixData.points2.map((point, i) => (
        <Sphere key={`strand2-${i}`} args={[0.04, 16, 16]} position={point}>
          <meshStandardMaterial
            color="#EC4899"
            emissive="#EC4899"
            emissiveIntensity={0.3}
            metalness={0.8}
            roughness={0.2}
          />
        </Sphere>
      ))}

      {/* Connection rungs */}
      {helixData.connections.map((conn, i) => {
        const midpoint = new THREE.Vector3()
          .addVectors(conn.start, conn.end)
          .multiplyScalar(0.5);
        const direction = new THREE.Vector3()
          .subVectors(conn.end, conn.start);
        const length = direction.length();

        // Calculate rotation to align cylinder
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction.normalize()
        );
        const euler = new THREE.Euler().setFromQuaternion(quaternion);

        return (
          <Cylinder
            key={`conn-${i}`}
            args={[0.015, 0.015, length, 8]}
            position={midpoint}
            rotation={euler}
          >
            <meshStandardMaterial
              color="#8B5CF6"
              emissive="#8B5CF6"
              emissiveIntensity={0.2}
              metalness={0.6}
              roughness={0.4}
              transparent
              opacity={0.6}
            />
          </Cylinder>
        );
      })}
    </group>
  );
}

// Data flow particles along the helix
function DataFlowParticles({ count = 30 }: { count?: number }) {
  const particlesRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);

  const [positions, colors] = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const t = (i / count) * 3 * Math.PI * 2;
      const radius = 0.5 + Math.random() * 0.2;

      positions[i * 3] = Math.cos(t) * radius;
      positions[i * 3 + 1] = (i / count) * 4 - 2;
      positions[i * 3 + 2] = Math.sin(t) * radius;

      const color = new THREE.Color().setHSL(i / count, 0.8, 0.6);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    return [positions, colors];
  }, [count]);

  useFrame(() => {
    if (!particlesRef.current) return;

    timeRef.current += 0.02;
    const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const baseT = (i / count) * 3 * Math.PI * 2;
      const t = baseT + timeRef.current;
      const radius = 0.5 + Math.sin(timeRef.current + i * 0.1) * 0.1;

      positions[i3] = Math.cos(t) * radius;
      positions[i3 + 1] = ((i + timeRef.current * 5) % count / count) * 4 - 2;
      positions[i3 + 2] = Math.sin(t) * radius;
    }

    particlesRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={count}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        vertexColors
        transparent
        opacity={0.8}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

interface DNAHelixProps {
  height?: number;
  radius?: number;
  turns?: number;
  showDataFlow?: boolean;
}

export function DNAHelix({
  height = 4,
  radius = 0.5,
  turns = 3,
  showDataFlow = true,
}: DNAHelixProps) {
  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [2, 0, 3], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['transparent']} />

        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <pointLight position={[5, 5, 5]} intensity={1} color="#4F46E5" />
        <pointLight position={[-5, -5, -5]} intensity={0.8} color="#EC4899" />
        <spotLight
          position={[0, 5, 0]}
          angle={0.3}
          penumbra={1}
          intensity={0.5}
          castShadow
        />

        {/* DNA Helix */}
        <DNAStrand height={height} radius={radius} turns={turns} dataPoints={60} />

        {/* Data flow particles */}
        {showDataFlow && <DataFlowParticles count={40} />}
      </Canvas>
    </div>
  );
}
