export interface ChatMessage { id: string; conversationId: string; senderId: string; body: string | null; mediaKind: string | null; revealedBy: string[]; createdAt: Date }

export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

const STARTERS: Record<string, string> = {
  food: "What's the best meal you've had this year?", coffee: 'Coffee order, and do you have a favourite place?', trekking: "What's the best trek or trail you've done?",
  travel: 'Where is the next place on your list?', music: "What are you listening to on repeat right now?", movies: 'What film could you watch again and again?',
  'board games': 'Are you a strategy person or a party-game person?', fitness: 'What do you do to stay active?', cricket: 'Who is your all-time favourite player?',
  football: 'Who do you support?', photography: "What's your favourite photo you've taken?", art: 'Seen any good exhibitions lately?', reading: "What's the last book you couldn't put down?",
  cooking: "What's your signature dish?", dancing: 'Do you dance when no one is watching?', comedy: 'Who always makes you laugh?', gaming: 'What are you playing at the moment?',
  yoga: 'How long have you been practising?', 'road trips': 'Best road trip you have taken?', tech: "What's the coolest thing you've built or tried lately?",
};
const GENERIC = ["What's something that made you smile this week?", "What's a small thing you're looking forward to?", 'Chai or coffee?'];

/** Suggestions only. They fill the text box for the person to edit; nothing is ever sent on anyone's behalf. */
export function conversationStarters(shared: string[], max = 3): string[] {
  const out: string[] = [];
  for (const s of shared) { const q = STARTERS[s.trim().toLowerCase()]; if (q && !out.includes(q)) out.push(q); }
  for (const g of GENERIC) if (out.length < max && !out.includes(g)) out.push(g);
  return out.slice(0, max);
}

export function receiptLabel(lastMine: ChatMessage | undefined, otherLastReadAt: Date | null): 'Seen' | 'Sent' | null {
  if (!lastMine) return null;
  return otherLastReadAt && otherLastReadAt.getTime() >= lastMine.createdAt.getTime() ? 'Seen' : 'Sent';
}

export function previewText(last: { body: string | null; mediaKind: string | null; fromMe: boolean } | null): string {
  if (!last) return 'Say hi';
  const t = last.mediaKind === 'image' ? 'Photo' : last.mediaKind === 'voice' ? 'Voice note' : (last.body ?? '').replace(/\s+/g, ' ').slice(0, 80);
  return last.fromMe ? `You: ${t}` : t;
}

export function chatErrorMessage(code: string | undefined): string {
  if (code === 'SQ429') return 'You are sending very fast. Take a breath and try again in a moment.';
  if (code === 'SQ430') return 'Give them a little time to reply before sending more. It keeps first chats comfortable for everyone.';
  if (code === '42501') return 'This conversation is not available any more.';
  return 'That message did not send. Check your connection and try again.';
}

export const FIRST_CONTACT_LIMIT = 3;
/** Mirrors the database rule: until the other person replies, you can send three messages. The server enforces it either way. */
export function sendGate(messages: ChatMessage[], me: string): { allowed: boolean; hint: string | null } {
  const theirs = messages.some((m) => m.senderId !== me);
  const mine = messages.filter((m) => m.senderId === me).length;
  if (!theirs && mine >= FIRST_CONTACT_LIMIT) return { allowed: false, hint: 'Waiting for a reply. You can message again once they respond.' };
  if (!theirs && mine === FIRST_CONTACT_LIMIT - 1) return { allowed: true, hint: 'One more message until they reply.' };
  return { allowed: true, hint: null };
}

export interface PlanNudge { reason: 'ready' | 'quiet'; title: string; body: string }
const QUIET_AFTER_MS = 24 * 3_600_000;
/**
 * A gentle prompt to turn a chat into a plan. It appears only after a real back-and-forth, never while a plan already exists,
 * never after it was dismissed, and it only suggests: nothing is sent unless the person taps through and sends it.
 */
export function planNudge(o: { messages: Pick<ChatMessage, 'senderId' | 'createdAt'>[]; me: string; now: Date; hasOpenPlan: boolean; dismissed: boolean; eligible: boolean }): PlanNudge | null {
  if (!o.eligible || o.hasOpenPlan || o.dismissed) return null;
  const mine = o.messages.filter((m) => m.senderId === o.me).length;
  const theirs = o.messages.length - mine;
  if (mine < 1 || theirs < 1) return null;
  const last = Math.max(...o.messages.map((m) => m.createdAt.getTime()));
  if (o.messages.length >= 4 && o.now.getTime() - last >= QUIET_AFTER_MS) return { reason: 'quiet', title: 'Chat gone quiet?', body: 'A plan can pick it back up. Suggest something simple, like a chai.' };
  if (mine >= 2 && theirs >= 2 && o.messages.length >= 6) return { reason: 'ready', title: 'Enjoying this chat?', body: 'Turn it into a plan. Pick a place, and they can say yes or suggest another time.' };
  return null;
}
