import {
  Code,
  Palette,
  Users,
  DollarSign,
  Calendar,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/components/common/Modal';
import type { Project } from '@/types';

interface ProjectModalProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectModal({ project, isOpen, onClose }: ProjectModalProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    concept: true,
    features: false,
    journey: false,
    technical: false,
    implementation: false,
    roi: false,
  });

  if (!project) return null;

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const Section = ({
    id,
    title,
    icon,
    children,
  }: {
    id: string;
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => toggleSection(id)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          {icon}
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        {expandedSections[id] ? (
          <ChevronUp className="text-gray-600" />
        ) : (
          <ChevronDown className="text-gray-600" />
        )}
      </button>
      {expandedSections[id] && <div className="p-4 bg-white">{children}</div>}
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={project.name} size="xl">
      <div className="space-y-4">
        {/* Header */}
        <div className={`bg-gradient-to-r ${project.color} p-6 rounded-xl`}>
          <div className="flex items-center gap-4 mb-3">
            <span className="text-6xl">{project.icon}</span>
            <div>
              <h2 className="text-2xl font-bold text-white">{project.name}</h2>
              <p className="text-white text-opacity-90">{project.tagline}</p>
            </div>
          </div>
          <p className="text-white text-sm mt-4">{project.description}</p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-purple-50 rounded-lg p-3">
            <Calendar size={20} className="text-purple-600 mb-2" />
            <p className="text-xs text-gray-600">Timeline</p>
            <p className="text-sm font-bold text-gray-900">{project.implementation.timeline}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <DollarSign size={20} className="text-green-600 mb-2" />
            <p className="text-xs text-gray-600">Budget</p>
            <p className="text-sm font-bold text-gray-900">{project.implementation.budget}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-3">
            <Code size={20} className="text-blue-600 mb-2" />
            <p className="text-xs text-gray-600">Tech Stack</p>
            <p className="text-sm font-bold text-gray-900">
              {project.technicalStack.length} technologies
            </p>
          </div>
          <div className="bg-orange-50 rounded-lg p-3">
            <TrendingUp size={20} className="text-orange-600 mb-2" />
            <p className="text-xs text-gray-600">Engagement</p>
            <p className="text-sm font-bold text-gray-900">Score: {project.score}</p>
          </div>
        </div>

        {/* Expandable Sections */}
        <div className="space-y-3">
          <Section id="concept" title="Concept" icon={<Palette className="text-purple-600" />}>
            <p className="text-gray-700">{project.concept}</p>
          </Section>

          <Section id="features" title="Features" icon={<Code className="text-blue-600" />}>
            <ul className="space-y-2">
              {project.features.map((feature, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="inline-block w-2 h-2 mt-2 bg-blue-600 rounded-full flex-shrink-0" />
                  <span className="text-gray-700">{feature}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="journey" title="User Journey" icon={<Users className="text-green-600" />}>
            <ol className="space-y-3">
              {project.userJourney.map((step, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="inline-flex items-center justify-center w-6 h-6 bg-green-100 text-green-600 rounded-full flex-shrink-0 text-sm font-bold">
                    {index + 1}
                  </span>
                  <span className="text-gray-700 mt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </Section>

          <Section
            id="technical"
            title="Technical Stack"
            icon={<Code className="text-indigo-600" />}
          >
            <div className="space-y-3">
              {project.technicalStack.map((tech, index) => (
                <div key={index} className="bg-gray-50 rounded-lg p-3">
                  <p className="font-semibold text-gray-900">{tech.tech}</p>
                  <p className="text-sm text-gray-600 mt-1">{tech.purpose}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="implementation"
            title="Implementation Phases"
            icon={<Calendar className="text-orange-600" />}
          >
            <div className="space-y-4">
              {project.implementation.phases.map((phase, index) => (
                <div key={index} className="border-l-4 border-orange-500 pl-4">
                  <h4 className="font-semibold text-gray-900 mb-2">{phase.phase}</h4>
                  <ul className="space-y-1">
                    {phase.tasks.map((task, taskIndex) => (
                      <li key={taskIndex} className="text-sm text-gray-700 flex items-start gap-2">
                        <span className="text-orange-500">•</span>
                        {task}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>

          <Section id="roi" title="Return on Investment" icon={<DollarSign className="text-green-600" />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(project.roi).map(([key, value]) => (
                <div key={key} className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4">
                  <p className="text-sm font-semibold text-gray-900 mb-1 capitalize">{key}</p>
                  <p className="text-sm text-gray-700">{value}</p>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Why It Works */}
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Why It Works</h3>
          <ul className="space-y-2">
            {project.whyItWorks.map((reason, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="inline-block w-2 h-2 mt-2 bg-purple-600 rounded-full flex-shrink-0" />
                <span className="text-gray-700">{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
