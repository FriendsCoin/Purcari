import { useState, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore, XROrigin, useXRHitTest } from '@react-three/xr';
import { Sphere, Text, Html } from '@react-three/drei';
import { Camera, MapPin, X, Info } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Button } from '../common/Button';
import { useARSupport } from '@/hooks/useARSupport';
import * as THREE from 'three';

interface SpeciesData {
  name: string;
  count: number;
  type?: string;
}

interface ARBiodiversitySceneProps {
  species: SpeciesData[];
}

// Create XR store outside component to persist state
const xrStore = createXRStore();

function PlaceableSpeciesModel({ species }: { species: SpeciesData }) {
  const [placed, setPlaced] = useState(false);
  const [hovered, setHovered] = useState(false);
  const meshRef = useRef<THREE.Mesh>(null);
  const matrixHelper = useRef(new THREE.Matrix4());
  const hitTestPosition = useRef(new THREE.Vector3());

  // Color based on species type
  const colorMap: Record<string, string> = {
    mammal: '#F59E0B',
    bird: '#EC4899',
    insect: '#10B981',
    bat: '#8B5CF6',
  };
  const color = colorMap[species.type || 'mammal'] || '#4F46E5';

  // Size based on observation count (logarithmic scale)
  const size = Math.log(species.count + 1) * 0.05 + 0.1;

  // Use XR hit test to detect surfaces in AR
  useXRHitTest(
    (results, getWorldMatrix) => {
      if (!placed && results.length > 0) {
        getWorldMatrix(matrixHelper.current, results[0]);
        hitTestPosition.current.setFromMatrixPosition(matrixHelper.current);

        if (meshRef.current) {
          meshRef.current.position.copy(hitTestPosition.current);
          setPlaced(true);
        }
      }
    },
    'viewer',
    'plane'
  );

  return (
    <mesh
      ref={meshRef}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Sphere args={[size, 32, 32]}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 0.8 : 0.3}
          transparent
          opacity={placed ? 1 : 0.5}
        />
      </Sphere>

      {hovered && placed && (
        <Html distanceFactor={2} position={[0, size + 0.1, 0]}>
          <div className="bg-gray-900 bg-opacity-95 text-white px-3 py-2 rounded-lg text-xs whitespace-nowrap">
            <p className="font-bold">{species.name}</p>
            <p className="text-gray-300">{species.count} observations</p>
          </div>
        </Html>
      )}

      {!placed && (
        <Text
          position={[0, size + 0.2, 0]}
          fontSize={0.08}
          color="white"
          anchorX="center"
          anchorY="middle"
        >
          Tap to place
        </Text>
      )}
    </mesh>
  );
}

function ARScene({ species }: { species: SpeciesData[] }) {
  const topSpecies = species.slice(0, 5); // Show top 5 species

  return (
    <XROrigin position={[0, 0, 0]}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 10, 5]} intensity={1.5} />
      <pointLight position={[-10, -10, -5]} intensity={0.5} />

      {topSpecies.map((s) => (
        <PlaceableSpeciesModel key={s.name} species={s} />
      ))}
    </XROrigin>
  );
}

export function ARBiodiversityScene({ species }: ARBiodiversitySceneProps) {
  const [isARActive, setIsARActive] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const { isSupported, isLoading, error, platformInfo } = useARSupport();

  const enterAR = useCallback(() => {
    xrStore.enterAR();
    setIsARActive(true);
  }, []);

  const exitAR = useCallback(() => {
    if (xrStore) {
      setIsARActive(false);
    }
  }, []);

  // Listen to XR session state changes
  xrStore.subscribe((state) => {
    if (!state.session) {
      setIsARActive(false);
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="animate-spin w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">Checking AR support...</p>
        </CardContent>
      </Card>
    );
  }

  if (!isSupported) {
    return (
      <Card className="border-orange-200 bg-orange-50">
        <CardHeader className="bg-gradient-to-r from-orange-500 to-red-500 text-white">
          <div className="flex items-center gap-3">
            <Camera size={24} />
            <div>
              <CardTitle className="text-white">AR Not Available</CardTitle>
              <p className="text-orange-100 text-sm mt-1">
                {platformInfo.isIOS ? '📱 iOS Platform' :
                 platformInfo.isAndroid ? '🤖 Android Platform' :
                 '💻 Desktop Platform'}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="bg-white rounded-lg p-4 border border-orange-200">
              <p className="font-semibold text-orange-900 mb-2">
                ⚠️ {error}
              </p>
            </div>

            <div className="bg-white rounded-lg p-4 border border-orange-200">
              <h4 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
                <Info size={16} />
                Requirements for AR
              </h4>
              <ul className="text-sm text-gray-700 space-y-2">
                <li>✓ <strong>Android device</strong> with ARCore support</li>
                <li>✓ <strong>Chrome browser</strong> (version 79+)</li>
                <li>✓ <strong>Google Play Services for AR</strong> installed</li>
                <li>✗ <strong>iOS</strong> - Not supported (WebXR AR unavailable)</li>
              </ul>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
              <h4 className="font-bold text-gray-900 mb-2">
                🌟 What You&apos;re Missing
              </h4>
              <p className="text-sm text-gray-700">
                AR mode lets you place 3D biodiversity models in your real environment using your phone&apos;s camera.
                Each species appears as a colored sphere sized by observation count. Walk around them, tap for details!
              </p>
            </div>

            {platformInfo.isIOS && (
              <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                <p className="text-sm text-purple-900">
                  <strong>💡 Alternative:</strong> Try the 3D visualizations above with mouse/touch controls,
                  or access this page on an Android device with Chrome for the full AR experience.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white bg-opacity-20 rounded-lg">
                <Camera size={24} />
              </div>
              <div>
                <CardTitle className="text-white text-xl">
                  Augmented Reality Mode
                </CardTitle>
                <p className="text-blue-100 text-sm mt-1">
                  Place biodiversity models in your environment
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowInfo(!showInfo)}
                className="bg-white bg-opacity-20 text-white border-white hover:bg-opacity-30"
              >
                <Info size={16} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          {showInfo && (
            <div className="mb-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
              <h4 className="font-bold text-gray-900 mb-2">How to use AR mode</h4>
              <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                <li>Tap &quot;Enter AR Mode&quot; below</li>
                <li>Grant camera permissions when prompted</li>
                <li>Point your camera at a flat surface (floor, table)</li>
                <li>Tap on detected surfaces to place biodiversity models</li>
                <li>Walk around to view from different angles</li>
                <li>Tap models to see species information</li>
              </ol>
            </div>
          )}

          {/* AR Preview / Status */}
          {!isARActive ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 mb-4">
                {species.slice(0, 5).map((s, i) => {
                  const colors = ['bg-orange-500', 'bg-pink-500', 'bg-green-500', 'bg-purple-500', 'bg-blue-500'];
                  return (
                    <div key={s.name} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                      <div className={`w-3 h-3 rounded-full ${colors[i % colors.length]}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-900 truncate">{s.name}</p>
                        <p className="text-xs text-gray-500">{s.count} obs.</p>
                      </div>
                      <MapPin size={12} className="text-gray-400" />
                    </div>
                  );
                })}
              </div>

              <Button
                variant="primary"
                size="lg"
                onClick={enterAR}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold py-4"
              >
                <Camera size={20} className="mr-2" />
                Enter AR Mode
              </Button>

              <p className="text-xs text-center text-gray-500">
                Make sure you&apos;re in a well-lit area with a flat surface
              </p>
            </div>
          ) : (
            <div className="bg-gray-900 rounded-lg aspect-video flex items-center justify-center text-white">
              <div className="text-center">
                <p className="text-lg font-bold mb-2">AR Session Active</p>
                <p className="text-sm text-gray-300 mb-4">
                  Point your camera at a surface and tap to place models
                </p>
                <Button
                  variant="outline"
                  onClick={exitAR}
                  className="bg-white bg-opacity-20 border-white text-white hover:bg-opacity-30"
                >
                  <X size={16} className="mr-2" />
                  Exit AR
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AR Canvas (hidden when not in AR mode) */}
      {isARActive && (
        <div className="fixed inset-0 z-50">
          <Canvas>
            <XR store={xrStore}>
              <ARScene species={species} />
            </XR>
          </Canvas>

          {/* AR Overlay Controls */}
          <div className="absolute top-4 right-4">
            <Button
              variant="primary"
              onClick={exitAR}
              className="bg-red-600 hover:bg-red-700 text-white shadow-2xl"
            >
              <X size={20} className="mr-2" />
              Exit AR
            </Button>
          </div>

          {/* AR Instructions Overlay */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
            <div className="bg-gray-900 bg-opacity-90 text-white px-4 py-2 rounded-full text-sm">
              👆 Tap surfaces to place biodiversity models
            </div>
          </div>
        </div>
      )}
    </>
  );
}
