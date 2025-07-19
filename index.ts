import typescript from "typescript"
import { Project } from "ts-morph"
import type {
  ClassDeclaration,
  MemoryEmitResultFile,
  PropertyDeclaration,
  SourceFile,
} from "ts-morph"
import type { InterfaceDeclaration, TypeAliasDeclaration } from "ts-morph"
import type {
  AnalyzePhaseParams,
  CollectPhaseParams,
  ModuleLinkPhaseParams,
  PackageLinkPhaseParams,
  Plugin,
} from "@custom-elements-manifest/analyzer"
import * as schema from "custom-elements-manifest/schema"
import { ts } from "ts-morph"

type ExtendedContext = {
  dev: boolean
  thirdPartyCEMs: any[]
  isSetUp: boolean
  tsCompilerHost: typescript.CompilerHost
  tsProgram: typescript.Program
  project: Project
  allSourceFiles: SourceFile[]
  foundClasses: {
    sourceFile: MemoryEmitResultFile["filePath"]
    className: string
    resolvedProperties: { [key: string]: string }
  }[]
  classDeclarations: ClassDeclaration[]
  interfaceDeclarations: InterfaceDeclaration[]
  typeDeclarations: TypeAliasDeclaration[]
}

interface ExtendedPlugin extends Plugin {
  initialize(param: {
    ts: typeof typescript
    customElementsManifest: any
    context: ExtendedContext
  }): void

  collectPhase?(params: CollectPhaseParams & { context: ExtendedContext }): void

  analyzePhase?(
    params: AnalyzePhaseParams & {
      moduleDoc: schema.Module
      context: ExtendedContext
    },
  ): void

  moduleLinkPhase?(
    params: ModuleLinkPhaseParams & {
      moduleDoc: schema.Module
      context: ExtendedContext
    },
  ): void

  packageLinkPhase?(
    params: PackageLinkPhaseParams & {
      context: ExtendedContext
    },
  ): void
}

function handleProperty(
  prop: PropertyDeclaration,
  s: string,
  nestingLevel: number,
): string {
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

  const typeSymbol = prop.getType().getSymbol()
  const clsDeclaration = typeSymbol?.getDeclarations()[0] as ClassDeclaration
  const members = clsDeclaration.getProperties()

  members.forEach((m) => {
    s = handleProperty(m, s, nestingLevel + 1)
  })

  const isOptional =
    prop.getNodeProperty("questionToken")?.getText() === "?" ||
    prop.getNodeProperty("type")?.getText().endsWith("| undefined")

  s += `${lineWhitespaces}}${isOptional ? " | undefined" : ""}\n`

  return s
}

function resolveType(prop: PropertyDeclaration): string {
  const isOptional =
    prop.getNodeProperty("questionToken")?.getText() === "?" ||
    prop.getNodeProperty("type")?.getText().endsWith("| undefined")
  if (prop.getName() === "data6")
    console.log(
      "gotten type",
      prop.getNodeProperty("type")?.getText(),
      prop.getNodeProperty("type")?.getParent()?.getType().getText(),
      // TODO: fd continue: find out how to get data6 -> IProfileIcon['data6] -> Data6 -> string | undefined
    )

  // If the type is a primitive type, return it directly
  if (!prop.getType().isObject()) {
    return (
      prop.getType().getText().replaceAll('"', "'") +
      (isOptional ? " | undefined" : "")
    )
  }

  // If the type is an object, resolve its properties recursively

  let s = `{\n`
  const typeSymbol = prop.getType().getSymbol()
  const clsDeclaration = typeSymbol?.getDeclarations()[0] as ClassDeclaration
  const members = clsDeclaration.getProperties()

  members.forEach((p) => {
    s = handleProperty(p, s, 1)
  })
  s += `}`
  return s.replaceAll('"', "'") + (isOptional ? " | undefined" : "")
}

function assertAsClassDeclaration(
  node: any,
): asserts node is typescript.ClassDeclaration {
  if (!node || Number(node.kind) !== Number(ts.SyntaxKind.ClassDeclaration)) {
    throw new Error("Node is not a ClassDeclaration")
  }
}

function assertAsCustomElement(
  classDoc: any,
): asserts classDoc is schema.CustomElement {
  if (!classDoc) {
    throw new Error("Node is not a CustomElement")
  }
}

export default function cemPluginComplexTypes(
  tsSourceFilesGlobs = ["./**/*.ts"],
): ExtendedPlugin {
  function setup({
    ts,
    context,
  }: {
    ts: typeof typescript
    context: ExtendedContext
  }) {
    if (context.isSetUp) return

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
    context.allSourceFiles = (context.project as Project).getSourceFiles()
    context.foundClasses = []
    context.classDeclarations = []
    context.interfaceDeclarations = []
    context.typeDeclarations = []

    context.allSourceFiles.forEach((sourceFile: SourceFile) => {
      context.classDeclarations = sourceFile.getClasses()
      context.interfaceDeclarations.push(...sourceFile.getInterfaces())
      context.typeDeclarations.push(...sourceFile.getTypeAliases())

      // Iterate over all classes in the source file
      context.classDeclarations.forEach(async (cls) => {
        // Write first line of class declaration
        const resolvedProperties = {}
        // Iterate over all properties in the class and update the string with the subpart of the class declaration
        const properties = cls.getProperties()
        properties.forEach((prop) => {
          resolvedProperties[prop.getName()] = resolveType(prop)
          if (prop.getName() === "data6")
            console.log(
              "resolved property",
              prop.getName(),
              resolvedProperties[prop.getName()],
            )
        })

        context.foundClasses.push({
          sourceFile: sourceFile.getFilePath(),
          className: cls.getName() as string,
          resolvedProperties,
        })
      })
    })

    context.dev && console.debug("setup end", context.foundClasses)
    // console.log(
    //   "typeAliases",
    //   context.typeDeclarations.find((t) => t.getName() === "Data4")?.getText(),
    // )

    context.isSetUp = true
  }

  return {
    name: "cem-plugin-complex-types",

    initialize({ customElementsManifest, context }) {
      context.dev &&
        console.debug("initialize", { customElementsManifest, context })
      context.isSetUp = false
    },

    collectPhase({ ts, node, context }) {
      context.dev && console.debug("collectPhase", { node, context })
      setup({ ts, context })
    },

    analyzePhase({ ts, node, moduleDoc, context }) {
      context.dev && console.debug("analyzePhase", { node, moduleDoc, context })

      switch (node.kind) {
        case ts.SyntaxKind.ClassDeclaration: {
          try {
            assertAsClassDeclaration(node)
          } catch {
            return
          }

          const className = node.name?.getText() as string | undefined
          const classDoc = moduleDoc.declarations?.find(
            (declaration) => declaration?.name === className,
          )
          const classDeclarationObject =
            context.foundClasses?.find(
              (classDeclaration) => classDeclaration?.className === className,
            )?.resolvedProperties || {}

          try {
            assertAsCustomElement(classDoc)
          } catch {
            return
          }
          if (classDoc.attributes) {
            classDoc.attributes?.forEach(async (member) => {
              // const isOptional = member.type?.text.includes('| undefined')
              // console.log('member', member.name)

              const fullyResolvedType = classDeclarationObject[member.name]

              if (fullyResolvedType) {
                // Check if the type is not a primitive type or literal
                let optionalTypeName = member.type?.text?.match(/^[A-Z]/g)
                  ?.length
                  ? member.type?.text
                  : ""
                // console.log("type", {
                //   name: member.name,
                //   fullyResolvedType,
                //   optionalTypeName,
                // })
                // Remove | undefined from the type name, because it will be added at the end
                optionalTypeName = optionalTypeName?.replace(" | undefined", "")
                // Wrap it in a comment for better readability in type hint
                optionalTypeName = optionalTypeName
                  ? `/* ${optionalTypeName} */ `
                  : ""
                // Set the type of the member to the fully resolved type
                member.type = {
                  ...member.type,
                  text: `${optionalTypeName}${fullyResolvedType}`,
                }
              }
            })
          }
          break
        }
        default:
          break
      }
    },

    moduleLinkPhase({ moduleDoc, context }) {
      // context.dev && console.debug
      console.log("moduleLinkPhase", {
        moduleDoc,
        foundClasses: context.foundClasses,
        classDeclarations: context.classDeclarations.map((item) =>
          item.getName(),
        ),
        interfaceDeclarations: context.interfaceDeclarations.map((item) =>
          item.getName(),
        ),
        typeDeclarations: context.typeDeclarations.map((item) =>
          item.getName(),
        ),
      })
    },

    packageLinkPhase({ customElementsManifest, context }) {
      context.dev && console.debug("packageLinkPhase")
    },
  }
}
