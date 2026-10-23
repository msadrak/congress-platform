// Node module hooks for the ui component tests: resolve extensionless relative imports the way Vite does and
// compile .tsx with the TypeScript compiler (already a dev dependency). .ts files use Node's own type stripping.
import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw error;
    for (const extension of [".tsx", ".ts"]) {
      try {
        return await next(specifier + extension, context);
      } catch {
        // try the next extension
      }
    }
    throw error;
  }
}

export async function load(url, context, next) {
  if (!url.endsWith(".tsx")) return next(url, context);
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
