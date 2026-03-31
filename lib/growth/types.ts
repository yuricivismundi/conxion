export type DanceMoveStatus = "planned" | "practicing" | "learned";
export type DanceMoveDifficulty = "easy" | "medium" | "hard";
export type DanceMoveType = "footwork" | "partnerwork" | "turn-pattern" | "styling" | "musicality" | "other";

export type DanceMoveUser = {
  id: string;
  userId: string;
  style: string;
  name: string;
  status: DanceMoveStatus;
  confidence: number | null;
  difficulty: DanceMoveDifficulty;
  moveType: DanceMoveType;
  practiceCount: number;
  startedPracticingAt: string | null;
  lastPracticedAt: string | null;
  referenceUrl: string | null;
  keyCue: string | null;
  commonMistake: string | null;
  fixTip: string | null;
  note: string | null;
  isPublic: boolean;
  learnedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DanceMovePracticeLog = {
  id: string;
  moveId: string;
  userId: string;
  confidenceAfter: number | null;
  quickNote: string | null;
  createdAt: string;
};

export type DanceGrowthSummary = {
  userId: string;
  plannedCount: number;
  practicingCount: number;
  learnedCount: number;
  stylesTracked: string[];
  recentlyLearned: string[];
};

export function isSchemaMissingError(message: string) {
  const text = message.toLowerCase();
  if (text.includes("could not find the table")) return true;
  if (text.includes("schema cache") && (text.includes("table") || text.includes("relation"))) return true;
  if (text.includes("column") && text.includes("does not exist")) return false;
  if (text.includes("table") && text.includes("does not exist")) return true;
  if (text.includes("relation") && text.includes("does not exist")) return true;
  return false;
}

export function titleCase(value: string) {
  if (!value) return value;
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
