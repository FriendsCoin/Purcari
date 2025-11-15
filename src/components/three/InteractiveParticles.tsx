import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';

interface InteractiveParticlesProps {
  count?: number;
  audioData?: {
    bassFrequency: number;
    midFrequency: number;
    trebleFrequency: number;
    volume: number;
  };
  webcamVideo?: HTMLVideoElement | null;
}

function AudioReactiveParticles({ count = 3000, audioData, webcamVideo }: InteractiveParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);
  const videoTextureRef = useRef<THREE.VideoTexture | null>(null);

  // Create video texture if webcam is available
  useEffect(() => {
    if (webcamVideo && webcamVideo.readyState >= webcamVideo.HAVE_CURRENT_DATA) {
      const texture = new THREE.VideoTexture(webcamVideo);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.format = THREE.RGBFormat;
      videoTextureRef.current = texture;
    }
  }, [webcamVideo]);

  const [positions, colors, sizes] = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Spherical distribution
      const radius = 3 + Math.random() * 4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      // Rainbow colors
      const hue = i / count;
      const color = new THREE.Color().setHSL(hue, 0.8, 0.6);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      sizes[i] = Math.random() * 0.03 + 0.01;
    }

    return [positions, colors, sizes];
  }, [count]);

  useFrame(() => {
    if (!pointsRef.current) return;

    timeRef.current += 0.01;
    const time = timeRef.current;

    // Base rotation
    pointsRef.current.rotation.y = time * 0.05;

    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;
    const sizes = pointsRef.current.geometry.attributes.size.array as Float32Array;

    // Audio reactivity
    const bassScale = audioData ? 1 + (audioData.bassFrequency / 255) * 2 : 1;
    const midScale = audioData ? audioData.midFrequency / 255 : 0.5;
    const volume = audioData ? audioData.volume : 0;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const x = positions[i3];
      const y = positions[i3 + 1];
      const z = positions[i3 + 2];

      // Audio-reactive movement
      const distance = Math.sqrt(x * x + y * y + z * z);
      const bassWave = Math.sin(time + i * 0.1 + distance * 0.3) * bassScale * 0.05;
      const midWave = Math.cos(time * 2 + i * 0.05) * midScale * 0.03;

      positions[i3] = x + bassWave;
      positions[i3 + 1] = y + midWave;
      positions[i3 + 2] = z + Math.sin(time + i * 0.08) * 0.02;

      // Audio-reactive size
      sizes[i] = (0.01 + Math.random() * 0.02) * (1 + volume);
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true;
    pointsRef.current.geometry.attributes.size.needsUpdate = true;

    // Scale based on bass
    const scale = 1 + (audioData?.bassFrequency || 0) / 512;
    pointsRef.current.scale.set(scale, scale, scale);
  });

  return (
    <Points ref={pointsRef} positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        vertexColors
        size={0.02}
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
      <bufferAttribute
        attach="geometry-attributes-size"
        args={[sizes, 1]}
        count={count}
        itemSize={1}
      />
    </Points>
  );
}

// Webcam-based particle mesh
function WebcamParticleMesh({ videoElement }: { videoElement: HTMLVideoElement | null }) {
  const meshRef = useRef<THREE.Mesh>(null);

  const videoTexture = useMemo(() => {
    if (!videoElement) return null;
    const texture = new THREE.VideoTexture(videoElement);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }, [videoElement]);

  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.3;
    meshRef.current.rotation.x = Math.cos(state.clock.elapsedTime * 0.3) * 0.2;
  });

  if (!videoTexture) return null;

  return (
    <mesh ref={meshRef} position={[0, 0, -2]}>
      <planeGeometry args={[3, 2.25]} />
      <meshBasicMaterial
        map={videoTexture}
        transparent
        opacity={0.7}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

interface InteractiveParticleSystemProps {
  audioData?: {
    bassFrequency: number;
    midFrequency: number;
    trebleFrequency: number;
    volume: number;
  };
  webcamVideo?: HTMLVideoElement | null;
  enableOrbitControls?: boolean;
  className?: string;
}

export function InteractiveParticleSystem({
  audioData,
  webcamVideo,
  enableOrbitControls = true,
  className
}: InteractiveParticleSystemProps) {
  return (
    <div className={className}>
      <Canvas
        camera={{ position: [0, 0, 8], fov: 75 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#000000']} />
        <fog attach="fog" args={['#000000', 5, 20]} />

        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 10, 10]} intensity={1} color="#4F46E5" />
        <pointLight position={[-10, -10, -10]} intensity={0.8} color="#EC4899" />

        {/* Audio-reactive particles */}
        <AudioReactiveParticles
          count={3000}
          audioData={audioData}
          webcamVideo={webcamVideo}
        />

        {/* Webcam feed overlay */}
        {webcamVideo && <WebcamParticleMesh videoElement={webcamVideo} />}

        {/* Mouse controls */}
        {enableOrbitControls && (
          <OrbitControls
            enableZoom
            enablePan
            enableRotate
            zoomSpeed={0.6}
            rotateSpeed={0.5}
            minDistance={3}
            maxDistance={15}
          />
        )}
      </Canvas>
    </div>
  );
}
