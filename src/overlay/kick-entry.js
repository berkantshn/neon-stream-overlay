// Made By FALCREB
// overlay-kick.html girişi. Sıra önemlidir: önce CSP kilitlenir, overlay kodu sonra yüklenir.
// Dinamik import bu sırayı paketleyiciye bırakmadan garanti eder.

import { lockConnectSrc } from './csp-lock.js';

lockConnectSrc();
import('./main.js');
