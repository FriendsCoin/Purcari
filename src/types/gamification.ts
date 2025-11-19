/**
 * Gamification system types
 */

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  points: number;
  category: 'explorer' | 'scientist' | 'conservationist' | 'data-master';
  unlocked: boolean;
  unlockedAt?: Date;
  progress: number; // 0-100
  requirement: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  earnedAt: Date;
}

export interface UserProgress {
  level: number;
  xp: number;
  xpToNextLevel: number;
  totalPoints: number;
  speciesDiscovered: number;
  dataPointsAnalyzed: number;
  visualizationsViewed: number;
  achievementsUnlocked: number;
  streak: number; // Days streak
  lastVisit: Date;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  avatar?: string;
  level: number;
  points: number;
  achievementsCount: number;
  speciesDiscovered: number;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  type: 'daily' | 'weekly' | 'special';
  icon: string;
  points: number;
  progress: number;
  goal: number;
  expiresAt: Date;
  completed: boolean;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  steps: QuestStep[];
  reward: {
    xp: number;
    badge?: Badge;
    achievement?: Achievement;
  };
  active: boolean;
  completed: boolean;
}

export interface QuestStep {
  id: string;
  description: string;
  completed: boolean;
  action: string; // e.g., 'view-species-network', 'analyze-data', etc.
}
