import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, Html } from '@react-three/drei';
import * as THREE from 'three';

interface Hotspot {
  id: number;
  name: string;
  lat: number;
  lng: number;
  detections: number;
  species: number;
}

interface HotspotMarkerProps {
  hotspot: Hotspot;
  globeRadius: number;
}

function HotspotMarker({ hotspot, globeRadius }: HotspotMarkerProps) {
  const markerRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // Convert lat/lng to 3D position on sphere
  const position = useMemo(() => {
    const phi = (90 - hotspot.lat) * (Math.PI / 180);
    const theta = (hotspot.lng + 180) * (Math.PI / 180);
    const radius = globeRadius + 0.05;

    return new THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
  }, [hotspot, globeRadius]);

  useFrame((state) => {
    if (!markerRef.current) return;

    // Gentle pulsing
    const scale = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
    markerRef.current.scale.setScalar(hovered ? scale * 1.3 : scale);
  });

  const markerSize = Math.log(hotspot.detections + 1) * 0.02 + 0.05;

  return (
    <group ref={markerRef} position={position}>
      {/* Main marker */}
      <Sphere
        args={[markerSize, 16, 16]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <meshStandardMaterial
          color="#EC4899"
          emissive="#EC4899"
          emissiveIntensity={hovered ? 1 : 0.5}
          transparent
          opacity={0.9}
        />
      </Sphere>

      {/* Pulse ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[markerSize * 1.2, markerSize * 1.5, 32]} />
        <meshBasicMaterial
          color="#EC4899"
          transparent
          opacity={hovered ? 0.4 : 0.2}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Info tooltip */}
      {hovered && (
        <Html distanceFactor={5} position={[0, markerSize * 2, 0]}>
          <div className="bg-gray-900 bg-opacity-95 text-white px-4 py-2 rounded-lg shadow-xl backdrop-blur-sm border border-pink-500 whitespace-nowrap animate-scale-in">
            <p className="font-bold text-sm mb-1">{hotspot.name}</p>
            <div className="text-xs space-y-0.5">
              <p className="text-pink-300">{hotspot.detections} detections</p>
              <p className="text-purple-300">{hotspot.species} species</p>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

function Globe({ hotspots, radius = 1.5 }: { hotspots: Hotspot[]; radius?: number }) {
  const globeRef = useRef<THREE.Mesh>(null);
  const atmosphereRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (globeRef.current) {
      globeRef.current.rotation.y += 0.001;
    }
    if (atmosphereRef.current) {
      atmosphereRef.current.rotation.y += 0.0015;
    }
  });

  // Create wireframe for the globe
  const wireframeGeometry = useMemo(() => {
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const edges = new THREE.EdgesGeometry(geometry, 15);
    return edges;
  }, [radius]);

  return (
    <group>
      {/* Main globe */}
      <Sphere ref={globeRef} args={[radius, 64, 64]}>
        <meshStandardMaterial
          color="#1a1a2e"
          emissive="#0f0f1e"
          emissiveIntensity={0.2}
          metalness={0.8}
          roughness={0.4}
          wireframe={false}
        />
      </Sphere>

      {/* Wireframe overlay */}
      <lineSegments geometry={wireframeGeometry}>
        <lineBasicMaterial color="#4F46E5" transparent opacity={0.3} />
      </lineSegments>

      {/* Atmosphere glow */}
      <Sphere ref={atmosphereRef} args={[radius * 1.1, 32, 32]}>
        <meshBasicMaterial
          color="#4F46E5"
          transparent
          opacity={0.1}
          side={THREE.BackSide}
        />
      </Sphere>

      {/* Hotspot markers */}
      {hotspots.map((hotspot) => (
        <HotspotMarker key={hotspot.id} hotspot={hotspot} globeRadius={radius} />
      ))}
    </group>
  );
}

// Orbital particles representing biodiversity data
function OrbitalParticles({ count = 100, radius = 2 }: { count?: number; radius?: number }) {
  const particlesRef = useRef<THREE.Points>(null);

  const [positions, colors] = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = radius + Math.random() * 0.5;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      const color = new THREE.Color().setHSL(Math.random(), 0.8, 0.6);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    return [positions, colors];
  }, [count, radius]);

  useFrame((state) => {
    if (!particlesRef.current) return;
    particlesRef.current.rotation.y = state.clock.elapsedTime * 0.05;
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
        size={0.03}
        vertexColors
        transparent
        opacity={0.6}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

import { useState } from 'react';

interface BiodiversityGlobeProps {
  hotspots: Hotspot[];
  className?: string;
  showParticles?: boolean;
}

export function BiodiversityGlobe({
  hotspots,
  className,
  showParticles = true,
}: BiodiversityGlobeProps) {
  return (
    <div className={className}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['transparent']} />
        <fog attach="fog" args={['#000000', 8, 15]} />

        {/* Lighting */}
        <ambientLight intensity={0.3} />
        <pointLight position={[5, 5, 5]} intensity={1.5} color="#4F46E5" />
        <pointLight position={[-5, 0, -5]} intensity={0.8} color="#EC4899" />
        <spotLight
          position={[0, 5, 0]}
          angle={0.5}
          penumbra={1}
          intensity={1}
          color="#8B5CF6"
        />

        {/* Globe with hotspots */}
        <Globe hotspots={hotspots} radius={1.5} />

        {/* Orbital particles */}
        {showParticles && <OrbitalParticles count={150} radius={2.2} />}
      </Canvas>
    </div>
  );
}

export type { Hotspot };
