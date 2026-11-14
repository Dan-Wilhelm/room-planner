#!/usr/bin/env bash
# Scans staged files (or all tracked files with --all) for secrets before committing.
# Uses gitleaks if installed, otherwise a grep-based fallback.
set -euo pipefail

if command -v gitleaks >/dev/null 2>&1; then
  if [[ "${1:-}" == "--all" ]]; then gitleaks detect --no-banner --redact; else gitleaks protect --staged --no-banner --redact; fi
  exit $?
fi

if [[ "${1:-}" == "--all" ]]; then
  files=$(git ls-files)
else
  files=$(git diff --cached --name-only --diff-filter=ACM)
fi

status=0
for f in $files; do
  [[ -f "$f" ]] || continue
  case "$f" in
    .env.example|scripts/secret-scan.sh|package-lock.json) continue ;;
  esac
  # Forbidden files
  if [[ "$f" == .env* || "$f" == .vercel/* ]]; then
    echo "BLOCKED: $f must not be committed"; status=1; continue
  fi
  # Secret patterns (values only matter, so match key formats and assignments with values)
  if grep -nIE 'sk-ant-[A-Za-z0-9_-]{10,}|vck_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|EAA[A-Za-z0-9]{40,}|(ANTHROPIC_API_KEY|SESSION_SECRET|APP_PASSWORD|AI_GATEWAY_API_KEY|META_[A-Z_]*TOKEN)\s*=\s*["'"'"']?[A-Za-z0-9_\-]{12,}' "$f" >/dev/null 2>&1; then
    echo "POSSIBLE SECRET in $f:"
    grep -nIE 'sk-ant-|vck_|AIza|ghp_|EAA[A-Za-z0-9]{40,}|(ANTHROPIC_API_KEY|SESSION_SECRET|APP_PASSWORD|AI_GATEWAY_API_KEY|META_[A-Z_]*TOKEN)\s*=' "$f" | sed -E 's/(=\s*["'"'"']?.{0,4}).*/\1…<redacted>/' | head -5
    status=1
  fi
done

if [[ $status -eq 0 ]]; then echo "secret-scan: OK"; fi
exit $status
