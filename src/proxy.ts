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

function adminRequired() {
  return new NextResponse("Private admin authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AgentOS Admin", charset="UTF-8"', "Cache-Control": "no-store" },
  })
}

// v1 is the public marketplace surface. The retained legacy dashboard and its
// supporting routes are private owner tooling, protected at the edge.
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
  if (path.startsWith("/api/") && path !== "/api/v1" && !path.startsWith("/api/v1/")) {
    return isPrivateAdmin(request)
      ? NextResponse.next()
      : NextResponse.json({ error: { code: "API_VERSION_RETIRED", message: "Use /api/v1 and GET /docs" } }, { status: 410 })
  }
  if (path.startsWith("/dashboard")) {
    return isPrivateAdmin(request) ? NextResponse.next() : adminRequired()
  }
  return NextResponse.next()
}

export const config = { matcher: ["/api/:path*", "/dashboard/:path*"] }
