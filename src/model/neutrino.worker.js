// neutrino.worker.js -- Neutrino's thread (neutrino-bridge.js). Vite inlines it (?worker&inline).
import createNeutrino from './neutrino/neutrino.js';
import { hostNeutrino } from './neutrino-bridge.js';

hostNeutrino(self, createNeutrino);
