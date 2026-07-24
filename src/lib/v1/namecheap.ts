import { ApiError } from "./http"

type NamecheapResponse = { ok: boolean; xml: string }
function config() {
  const apiUser = process.env.NAMECHEAP_API_USER, apiKey = process.env.NAMECHEAP_API_KEY, username = process.env.NAMECHEAP_USERNAME, clientIp = process.env.NAMECHEAP_CLIENT_IP
  if (!apiUser || !apiKey || !username || !clientIp) throw new ApiError("provider_configuration_error", "Namecheap API credentials and whitelisted NAMECHEAP_CLIENT_IP are required", 503)
  if (process.env.NAMECHEAP_SANDBOX === "true") throw new ApiError("provider_configuration_error", "Namecheap sandbox is forbidden for production ASP operations", 503)
  return { apiUser, apiKey, username, clientIp }
}
function decode(value: string) { return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") }
export async function namecheap(command: string, parameters: Record<string, string | number | undefined>): Promise<NamecheapResponse> {
  const c = config(); const query = new URLSearchParams({ ApiUser: c.apiUser, ApiKey: c.apiKey, UserName: c.username, ClientIp: c.clientIp, Command: command })
  for (const [key, value] of Object.entries(parameters)) if (value !== undefined) query.set(key, String(value))
  const response = await fetch(`https://api.namecheap.com/xml.response?${query}`, { cache: "no-store" })
  const xml = await response.text()
  const errors = [...xml.matchAll(/<Error[^>]*>([\s\S]*?)<\/Error>/g)].map(match => decode(match[1].trim()))
  if (!response.ok || errors.length || !/Status="OK"/i.test(xml)) throw new ApiError("provider_error", `Namecheap request failed: ${errors.join("; ") || response.status}`, 502)
  return { ok: true, xml }
}
export async function checkDomain(domain: string) { return namecheap("namecheap.domains.check", { DomainList: domain }) }
export async function getDomain(domain: string) { return namecheap("namecheap.domains.getInfo", { DomainName: domain }) }
export async function setDnsHosts(domain: string, hosts: Array<{ host: string; type: string; value: string; ttl?: number; mxPref?: number }>) {
  if (!hosts.length) throw new ApiError("invalid_request", "At least one DNS record is required; Namecheap setHosts replaces the full zone")
  const [sld, ...tldParts] = domain.toLowerCase().split("."); if (!sld || !tldParts.length) throw new ApiError("invalid_request", "Invalid domain")
  const params: Record<string, string | number | undefined> = { SLD: sld, TLD: tldParts.join(".") }
  hosts.forEach((record, index) => { const i = index + 1; params[`HostName${i}`] = record.host; params[`RecordType${i}`] = record.type; params[`Address${i}`] = record.value; params[`TTL${i}`] = record.ttl ?? 1800; if (record.mxPref !== undefined) params[`MXPref${i}`] = record.mxPref })
  return namecheap("namecheap.domains.dns.setHosts", params)
}
