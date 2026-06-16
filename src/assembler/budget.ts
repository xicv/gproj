export interface Section { label: string; priority: number; text: string; mandatory?: boolean; }
export interface SizedSection extends Section { estimatedTokens: number; budgetCost: number; }
export interface DroppedSection { label: string; estimatedTokens: number; }
export interface TruncatedSection { label: string; fromTokens: number; toTokens: number; }
export interface BudgetResult {
  sections: Section[];
  estimatedTokens: number;
  dropped: DroppedSection[];
  truncated: TruncatedSection[];
  mandatoryOverflow: boolean;
}

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
export const budgetCost = (text: string): number => Math.ceil(estimateTokens(text) * 1.15);

const minTruncateBudget = 40;
const truncateMarker = "\n…[truncated]";

function sizeSection(section: Section): SizedSection {
  return {
    ...section,
    estimatedTokens: estimateTokens(section.text),
    budgetCost: budgetCost(section.text),
  };
}

function truncateText(text: string, tokenBudget: number): string {
  if (tokenBudget <= 0) return "";
  const markerTokens = estimateTokens(truncateMarker);
  const maxEstimatedTokens = Math.floor(tokenBudget / 1.15);
  const contentBudget = Math.max(0, maxEstimatedTokens - markerTokens);
  const maxChars = contentBudget * 4;
  return `${text.slice(0, maxChars).trimEnd()}${truncateMarker}`;
}

export function planBudget(sections: Section[], maxTokens: number): BudgetResult {
  const ordered = [...sections].sort((a, b) => b.priority - a.priority).map(sizeSection);
  const included: Section[] = [];
  const dropped: DroppedSection[] = [];
  const truncated: TruncatedSection[] = [];
  let usedBudget = 0;
  let estimatedTokens = 0;

  for (const section of ordered.filter((item) => item.mandatory)) {
    included.push(section);
    usedBudget += section.budgetCost;
    estimatedTokens += section.estimatedTokens;
  }

  const mandatoryOverflow = usedBudget > maxTokens;

  for (const section of ordered.filter((item) => !item.mandatory)) {
    const remaining = maxTokens - usedBudget;
    if (section.budgetCost <= remaining) {
      included.push(section);
      usedBudget += section.budgetCost;
      estimatedTokens += section.estimatedTokens;
      continue;
    }
    if (remaining < minTruncateBudget) {
      dropped.push({ label: section.label, estimatedTokens: section.estimatedTokens });
      continue;
    }

    const text = truncateText(section.text, remaining);
    const toTokens = estimateTokens(text);
    included.push({ ...section, text });
    usedBudget += budgetCost(text);
    estimatedTokens += toTokens;
    truncated.push({ label: section.label, fromTokens: section.estimatedTokens, toTokens });
  }

  return {
    sections: included.sort((a, b) => b.priority - a.priority),
    estimatedTokens,
    dropped,
    truncated,
    mandatoryOverflow,
  };
}

export function pruneToBudget(sections: Section[], maxTokens: number): Section[] {
  return planBudget(sections, maxTokens).sections;
}
