import { z } from 'zod';

export interface ToolEvidence {
  toolName: string;
  arguments: unknown;
  output: unknown;
}

const mathArguments = z.object({ left: z.number().finite(), right: z.number().finite() }).strict();
const mathOutput = z.object({ result: z.number().finite() }).strict();
const timeOutput = z
  .object({ timestamp: z.string().datetime(), timezone: z.string().min(1) })
  .strict();

export function verifyGoalEvidence(
  goal: string,
  evidence: readonly ToolEvidence[],
): { verified: boolean; summary?: string } {
  const lower = goal.toLowerCase();
  const numbers = [...goal.matchAll(/-?\d+(?:\.\d+)?/g)].map(([value]) => Number(value));
  const latest = (toolName: string) =>
    [...evidence].reverse().find((item) => item.toolName === toolName);
  const has = (pattern: RegExp) => pattern.test(lower);
  if (has(/\b(schedule|every|recurring|remind|notify me when)\b/)) {
    const output = latest('tasks.schedule')?.output;
    const parsed = z
      .object({
        scheduleId: z.string().uuid(),
        nextRuns: z.array(z.string().datetime()).min(1),
        queuePending: z.literal(false),
      })
      .passthrough()
      .safeParse(output);
    return parsed.success
      ? {
          verified: true,
          summary: `Schedule ${parsed.data.scheduleId} was stored and queued; next run ${parsed.data.nextRuns[0]}.`,
        }
      : { verified: false };
  }
  if (has(/\b(send|sent)\b/) && has(/\b(email|mail|message)\b/)) {
    const parsed = z
      .object({ status: z.literal('SENT_VERIFIED'), providerMessageId: z.string().min(1) })
      .passthrough()
      .safeParse(latest('email.send')?.output);
    return parsed.success
      ? { verified: true, summary: 'Gmail accepted the message and it appears in Sent.' }
      : { verified: false };
  }
  if (has(/\b(draft|compose)\b/) && has(/\b(email|mail|message)\b/)) {
    const output = latest('email.update_draft')?.output ?? latest('email.draft')?.output;
    const parsed = z
      .object({ draftRef: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
      .passthrough()
      .safeParse(output);
    return parsed.success
      ? { verified: true, summary: `Gmail draft ${parsed.data.draftRef} was verified.` }
      : { verified: false };
  }
  if (has(/\b(email|mail|message)\b/) && has(/\b(read|summarize|open)\b/)) {
    const parsed = z
      .object({
        emailRef: z.string().uuid(),
        textBody: z.string(),
        sourceTrust: z.literal('UNTRUSTED_EXTERNAL_CONTENT'),
      })
      .passthrough()
      .safeParse(latest('email.read')?.output);
    return parsed.success
      ? {
          verified: true,
          summary: `Gmail message ${parsed.data.emailRef} was read; its content remains untrusted.`,
        }
      : { verified: false };
  }
  if (has(/\b(email|mail|message)\b/) && has(/\b(find|search|look for|list)\b/)) {
    const parsed = z
      .object({
        messages: z.array(z.object({ emailRef: z.string().uuid() }).passthrough()),
        sourceTrust: z.literal('UNTRUSTED_EXTERNAL_CONTENT'),
      })
      .passthrough()
      .safeParse(latest('email.search')?.output);
    return parsed.success
      ? {
          verified: true,
          summary: `Gmail search returned ${parsed.data.messages.length} bounded results.`,
        }
      : { verified: false };
  }
  if (has(/\b(calendar|event|meeting)\b/)) {
    const action = has(/\b(delete|cancel|remove)\b/)
      ? 'calendar.delete_event'
      : has(/\b(update|change|move|edit)\b/)
        ? 'calendar.update_event'
        : has(/\b(create|add|book)\b/)
          ? 'calendar.create_event'
          : has(/\b(list|show|summarize|today|upcoming)\b/)
            ? 'calendar.list_events'
            : 'calendar.get_event';
    const output = latest(action)?.output;
    if (action === 'calendar.delete_event')
      return z
        .object({ eventRef: z.string().uuid(), status: z.literal('DELETED') })
        .passthrough()
        .safeParse(output).success
        ? { verified: true, summary: 'Calendar event deletion was verified.' }
        : { verified: false };
    if (action === 'calendar.list_events')
      return z
        .object({
          events: z.array(z.object({ eventRef: z.string().uuid() }).passthrough()),
          sourceTrust: z.literal('UNTRUSTED_EXTERNAL_CONTENT'),
        })
        .passthrough()
        .safeParse(output).success
        ? { verified: true, summary: 'Calendar events were listed from the connected account.' }
        : { verified: false };
    return z
      .object({ eventRef: z.string().uuid(), summary: z.string(), etag: z.string().nullable() })
      .passthrough()
      .safeParse(output).success
      ? { verified: true, summary: 'Calendar event state was fetched and verified.' }
      : { verified: false };
  }
  const timeRequested = /\b(time|clock|date)\b/.test(lower);
  const addRequested = /\b(add|sum|plus)\b|\d\s*\+\s*\d/.test(lower);
  const multiplyRequested = /\b(multiply|multiplication|product|times)\b|\d\s*[×*]\s*\d/.test(
    lower,
  );
  if (timeRequested) {
    const result = latest('system.get_time');
    const parsed = result ? timeOutput.safeParse(result.output) : undefined;
    if (!parsed?.success) return { verified: false };
    let localized: string;
    try {
      localized = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'long',
        timeZone: parsed.data.timezone,
      }).format(new Date(parsed.data.timestamp));
    } catch {
      return { verified: false };
    }
    return { verified: true, summary: `Current time in ${parsed.data.timezone} is ${localized}.` };
  }

  const addEvidence = latest('math.add');
  const multiplyEvidence = latest('math.multiply');
  if (addRequested) {
    if (!addEvidence) return { verified: false };
    const args = mathArguments.safeParse(addEvidence.arguments);
    const output = mathOutput.safeParse(addEvidence.output);
    if (!args.success || !output.success || output.data.result !== args.data.left + args.data.right)
      return { verified: false };
    if (
      numbers.length >= 2 &&
      ![args.data.left, args.data.right].every((value) => numbers.slice(0, 2).includes(value))
    )
      return { verified: false };
    if (multiplyRequested) {
      if (!multiplyEvidence || numbers.length < 3) return { verified: false };
      const multiplyArgs = mathArguments.safeParse(multiplyEvidence.arguments);
      const multiplyOutput = mathOutput.safeParse(multiplyEvidence.output);
      const multiplier = numbers[2];
      if (
        !multiplyArgs.success ||
        !multiplyOutput.success ||
        multiplier === undefined ||
        ![multiplyArgs.data.left, multiplyArgs.data.right].includes(output.data.result) ||
        ![multiplyArgs.data.left, multiplyArgs.data.right].includes(multiplier) ||
        multiplyOutput.data.result !== output.data.result * multiplier
      )
        return { verified: false };
      return { verified: true, summary: `Calculation complete: ${multiplyOutput.data.result}.` };
    }
    return { verified: true, summary: `Sum: ${output.data.result}.` };
  }

  if (multiplyRequested) {
    if (!multiplyEvidence) return { verified: false };
    const args = mathArguments.safeParse(multiplyEvidence.arguments);
    const output = mathOutput.safeParse(multiplyEvidence.output);
    if (!args.success || !output.success || output.data.result !== args.data.left * args.data.right)
      return { verified: false };
    if (
      numbers.length >= 2 &&
      ![args.data.left, args.data.right].every((value) => numbers.slice(0, 2).includes(value))
    )
      return { verified: false };
    return { verified: true, summary: `Product: ${output.data.result}.` };
  }

  return { verified: false };
}
