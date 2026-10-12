import ts from "typescript";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
// Do not fix unrelated broken project references just to mask diagnostics.
const changed = execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" }).trim().split(/\r?\n/).filter((file) => /\.(ts|tsx)$/.test(file));
const newFiles = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).trim().split(/\r?\n/).filter((file) => /\.(ts|tsx)$/.test(file));
const oldSources = new Map(changed.map((file) => [path.resolve(file), execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" })]));
const entryPoints = [...new Set([...parsed.fileNames, ...changed.map((file) => path.resolve(file)), ...newFiles.map((file) => path.resolve(file))])];
function diagnostics(baseline) {
  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile.bind(host);
  host.readFile = (file) => baseline && oldSources.has(path.resolve(file)) ? oldSources.get(path.resolve(file)) : readFile(file);
  const roots = baseline ? entryPoints.filter((file) => !newFiles.some((item) => path.resolve(item) === file)) : entryPoints;
  const program = ts.createProgram(roots, parsed.options, host);
  return ts.getPreEmitDiagnostics(program).map((item) => ({ file: item.file ? path.relative(root, item.file.fileName).replaceAll("\\", "/") : "configuration", code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, " "), line: item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start).line + 1 : 0 }));
}
const baseline = diagnostics(true);
const current = diagnostics(false);
const key = (item) => `${item.file}:${item.code}:${item.message}`;
const remaining = new Map();
for (const item of baseline) remaining.set(key(item), (remaining.get(key(item)) || 0) + 1);
const introduced = current.filter((item) => { const count = remaining.get(key(item)) || 0; if (!count) return true; remaining.set(key(item), count - 1); return false; });
console.log(JSON.stringify({ baselineErrors: baseline.length, currentErrors: current.length, introducedErrors: introduced }, null, 2));
if (introduced.length) process.exitCode = 1;
