/**
 * Test-only module hooks so `node --test` can server-render `.tsx` components: TypeScript (already a dev
 * dependency) transpiles JSX, extensionless relative imports resolve to `.tsx`/`.ts`, and stylesheets load empty.
 * Register it from a test with `register("./support/tsxLoader.mjs", import.meta.url)` before importing a component.
 */
import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") || error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    for (const extension of [".tsx", ".ts"]) {
      try {
        return await nextResolve(specifier + extension, context);
      } catch {
        // try the next extension
      }
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
  if (url.endsWith(".tsx")) {
    const source = await readFile(new URL(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: url,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: true,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
