import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { ApiError } from "./http"

function encryptionKey() {
  const encoded = process.env.PHONE_SECRET_ENCRYPTION_KEY
  if (!encoded) throw new ApiError("provider_configuration_error", "PHONE_SECRET_ENCRYPTION_KEY is not configured", 503)
  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32) throw new ApiError("provider_configuration_error", "PHONE_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes", 503)
  return key
}

export function encryptPhoneSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")
}

export function decryptPhoneSecret(value: string) {
  try {
    const packed = Buffer.from(value, "base64")
    const iv = packed.subarray(0, 12)
    const tag = packed.subarray(12, 28)
    const encrypted = packed.subarray(28)
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
  } catch {
    throw new ApiError("provider_configuration_error", "Stored phone callback secret cannot be decrypted", 503)
  }
}
