const fs = require("fs");
const path = require("path");

const SDK_DIR = path.join(__dirname, "..", "public", "sdk");
const BUNDLE_DIR = path.join(__dirname, "..", "node_modules", "@zama-fhe", "relayer-sdk", "bundle");

const FILES = [
  { src: "relayer-sdk-js.umd.cjs", dest: "relayer-sdk.js" },
  { src: "tfhe_bg.wasm", dest: "tfhe_bg.wasm" },
  { src: "kms_lib_bg.wasm", dest: "kms_lib_bg.wasm" },
];

if (!fs.existsSync(SDK_DIR)) fs.mkdirSync(SDK_DIR, { recursive: true });

for (const f of FILES) {
  const src = path.join(BUNDLE_DIR, f.src);
  const dest = path.join(SDK_DIR, f.dest);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    const size = (fs.statSync(dest).size / 1024).toFixed(0);
    process.stdout.write(`Copied ${f.dest} (${size}KB)\n`);
  } else {
    process.stderr.write(`Warning: ${src} not found\n`);
  }
}
