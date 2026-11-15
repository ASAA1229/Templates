import { loadTools, readAndVerify, buildArchive } from "./modules/tools/tools.ts";
const t0 = Date.now();
const { tools } = await loadTools("C:/Users/chinn/OneDrive/Desktop/projects/Templates/tools");
const v = await readAndVerify(tools[0]!);
const t1 = Date.now();
const a = buildArchive(tools[0]!, v);
console.log("verify ms", t1 - t0, "zip ms", Date.now() - t1, a.archive.length);
