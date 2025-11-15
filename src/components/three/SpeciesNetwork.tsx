import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface SpeciesNode {
  id: string;
  name: string;
  count: number;
  type: 'mammal' | 'bird' | 'insect' | 'bat';
  position: THREE.Vector3;
  color: string;
}

interface NetworkConnection {
  from: number;
  to: number;
  strength: number;
}

interface SpeciesNetworkSceneProps {
  species: Array<{ name: string; count: number; type: string }>;
}

function SpeciesNetworkScene({ species }: SpeciesNetworkSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const timeRef = useRef(0);

  // Generate network nodes and connections
  const { nodes, connections } = useMemo(() => {
    const colorMap = {
      mammal: '#F59E0B',
      bird: '#EC4899',
      insect: '#10B981',
      bat: '#8B5CF6',
    };

    const nodes: SpeciesNode[] = species.slice(0, 20).map((s, i) => {
      // Arrange nodes in a sphere
      const phi = Math.acos(-1 + (2 * i) / species.length);
      const theta = Math.sqrt(species.length * Math.PI) * phi;
      const radius = 3;

      return {
        id: `species-${i}`,
        name: s.name,
        count: s.count,
        type: (s.type || 'mammal') as SpeciesNode['type'],
        position: new THREE.Vector3(
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.sin(phi) * Math.sin(theta),
          radius * Math.cos(phi)
        ),
        color: colorMap[s.type as keyof typeof colorMap] || colorMap.mammal,
      };
    });

    // Create connections between related species
    const connections: NetworkConnection[] = [];
    for (let i = 0; i < nodes.length; i++) {
      // Connect to 2-4 nearby nodes
      const connectCount = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < connectCount; j++) {
        const targetIndex = (i + 1 + Math.floor(Math.random() * 5)) % nodes.length;
        if (targetIndex !== i) {
          connections.push({
            from: i,
            to: targetIndex,
            strength: Math.random(),
          });
        }
      }
    }

    return { nodes, connections };
  }, [species]);

  // Create line geometry for connections
  const connectionGeometry = useMemo(() => {
    const positions = new Float32Array(connections.length * 6);
    const colors = new Float32Array(connections.length * 6);

    connections.forEach((conn, i) => {
      const i6 = i * 6;
      const fromNode = nodes[conn.from];
      const toNode = nodes[conn.to];

      positions[i6] = fromNode.position.x;
      positions[i6 + 1] = fromNode.position.y;
      positions[i6 + 2] = fromNode.position.z;

      positions[i6 + 3] = toNode.position.x;
      positions[i6 + 4] = toNode.position.y;
      positions[i6 + 5] = toNode.position.z;

      // Gradient color between nodes
      const fromColor = new THREE.Color(fromNode.color);
      const toColor = new THREE.Color(toNode.color);

      colors[i6] = fromColor.r;
      colors[i6 + 1] = fromColor.g;
      colors[i6 + 2] = fromColor.b;

      colors[i6 + 3] = toColor.r;
      colors[i6 + 4] = toColor.g;
      colors[i6 + 5] = toColor.b;
    });

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geom;
  }, [nodes, connections]);

  useFrame(() => {
    if (!groupRef.current) return;

    timeRef.current += 0.005;

    // Gentle rotation
    groupRef.current.rotation.y = timeRef.current * 0.3;
    groupRef.current.rotation.x = Math.sin(timeRef.current * 0.2) * 0.1;

    // Pulse connections
    if (linesRef.current) {
      const material = linesRef.current.material as THREE.LineBasicMaterial;
      material.opacity = 0.2 + Math.sin(timeRef.current * 2) * 0.1;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Connection lines */}
      <lineSegments ref={linesRef} geometry={connectionGeometry}>
        <lineBasicMaterial
          transparent
          vertexColors
          opacity={0.25}
          blending={THREE.AdditiveBlending}
          linewidth={1}
        />
      </lineSegments>

      {/* Species nodes */}
      {nodes.map((node, i) => (
        <SpeciesNodeComponent key={node.id} node={node} index={i} />
      ))}
    </group>
  );
}

function SpeciesNodeComponent({ node, index }: { node: SpeciesNode; index: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    if (!meshRef.current) return;

    // Gentle pulsing based on species count
    const baseScale = Math.log(node.count + 1) * 0.1 + 0.1;
    const pulse = Math.sin(state.clock.elapsedTime * 2 + index * 0.5) * 0.02;
    const scale = baseScale + pulse + (hovered ? 0.05 : 0);

    meshRef.current.scale.setScalar(scale);
  });

  return (
    <group position={node.position}>
      <Sphere
        ref={meshRef}
        args={[1, 32, 32]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <meshStandardMaterial
          color={node.color}
          emissive={node.color}
          emissiveIntensity={hovered ? 0.5 : 0.3}
          metalness={0.7}
          roughness={0.3}
          transparent
          opacity={0.9}
        />
      </Sphere>

      {/* Label on hover */}
      {hovered && (
        <Html distanceFactor={10}>
          <div className="bg-gray-900 bg-opacity-90 text-white px-3 py-2 rounded-lg shadow-lg backdrop-blur-sm border border-purple-500 whitespace-nowrap">
            <p className="font-bold text-sm">{node.name}</p>
            <p className="text-xs text-gray-300">{node.count} observations</p>
            <p className="text-xs text-purple-300">{node.type}</p>
          </div>
        </Html>
      )}

      {/* Glow ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.15, 0.18, 32]} />
        <meshBasicMaterial
          color={node.color}
          transparent
          opacity={hovered ? 0.6 : 0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// Import useState
import { useState } from 'react';

interface SpeciesNetworkProps {
  species: Array<{ name: string; count: number; type: string }>;
  className?: string;
}

export function SpeciesNetwork({ species, className }: SpeciesNetworkProps) {
  return (
    <div className={className}>
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['transparent']} />
        <fog attach="fog" args={['#000000', 5, 20]} />

        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 10, 10]} intensity={1} color="#4F46E5" />
        <pointLight position={[-10, -10, -10]} intensity={0.8} color="#EC4899" />
        <pointLight position={[0, 0, -10]} intensity={0.6} color="#10B981" />

        {/* Network */}
        <SpeciesNetworkScene species={species} />

        {/* Interactive mouse controls */}
        <OrbitControls
          enableZoom
          enablePan
          enableRotate
          zoomSpeed={0.6}
          rotateSpeed={0.5}
          minDistance={4}
          maxDistance={15}
        />
      </Canvas>
    </div>
  );
}
