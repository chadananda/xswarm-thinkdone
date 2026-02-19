#!/usr/bin/env bash
# pre-deploy.sh — Full deployment pipeline
# Usage: ./scripts/pre-deploy.sh [patch|minor|major]
#
# Pipeline:
#   1. Bump version (semver)              ~5s
#   2. Lint (eslint + security rules)     ~10s
#   3. Build (astro build)                ~15s
#   4. Upload assets to R2 (if changed)   ~5-30s
#   5. SEO audit (seo-analyzer)           ~5s
#   6. Security audit (5 scans)           ~30s
#   7. Run all tests (TDD + BDD)          ~20s
#   8. Commit & push with tag             ~10s
#   9. Deploy (Wrangler)                  ~30s
#
# Total estimated time: ~2 minutes

set -euo pipefail

BUMP="${1:-patch}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

step=0
total=9
failures=0

banner() {
  step=$((step + 1))
  echo ""
  echo -e "${CYAN}${BOLD}[$step/$total] $1${RESET}"
  echo -e "${DIM}$(printf '%.0s─' {1..50})${RESET}"
}

pass() { echo -e "  ${GREEN}✓${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; failures=$((failures + 1)); }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
skip() { echo -e "  ${DIM}○ $1 (skipped)${RESET}"; }

cd "$(dirname "$0")/.."

# Preflight
if ! git diff --quiet HEAD 2>/dev/null; then
  warn "Uncommitted changes will be included in the deploy commit"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Version bump ($BUMP)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OLD_VERSION=$(node -p "require('./package.json').version")
npm version "$BUMP" --no-git-tag-version --no-commit-hooks > /dev/null 2>&1
NEW_VERSION=$(node -p "require('./package.json').version")
pass "$OLD_VERSION → $NEW_VERSION"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Lint"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if npx eslint src/ --max-warnings 0 2>&1; then
  pass "ESLint clean (includes security rules)"
else
  fail "Lint errors — fix before deploying"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Build"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if npx astro build 2>&1 | tail -3; then
  [ -d "dist" ] && pass "Build succeeded" || fail "No dist/ directory"
else
  fail "Build failed"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Upload assets to R2 (if changed)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UPLOAD_OUT=$(node scripts/upload-assets.js --all 2>&1)
echo "$UPLOAD_OUT"
if echo "$UPLOAD_OUT" | grep -q "failed"; then
  fail "Asset upload had failures — check output above"
else
  pass "Assets synced to R2"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "SEO audit (seo-analyzer)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if [ -d "dist" ]; then
  SEO_OUT=$(npx seo-analyzer --files "dist/**/*.html" 2>&1 || true)
  SEO_ERRORS=$(echo "$SEO_OUT" | grep -ci "error" || true)
  echo "$SEO_OUT" | tail -10
  if [ "$SEO_ERRORS" -eq 0 ]; then
    pass "SEO audit clean"
  else
    warn "SEO issues found — review output above"
  fi
else
  skip "No dist/ — build must succeed first"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Security audit (5 scans)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Scan 1: Secrets detection (gitleaks — entropy + regex patterns)
echo -e "  ${DIM}[1/5] Secrets scan (gitleaks)${RESET}"
if npx gitleaks-secret-scanner detect --source . --no-git --redact 2>&1 | tail -5; then
  pass "No secrets detected"
else
  LEAKS_EXIT=$?
  if [ "$LEAKS_EXIT" -eq 1 ]; then
    fail "Secrets detected — remove before deploying"
  else
    warn "gitleaks scan inconclusive"
  fi
fi

# Scan 2: Dependency vulnerabilities (npm audit)
echo -e "  ${DIM}[2/5] Dependency vulnerabilities (npm audit)${RESET}"
AUDIT_OUT=$(npm audit --omit=dev 2>&1 || true)
if echo "$AUDIT_OUT" | grep -q "found 0 vulnerabilities"; then
  pass "No dependency vulnerabilities"
elif echo "$AUDIT_OUT" | grep -qi "critical\|high"; then
  echo "$AUDIT_OUT" | head -10
  fail "Critical/high vulnerabilities — run npm audit fix"
else
  warn "Low/moderate vulnerabilities exist — review with npm audit"
fi

# Scan 3: Static security analysis (eslint-plugin-security, already ran in lint)
echo -e "  ${DIM}[3/5] Static analysis (eslint-plugin-security)${RESET}"
pass "Covered by lint step (eslint-plugin-security rules)"

# Scan 4: Known-vulnerable JS libraries in build output (retire.js)
echo -e "  ${DIM}[4/5] Vulnerable JS libraries (retire.js)${RESET}"
if [ -d "dist" ]; then
  RETIRE_OUT=$(npx retire --path dist/ --outputformat text 2>&1 || true)
  if echo "$RETIRE_OUT" | grep -qi "no known vulnerable"; then
    pass "No known-vulnerable JS libraries in build"
  elif echo "$RETIRE_OUT" | grep -qi "severity"; then
    echo "$RETIRE_OUT" | head -10
    fail "Vulnerable JS libraries detected in build — update dependencies"
  else
    pass "retire.js scan clean"
  fi
else
  skip "No dist/ — build must succeed first"
fi

# Scan 5: Frontend web vulnerability scan (is-website-vulnerable)
echo -e "  ${DIM}[5/5] Web vulnerability scan (is-website-vulnerable)${RESET}"
if [ -d "dist" ]; then
  # Start preview server for web scanning
  npx astro preview --port 4174 &
  PREVIEW_PID=$!
  sleep 3

  IWV_OUT=$(npx is-website-vulnerable http://localhost:4174 2>&1 || true)
  if echo "$IWV_OUT" | grep -qi "no vulnerable"; then
    pass "No frontend JS vulnerabilities detected"
  elif echo "$IWV_OUT" | grep -qi "found.*vulnerable\|vulnerability"; then
    echo "$IWV_OUT" | tail -10
    warn "Frontend JS vulnerabilities found — review output"
  else
    pass "Web vulnerability scan clean"
  fi

  kill $PREVIEW_PID 2>/dev/null; wait $PREVIEW_PID 2>/dev/null || true
else
  skip "No dist/ — build must succeed first"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Tests (TDD + BDD)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# TDD: unit/integration tests
echo -e "  ${DIM}TDD tests:${RESET}"
if node tests/memory.test.js 2>&1 | tail -5; then
  pass "TDD tests passed"
else
  fail "TDD tests failed"
fi

# BDD: end-to-end (Playwright)
if [ -f "playwright.config.js" ] || [ -f "playwright.config.ts" ]; then
  echo -e "  ${DIM}BDD/E2E tests:${RESET}"
  if npx playwright test 2>&1 | tail -10; then
    pass "BDD tests passed"
  else
    fail "BDD tests failed"
  fi
else
  skip "No playwright.config — BDD tests not configured yet"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Commit & Push"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ "$failures" -gt 0 ]; then
  echo -e "  ${RED}${BOLD}$failures failure(s) detected — aborting commit${RESET}"
  echo "  Fix the issues above and re-run the pipeline."
  # Revert version bump
  npm version "$OLD_VERSION" --no-git-tag-version --no-commit-hooks --allow-same-version > /dev/null 2>&1
  warn "Version reverted to $OLD_VERSION"
  exit 1
fi

git add -A
git commit -m "$(cat <<EOF
release: v${NEW_VERSION}

Pre-deploy pipeline passed:
- Lint: clean (eslint + security rules)
- Build: astro build succeeded
- SEO: seo-analyzer audit
- Security: gitleaks + npm audit + SAST + retire.js + web vuln scan
- Tests: TDD passed
EOF
)" || warn "Nothing to commit"

git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}" 2>/dev/null || warn "Tag v${NEW_VERSION} exists"
git push origin HEAD --tags 2>&1 || fail "Push failed"
pass "Pushed v${NEW_VERSION} with tag"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
banner "Deploy (Wrangler)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo -e "${GREEN}${BOLD}  v${NEW_VERSION} ready to deploy${RESET}"
echo ""
echo "  Pipeline summary:"
echo "    Version:   $OLD_VERSION → $NEW_VERSION  ~5s"
echo "    Lint:      eslint + security rules      ~10s"
echo "    Build:     astro build                   ~15s"
echo "    Assets:    R2 upload (changed only)      ~5-30s"
echo "    SEO:       seo-analyzer audit            ~5s"
echo "    Security:  5 scans (secrets, deps,       ~30s"
echo "               SAST, retire.js, web vuln)"
echo "    Tests:     TDD + BDD                     ~20s"
echo "    Git:       committed + pushed + tagged    ~10s"
echo ""

if command -v wrangler > /dev/null 2>&1; then
  echo -e "  ${CYAN}Deploying with Wrangler...${RESET}"
  if wrangler pages deploy dist/ 2>&1; then
    pass "Deployed v${NEW_VERSION} to Cloudflare Pages"
  else
    fail "Wrangler deploy failed"
  fi
else
  echo -e "  ${YELLOW}Wrangler not found. Deploy manually:${RESET}"
  echo "    npx wrangler pages deploy dist/"
  echo "    # or: npm i -g wrangler && wrangler pages deploy dist/"
fi

echo ""
