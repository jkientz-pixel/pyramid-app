#!/bin/bash
# Rank XI dual deploy: GitHub (repo of record + legacy URL) + Cloudflare Pages (canonical)
set -e
cd "$(dirname "$0")"
git push
npx -y wrangler@4.114.0 pages deploy . --project-name=rank-xi --branch=master --commit-dirty=true
echo "Deployed: https://rank-xi.pages.dev"
