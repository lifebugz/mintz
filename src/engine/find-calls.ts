import {
  type CallExpression,
  type SourceFile,
  type Symbol as TsSymbol,
  SyntaxKind,
} from "ts-morph";

/**
 * Find every CallExpression in `sourceFile` whose callee resolves to mintz's
 * default export (or its named alias). Resolution is done via TypeScript's
 * symbol table, so renamed imports, re-exports, and shadowing are all handled
 * correctly.
 */
export function findMintCalls(
  sourceFile: SourceFile,
  mintzModulePath: string,
): readonly CallExpression[] {
  const mintSymbols = collectMintSymbols(sourceFile, mintzModulePath);
  if (mintSymbols.size === 0) return [];

  const result: CallExpression[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const sym = callee.getSymbol();
    if (!sym) continue;
    const aliased = unalias(sym);
    if (mintSymbols.has(aliased)) {
      result.push(call);
    }
  }
  return result;
}

function collectMintSymbols(sourceFile: SourceFile, mintzModulePath: string): Set<TsSymbol> {
  const symbols = new Set<TsSymbol>();
  for (const decl of sourceFile.getImportDeclarations()) {
    const moduleSpec = decl.getModuleSpecifierValue();
    if (!matchesMintzModule(moduleSpec, mintzModulePath)) continue;

    const def = decl.getDefaultImport();
    if (def) {
      const sym = def.getSymbol();
      if (sym) symbols.add(unalias(sym));
    }
    for (const named of decl.getNamedImports()) {
      const propertyName = named.getNameNode().getText();
      const aliasNode = named.getAliasNode();
      const localSym = (aliasNode ?? named.getNameNode()).getSymbol();
      if (localSym && (propertyName === "mint" || propertyName === "default")) {
        symbols.add(unalias(localSym));
      }
    }
  }
  return symbols;
}

function matchesMintzModule(spec: string, mintzPath: string): boolean {
  return spec === "mintz" || spec === mintzPath;
}

function unalias(sym: TsSymbol): TsSymbol {
  let cur = sym;
  // Walk through aliases (e.g. import-renames) to the originating symbol.
  for (let i = 0; i < 16; i++) {
    const aliased = cur.getAliasedSymbol?.();
    if (!aliased || aliased === cur) break;
    cur = aliased;
  }
  return cur;
}
