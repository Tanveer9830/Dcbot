/**
 * Leveling maths. Shared by the bot and the dashboard so both compute
 * progress identically.
 *
 * Curve: level N requires 100 * N^2 cumulative XP.
 *   level 0 -> 0, level 1 -> 100, level 2 -> 400, level 3 -> 900 ...
 */
export function xpForLevel(level: number): number {
  if (level < 0) throw new RangeError('level must be >= 0');
  return 100 * level * level;
}

export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  return Math.floor(Math.sqrt(xp / 100));
}

export interface LevelProgress {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP still needed for the next level. */
  xpToNextLevel: number;
  /** 0..1 progress through the current level. */
  percent: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const span = Math.max(1, nextLevelXp - currentLevelXp);
  const xpIntoLevel = Math.max(0, xp - currentLevelXp);
  return {
    level,
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel,
    xpToNextLevel: Math.max(0, nextLevelXp - xp),
    percent: Math.min(1, xpIntoLevel / span),
  };
}

/** Random XP for a message, clamped to [min, max]. */
export function rollMessageXp(
  min: number,
  max: number,
  random: () => number = Math.random,
): number {
  if (max < min) throw new RangeError('max must be >= min');
  return min + Math.floor(random() * (max - min + 1));
}
