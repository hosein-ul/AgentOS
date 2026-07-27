import assert from "node:assert/strict"
import test from "node:test"
import { isValidPaymentWallet } from "../src/lib/v1/config.ts"

test("payment receiving wallet must be a strict EVM address", () => {
  assert.equal(isValidPaymentWallet("0x0000000000000000000000000000000000000000"), true)
  assert.equal(isValidPaymentWallet("XKOc0d1ac70a3a32bcea4a124e65eb22eb5f0d0adc2"), false)
  assert.equal(isValidPaymentWallet("0xnot-a-wallet"), false)
})
