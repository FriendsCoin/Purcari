/**
 * Gamification system utilities
 */

import type { Achievement, UserProgress, Challenge, Quest } from '@/types/gamification';

/**
 * Calculate level from XP using exponential curve
 */
export function calculateLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

/**
 * Calculate XP required for next level
 */
export function xpForLevel(level: number): number {
  return Math.pow(level, 2) * 100;
}

/**
 * Calculate XP needed to reach next level
 */
export function xpToNextLevel(currentXP: number): number {
  const currentLevel = calculateLevel(currentXP);
  const nextLevelXP = xpForLevel(currentLevel + 1);
  return nextLevelXP - currentXP;
}

/**
 * Award XP and check for level up
 */
export function awardXP(currentProgress: UserProgress, xpAmount: number): {
  newProgress: UserProgress;
  leveledUp: boolean;
  newLevel?: number;
} {
  const newXP = currentProgress.xp + xpAmount;
  const oldLevel = currentProgress.level;
  const newLevel = calculateLevel(newXP);
  const leveledUp = newLevel > oldLevel;

  return {
    newProgress: {
      ...currentProgress,
      xp: newXP,
      level: newLevel,
      xpToNextLevel: xpToNextLevel(newXP),
      totalPoints: currentProgress.totalPoints + xpAmount
    },
    leveledUp,
    newLevel: leveledUp ? newLevel : undefined
  };
}

/**
 * Generate default achievements
 */
export function generateAchievements(): Achievement[] {
  return [
    // Explorer category
    {
      id: 'first-species',
      title: 'First Discovery',
      description: 'View your first species data',
      icon: '🔍',
      points: 10,
      category: 'explorer',
      unlocked: false,
      progress: 0,
      requirement: 1,
      rarity: 'common'
    },
    {
      id: 'species-collector',
      title: 'Species Collector',
      description: 'Analyze data for 10 different species',
      icon: '📚',
      points: 50,
      category: 'explorer',
      unlocked: false,
      progress: 0,
      requirement: 10,
      rarity: 'rare'
    },
    {
      id: 'biodiversity-master',
      title: 'Biodiversity Master',
      description: 'Discover all species in the dataset',
      icon: '👑',
      points: 200,
      category: 'explorer',
      unlocked: false,
      progress: 0,
      requirement: 50,
      rarity: 'legendary'
    },

    // Scientist category
    {
      id: 'hypothesis-tester',
      title: 'Hypothesis Tester',
      description: 'Review 3 scientific hypotheses',
      icon: '🧪',
      points: 30,
      category: 'scientist',
      unlocked: false,
      progress: 0,
      requirement: 3,
      rarity: 'common'
    },
    {
      id: 'data-analyst',
      title: 'Data Analyst',
      description: 'Use 5 different visualization tools',
      icon: '📊',
      points: 75,
      category: 'scientist',
      unlocked: false,
      progress: 0,
      requirement: 5,
      rarity: 'rare'
    },
    {
      id: 'ml-pioneer',
      title: 'ML Pioneer',
      description: 'Explore all Machine Learning visualizations',
      icon: '🤖',
      points: 100,
      category: 'scientist',
      unlocked: false,
      progress: 0,
      requirement: 5,
      rarity: 'epic'
    },

    // Conservationist category
    {
      id: 'conservation-advocate',
      title: 'Conservation Advocate',
      description: 'Spend 10 minutes analyzing biodiversity data',
      icon: '🌿',
      points: 40,
      category: 'conservationist',
      unlocked: false,
      progress: 0,
      requirement: 600, // seconds
      rarity: 'common'
    },
    {
      id: 'eco-warrior',
      title: 'Eco Warrior',
      description: 'Visit the dashboard 7 days in a row',
      icon: '⚔️',
      points: 150,
      category: 'conservationist',
      unlocked: false,
      progress: 0,
      requirement: 7,
      rarity: 'epic'
    },

    // Data Master category
    {
      id: 'data-explorer',
      title: 'Data Explorer',
      description: 'Analyze 1000 observation data points',
      icon: '📈',
      points: 60,
      category: 'data-master',
      unlocked: false,
      progress: 0,
      requirement: 1000,
      rarity: 'rare'
    },
    {
      id: '3d-enthusiast',
      title: '3D Enthusiast',
      description: 'Interact with all 3D visualizations',
      icon: '🎨',
      points: 80,
      category: 'data-master',
      unlocked: false,
      progress: 0,
      requirement: 7,
      rarity: 'epic'
    },
    {
      id: 'ar-explorer',
      title: 'AR Explorer',
      description: 'Experience biodiversity in Augmented Reality',
      icon: '📱',
      points: 120,
      category: 'data-master',
      unlocked: false,
      progress: 0,
      requirement: 1,
      rarity: 'epic'
    },
    {
      id: 'gesture-master',
      title: 'Gesture Master',
      description: 'Control visualizations using hand gestures',
      icon: '👋',
      points: 90,
      category: 'data-master',
      unlocked: false,
      progress: 0,
      requirement: 10,
      rarity: 'rare'
    }
  ];
}

/**
 * Generate daily challenges
 */
export function generateDailyChallenges(): Challenge[] {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return [
    {
      id: 'daily-explorer',
      title: 'Daily Explorer',
      description: 'View 5 different species today',
      type: 'daily',
      icon: '🔍',
      points: 25,
      progress: 0,
      goal: 5,
      expiresAt: tomorrow,
      completed: false
    },
    {
      id: 'daily-analyst',
      title: 'Daily Analyst',
      description: 'Use 3 different visualization tools',
      type: 'daily',
      icon: '📊',
      points: 30,
      progress: 0,
      goal: 3,
      expiresAt: tomorrow,
      completed: false
    },
    {
      id: 'daily-learner',
      title: 'Daily Learner',
      description: 'Review 2 scientific hypotheses',
      type: 'daily',
      icon: '📚',
      points: 20,
      progress: 0,
      goal: 2,
      expiresAt: tomorrow,
      completed: false
    }
  ];
}

/**
 * Generate tutorial quest
 */
export function generateTutorialQuest(): Quest {
  return {
    id: 'getting-started',
    title: 'Getting Started with Biodiversity Data',
    description: 'Learn the basics of the Purcari Biodiversity Dashboard',
    steps: [
      {
        id: 'step-1',
        description: 'Load demo or real data',
        completed: false,
        action: 'load-data'
      },
      {
        id: 'step-2',
        description: 'View the species distribution chart',
        completed: false,
        action: 'view-species-distribution'
      },
      {
        id: 'step-3',
        description: 'Explore a scientific hypothesis',
        completed: false,
        action: 'view-hypothesis'
      },
      {
        id: 'step-4',
        description: 'Try a 3D visualization',
        completed: false,
        action: 'view-3d-viz'
      },
      {
        id: 'step-5',
        description: 'Check out Machine Learning predictions',
        completed: false,
        action: 'view-ml'
      }
    ],
    reward: {
      xp: 100,
      badge: {
        id: 'tutorial-complete',
        name: 'Quick Learner',
        description: 'Completed the tutorial',
        icon: '🎓',
        color: '#3B82F6',
        earnedAt: new Date()
      }
    },
    active: true,
    completed: false
  };
}

/**
 * Check and update achievement progress
 */
export function updateAchievementProgress(
  achievement: Achievement,
  newProgress: number
): { achievement: Achievement; unlocked: boolean } {
  const updatedAchievement = {
    ...achievement,
    progress: Math.min(newProgress, achievement.requirement)
  };

  if (newProgress >= achievement.requirement && !achievement.unlocked) {
    updatedAchievement.unlocked = true;
    updatedAchievement.unlockedAt = new Date();
    return { achievement: updatedAchievement, unlocked: true };
  }

  return { achievement: updatedAchievement, unlocked: false };
}

/**
 * Get rarity color
 */
export function getRarityColor(rarity: Achievement['rarity']): string {
  switch (rarity) {
    case 'common':
      return '#9CA3AF'; // gray
    case 'rare':
      return '#3B82F6'; // blue
    case 'epic':
      return '#A855F7'; // purple
    case 'legendary':
      return '#F59E0B'; // gold
  }
}

/**
 * Get category color
 */
export function getCategoryColor(category: Achievement['category']): string {
  switch (category) {
    case 'explorer':
      return '#10B981'; // green
    case 'scientist':
      return '#3B82F6'; // blue
    case 'conservationist':
      return '#059669'; // emerald
    case 'data-master':
      return '#8B5CF6'; // violet
  }
}
