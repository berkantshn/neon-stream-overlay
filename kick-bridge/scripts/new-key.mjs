// Made By FALCREB
// Overlay için rastgele, salt okunur bir anahtar üretir. Anahtar hiçbir dosyaya yazılmaz.
import { randomBytes } from 'node:crypto';

console.log(randomBytes(32).toString('base64url'));
