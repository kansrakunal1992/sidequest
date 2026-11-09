-- Waypoint part 16: friendlier names for two vibes, so nothing in the store listing or the app trips Google Play's review.
--   hookups         "Hookups"    / "No strings"      ->  "Casual"  / "Easygoing, low pressure"
--   experimentation "Experiment" / "Explore freely"  ->  "Explore" / "Try something new"
-- Only the display text changes. The internal ids ('hookups', 'experimentation') stay, so no data, rule, feature or policy changes.
-- Safe to run twice. STATUS: written and checked by scripts/check-sql.mjs; not run on a hosted Supabase project.
update public.intent_modes set label = 'Casual',  tagline = 'Easygoing, low pressure' where id = 'hookups';
update public.intent_modes set label = 'Explore', tagline = 'Try something new'        where id = 'experimentation';
