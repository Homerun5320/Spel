// Bundle-diet-2: the page loads one language table at a time (src/ui/i18n.ts), but tests want both up front. Importing this module registers them
// statically; `tests/i18n.setup.ts` does it for every vitest project, so a test that imports `t` or `TABLES` works unchanged.
import { en } from '../../src/ui/i18n.en';
import { sv } from '../../src/ui/i18n.sv';
import { registerTable } from '../../src/ui/i18n';

registerTable('sv', sv);
registerTable('en', en);
