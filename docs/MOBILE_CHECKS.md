# Checking the mobile app without a phone

Three layers, from cheapest to most real. None replaces running the app on a phone (docs/ANDROID_RUN.md).

1. **Logic tests** (always available): `cd apps/mobile && node --test test/*.test.ts` runs the pure logic in `src/core`, the database contract test, and (if the packages below are installed) the screen renders.
2. **Real type-checking**: install the real packages and run the compiler.
   ```
   cd apps/mobile && npm install --legacy-peer-deps --ignore-scripts   # or pnpm install at the repo root
   npx tsc -p tsconfig.json
   ```
   In the authoring sandbox this was done by installing `expo@~54`, then every package at the version in `node_modules/expo/bundledNativeModules.json`, into a scratch folder and symlinking it into `apps/mobile/node_modules`. Result: zero errors, against the real Expo SDK 54 / React Native 0.81 types.
3. **Screen renders** (`test/render.test.ts`, harness in `test/render/`): esbuild bundles the real screens with `react-native-web` and mounts them in jsdom. Fakes (in `test/render/mocks/`): Supabase (answers from the test and records every call), expo-router (records navigation), session and modes, icons, the gradient, safe-area. Needs devDependencies `react-native-web`, `react-dom`, `esbuild`, `jsdom`.
   What it proves: a screen renders, loads its data, shows errors and empty states, validates input, calls the right database function with the right arguments, and navigates where it should.
   What it cannot prove: native layout and styling, gestures, keyboard behaviour, fonts, permissions, push, or how Expo and Supabase behave on a device. Treat a first device run as still necessary.

The contract test (`test/db-contract.test.ts`) needs nothing installed: it reads `src/lib/db.ts` and the SQL migrations as text and checks every call's function name and argument names.
