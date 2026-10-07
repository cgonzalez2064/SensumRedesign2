#!/usr/bin/env bash
# =====================================================================
# Builds the production release for Namecheap (see docs/NAMECHEAP_DEPLOYMENT.md)
#
#   tools/build-release.sh
#
# Output:
#   dist/release-<date>-<commit>/public_html/   → upload into ~/public_html
#   dist/release-<date>-<commit>/sensum-cms/    → upload into ~/sensum-cms (NOT inside public_html)
#   dist/release-<date>-<commit>.zip            → the same two folders, zipped
#
# Only runtime files are included: no tests, docs, tools, git data, .env,
# database, uploads, Composer dev tooling or the local dev router.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Refusing to build: commit or stash your changes first (the build must match a commit)." >&2
  exit 1
fi

COMMIT="$(git rev-parse --short HEAD)"
NAME="release-$(date +%Y%m%d)-${COMMIT}"
OUT="dist/${NAME}"
rm -rf "$OUT" "dist/${NAME}.zip"
mkdir -p "$OUT/public_html" "$OUT/sensum-cms"

# ---- public_html: the website + admin interface + API entry point ----
git archive HEAD index.html 404.html privacy-notice.html robots.txt sitemap.xml site.webmanifest .htaccess \
  assets admin api | tar -x -C "$OUT/public_html"
# Development-only or reference files that must not be published.
rm -rf "$OUT/public_html/assets/fonts/fetch-fonts.sh" \
       "$OUT/public_html/assets/projects/README.md" \
       "$OUT/public_html/assets/portfolio/README.md" \
       "$OUT/public_html/assets/fonts/README.md"
mkdir -p "$OUT/public_html/assets/uploads"   # .htaccess inside comes from git

# ---- sensum-cms: private application (outside the web root) ----
git archive HEAD cms | tar -x -C "$OUT" && mv "$OUT/cms/"* "$OUT/cms/".htaccess "$OUT/sensum-cms/" && rmdir "$OUT/cms"
rm -rf "$OUT/sensum-cms/dev"                       # local development router
rm -rf "$OUT/sensum-cms/storage" && mkdir -p "$OUT/sensum-cms/storage"
cp cms/storage/.htaccess "$OUT/sensum-cms/storage/.htaccess"
(cd "$OUT/sensum-cms" && composer install --no-dev --optimize-autoloader --no-interaction --quiet)
rm -f "$OUT/sensum-cms/composer.lock.bak"
echo "$COMMIT" > "$OUT/sensum-cms/BUILD"

# ---- sanity checks ----
for f in "$OUT/public_html/index.html" "$OUT/public_html/api/index.php" "$OUT/public_html/admin/index.html" \
         "$OUT/sensum-cms/bootstrap.php" "$OUT/sensum-cms/vendor/autoload.php" "$OUT/sensum-cms/templates/index.html.tpl"; do
  [ -f "$f" ] || { echo "Missing $f" >&2; exit 1; }
done
BAD="$(find "$OUT" \( -name '.env' -o -name '*.sqlite' -o -name 'node_modules' -o -name 'router.php' -o -name 'LOCAL-TEST-*' \); find "$OUT/public_html" -name '*.md')"
if [ -n "$BAD" ]; then
  echo "Release contains files that must not ship:" >&2
  echo "$BAD" >&2
  exit 1
fi

(cd dist && zip -qr "${NAME}.zip" "${NAME}")
echo "Built ${OUT}"
echo "  public_html: $(find "$OUT/public_html" -type f | wc -l | tr -d ' ') files"
echo "  sensum-cms:  $(find "$OUT/sensum-cms" -type f | wc -l | tr -d ' ') files"
echo "  zip:         dist/${NAME}.zip ($(du -h "dist/${NAME}.zip" | cut -f1))"
