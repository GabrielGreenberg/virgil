import baseConfig from "./vitest.config";
import { guardFamily } from "./src/lib/__tests__/_guard-family";

/**
 * `npm run test:guards` — the whole-tree guard family, run on EVERY worker
 * task (task 988). Same config as `vitest.config.ts`; only `include` is
 * replaced (not merged — `mergeConfig` would concatenate it back to the full
 * suite) by the DERIVED membership in `src/lib/__tests__/_guard-family.ts`.
 */
const include = baseConfig.test?.include ?? [];

const guardsConfig = {
  ...baseConfig,
  test: { ...baseConfig.test, include: guardFamily(include) },
};

export default guardsConfig;
