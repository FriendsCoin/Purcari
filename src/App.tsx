import { useState } from 'react';
import { Upload, Sparkles } from 'lucide-react';
import { Card } from './components/common/Card';
import { Button } from './components/common/Button';
import type { ViewState } from './types';

function App() {
  const [view, setView] = useState<ViewState>('upload');

  const handleLoadDemo = () => {
    // Load demo data
    console.log('Loading demo data...');
    setView('dashboard');
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

          <div className="grid md:grid-cols-2 gap-6">
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
              onClick={handleLoadDemo}
              className="bg-gradient-to-br from-emerald-600 to-teal-600 border-2 border-emerald-400"
            >
              <div className="text-center">
                <Sparkles size={64} className="text-white mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-white mb-3">Use Simulated Data</h3>
                <p className="text-white text-opacity-90 mb-6 text-sm">
                  Explore with sample biodiversity data
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto p-8">
        <h1 className="text-4xl font-bold mb-8">Dashboard View</h1>
        <p className="text-gray-600">Dashboard content will be rendered here...</p>
      </div>
    </div>
  );
}

export default App;
