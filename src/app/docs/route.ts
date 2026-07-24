import { agentDocs } from "@/lib/v1/docs"
export const runtime = "nodejs"
export async function GET() { return new Response(agentDocs, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } }) }
