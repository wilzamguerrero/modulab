import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco');
const target = path.join(root, 'public', 'draco');

if (!fs.existsSync(source)) {
  console.warn('[modulab] No se encontró el decodificador Draco de three; se omite la copia.');
  process.exit(0);
}

fs.mkdirSync(target, { recursive: true });
for (const entry of fs.readdirSync(source)) {
  if (entry.endsWith('.js') || entry.endsWith('.wasm')) {
    fs.copyFileSync(path.join(source, entry), path.join(target, entry));
  }
}
console.log('[modulab] Decodificadores Draco copiados a public/draco.');
