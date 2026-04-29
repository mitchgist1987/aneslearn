#!/bin/bash
# Runs from AnesLearn/ directory (Netlify base)
set -e

echo "=== AnesLearn Build ==="
echo "Node: $(node --version)"

echo "--- Fetching Green Book content ---"
if [ -d "cugammadex" ]; then
  cd cugammadex && git pull && cd ..
else
  git clone --depth=1 https://github.com/mitchgist1987/cugammadex.git
fi

echo "--- Injecting Green Book content ---"
node inject_greenbook.js

echo "--- Build complete ---"
