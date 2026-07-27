// Test-only module resolution.
//
// The application source uses TypeScript's extensionless relative imports
// ("./service-catalog") and the "@/..." path alias, both of which Next resolves
// at build time. Node's ESM loader does not. This hook teaches the test runner
// the same two rules so tests can import real application modules directly
// instead of source being reshaped to suit the runner.
//
// It affects tests only; nothing here is bundled or shipped.

import { register } from "node:module"
import { pathToFileURL } from "node:url"

const SRC = pathToFileURL(`${process.cwd()}/src/`).href
const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".mjs", ".js"]

export async function resolve(specifier, context, nextResolve) {
  const rewritten = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier

  try {
    return await nextResolve(rewritten, context)
  } catch (error) {
    const relative = rewritten.startsWith(".") || rewritten.startsWith("file:")
    if (!relative) throw error
    for (const suffix of CANDIDATE_SUFFIXES) {
      try {
        return await nextResolve(`${rewritten}${suffix}`, context)
      } catch {
        // try the next candidate extension
      }
    }
    throw error
  }
}

register(import.meta.url, import.meta.url)
