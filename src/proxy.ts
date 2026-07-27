import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

function isPrivateAdmin(request: NextRequest) {
  const username = process.env.ADMIN_DASHBOARD_USERNAME
  const password = process.env.ADMIN_DASHBOARD_PASSWORD
  const header = request.headers.get("authorization")
  if (!username || !password || !header?.startsWith("Basic ")) return false
  try {
    const supplied = atob(header.slice(6))
    return supplied === `${username}:${password}`
  } catch { return false }
}

// A browser pops its native credential dialog for any response carrying
// WWW-Authenticate, including ones it fetched speculatively. Chrome prerenders
// URLs from history when you type a domain, so an operator who once opened
// /admin got a password prompt every time they opened the site — over whatever
// page actually loaded, which looks like the site randomly demanding a password.
//
// Only a real, user-initiated top-level navigation may trigger the dialog.
function isUserNavigation(request: NextRequest) {
  const headers = request.headers
  const speculative = headers.get("sec-purpose")?.includes("prefetch")
    || headers.get("purpose") === "prefetch"
    || headers.get("x-moz") === "prefetch"
    || headers.get("next-router-prefetch") === "1"
  if (speculative) return false
  const mode = headers.get("sec-fetch-mode")
  const dest = headers.get("sec-fetch-dest")
  // Absent Sec-Fetch-* means a non-browser client (curl, scripts): let those
  // through to the challenge so operator tooling still works.
  if (!mode && !dest) return true
  return mode === "navigate" && dest === "document"
}

function adminChallenge() {
  return new NextResponse("Private admin authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AgentOS Admin", charset="UTF-8"', "Cache-Control": "no-store" },
  })
}

// Speculative and subresource requests get a plain 404: no dialog, and the admin
// surface is not advertised to anything that did not deliberately ask for it.
function adminHidden() {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  })
}

// v1 is the marketplace surface. `/dashboard` is the tenant portal and does
// its authorization in server components/route handlers; `/admin` is owner-only.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  if (path === "/api/asp" || path.startsWith("/api/asp/")) {
    return NextResponse.json({
      error: {
        code: "API_VERSION_RETIRED",
        message: "Legacy ASP routes are disabled. Use /api/v1/services and /docs.",
      },
    }, { status: 410 })
  }
  if (path.startsWith("/api/dashboard/")) return NextResponse.next()
  if (path.startsWith("/api/") && path !== "/api/v1" && !path.startsWith("/api/v1/")) {
    return isPrivateAdmin(request)
      ? NextResponse.next()
      : NextResponse.json({ error: { code: "API_VERSION_RETIRED", message: "Use /api/v1 and GET /docs" } }, { status: 410 })
  }
  if (path.startsWith("/admin")) {
    if (isPrivateAdmin(request)) return NextResponse.next()
    return isUserNavigation(request) ? adminChallenge() : adminHidden()
  }
  return NextResponse.next()
}

export const config = { matcher: ["/api/:path*", "/admin/:path*"] }
