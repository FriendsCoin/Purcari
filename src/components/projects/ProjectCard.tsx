import { Zap } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/common/Card';
import type { Project } from '@/types';

interface ProjectCardProps {
  project: Project;
  onClick: () => void;
}

export function ProjectCard({ project, onClick }: ProjectCardProps) {
  return (
    <Card className="cursor-pointer hover:shadow-xl transition-all duration-300" onClick={onClick} hover>
      <div className={`h-2 bg-gradient-to-r ${project.color}`} />

      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-4xl">{project.icon}</span>
            <div>
              <CardTitle as="h3" className="text-xl font-bold">
                {project.name}
              </CardTitle>
              <p className="text-sm text-gray-600 mt-1">{project.tagline}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-purple-100 px-3 py-1 rounded-full">
            <Zap size={16} className="text-purple-600" />
            <span className="text-sm font-bold text-purple-600">Score: {project.score}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <p className="text-gray-700 line-clamp-3">{project.description}</p>

        <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500">Timeline</p>
            <p className="text-sm font-semibold text-gray-900">{project.implementation.timeline}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Budget</p>
            <p className="text-sm font-semibold text-gray-900">{project.implementation.budget}</p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-2">Technical Stack (Preview)</p>
          <div className="flex flex-wrap gap-2">
            {project.technicalStack.slice(0, 3).map((tech, index) => (
              <span
                key={index}
                className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium"
              >
                {tech.tech}
              </span>
            ))}
            {project.technicalStack.length > 3 && (
              <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs">
                +{project.technicalStack.length - 3} more
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-purple-600 mt-4 flex items-center gap-1 font-medium">
          Click to explore full concept →
        </p>
      </CardContent>
    </Card>
  );
}
