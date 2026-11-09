/**
 * Plain-language safety checks on message text. They run on the device of the person who RECEIVES a message, so the warning shows up at once,
 * and the same code is available to the server. A warning is never silent: the person sees what looked wrong and can report, block, or say "I know them".
 * These are cues, not verdicts: they can be wrong in both directions, and the wording says "may".
 */
export type RiskCode = 'money' | 'investment' | 'off_platform' | 'link' | 'contact_info' | 'pressure' | 'romance_scam' | 'explicit';
export type RiskLevel = 'none' | 'caution' | 'warning';
export interface RiskFlag { code: RiskCode; level: Exclude<RiskLevel, 'none'>; title: string; advice: string }
export interface TextAssessment { level: RiskLevel; flags: RiskFlag[]; explicit: boolean }

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
const norm = (t: string): string => t.toLowerCase().replace(/[01345 7@$]/g, (c) => LEET[c] ?? c).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const squash = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]/g, '');

const PLAT = '(whatsapp|whats app|telegram|signal|snapchat|snap|kik|wechat|line|insta|instagram|imessage|viber|discord)';
/** A platform name only counts when it is a request or an offer to move the chat ("add me on", "my whatsapp"), not when it is just mentioned. */
const OFF_PLATFORM = [
  new RegExp(`\\b(add|follow|dm|message|msg|chat|talk|text|find|reach|contact|hit|move|switch|continue|call)\\b[^.!?]{0,25}\\b${PLAT}\\b`),
  new RegExp(`\\b${PLAT}\\b[^.!?]{0,12}\\b(id|handle|username|number|me|here|instead)\\b`),
  new RegExp(`\\bmy ${PLAT}\\b`),
];

const RULES: { code: RiskCode; level: 'caution' | 'warning'; test: (raw: string, n: string) => boolean; title: string; advice: string }[] = [
  { code: 'money', level: 'warning', title: 'Asks for money or gifts', advice: 'Never send money, gift cards or bank details to someone you have not met in person, however good the reason sounds.',
    test: (r, n) => /\b(send|give|lend|wire|transfer|pay)\b.{0,30}\b(money|cash|funds|payment|me)\b/.test(n) && /\b(money|cash|funds|bank|card|account|payment|urgent|emergency)\b/.test(n)
      || /\bgift ?cards?\b|\bitunes cards?\b|\bsteam cards?\b|\bwestern union\b|\bmoneygram\b|\bbank (details|account|transfer)\b|\bneed (some )?(money|cash)\b/.test(n)
      || /\b(cash ?app|venmo|zelle|paypal|paytm|upi)\b.{0,40}\b(send|pay|me|my)\b|\b(send|pay)\b.{0,40}\b(cash ?app|venmo|zelle|paypal|paytm|upi)\b/.test(n) || /[$£€₹]\s?\d{2,}/.test(r) && /\b(send|need|give|lend|pay)\b/.test(n) },
  { code: 'investment', level: 'warning', title: 'Talks about investing or crypto', advice: 'Romance scams often lead to a "can\'t-lose" investment. Do not move money or install trading apps because someone you met online asked you to.',
    test: (_r, n) => /\b(bitcoin|btc|crypto(currency)?|usdt|ethereum|forex|binance|trading platform|trading app|guaranteed returns?|double your|investment (opportunity|platform|plan))\b/.test(n) },
  { code: 'off_platform', level: 'caution', title: 'Asks to move the chat elsewhere', advice: 'Scammers move chats to other apps where nobody can see or report them. You can stay here until you trust this person.',
    test: (r, n) => OFF_PLATFORM.some((re) => re.test(n)) || /\bwa\.me\/|t\.me\/|\bwhatsapp\.com\//i.test(r) },
  { code: 'link', level: 'caution', title: 'Contains a link', advice: 'Do not open links from people you have not met. They can steal passwords or install harmful apps.',
    test: (r) => /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]{2,}\.(com|net|org|io|app|ly|me|co|xyz|online|site|link|top|click|shop)\b\/?/i.test(r) },
  { code: 'contact_info', level: 'caution', title: 'Shares a phone number or email', advice: 'Keep your own number and email private until you are comfortable.',
    test: (r) => /(\+?\d[\d\s().-]{8,}\d)/.test(r) || /[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(r) },
  { code: 'pressure', level: 'caution', title: 'Pushes you to act fast or keep secrets', advice: 'Real people do not need you to hurry or hide things from your friends. Slow down and talk to someone you trust.',
    test: (_r, n) => /\b(right now|act fast|limited time|do not tell anyone|dont tell anyone|keep (this|it) (between us|secret)|before it is too late|immediately)\b/.test(n) },
  { code: 'romance_scam', level: 'caution', title: 'Matches a common romance-scam story', advice: 'Stories about being overseas, in the military, on an oil rig, an inheritance or a sudden emergency are classic scam openers.',
    test: (_r, n) => /\b(my late (husband|wife)|oil rig|deployed|inheritance|customs fee|stuck at the airport|hospital bills?|widow(er)? with|working overseas|offshore)\b/.test(n) },
  { code: 'explicit', level: 'warning', title: 'May contain explicit content', advice: 'You do not have to read or reply to this. You can hide it, report it, or block this person.',
    test: (_r, n) => /\b(send nudes?|nudes?|dick pics?|cock pics?|blow ?jobs?|hand ?jobs?|cum ?shots?|sex tape|jerk(ing)? off|fuck me|suck my|pussy|only ?fans|titties|boobs pics?)\b/.test(n) || /\bnude pics?\b/.test(n) },
];

export function assessMessageText(text: string | null | undefined, opts: { earlyInConversation?: boolean } = {}): TextAssessment {
  const raw = (text ?? '').trim();
  if (!raw) return { level: 'none', flags: [], explicit: false };
  const n = norm(raw);
  const flags: RiskFlag[] = [];
  for (const r of RULES) if (r.test(raw, n) || (r.code === 'money' && /(gift\s*cards?)/.test(squash(raw).replace(/g1ft/g, 'gift')) )) flags.push({ code: r.code, level: r.level, title: r.title, advice: r.advice });
  if (opts.earlyInConversation) {
    const moved = flags.find((f) => f.code === 'off_platform' || f.code === 'link' || f.code === 'contact_info');
    if (moved && moved.level === 'caution') moved.level = 'warning';
    if (moved) moved.title = `${moved.title} (very early in the chat)`;
  }
  const level: RiskLevel = flags.some((f) => f.level === 'warning') ? 'warning' : flags.length ? 'caution' : 'none';
  return { level, flags, explicit: flags.some((f) => f.code === 'explicit') };
}

export interface AccountTrust { verified: boolean; accountAgeDays: number; repeatedMessageTo: number }
/** The other person's account, as the database sees it (see chat_trust). Each line is factual and visible to the user. */
export function describeAccountTrust(t: AccountTrust, opts: { verificationAvailable?: boolean } = {}): { label: string; tone: 'good' | 'neutral' | 'warn'; detail?: string }[] {
  const out: { label: string; tone: 'good' | 'neutral' | 'warn'; detail?: string }[] = [];
  // While selfie verification is switched off, "Not photo verified" would blame everyone for something they cannot do, so the line is left out.
  if (t.verified || opts.verificationAvailable !== false) out.push(t.verified ? { label: 'Photo verified', tone: 'good', detail: 'This person passed a selfie check against their profile photos.' } : { label: 'Not photo verified', tone: 'neutral', detail: 'They have not done the selfie check yet.' });
  if (t.accountAgeDays < 7) out.push({ label: t.accountAgeDays <= 0 ? 'Joined today' : `Joined ${t.accountAgeDays} day${t.accountAgeDays === 1 ? '' : 's'} ago`, tone: 'warn', detail: 'New accounts are where most scams and fake profiles come from. Take it slowly.' });
  if (t.repeatedMessageTo >= 3) out.push({ label: `Sent the same message to ${t.repeatedMessageTo} people today`, tone: 'warn', detail: 'This looks like copy-and-paste messaging, which is typical of bots and scammers.' });
  return out;
}
export const accountLooksSuspicious = (t: AccountTrust): boolean => t.repeatedMessageTo >= 3 || (!t.verified && t.accountAgeDays < 2 && t.repeatedMessageTo >= 2);
