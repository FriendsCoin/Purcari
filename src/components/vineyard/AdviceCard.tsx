import { ArrowUpRight } from 'lucide-react';
import { Card, CardContent } from '@/components/common/Card';
import type { VineyardAdvice } from '@/types';

interface AdviceCardProps {
  advice: VineyardAdvice;
  onClick: () => void;
}

const priorityStyles: Record<VineyardAdvice['priority'], string> = {
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-sky-100 text-sky-800 border-sky-200',
};

const categoryLabels: Record<VineyardAdvice['category'], string> = {
  habitat: 'Habitat',
  phytosanitary: 'Phytosanitary',
  water: 'Water',
  fauna: 'Fauna',
  'soil-cover': 'Soil & cover',
  monitoring: 'Monitoring',
};

export function AdviceCard({ advice, onClick }: AdviceCardProps) {
  return (
    <Card
      className="cursor-pointer hover:shadow-lg transition-all duration-200 border-l-4"
      style={{ borderLeftColor: advice.color }}
      onClick={onClick}
      hover
    >
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{advice.icon}</span>
            <div>
              <h4 className="text-lg font-semibold text-gray-900 leading-tight">{advice.title}</h4>
              <span className="text-xs text-gray-500">{categoryLabels[advice.category]}</span>
            </div>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${priorityStyles[advice.priority]}`}
          >
            {advice.priority.charAt(0).toUpperCase() + advice.priority.slice(1)} priority
          </span>
        </div>

        <p className="text-sm text-gray-600 mt-4">{advice.summary}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {advice.zones.map(zone => (
            <span
              key={zone}
              className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-xs font-medium"
            >
              {zone}
            </span>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {advice.works.length} field works · {advice.evidence.length} data points
          </span>
          <span className="text-xs text-green-700 font-medium flex items-center gap-1">
            View works <ArrowUpRight size={14} />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
