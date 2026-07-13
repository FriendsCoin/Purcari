import { Leaf, Microscope, MapPin, Sparkles } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import type { VineyardAdvice, WorkSeason } from '@/types';

interface AdviceModalProps {
  advice: VineyardAdvice | null;
  isOpen: boolean;
  onClose: () => void;
}

const seasonStyles: Record<WorkSeason, { label: string; className: string }> = {
  spring: { label: 'Spring', className: 'bg-green-100 text-green-800' },
  summer: { label: 'Summer', className: 'bg-yellow-100 text-yellow-800' },
  autumn: { label: 'Autumn', className: 'bg-orange-100 text-orange-800' },
  winter: { label: 'Winter', className: 'bg-blue-100 text-blue-800' },
  'year-round': { label: 'Year-round', className: 'bg-purple-100 text-purple-800' },
};

const effortDots: Record<VineyardAdvice['works'][number]['effort'], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function AdviceModal({ advice, isOpen, onClose }: AdviceModalProps) {
  if (!advice) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={advice.title} size="lg">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4 pb-6 border-b border-gray-200">
          <span className="text-6xl">{advice.icon}</span>
          <div className="flex-1">
            <span
              className="inline-block px-4 py-1 rounded-full text-sm font-semibold text-white capitalize"
              style={{ backgroundColor: advice.color }}
            >
              {advice.priority} priority
            </span>
            <p className="text-gray-700 mt-3">{advice.summary}</p>
          </div>
        </div>

        {/* Target zones */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <MapPin size={18} className="text-gray-500" />
            Target zones
          </h3>
          <div className="flex flex-wrap gap-2">
            {advice.zones.map(zone => (
              <span
                key={zone}
                className="px-3 py-1 rounded-lg bg-gray-100 text-gray-800 text-sm font-medium"
              >
                {zone}
              </span>
            ))}
          </div>
        </div>

        {/* Evidence from the data */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Microscope size={18} className="text-blue-500" />
            What the data shows
          </h3>
          <ul className="space-y-2">
            {advice.evidence.map((item, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="inline-block w-2 h-2 mt-2 bg-blue-500 rounded-full flex-shrink-0" />
                <span className="text-gray-700">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Field works */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Leaf size={18} className="text-green-600" />
            Recommended vineyard works
          </h3>
          <div className="space-y-3">
            {advice.works.map((work, index) => {
              const season = seasonStyles[work.season];
              return (
                <div
                  key={index}
                  className="flex items-start gap-3 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4"
                >
                  <span className="text-gray-800 flex-1">{work.action}</span>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${season.className}`}>
                      {season.label}
                    </span>
                    <span className="text-xs text-gray-500" title={`Effort: ${work.effort}`}>
                      {'●'.repeat(effortDots[work.effort])}
                      <span className="text-gray-300">{'●'.repeat(3 - effortDots[work.effort])}</span>
                      <span className="ml-1">effort</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Benefit */}
        <div className="bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl p-5 border border-emerald-200">
          <h3 className="text-sm font-semibold text-emerald-900 mb-1 flex items-center gap-2">
            <Sparkles size={16} />
            Expected benefit
          </h3>
          <p className="text-emerald-900">{advice.benefit}</p>
        </div>
      </div>
    </Modal>
  );
}
