#!/bin/bash
# ============================================================
# AnesLearn Netlify Build Script
# Pulls latest Green Book content from mitchgist1987/cugammadex
# and rebuilds index.html with updated rotation content
# ============================================================
set -e

echo "=== AnesLearn Build ==="
echo "Node: $(node --version)"
echo "npm: $(npm --version)"

# Clone the Green Book repo
echo "--- Fetching Green Book content ---"
if [ -d "cugammadex" ]; then
  cd cugammadex && git pull && cd ..
else
  git clone --depth=1 https://github.com/mitchgist1987/cugammadex.git
fi

# Run the content injection script
echo "--- Injecting Green Book content into AnesLearn ---"
node inject_greenbook.js

echo "--- Build complete ---"
