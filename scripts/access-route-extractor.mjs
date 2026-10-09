import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

const STATIC_ROUTE_KEYS = new Set(["public", "methods", "request", "cacheControl", "handler", "permission"]);

function parse(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) {
    throw new Error(`${file}: unsupported malformed TypeScript: ${ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, " ")}`);
  }
  return source;
}

function diagnostic(file, node, message) {
  const { line } = parse(file).getLineAndCharacterOfPosition(node.getStart());
  return `${file}:${line + 1}: ${message}`;
}

function resolveModule(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier.replace(/\.js$/u, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

function moduleSpecifier(declaration) {
  return declaration.moduleSpecifier && ts.isStringLiteral(declaration.moduleSpecifier)
    ? declaration.moduleSpecifier.text
    : null;
}

function exportName(element) {
  return element.propertyName?.text ?? element.name?.text;
}

function resolveExport(file, name, seen = new Set()) {
  const key = `${file}:${name}`;
  if (seen.has(key)) return { value: null, diagnostic: `ambiguous export cycle for ${name}` };
  seen.add(key);
  const source = parse(file);
  let found = null;
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement) && statement.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
          if (!(statement.declarationList.flags & ts.NodeFlags.Const) || !declaration.initializer || !ts.isStringLiteral(declaration.initializer)) {
            return { value: null, diagnostic: diagnostic(file, declaration, `export ${name} is not a string literal`) };
          }
          if (found !== null) return { value: null, diagnostic: `ambiguous export ${name}` };
          found = declaration.initializer.text;
        }
      }
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const target = moduleSpecifier(statement);
    if (!target) continue;
    const specifiers = statement.exportClause && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements
      : [];
    for (const element of specifiers) {
      if (element.name.text !== name) continue;
      const targetFile = resolveModule(file, target);
      if (!targetFile) return { value: null, diagnostic: diagnostic(file, statement, `cannot resolve re-export ${target}`) };
      const result = resolveExport(targetFile, exportName(element), seen);
      if (found !== null) {
        return { value: null, diagnostic: diagnostic(file, statement, `ambiguous export ${name}`) };
      }
      if (result.value === null) return result;
      found = result.value;
    }
  }
  return found === null
    ? { value: null, diagnostic: `${file}: export ${name} is not a supported string constant` }
    : { value: found, diagnostic: null };
}

function importedBindings(file, source) {
  const bindings = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    const specifier = moduleSpecifier(statement);
    if (!specifier) continue;
    for (const element of statement.importClause.namedBindings.elements) {
      if (bindings.has(element.name.text) || statement.importClause.isTypeOnly || element.isTypeOnly) {
        bindings.set(element.name.text, null);
      } else {
        bindings.set(element.name.text, { specifier, file: resolveModule(file, specifier), imported: element.propertyName?.text ?? element.name.text });
      }
    }
  }
  for (const statement of source.statements) {
    const names = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.map((declaration) => declaration.name)
      : ts.isFunctionDeclaration(statement) ? [statement.name] : [];
    for (const name of names) {
      if (name && ts.isIdentifier(name) && bindings.has(name.text)) bindings.set(name.text, null);
    }
  }
  return bindings;
}

function staticRouteKey(file, node, bindings) {
  if (ts.isIdentifier(node)) return { name: node.text, diagnostic: null };
  if (ts.isStringLiteral(node)) return { name: node.text, diagnostic: null };
  if (ts.isComputedPropertyName(node)) {
    const expression = node.expression;
    if (!ts.isIdentifier(expression)) return { name: null, diagnostic: diagnostic(file, node, "computed route key is not a named imported string constant") };
    const binding = bindings.get(expression.text);
    if (!binding?.file) return { name: null, diagnostic: diagnostic(file, node, `route key ${expression.text} has no resolvable named import`) };
    const result = resolveExport(binding.file, binding.imported);
    return result.value === null
      ? { name: null, diagnostic: diagnostic(file, node, result.diagnostic) }
      : { name: result.value, diagnostic: null };
  }
  return { name: null, diagnostic: diagnostic(file, node, "route key is not an identifier, quoted string, or supported imported constant") };
}

function directProperties(file, object, allowedKeys) {
  const properties = new Map();
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      return { properties, diagnostic: diagnostic(file, property, "object spread is unsupported") };
    }
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      return { properties, diagnostic: diagnostic(file, property, "method or accessor declaration is unsupported") };
    }
    const key = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ? property.name.text
      : null;
    if (!key || !allowedKeys.has(key)) {
      return { properties, diagnostic: diagnostic(file, property, "unknown or dynamic object key is unsupported") };
    }
    if (properties.has(key)) return { properties, diagnostic: diagnostic(file, property, `duplicate object key ${key} is unsupported`) };
    properties.set(key, ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer);
  }
  return { properties, diagnostic: null };
}

function literalBoolean(file, node, key) {
  if (node?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return false;
  return { diagnostic: diagnostic(file, node ?? { getStart: () => 0 }, `${key} must be a literal boolean`) };
}

function literalMethods(file, node) {
  if (!node || !ts.isArrayLiteralExpression(node) || node.elements.some((element) => !ts.isStringLiteral(element))) {
    return { methods: [], diagnostic: diagnostic(file, node ?? { getStart: () => 0 }, "methods must be an array of string literals") };
  }
  return { methods: node.elements.map((element) => element.text), diagnostic: null };
}

function validateMetadata(file, initializer, kind) {
  if (!ts.isObjectLiteralExpression(initializer)) {
    return { public: null, methods: [], diagnostic: diagnostic(file, initializer, `${kind} metadata must be a static object literal`) };
  }
  const { properties, diagnostic: propertiesDiagnostic } = directProperties(file, initializer, STATIC_ROUTE_KEYS);
  if (propertiesDiagnostic) return { public: null, methods: [], diagnostic: propertiesDiagnostic };
  const publicValue = properties.has("public") ? literalBoolean(file, properties.get("public"), "public") : null;
  if (publicValue && typeof publicValue === "object") return { public: null, methods: [], diagnostic: publicValue.diagnostic };
  const methods = literalMethods(file, properties.get("methods"));
  if (methods.diagnostic) return { public: publicValue, methods: [], diagnostic: methods.diagnostic };
  return { public: publicValue ?? null, methods: methods.methods, diagnostic: null };
}

function findFunction(source, name) {
  return source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name) ?? null;
}

function validateGuestRoute(file, source) {
  const functionDeclaration = findFunction(source, "guestRoute");
  if (!functionDeclaration) return null;
  if (functionDeclaration.parameters.length !== 1 || !ts.isIdentifier(functionDeclaration.parameters[0].name)) {
    return { diagnostic: diagnostic(file, functionDeclaration, "guestRoute must have one handler parameter") };
  }
  const handlerName = functionDeclaration.parameters[0].name.text;
  const statements = functionDeclaration.body?.statements ?? [];
  if (statements.length !== 1 || !ts.isReturnStatement(statements[0]) || !statements[0].expression ||
      !ts.isCallExpression(statements[0].expression) || !ts.isIdentifier(statements[0].expression.expression) ||
      statements[0].expression.expression.text !== "pluginRoute" || statements[0].expression.arguments.length !== 1) {
    return { diagnostic: diagnostic(file, functionDeclaration, "guestRoute must directly return pluginRoute(static metadata)") };
  }
  const object = statements[0].expression.arguments[0];
  const { properties, diagnostic: propertiesDiagnostic } = ts.isObjectLiteralExpression(object)
    ? directProperties(file, object, new Set(["public", "methods", "request", "handler"]))
    : { properties: new Map(), diagnostic: diagnostic(file, object, "guestRoute metadata must be a static object literal") };
  if (propertiesDiagnostic) return { diagnostic: propertiesDiagnostic };
  if (properties.size !== 4 || !properties.has("public") || !properties.has("methods") ||
      !properties.has("request") || !properties.has("handler")) {
    return { diagnostic: diagnostic(file, object, "guestRoute must provide exactly public, methods, request, and handler") };
  }
  if (!ts.isIdentifier(properties.get("request")) || properties.get("request").text !== "guestRequest") {
    return { diagnostic: diagnostic(file, properties.get("request"), "guestRoute request must be the guestRequest binding") };
  }
  if (!ts.isIdentifier(properties.get("handler")) || properties.get("handler").text !== handlerName) {
    return { diagnostic: diagnostic(file, properties.get("handler"), "guestRoute handler must be its parameter") };
  }
  const metadata = validateMetadata(file, object, "guestRoute");
  return metadata;
}

export function extractCommerceRoutes(commercePlugin) {
  const source = parse(commercePlugin);
  const bindings = importedBindings(commercePlugin, source);
  const routeBinding = bindings.get("pluginRoute");
  const knownPluginRoute = routeBinding?.specifier === "emdash/plugin" && routeBinding.imported === "pluginRoute";
  if (source.statements.some((statement) => ts.isExpressionStatement(statement))) {
    throw new Error("unsupported top-level executable statement in static Commerce plugin");
  }
  const pluginDeclarations = source.statements.filter((statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some((declaration) =>
      ts.isIdentifier(declaration.name) && declaration.name.text === "plugin"));
  const pluginDeclaration = pluginDeclarations[0];
  const plugin = pluginDeclaration?.declarationList.declarations.find((declaration) =>
    ts.isIdentifier(declaration.name) && declaration.name.text === "plugin");
  const exports = source.statements.filter(ts.isExportAssignment);
  const defaultExport = exports.length === 1 && !exports[0].isExportEquals &&
    ts.isIdentifier(exports[0].expression) && exports[0].expression.text === "plugin";
  const unsupported = [];
  const unresolved = [];
  if (pluginDeclarations.length !== 1 || !(pluginDeclaration.declarationList.flags & ts.NodeFlags.Const) ||
      !plugin || !defaultExport || !ts.isObjectLiteralExpression(plugin.initializer)) {
    throw new Error("Commerce plugin must default-export a top-level static plugin object");
  }
  const pluginProperties = directProperties(commercePlugin, plugin.initializer, new Set(["hooks", "routes"]));
  if (pluginProperties.diagnostic) throw new Error(pluginProperties.diagnostic);
  const routes = pluginProperties.properties.get("routes");
  if (!routes || !ts.isObjectLiteralExpression(routes)) throw new Error("Commerce plugin routes must be a top-level static object");
  const guestMetadata = validateGuestRoute(commercePlugin, source);
  const guestDiagnostic = guestMetadata?.diagnostic;
  if (guestDiagnostic) unsupported.push({ name: "guestRoute", path: null, diagnostic: guestDiagnostic });
  const result = [];
  const seenRoutes = new Set();
  for (const property of routes.properties) {
    if (ts.isSpreadAssignment(property)) {
      unsupported.push({ name: null, path: null, diagnostic: diagnostic(commercePlugin, property, "top-level route spread is unsupported") });
      continue;
    }
    if (!ts.isPropertyAssignment(property)) {
      unsupported.push({ name: null, path: null, diagnostic: diagnostic(commercePlugin, property, "top-level route method/accessor is unsupported") });
      continue;
    }
    const key = staticRouteKey(commercePlugin, property.name, bindings);
    if (key.diagnostic) {
      if (ts.isComputedPropertyName(property.name) && ts.isIdentifier(property.name.expression)) {
        unresolved.push(property.name.expression.text);
      }
      unsupported.push({ name: null, path: null, diagnostic: key.diagnostic });
      continue;
    }
    const path = `/_emdash/api/plugins/dinkus-commerce/${key.name}`;
    if (seenRoutes.has(key.name)) {
      unsupported.push({ name: key.name, path, diagnostic: diagnostic(commercePlugin, property, "duplicate route key is unsupported") });
      for (let index = result.length - 1; index >= 0; index -= 1) {
        if (result[index].name === key.name) result.splice(index, 1);
      }
      continue;
    }
    seenRoutes.add(key.name);
    let metadata;
    const initializer = property.initializer;
    if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === "pluginRoute") {
      if (!knownPluginRoute) {
        unsupported.push({ name: key.name, path, diagnostic: diagnostic(commercePlugin, initializer, "pluginRoute must be a named import from emdash/plugin") });
        continue;
      }
      if (initializer.arguments.length !== 1) {
        unsupported.push({ name: key.name, path, diagnostic: diagnostic(commercePlugin, initializer, "pluginRoute must receive one static metadata object") });
        continue;
      }
      metadata = validateMetadata(commercePlugin, initializer.arguments[0], "pluginRoute");
    } else if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === "guestRoute") {
      if (!knownPluginRoute || !guestMetadata || guestDiagnostic || initializer.arguments.length !== 1) {
        unsupported.push({ name: key.name, path, diagnostic: guestDiagnostic ?? diagnostic(commercePlugin, initializer, "guestRoute must receive one handler") });
        continue;
      }
      metadata = guestMetadata;
    } else {
      metadata = validateMetadata(commercePlugin, initializer, "route");
    }
    if (metadata.diagnostic) {
      unsupported.push({ name: key.name, path, diagnostic: metadata.diagnostic });
      continue;
    }
    result.push({ name: key.name, path, public: metadata.public, methods: metadata.methods });
  }
  return { routes: result, unsupported, unresolved };
}
