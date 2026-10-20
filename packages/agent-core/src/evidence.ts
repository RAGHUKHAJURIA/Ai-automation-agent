import { z } from 'zod';

export interface ToolEvidence { toolName: string; arguments: unknown; output: unknown }

const mathArguments = z.object({ left: z.number().finite(), right: z.number().finite() }).strict();
const mathOutput = z.object({ result: z.number().finite() }).strict();
const timeOutput = z.object({ timestamp: z.string().datetime(), timezone: z.string().min(1) }).strict();

export function verifyGoalEvidence(goal: string, evidence: readonly ToolEvidence[]): { verified: boolean; summary?: string } {
  const lower = goal.toLowerCase();
  const numbers = [...goal.matchAll(/-?\d+(?:\.\d+)?/g)].map(([value]) => Number(value));
  const latest = (toolName: string) => [...evidence].reverse().find((item) => item.toolName === toolName);
  const timeRequested = /\b(time|clock|date)\b/.test(lower);
  const addRequested = /\b(add|sum|plus)\b|\d\s*\+\s*\d/.test(lower);
  const multiplyRequested = /\b(multiply|multiplication|product|times)\b|\d\s*[×*]\s*\d/.test(lower);
  if (timeRequested) {
    const result = latest('system.get_time');
    const parsed = result ? timeOutput.safeParse(result.output) : undefined;
    if (!parsed?.success) return { verified: false };
    let localized: string;
    try { localized = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'long', timeZone: parsed.data.timezone }).format(new Date(parsed.data.timestamp)); }
    catch { return { verified: false }; }
    return { verified: true, summary: `Current time in ${parsed.data.timezone} is ${localized}.` };
  }

  const addEvidence = latest('math.add');
  const multiplyEvidence = latest('math.multiply');
  if (addRequested) {
    if (!addEvidence) return { verified: false };
    const args = mathArguments.safeParse(addEvidence.arguments);
    const output = mathOutput.safeParse(addEvidence.output);
    if (!args.success || !output.success || output.data.result !== args.data.left + args.data.right) return { verified: false };
    if (numbers.length >= 2 && ![args.data.left, args.data.right].every((value) => numbers.slice(0, 2).includes(value))) return { verified: false };
    if (multiplyRequested) {
      if (!multiplyEvidence || numbers.length < 3) return { verified: false };
      const multiplyArgs = mathArguments.safeParse(multiplyEvidence.arguments);
      const multiplyOutput = mathOutput.safeParse(multiplyEvidence.output);
      const multiplier = numbers[2];
      if (!multiplyArgs.success || !multiplyOutput.success || multiplier === undefined || ![multiplyArgs.data.left, multiplyArgs.data.right].includes(output.data.result) || ![multiplyArgs.data.left, multiplyArgs.data.right].includes(multiplier) || multiplyOutput.data.result !== output.data.result * multiplier) return { verified: false };
      return { verified: true, summary: `Calculation complete: ${multiplyOutput.data.result}.` };
    }
    return { verified: true, summary: `Sum: ${output.data.result}.` };
  }

  if (multiplyRequested) {
    if (!multiplyEvidence) return { verified: false };
    const args = mathArguments.safeParse(multiplyEvidence.arguments);
    const output = mathOutput.safeParse(multiplyEvidence.output);
    if (!args.success || !output.success || output.data.result !== args.data.left * args.data.right) return { verified: false };
    if (numbers.length >= 2 && ![args.data.left, args.data.right].every((value) => numbers.slice(0, 2).includes(value))) return { verified: false };
    return { verified: true, summary: `Product: ${output.data.result}.` };
  }

  return { verified: false };
}
