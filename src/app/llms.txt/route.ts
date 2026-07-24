import { llmsText } from "@/lib/v1/docs"
export const runtime = "nodejs"
export async function GET() { return new Response(llmsText, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } }) }
