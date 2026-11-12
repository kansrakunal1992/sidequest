# Test profiles (seeding)

Creates realistic-looking **fake people** so you can test Discover, matching, filters and verification without waiting for real users:
**36 states and union territories x 50 profiles = 1,800 people** (adjustable), each with a first name that fits the region, an age, a bio, vibes, prompts, interests,
Date Ideas, a location inside the city, and photo slots. They are marked by the e-mail domain `@seed.waypoint.test` so they can be removed in one step.

## Read this first
- **Use a separate staging Supabase project, never your live one.** Fake profiles that real people can like and message are misleading to them, and they pollute your data.
  The apply script refuses to run on a database that already has more than 20 real accounts.
- Photos: **I could not generate photorealistic faces**. Two options: `--source placeholder` (plain generated avatars, to test the pipeline today), or your own AI-generated
  images in a folder (see "Real-looking photos"). If you later use AI-generated faces in the app, keep them out of any real or public release.
- These accounts cannot log in (no password). They are only there to be seen, liked and messaged by your test accounts.

## 1. Make the data
```
pnpm seed:generate                      # all 36 regions, 50 each, into scripts/seed/out
pnpm seed:generate -- --regions DL,MH,KA --per-region 80
pnpm seed:generate -- --balanced-vibes  # many more people in hookups / experimentation / post-marital, so every vibe is testable
```
Other options: `--seed 2` (a different set of people), `--verified-pct 15` (share with a photo-verified badge), `--max-photos 3`.
Region codes: `AP AR AS BR CG GA GJ HR HP JH KA KL MP MH MN ML MZ NL OD PB RJ SK TN TS TR UP UK WB AN CH DD DL JK LA LD PY`.

## 2. Put them in the database
```
DATABASE_URL="postgres://..." pnpm seed:apply            # asks you to type "seed" first
```
Use the **staging** project's connection string (Supabase: Project Settings, Database, Connection string). Each region is one transaction and takes about a tenth of a second.
You can also paste a single region file (for example `32_DL.sql`) into the Supabase SQL editor.

## 3. Photos
```
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... pnpm seed:images -- --source placeholder
```
The service-role key is a secret: use it only on your computer, never in the app or in git.

### Real-looking photos
`scripts/seed/out/image-prompts.csv` has one line per photo slot: the file name and a prompt written to look like an ordinary phone photo (natural light, slightly imperfect framing,
no studio polish). Generate the images with any tool you like (Stable Diffusion or Flux through ComfyUI or a hosted API, Leonardo, Ideogram, and so on), then put them in a folder:
```
my-images/women/*.jpg   my-images/men/*.jpg   my-images/non_binary/*.jpg   (or one flat folder)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm seed:images -- --source ./my-images
```
Pictures are matched by gender and reused when a folder runs out (the script tells you how many were reused). About 3,500 photo slots exist for 1,800 people. Because they are test photos, small files
(around 100 to 150 KB) keep you well within Supabase's free storage. Check your tool's terms for the images you generate.

## 4. Check it worked
```
psql "$DATABASE_URL" -f scripts/seed/verify.sql
```
Prints how many people a tester standing in each region sees in each vibe. Everything in it is rolled back. On the tested local run: all 36 regions had between 16 and 35 people visible in
Friendship from a 25 km radius; niche vibes are sparse unless you used `--balanced-vibes`.

## Seeing them in the app
Discover filters by distance (25 km by default) and by what each person is looking for, so:
- Your test account **in a region's city** sees that region's people. Update your location in the app, or leave location off (then you see people from everywhere).
- Seeded dating profiles mostly look for the opposite gender, so you will see most people if your test account is a different gender, and fewer otherwise. Friendship and adventures are open to everyone.
- About 8 in 100 seeded people are set to "taking a break" or "not available" and are hidden on purpose, as real users would be.

## 5. Remove them
```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm seed:images -- --purge     # photo files first
psql "$DATABASE_URL" -f scripts/seed/out/purge.sql                             # then the profiles
```
`purge.sql` deletes only accounts whose e-mail ends in `@seed.waypoint.test`. Their profiles, photos, likes, blocks, matches and messages go with them. Real accounts are untouched (tested).

## What was tested
Generator checks (`pnpm seed:test`: 8 tests): counts, uniqueness, ages, text limits, locations near the city, repeatability, SQL quoting. All 1,800 profiles were applied to a local Postgres 16
with PostGIS built from every migration; they passed every trigger, appeared in Discover as described, and the purge removed everything it should. **Not tested:** the upload to real Supabase
Storage, and inserting into the real `auth.users` of a hosted Supabase project (the statement uses the standard columns, but run one small region first: `--regions DL --per-region 5`).
