/** High-confidence credential patterns (SECURITY.md section 5). Findings never include the secret value. */
const RULES: { id: string; pattern: RegExp }[] = [
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: "credentialed-url", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@[^\s/]+/i },
  {
    id: "assigned-secret",
    pattern:
      /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["'][A-Za-z0-9/+_=-]{16,}["']/i,
  },
];

/** File names that must never ship inside a template. */
const FORBIDDEN_NAMES = [/^\.env(?:\..+)?$/i, /\.(?:pem|key|p12|pfx|jks)$/i, /^id_(?:rsa|ed25519|ecdsa)$/i];

export interface SecretFinding {
  file: string;
  rule: string;
  line?: number;
}

export function scanForSecrets(files: Map<string, Buffer>): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [file, bytes] of files) {
    const base = file.split("/").pop() ?? file;
    if (FORBIDDEN_NAMES.some((rule) => rule.test(base)) && !/\.example$/i.test(base)) {
      findings.push({ file, rule: "forbidden-file-name" });
    }
    if (bytes.includes(0)) continue;
    bytes
      .toString("utf8")
      .split(/\r?\n/)
      .forEach((text, index) => {
        for (const rule of RULES) if (rule.pattern.test(text)) findings.push({ file, rule: rule.id, line: index + 1 });
      });
  }
  return findings;
}
