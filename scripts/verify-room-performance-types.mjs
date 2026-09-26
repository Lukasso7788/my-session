import { execFileSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";

// Compare against HEAD in memory, without checking out/restoring user files.
// This repository has existing app-wide TS errors; newly introduced errors
// still fail verification rather than being hidden by that baseline.
const root = process.cwd();
const config = ts.readConfigFile("tsconfig.app.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const changed = execFileSync("git", ["diff", "--name-only", "--", "src"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const original = new Map(changed.map((file) => [path.resolve(file).toLowerCase(), execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" })]));
const untracked = new Set(execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "src"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean).map((file) => path.resolve(file).toLowerCase()));
function check(baseline) {
  const host = ts.createCompilerHost(parsed.options);
  const read = host.readFile;
  host.readFile = (file) => baseline && original.has(path.resolve(file).toLowerCase()) ? original.get(path.resolve(file).toLowerCase()) : read(file);
  host.getSourceFile = (file, languageVersion) => {
    const content = host.readFile(file);
    return content === undefined ? undefined : ts.createSourceFile(file, content, languageVersion, true);
  };
  const roots = baseline ? parsed.fileNames.filter((file) => !untracked.has(path.resolve(file).toLowerCase())) : parsed.fileNames;
  const program = ts.createProgram(roots, parsed.options, host);
  return ts.getPreEmitDiagnostics(program);
}
const fingerprint = (diagnostic) => `${diagnostic.file ? path.relative(root, diagnostic.file.fileName) : "config"}|${diagnostic.code}|${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
const baseline = check(true);
const counts = new Map();
for (const diagnostic of baseline) {
  const key = fingerprint(diagnostic);
  counts.set(key, (counts.get(key) || 0) + 1);
}
const current = check(false);
const added = current.filter((diagnostic) => {
  const key = fingerprint(diagnostic);
  const left = counts.get(key) || 0;
  if (!left) return true;
  counts.set(key, left - 1);
  return false;
});
console.log(`App TypeScript: HEAD=${baseline.length} diagnostics; working tree=${current.length}; new=${added.length}`);
if (added.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(added, {
    getCurrentDirectory: () => root, getCanonicalFileName: (file) => file, getNewLine: () => "\n",
  }));
  process.exitCode = 1;
}
