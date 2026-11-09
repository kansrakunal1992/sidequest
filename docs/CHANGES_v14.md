# v14 changes (on top of v13)
Honest status: written and unit-tested where the sandbox could run tests; **not run against real Didit, Supabase, Railway or a phone**.
Ran here: API 125 passed (17 skipped need `pg`/`jsdom`, 0 failed), shared 50/50, mobile logic 110 passed, SQL checker clean, syntax check on all changed files.
NOT run here: full API/mobile typecheck, the jsdom render tests (including the new verify tests), native build.

- API: `selfie-verification.ts` (Didit client, signature check, verdict rules, start flow with limits), `POST /v1/verification/selfie/start`, `POST /v1/hooks/didit`, `verification` flag in `/v1/config`, config for `DIDIT_*`, `VERIFY_*`. Store methods in Pg and Memory stores.
- Database: `0017_auto_selfie.sql` (provider columns on `photo_verifications`; human-review queue ignores automatic attempts).
- App: Photo verification screen (`/safety/verify`), Safety hub row (only when the server has it), trust card and badge follow the server flag.
- Privacy page gains a photo-verification section only when switched on.
- Safety rules: consent required; 3 starts per day and 6 per week per person; monthly cap across everyone; approve only when liveness AND face match are approved and the score is at least `VERIFY_MIN_MATCH_SCORE`; "in review" becomes "try again" (no human fallback); provider asked to delete each session; webhook signed with HMAC and a 5 minute window.
- Not done: Play listing text and Data safety answers (guide part C6), rebrand, the 55 fixed purple accents, photo-rejection reasons screen.
- Known limit: the selfie opens in the phone's browser (no new native packages, so no lockfile change); returning to the app is by link or by hand.
