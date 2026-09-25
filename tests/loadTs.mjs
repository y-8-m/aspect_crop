import { readFile } from "node:fs/promises";
import ts from "typescript";

export const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

// Compile source modules using the existing TypeScript dependency, with optional API mocks.
export async function compile(name, overrides = {}) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  const imports = new Set([...js.matchAll(/(?:from\s+|import\()"([^"]+)"/g)].map((match) => match[1]));
  for (const specifier of imports) {
    const replacement = overrides[specifier] ?? (specifier.startsWith("./") ? await compile(specifier.slice(2), overrides) : null);
    if (replacement) js = js.replaceAll(`"${specifier}"`, JSON.stringify(replacement));
  }
  return dataUrl(js);
}
