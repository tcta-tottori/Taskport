/**
 * ULID（時系列にソート可能なID）の最小実装。
 * 26文字 = 先頭10文字がミリ秒タイムスタンプ、残り16文字が乱数。
 * 文字列としてソートすると生成順に並ぶため、created 順の一覧がそのまま作れる。
 * この用途のために依存を1つ増やす必要がないので自前で持つ。
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford Base32
const TIME_LEN = 10
const RAND_LEN = 16

function encodeTime(now: number): string {
  let out = ''
  let t = now
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out = ENCODING[t % 32] + out
    t = Math.floor(t / 32)
  }
  return out
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RAND_LEN)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < RAND_LEN; i++) out += ENCODING[bytes[i] % 32]
  return out
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom()
}
