// Provider-agnostic registrar + DNS interface.

export type DomainStatus = "available" | "unavailable" | "registered" | "pending" | "expired"
export type DnsRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV" | "CAA"

export interface AvailabilityResult {
  domain: string
  available: boolean
  premium?: boolean
  price?: string
  currency?: string
}

export interface RegistrationResult {
  providerDomainId: string
  status: DomainStatus
  registeredAt: string
  expiresAt: string
  nameservers: string[]
}

export interface RenewalResult {
  expiresAt: string
}

export interface DnsRecordDTO {
  providerRecordId: string
  type: DnsRecordType
  name: string
  value: string
  ttl: number
  priority?: number
}

export interface Contact {
  firstName: string
  lastName: string
  email: string
  phone: string
  address1: string
  city: string
  state?: string
  postalCode: string
  country: string
  organization?: string
}

export interface DomainProvider {
  readonly name: string
  search(opts: { query: string; tlds?: string[] }): Promise<AvailabilityResult[]>
  register(opts: { domain: string; years: number; contact: Contact; nameservers?: string[] }): Promise<RegistrationResult>
  renew(opts: { domain: string; providerDomainId?: string; years: number }): Promise<RenewalResult>
  listDnsRecords(domain: string): Promise<DnsRecordDTO[]>
  upsertDnsRecord(opts: { domain: string; record: Omit<DnsRecordDTO, "providerRecordId"> & { providerRecordId?: string } }): Promise<DnsRecordDTO>
  deleteDnsRecord(opts: { domain: string; providerRecordId: string }): Promise<void>
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean
}

// ─── Mock provider (default) ──────────────────────────────────────────────────

const RESERVED = new Set(["google", "apple", "microsoft", "amazon", "facebook", "openai", "anthropic"])
const YEAR_MS = 365 * 24 * 60 * 60 * 1000

function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
}

export class MockDomainProvider implements DomainProvider {
  readonly name = "mock"

  private records = new Map<string, DnsRecordDTO[]>()

  async search({ query, tlds = ["com", "io", "ai", "dev"] }: { query: string; tlds?: string[] }): Promise<AvailabilityResult[]> {
    const base = query.trim().toLowerCase().replace(/[^a-z0-9-]/g, "")
    return tlds.map(tld => {
      const domain = `${base}.${tld}`
      const reserved = RESERVED.has(base) || base.length < 3
      const premium = base.length <= 4 && !reserved
      return {
        domain,
        available: !reserved,
        premium,
        price: premium ? "199.00" : tld === "com" ? "12.99" : "24.99",
        currency: "USD",
      }
    })
  }

  async register({ domain, years, nameservers }: { domain: string; years: number; contact: Contact; nameservers?: string[] }): Promise<RegistrationResult> {
    const name = normalizeDomain(domain)
    const now = new Date()
    const expires = new Date(now.getTime() + Math.max(1, years) * YEAR_MS)
    return {
      providerDomainId: randomId("DM"),
      status: "registered",
      registeredAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      nameservers: nameservers ?? [`ns1.${name}`, `ns2.${name}`],
    }
  }

  async renew({ years }: { domain: string; providerDomainId?: string; years: number }): Promise<RenewalResult> {
    const expires = new Date(Date.now() + Math.max(1, years) * YEAR_MS)
    return { expiresAt: expires.toISOString() }
  }

  async listDnsRecords(domain: string): Promise<DnsRecordDTO[]> {
    return this.records.get(normalizeDomain(domain)) ?? []
  }

  async upsertDnsRecord({ domain, record }: { domain: string; record: Omit<DnsRecordDTO, "providerRecordId"> & { providerRecordId?: string } }): Promise<DnsRecordDTO> {
    const key = normalizeDomain(domain)
    const existing = this.records.get(key) ?? []
    const providerRecordId = record.providerRecordId ?? randomId("REC")
    const filtered = existing.filter(r => r.providerRecordId !== providerRecordId)
    const next: DnsRecordDTO = { ...record, providerRecordId }
    this.records.set(key, [...filtered, next])
    return next
  }

  async deleteDnsRecord({ domain, providerRecordId }: { domain: string; providerRecordId: string }): Promise<void> {
    const key = normalizeDomain(domain)
    const existing = this.records.get(key) ?? []
    this.records.set(key, existing.filter(r => r.providerRecordId !== providerRecordId))
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    void rawBody; void signature
    return true
  }
}

// ─── Selector ──────────────────────────────────────────────────────────────────

export function getDomainProvider(): DomainProvider {
  throw new Error("Legacy mock domain provider is retired; v1 domain remains fail-closed until Namecheap is production-ready")
}
