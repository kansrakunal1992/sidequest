/** Links to the public pages served by the API (privacy policy, terms and community guidelines, web account deletion). Null when the API address is missing or not https. */
export interface LegalLinks { terms: string; privacy: string; deleteAccount: string }
export function legalLinks(apiUrl: string | null | undefined): LegalLinks | null {
  const base = (apiUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/i.test(base)) return null;
  return { terms: `${base}/terms`, privacy: `${base}/privacy`, deleteAccount: `${base}/delete-account` };
}
