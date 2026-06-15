export interface Section { label: string; priority: number; text: string; mandatory?: boolean; }
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
export function pruneToBudget(sections: Section[], maxTokens: number): Section[] {
  const ordered = [...sections].sort((a, b) => b.priority - a.priority);
  const kept: Section[] = [];
  let used = 0;
  // mandatory sections are always kept, even if they push past the budget
  for (const s of ordered.filter((x) => x.mandatory)) { kept.push(s); used += estimateTokens(s.text); }
  for (const s of ordered.filter((x) => !x.mandatory)) {
    const cost = estimateTokens(s.text);
    if (used + cost <= maxTokens) { kept.push(s); used += cost; }
  }
  return kept.sort((a, b) => b.priority - a.priority);
}
