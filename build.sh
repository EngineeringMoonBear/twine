#!/bin/sh
# Wraps index.html (an artifact-style page fragment) into a full document for GitHub Pages.
set -e
cd "$(dirname "$0")"
{
  printf '%s\n' '<!doctype html>' '<html lang="en">' '<head>' \
    '<meta charset="utf-8">' \
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' \
    '<meta name="robots" content="noindex">' \
    '<meta name="description" content="Twine: a prototype app where cis women and trans women meet as friends, allies and more.">'
  cat index.html
  printf '%s\n' '</html>'
} > docs/index.html
echo "twine.joshedunbar.com" > docs/CNAME
touch docs/.nojekyll
