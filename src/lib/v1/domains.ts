import { createCipheriv, randomBytes } from "node:crypto"
import { ApiError } from "./http"
import { namecheap } from "./namecheap"

const fields = ["firstName", "lastName", "address1", "city", "stateProvince", "postalCode", "country", "phone", "emailAddress"] as const
type ContactField = typeof fields[number]
function validDomain(value: unknown) { if (typeof value !== "string" || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)) throw new ApiError("invalid_request", "domainName must be a registrable domain"); return value.toLowerCase() }
function contact(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError("invalid_request", "registrant contact is required")
  const result: Record<string, string> = {}; for (const key of fields) { const value = (input as Record<string, unknown>)[key]; if (typeof value !== "string" || !value.trim()) throw new ApiError("invalid_request", `registrant.${key} is required`); result[key] = value.trim() }
  return result as Record<ContactField, string>
}
function encrypted(value: unknown) {
  const encoded = process.env.DOMAIN_CONTACT_ENCRYPTION_KEY; if (!encoded) throw new ApiError("provider_configuration_error", "DOMAIN_CONTACT_ENCRYPTION_KEY is not configured", 503)
  const key = Buffer.from(encoded, "base64"); if (key.length !== 32) throw new ApiError("provider_configuration_error", "DOMAIN_CONTACT_ENCRYPTION_KEY must be base64-encoded 32 bytes", 503)
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${data.toString("base64")}`
}
export async function registerDomain(input: Record<string, unknown>) {
  const domain = validDomain(input.domainName), years = Number(input.years ?? 1); if (!Number.isInteger(years) || years < 1 || years > 10) throw new ApiError("invalid_request", "years must be an integer between 1 and 10")
  const [sld, ...tld] = domain.split("."), c = contact(input.registrant); const params: Record<string, string | number | undefined> = { SLD: sld, TLD: tld.join("."), Years: years, AddFreeWhoisguard: "yes", WGEnabled: "yes" }
  const map: Record<ContactField, string> = { firstName: "FirstName", lastName: "LastName", address1: "Address1", city: "City", stateProvince: "StateProvince", postalCode: "PostalCode", country: "Country", phone: "Phone", emailAddress: "EmailAddress" }
  for (const [key, suffix] of Object.entries(map)) { const value = c[key as ContactField]; params[`Registrant${suffix}`] = value; params[`Tech${suffix}`] = value; params[`Admin${suffix}`] = value; params[`AuxBilling${suffix}`] = value }
  await namecheap("namecheap.domains.create", params)
  return { domain, encryptedContact: encrypted(c) }
}
