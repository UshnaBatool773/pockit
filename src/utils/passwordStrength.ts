/**
 * Lightweight, dependency-free password strength estimate (0-100).
 * Not as sophisticated as zxcvbn, but has no external dependency, needs no
 * large wordlists, and is more than enough to drive a "weak/moderate/strong"
 * UI indicator without ever needing to leave the process.
 *
 * Rewards length and character-class variety, penalizes obvious patterns
 * (repeats, sequences, common passwords).
 */
const COMMON_PASSWORDS = new Set([
  "password", "123456", "12345678", "qwerty", "abc123", "letmein",
  "iloveyou", "admin", "welcome", "monkey", "dragon", "football",
  "111111", "123123", "password1", "12345", "1234567", "sunshine",
]);

export function estimatePasswordStrength(password: string): number {
  if (!password) return 0;

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 5;

  let score = 0;

  // Length: the single strongest signal.
  score += Math.min(password.length * 4, 40);

  // Character class variety.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
  const classCount = classes.filter((re) => re.test(password)).length;
  score += classCount * 10;

  // Penalize simple repeated characters, e.g. "aaaa" or "1111".
  if (/(.)\1{2,}/.test(password)) score -= 15;

  // Penalize obvious ascending/descending sequences, e.g. "1234", "abcd".
  if (hasSequence(password)) score -= 15;

  // Small bonus for longer passwords beyond 12 chars.
  if (password.length >= 12) score += 10;
  if (password.length >= 16) score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function hasSequence(password: string): boolean {
  const s = password.toLowerCase();
  for (let i = 0; i < s.length - 2; i++) {
    const a = s.charCodeAt(i);
    const b = s.charCodeAt(i + 1);
    const c = s.charCodeAt(i + 2);
    if (b - a === 1 && c - b === 1) return true; // ascending
    if (a - b === 1 && b - c === 1) return true; // descending
  }
  return false;
}
