import { agentDocs } from "@/lib/v1/docs"

export const runtime = "nodejs"

// /docs is the canonical Markdown documentation URL and is valid without ".md".
// /docs.md is an alias for agents that assume the extension. It serves identical
// content rather than redirecting, so a client that does not follow redirects
// still gets the documentation.
export async function GET() {
  return new Response(agentDocs, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      link: '</docs>; rel="canonical"',
    },
  })
}
