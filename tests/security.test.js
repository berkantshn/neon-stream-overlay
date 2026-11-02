// Made By FALCREB
// Kaynak kodda HTML üreten ve kod çalıştıran çağrıların bulunmadığını doğrular.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|srcdoc/;

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

test('src içinde tehlikeli DOM veya eval çağrısı yoktur', () => {
  const files = jsFiles('src');
  assert.ok(files.length >= 8);
  for (const file of files) {
    assert.equal(FORBIDDEN.test(readFileSync(file, 'utf8')), false, file);
  }
});
