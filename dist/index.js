import typescript from "typescript";
import { Project } from "ts-morph";
import { ts } from "ts-morph";
function handleProperty(prop, s, nestingLevel) {
  const unresolvedType = prop.getType().getText(prop, typescript.TypeFormatFlags.None);
  const typeHint = /^[\w\d]+$/g.test(unresolvedType) ? ` /*${unresolvedType}*/ ` : " ";
  const lineWhitespaces = " ".repeat(nestingLevel * 4);
  if (!prop.getType().isObject()) {
    s += `${lineWhitespaces}${prop.getName()}: ${prop.getType().getText()}
`;
    return s;
  }
  s += `${lineWhitespaces}${prop.getName()}:${typeHint}{
`;
  const typeSymbol = prop.getType().getSymbol();
  const clsDeclaration = typeSymbol?.getDeclarations()[0];
  const members = clsDeclaration.getProperties();
  members.forEach((m) => {
    s = handleProperty(m, s, nestingLevel + 1);
  });
  const isOptional = prop.getNodeProperty("questionToken")?.getText() === "?" || prop.getNodeProperty("type")?.getText().endsWith("| undefined");
  s += `${lineWhitespaces}}${isOptional ? " | undefined" : ""}
`;
  return s;
}
function resolveType(prop) {
  const isOptional = prop.getNodeProperty("questionToken")?.getText() === "?" || prop.getNodeProperty("type")?.getText().endsWith("| undefined");
  if (prop.getName() === "data6")
    console.log(
      "gotten type",
      prop.getNodeProperty("type")?.getText(),
      prop.getNodeProperty("type")?.getParent()?.getType().getText()
      // TODO: fd continue: find out how to get data6 -> IProfileIcon['data6] -> Data6 -> string | undefined
    );
  if (!prop.getType().isObject()) {
    return prop.getType().getText().replaceAll('"', "'") + (isOptional ? " | undefined" : "");
  }
  let s = `{
`;
  const typeSymbol = prop.getType().getSymbol();
  const clsDeclaration = typeSymbol?.getDeclarations()[0];
  const members = clsDeclaration.getProperties();
  members.forEach((p) => {
    s = handleProperty(p, s, 1);
  });
  s += `}`;
  return s.replaceAll('"', "'") + (isOptional ? " | undefined" : "");
}
function assertAsClassDeclaration(node) {
  if (!node || Number(node.kind) !== Number(ts.SyntaxKind.ClassDeclaration)) {
    throw new Error("Node is not a ClassDeclaration");
  }
}
function assertAsCustomElement(classDoc) {
  if (!classDoc) {
    throw new Error("Node is not a CustomElement");
  }
}
export default function cemPluginComplexTypes(tsSourceFilesGlobs = ["./**/*.ts"]) {
  function setup({
    ts: ts2,
    context
  }) {
    if (context.isSetUp) return;
    context.tsCompilerHost = ts2.createCompilerHost(
      typescript.getDefaultCompilerOptions()
    );
    context.tsProgram = ts2.createProgram(
      tsSourceFilesGlobs,
      typescript.getDefaultCompilerOptions(),
      context.tsCompilerHost
    );
    context.project = new Project({});
    context.project.addSourceFilesAtPaths(tsSourceFilesGlobs);
    context.allSourceFiles = context.project.getSourceFiles();
    context.foundClasses = [];
    context.classDeclarations = [];
    context.interfaceDeclarations = [];
    context.typeDeclarations = [];
    context.allSourceFiles.forEach((sourceFile) => {
      context.classDeclarations = sourceFile.getClasses();
      context.interfaceDeclarations.push(...sourceFile.getInterfaces());
      context.typeDeclarations.push(...sourceFile.getTypeAliases());
      context.classDeclarations.forEach(async (cls) => {
        const resolvedProperties = {};
        const properties = cls.getProperties();
        properties.forEach((prop) => {
          resolvedProperties[prop.getName()] = resolveType(prop);
          if (prop.getName() === "data6")
            console.log(
              "resolved property",
              prop.getName(),
              resolvedProperties[prop.getName()]
            );
        });
        context.foundClasses.push({
          sourceFile: sourceFile.getFilePath(),
          className: cls.getName(),
          resolvedProperties
        });
      });
    });
    context.dev && console.debug("setup end", context.foundClasses);
    context.isSetUp = true;
  }
  return {
    name: "cem-plugin-complex-types",
    initialize({ customElementsManifest, context }) {
      context.dev && console.debug("initialize", { customElementsManifest, context });
      context.isSetUp = false;
    },
    collectPhase({ ts: ts2, node, context }) {
      context.dev && console.debug("collectPhase", { node, context });
      setup({ ts: ts2, context });
    },
    analyzePhase({ ts: ts2, node, moduleDoc, context }) {
      context.dev && console.debug("analyzePhase", { node, moduleDoc, context });
      switch (node.kind) {
        case ts2.SyntaxKind.ClassDeclaration: {
          try {
            assertAsClassDeclaration(node);
          } catch {
            return;
          }
          const className = node.name?.getText();
          const classDoc = moduleDoc.declarations?.find(
            (declaration) => declaration?.name === className
          );
          const classDeclarationObject = context.foundClasses?.find(
            (classDeclaration) => classDeclaration?.className === className
          )?.resolvedProperties || {};
          try {
            assertAsCustomElement(classDoc);
          } catch {
            return;
          }
          if (classDoc.attributes) {
            classDoc.attributes?.forEach(async (member) => {
              const fullyResolvedType = classDeclarationObject[member.name];
              if (fullyResolvedType) {
                let optionalTypeName = member.type?.text?.match(/^[A-Z]/g)?.length ? member.type?.text : "";
                optionalTypeName = optionalTypeName?.replace(" | undefined", "");
                optionalTypeName = optionalTypeName ? `/* ${optionalTypeName} */ ` : "";
                member.type = {
                  ...member.type,
                  text: `${optionalTypeName}${fullyResolvedType}`
                };
              }
            });
          }
          break;
        }
        default:
          break;
      }
    },
    moduleLinkPhase({ moduleDoc, context }) {
      console.log("moduleLinkPhase", {
        moduleDoc,
        foundClasses: context.foundClasses,
        classDeclarations: context.classDeclarations.map(
          (item) => item.getName()
        ),
        interfaceDeclarations: context.interfaceDeclarations.map(
          (item) => item.getName()
        ),
        typeDeclarations: context.typeDeclarations.map(
          (item) => item.getName()
        )
      });
    },
    packageLinkPhase({ customElementsManifest, context }) {
      context.dev && console.debug("packageLinkPhase");
    }
  };
}
