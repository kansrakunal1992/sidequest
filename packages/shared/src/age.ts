export const MIN_AGE = 18;

/** dob is 'YYYY-MM-DD'. Returns whole years at `now` (UTC). Throws on invalid input. */
export function ageOn(dob: string, now: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) throw new Error('Invalid date of birth format');
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error('Invalid calendar date');
  }
  const ny = now.getUTCFullYear(), nm = now.getUTCMonth() + 1, nd = now.getUTCDate();
  if (y > ny || (y === ny && (mo > nm || (mo === nm && d > nd)))) throw new Error('Date of birth is in the future');
  let years = ny - y;
  // Feb 29 babies: conservatively count the birthday as Mar 1 in non-leap years.
  let bm = mo, bd = d;
  const leap = (yr: number) => (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
  if (mo === 2 && d === 29 && !leap(ny)) { bm = 3; bd = 1; }
  if (nm < bm || (nm === bm && nd < bd)) years -= 1;
  return years;
}

export function isAdult(dob: string, now: Date): boolean {
  try { return ageOn(dob, now) >= MIN_AGE; } catch { return false; }
}
