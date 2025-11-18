import { CheckCircle, AlertCircle, Info } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/common/Card';
import type { Hypothesis } from '@/types';

interface HypothesisCardProps {
  hypothesis: Hypothesis;
  onClick: () => void;
}

export function HypothesisCard({ hypothesis, onClick }: HypothesisCardProps) {
  const getResultIcon = () => {
    switch (hypothesis.result) {
      case 'confirmed':
        return <CheckCircle className="text-green-600" size={20} />;
      case 'rejected':
        return <AlertCircle className="text-red-600" size={20} />;
      default:
        return <Info className="text-gray-600" size={20} />;
    }
  };

  const getResultColor = () => {
    switch (hypothesis.result) {
      case 'confirmed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const confidencePercent = Math.round(hypothesis.confidence * 100);

  return (
    <Card
      className="cursor-pointer hover:shadow-lg transition-all duration-200"
      onClick={onClick}
      hover
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{hypothesis.icon}</span>
            <div>
              <CardTitle as="h4" className="text-lg font-semibold">
                {hypothesis.title}
              </CardTitle>
              <p className="text-sm text-gray-600 mt-1">{hypothesis.description}</p>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getResultIcon()}
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium border ${getResultColor()}`}
            >
              {hypothesis.result.charAt(0).toUpperCase() + hypothesis.result.slice(1)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-xs text-gray-500">Confidence</p>
              <p className="text-lg font-bold text-gray-900">{confidencePercent}%</p>
            </div>
            <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                style={{ width: `${confidencePercent}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500">Key Evidence</p>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {Object.entries(hypothesis.evidence)
              .slice(0, 3)
              .map(([key, value]) => (
                <div key={key} className="bg-gray-50 rounded-lg p-2">
                  <p className="text-xs text-gray-600 truncate">{key}</p>
                  <p className="text-sm font-semibold text-gray-900 truncate">{value}</p>
                </div>
              ))}
          </div>
        </div>

        <p className="text-xs text-purple-600 mt-4 flex items-center gap-1">
          <Info size={14} />
          Click to view details
        </p>
      </CardContent>
    </Card>
  );
}
