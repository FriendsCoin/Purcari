import { useState } from 'react';
import { Upload, Sparkles, Database } from 'lucide-react';
import { Card } from './components/common/Card';
import { Button } from './components/common/Button';
import { Dashboard } from './components/dashboard/Dashboard';
import { generateMockData } from './services/mockData';
import { loadRealGeoJSONData, processRealGeoJSON, extractHotspotsFromGeoJSON } from './services/realDataLoader';
import { loadAllCSVData } from './services/csvParser';
import type { ViewState, AnalysisData, Project, Hotspot } from './types';
import type { MonthlyTrend, SiteDiversity, DetailedMetrics } from './services/csvParser';

function App() {
  const [view, setView] = useState<ViewState>('upload');
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [isRealData, setIsRealData] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Real data state
  const [monthlyTrends, setMonthlyTrends] = useState<MonthlyTrend[]>([]);
  const [siteDiversity, setSiteDiversity] = useState<SiteDiversity[]>([]);
  const [detailedMetrics, setDetailedMetrics] = useState<DetailedMetrics[]>([]);

  const handleLoadDemo = () => {
    const { analysis: mockAnalysis, hotspots: mockHotspots, projects: mockProjects } = generateMockData();
    setAnalysis(mockAnalysis);
    setHotspots(mockHotspots);
    setProjects(mockProjects);
    setIsRealData(false);
    setView('dashboard');
  };

  const handleLoadRealData = async () => {
    setIsLoading(true);
    try {
      // Load GeoJSON data
      const geoData = await loadRealGeoJSONData();
      const processedAnalysis = processRealGeoJSON(geoData);
      const realHotspots = extractHotspotsFromGeoJSON(geoData);

      // Load CSV metrics
      const csvData = await loadAllCSVData();

      // Update state
      setAnalysis(processedAnalysis);
      setHotspots(realHotspots);
      setMonthlyTrends(csvData.monthlyTrends);
      setSiteDiversity(csvData.siteDiversity);
      setDetailedMetrics(csvData.detailedMetrics);
      setProjects([]); // No projects for real data mode
      setIsRealData(true);
      setView('dashboard');
    } catch (error) {
      console.error('Error loading real data:', error);
      alert('Failed to load real data. Please check console for details.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setView('upload');
  };

  if (view === 'upload') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-8">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-12 animate-fade-in">
            <h1 className="text-6xl font-bold text-white mb-4">Purcari Biodiversity</h1>
            <h2 className="text-3xl text-purple-300 mb-6">Data Analysis Dashboard</h2>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto">
              Analyze biodiversity monitoring data and get art project recommendations
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Card variant="glass" padding="lg">
              <div className="text-center">
                <Upload size={64} className="text-purple-400 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-white mb-3">Upload CSV</h3>
                <p className="text-gray-300 mb-6 text-sm">From Every1Counts export</p>
                <Button variant="primary" size="md">
                  Choose File
                </Button>
              </div>
            </Card>

            <Card
              variant="gradient"
              padding="lg"
              hover
              onClick={handleLoadRealData}
              className="bg-gradient-to-br from-blue-600 to-indigo-600 border-2 border-blue-400"
            >
              <div className="text-center">
                <Database size={64} className="text-white mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-white mb-3">Load Real Data</h3>
                <p className="text-white text-opacity-90 mb-6 text-sm">
                  2,665 observations + diversity metrics
                </p>
                <div className="text-blue-100 font-medium">
                  {isLoading ? 'Loading...' : 'Click to load →'}
                </div>
              </div>
            </Card>

            <Card
              variant="gradient"
              padding="lg"
              hover
              onClick={handleLoadDemo}
              className="bg-gradient-to-br from-emerald-600 to-teal-600 border-2 border-emerald-400"
            >
              <div className="text-center">
                <Sparkles size={64} className="text-white mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-white mb-3">Use Demo Data</h3>
                <p className="text-white text-opacity-90 mb-6 text-sm">
                  Explore with simulated biodiversity data
                </p>
                <div className="text-emerald-100 font-medium">Click to start →</div>
              </div>
            </Card>
          </div>

          <div className="mt-12 text-center">
            <p className="text-gray-400 text-sm">
              Version 2.0.0 | Built with React + TypeScript + Vite
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'dashboard' && analysis) {
    return (
      <Dashboard
        analysis={analysis}
        projects={projects}
        hotspots={hotspots}
        isRealData={isRealData}
        monthlyTrends={monthlyTrends}
        siteDiversity={siteDiversity}
        detailedMetrics={detailedMetrics}
        onBack={handleBack}
      />
    );
  }

  return null;
}

export default App;
