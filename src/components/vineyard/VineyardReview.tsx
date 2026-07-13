import { useMemo, useState } from 'react';
import { Sprout, CalendarDays, CheckCircle2 } from 'lucide-react';
import { AdviceCard } from './AdviceCard';
import { AdviceModal } from './AdviceModal';
import { vineyardAdvice, vineyardReviewSummary } from '@/services/vineyardAdvice';
import type { VineyardAdvice, WorkSeason } from '@/types';

type PriorityFilter = 'all' | VineyardAdvice['priority'];

const SEASON_ORDER: WorkSeason[] = ['spring', 'summer', 'autumn', 'winter', 'year-round'];

const seasonMeta: Record<WorkSeason, { label: string; emoji: string; className: string }> = {
  spring: { label: 'Spring', emoji: '🌸', className: 'from-green-50 to-emerald-50 border-green-200' },
  summer: { label: 'Summer', emoji: '☀️', className: 'from-yellow-50 to-amber-50 border-amber-200' },
  autumn: { label: 'Autumn', emoji: '🍂', className: 'from-orange-50 to-amber-50 border-orange-200' },
  winter: { label: 'Winter', emoji: '❄️', className: 'from-blue-50 to-sky-50 border-blue-200' },
  'year-round': { label: 'Year-round', emoji: '🔁', className: 'from-purple-50 to-fuchsia-50 border-purple-200' },
};

const priorityFilters: Array<{ key: PriorityFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'high', label: 'High priority' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
];

export function VineyardReview() {
  const [selected, setSelected] = useState<VineyardAdvice | null>(null);
  const [priority, setPriority] = useState<PriorityFilter>('all');

  const filtered = useMemo(
    () => (priority === 'all' ? vineyardAdvice : vineyardAdvice.filter(a => a.priority === priority)),
    [priority]
  );

  const worksBySeason = useMemo(() => {
    const map: Record<WorkSeason, Array<{ action: string; title: string }>> = {
      spring: [],
      summer: [],
      autumn: [],
      winter: [],
      'year-round': [],
    };
    for (const advice of vineyardAdvice) {
      for (const work of advice.works) {
        map[work.season].push({ action: work.action, title: advice.title });
      }
    }
    return map;
  }, []);

  const totalWorks = useMemo(
    () => vineyardAdvice.reduce((sum, a) => sum + a.works.length, 0),
    []
  );

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Review header */}
      <div className="bg-gradient-to-br from-emerald-600 to-green-700 rounded-3xl p-8 text-white shadow-lg">
        <div className="flex items-center gap-3 mb-2">
          <Sprout size={28} />
          <h2 className="text-3xl font-bold">{vineyardReviewSummary.headline}</h2>
        </div>
        <p className="text-emerald-50 max-w-4xl">{vineyardReviewSummary.verdict}</p>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-6">
          {vineyardReviewSummary.kpis.map(kpi => (
            <div key={kpi.label} className="bg-white bg-opacity-10 rounded-xl p-4 backdrop-blur-sm">
              <p className="text-2xl font-bold">{kpi.value}</p>
              <p className="text-sm font-medium text-emerald-50">{kpi.label}</p>
              <p className="text-xs text-emerald-100 text-opacity-80 mt-1">{kpi.hint}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Highlights */}
      <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Key findings from the final report</h3>
        <ul className="grid md:grid-cols-2 gap-3">
          {vineyardReviewSummary.highlights.map((h, i) => (
            <li key={i} className="flex items-start gap-3">
              <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 flex-shrink-0" />
              <span className="text-gray-700 text-sm">{h}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Advice grid */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-2xl font-bold text-gray-900">Recommendations & vineyard works</h3>
            <p className="text-gray-600 text-sm">
              {vineyardAdvice.length} recommendations · {totalWorks} concrete field works. Click any card
              for the evidence and seasonal works.
            </p>
          </div>
          <div className="flex gap-2">
            {priorityFilters.map(f => (
              <button
                key={f.key}
                onClick={() => setPriority(f.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  priority === f.key
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filtered.map(advice => (
            <AdviceCard key={advice.id} advice={advice} onClick={() => setSelected(advice)} />
          ))}
        </div>
      </div>

      {/* Seasonal calendar */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <CalendarDays size={22} className="text-emerald-600" />
          <h3 className="text-2xl font-bold text-gray-900">Seasonal calendar of works</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {SEASON_ORDER.map(season => {
            const meta = seasonMeta[season];
            const works = worksBySeason[season];
            return (
              <div
                key={season}
                className={`bg-gradient-to-br ${meta.className} rounded-2xl p-5 border`}
              >
                <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span className="text-xl">{meta.emoji}</span>
                  {meta.label}
                  <span className="ml-auto text-xs font-normal text-gray-500">{works.length}</span>
                </h4>
                <ul className="space-y-2">
                  {works.map((w, i) => (
                    <li key={i} className="text-sm text-gray-700">
                      <span className="text-gray-400">•</span> {w.action}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <AdviceModal advice={selected} isOpen={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}
