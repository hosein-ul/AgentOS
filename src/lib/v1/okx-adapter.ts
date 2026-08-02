import type { NextRequest } from "next/server"

/**
 * HTTP adapter for the official OKX x402 SDK's `x402HTTPResourceServer`.
 * Same interface the SDK's ExpressAdapter satisfies, targeted at Next.js.
 * The SDK reads only through this surface, so processHTTPRequest sees a
 * request exactly as it would in any other framework it supports.
 */
export class NextRequestAdapter {
  private readonly req: NextRequest
  private readonly overridePath?: string
  constructor(req: NextRequest, overridePath?: string) {
    this.req = req
    this.overridePath = overridePath
  }

  getHeader(name: string): string | undefined {
    return this.req.headers.get(name) ?? undefined
  }

  getMethod(): string {
    return this.req.method
  }

  getPath(): string {
    return this.overridePath ?? new URL(this.req.url).pathname
  }

  getUrl(): string {
    return this.req.url
  }

  getAcceptHeader(): string {
    return this.req.headers.get("accept") ?? ""
  }

  getUserAgent(): string {
    return this.req.headers.get("user-agent") ?? ""
  }

  getQueryParams(): Record<string, string> {
    return Object.fromEntries(new URL(this.req.url).searchParams.entries())
  }

  getQueryParam(name: string): string | undefined {
    return new URL(this.req.url).searchParams.get(name) ?? undefined
  }

  getBody(): unknown {
    return undefined
  }
}
