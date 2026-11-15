import fs from 'node:fs';
const F = process.env.DATA_FILE || './data.json';
const base = { products: [], items: [], spent: {} };
export const load = () => {
  try { return { ...base, ...JSON.parse(fs.readFileSync(F, 'utf8')) }; }
  catch { return structuredClone(base); }
};
export const save = d => {
  fs.writeFileSync(F + '.tmp', JSON.stringify(d, null, 2));
  fs.renameSync(F + '.tmp', F);
};
