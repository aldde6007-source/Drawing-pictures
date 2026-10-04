// js/manga-worker.js のフィルターを Node で うごかす(tools/try_manga.py から よばれる)
// node tools/run_manga.mjs <in.raw> <width> <height> <outprefix>
import fs from 'node:fs';

const [inPath, width, height, outPrefix] = process.argv.slice(2);
const code = fs.readFileSync(new URL('../js/manga-worker.js', import.meta.url), 'utf8');
const self = { postMessage: (m) => { self.out = m; } };
new Function('self', code)(self);

const buf = fs.readFileSync(inPath);
for (const level of [1, 2, 3]) {
  const t = Date.now();
  self.onmessage({ data: { id: 1, width: Number(width), height: Number(height), buffer: new Uint8Array(buf).buffer, level } });
  if (self.out.error) throw new Error(self.out.error);
  console.log(`level ${level}: ${Date.now() - t} ms`);
  fs.writeFileSync(`${outPrefix}${level}.raw`, Buffer.from(self.out.buffer));
}
