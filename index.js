import typescript from "typescript"
import { Project } from "ts-morph"

/**
 * @param {PropertySignature} prop
 * @param {string} s
 */
function handleProperty(prop, s, nestingLevel) {
  const unresolvedType = prop
    .getType()
    .getText(prop, typescript.TypeFormatFlags.None)
  // Type hint can be an interface name as a comment before the resolved type
  const typeHint = /^[\w\d]+$/g.test(unresolvedType)
    ? ` /*${unresolvedType}*/ `
    : " "
  const lineWhitespaces = " ".repeat(nestingLevel * 4)

  // If the type is a primitive type, add it directly to the class declaration
  if (!prop.getType().isObject()) {
    // console.log('! is optional', prop.getType().getText())
    s += `${lineWhitespaces}${prop.getName()}: ${prop.getType().getText()}\n`
    return s
  }

  s += `${lineWhitespaces}${prop.getName()}:${typeHint}{\n`

  /** @type {typescript.Symbol} */
  const typeSymbol = prop.getType().getSymbol()
  /** @type {ClassDeclaration} */
  const clsDeclaration = typeSymbol?.getDeclarations()[0]
  const members = clsDeclaration.getProperties()

  members.forEach((m) => {
    s = handleProperty(m, s, nestingLevel + 1)
  })

  const isOptional =
    prop.getNodeProperty("questionToken")?.getText() === "?" ||
    prop.getNodeProperty("type").getText().endsWith("| undefined")

  s += `${lineWhitespaces}}${isOptional ? " | undefined" : ""}\n`

  return s
}

/**
 * @param {PropertyDeclaration} prop
 */
function resolveType(prop) {
  const isOptional =
    prop.getNodeProperty("questionToken")?.getText() === "?" ||
    prop.getNodeProperty("type").getText().endsWith("| undefined")

  // If the type is a primitive type, return it directly
  if (!prop.getType().isObject()) {
    return (
      prop.getType().getText().replaceAll('"', "'") +
      (isOptional ? " | undefined" : "")
    )
  }

  // If the type is an object, resolve its properties recursively

  let s = `{\n`
  /** @type {typescript.Symbol} */
  const typeSymbol = prop.getType().getSymbol()
  /** @type {ClassDeclaration} */
  const clsDeclaration = typeSymbol?.getDeclarations()[0]
  const members = clsDeclaration.getProperties()

  members.forEach((p) => {
    s = handleProperty(p, s, 1)
  })
  s += `}`
  return s.replaceAll('"', "'") + (isOptional ? " | undefined" : "")
}

export default function cemPluginComplexTypes(
  tsSourceFilesGlobs = ["./**/*.ts"],
) {
  let isSetUp = false

  /**
   * @argument {import('@custom-elements-manifest/analyzer').CollectPhaseParams}
   */
  function setup({ ts, context }) {
    if (isSetUp) return

    context.tsCompilerHost = ts.createCompilerHost(
      typescript.getDefaultCompilerOptions(),
    )
    context.tsProgram = ts.createProgram(
      tsSourceFilesGlobs,
      typescript.getDefaultCompilerOptions(),
      context.tsCompilerHost,
    )
    context.project = new Project({})
    context.project.addSourceFilesAtPaths(tsSourceFilesGlobs)
    context.allSourceFiles = context.project.getSourceFiles()
    context.classDeclarations = []

    context.allSourceFiles.forEach((sourceFile) => {
      console.log("file", sourceFile.getFilePath())
      const classes = sourceFile.getClasses()
      // Iterate over all classes in the source file
      classes.forEach(async (cls) => {
        // Write first line of class declaration
        const resolvedProperties = {}
        // Iterate over all properties in the class and update the string with the subpart of the class declaration
        const properties = cls.getProperties()
        properties.forEach((prop) => {
          resolvedProperties[prop.getName()] = resolveType(prop)
        })

        context.classDeclarations.push({
          sourceFile: sourceFile.getFilePath(),
          className: cls.getName(),
          resolvedProperties,
        })
      })
    })

    // console.log('setup end', context.classDeclarations)

    isSetUp = true
  }

  return {
    name: "cem-plugin-complex-types",
    /** @argument {import('@custom-elements-manifest/analyzer').CollectPhaseParams} */
    collectPhase({ ts, node, context }) {
      // console.log('collectPhase', context)
      setup({ ts, node, context })
    },

    /** @argument {import('@custom-elements-manifest/analyzer').AnalyzePhaseParams} */
    analyzePhase({ ts, node, moduleDoc, context }) {
      switch (node.kind) {
        case ts.SyntaxKind.ClassDeclaration: {
          const className = node.name.getText()
          const classDoc = moduleDoc?.declarations?.find(
            (declaration) => declaration.name === className,
          )

          const classDeclarationObject =
            context.classDeclarations?.find(
              (classDeclaration) => classDeclaration.className === className,
            )?.resolvedProperties || {}

          if (classDoc?.attributes) {
            classDoc.attributes.forEach(async (member) => {
              // const isOptional = member.type?.text.includes('| undefined')
              // console.log('member', member.name)

              const fullyResolvedType = classDeclarationObject[member.name]

              if (fullyResolvedType) {
                // Check if the type is not a primitive type or literal
                let optionalTypeName = member.type?.text?.match(/^[A-Z]/g)
                  ?.length
                  ? member.type?.text
                  : ""
                // Remove | undefined from the type name, because it will be added at the end
                optionalTypeName = optionalTypeName.replace(" | undefined", "")
                // Wrap it in a comment for better readability in type hint
                optionalTypeName = optionalTypeName
                  ? `/* ${optionalTypeName} */ `
                  : ""
                // Set the type of the member to the fully resolved type
                member.type = `${optionalTypeName}${fullyResolvedType}`
              }
            })
          }
          break
        }
        default:
          break
      }
    },

    /** @argument {import('@custom-elements-manifest/analyzer').ModuleLinkPhaseParams} */
    // moduleLinkPhase({ moduleDoc, context }) {},

    /** @argument {import('@custom-elements-manifest/analyzer').PackageLinkPhaseParams} */
    // packageLinkPhase({ customElementsManifest, context }) {},
  }
}
