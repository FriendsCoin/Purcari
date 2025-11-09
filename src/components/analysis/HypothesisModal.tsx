import { Modal } from '@/components/common/Modal';
import type { Hypothesis } from '@/types';

interface HypothesisModalProps {
  hypothesis: Hypothesis | null;
  isOpen: boolean;
  onClose: () => void;
}

export function HypothesisModal({ hypothesis, isOpen, onClose }: HypothesisModalProps) {
  if (!hypothesis) return null;

  const confidencePercent = Math.round(hypothesis.confidence * 100);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={hypothesis.title} size="lg">
      <div className="space-y-6">
        {/* Header with Icon and Result */}
        <div className="flex items-center gap-4 pb-6 border-b border-gray-200">
          <span className="text-6xl">{hypothesis.icon}</span>
          <div className="flex-1">
            <div
              className={`inline-block px-4 py-2 rounded-full text-sm font-semibold ${
                hypothesis.result === 'confirmed'
                  ? 'bg-green-100 text-green-800'
                  : hypothesis.result === 'rejected'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {hypothesis.result.toUpperCase()}
            </div>
            <div className="mt-3">
              <p className="text-sm text-gray-600">Statistical Confidence</p>
              <div className="flex items-center gap-3 mt-1">
                <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                    style={{ width: `${confidencePercent}%` }}
                  />
                </div>
                <span className="text-2xl font-bold text-gray-900">{confidencePercent}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Hypothesis</h3>
          <p className="text-gray-700">{hypothesis.description}</p>
        </div>

        {/* Methodology */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Methodology</h3>
          <p className="text-gray-700">{hypothesis.methodology}</p>
        </div>

        {/* Findings */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Key Findings</h3>
          <ul className="space-y-2">
            {hypothesis.findings.map((finding, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="inline-block w-2 h-2 mt-2 bg-purple-600 rounded-full flex-shrink-0" />
                <span className="text-gray-700">{finding}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Evidence */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Evidence</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(hypothesis.evidence).map(([key, value]) => (
              <div key={key} className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">{key}</p>
                <p className="text-xl font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Implications */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Management Implications</h3>
          <ul className="space-y-2">
            {hypothesis.implications.map((implication, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="inline-block w-2 h-2 mt-2 bg-green-600 rounded-full flex-shrink-0" />
                <span className="text-gray-700">{implication}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
