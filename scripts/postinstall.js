#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, readdirSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const modelsSource = join(__dirname, "..", "models")

const commonPublicDirs = [
  "public/models",
  "public/assets/models", 
  "app/assets/builds/models",
  "dist/models"
]

function findProjectRoot() {
  let dir = resolve(__dirname, "..", "..", "..")
  while (dir !== "/") {
    if (existsSync(join(dir, "package.json"))) {
      return dir
    }
    dir = dirname(dir)
  }
  return null
}

function findExistingPublicDir(projectRoot) {
  for (const dir of commonPublicDirs) {
    const fullPath = join(projectRoot, dir)
    const parentPath = dirname(fullPath)
    if (existsSync(parentPath)) {
      return fullPath
    }
  }
  return null
}

function copyModels(targetDir) {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }
  
  const models = readdirSync(modelsSource).filter(f => f.endsWith(".onnx"))
  
  models.forEach(model => {
    const src = join(modelsSource, model)
    const dest = join(targetDir, model)
    if (!existsSync(dest)) {
      copyFileSync(src, dest)
      console.log(`  ✓ Copied ${model}`)
    } else {
      console.log(`  - ${model} already exists`)
    }
  })
}

function main() {
  const projectRoot = findProjectRoot()
  
  if (!projectRoot) {
    console.log("stimulus-speak-then: Could not find project root")
    console.log("Please manually copy models from node_modules/stimulus-speak-then/models/ to public/models/")
    return
  }

  let targetDir = findExistingPublicDir(projectRoot) || join(projectRoot, "public", "models")

  console.log(`\nstimulus-speak-then: Installing models to ${targetDir}\n`)
  
  try {
    copyModels(targetDir)
    console.log("\n✓ Models installed successfully\n")
  } catch (err) {
    console.error("\nFailed to copy models:", err.message)
    console.log("Please manually copy models from node_modules/stimulus-speak-then/models/ to public/models/\n")
  }
}

main()
