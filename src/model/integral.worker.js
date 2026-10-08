// integral.worker.js -- Neutrino's thread (integral-bridge.js). Vite inlines it (?worker&inline).
import createIntegral from './integral/integral.js';
import { hostIntegral } from './integral-bridge.js';

hostIntegral(self, createIntegral);
