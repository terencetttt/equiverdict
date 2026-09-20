export function requireContractAddress(value: string | undefined): `0x${string}` {
  const address = value?.trim()
  if (!address) throw new Error('Contract deployment is pending configuration and provenance verification. NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS is not set.')
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) {
    throw new Error('NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS must be a nonzero 20-byte hexadecimal address.')
  }
  return address as `0x${string}`
}
