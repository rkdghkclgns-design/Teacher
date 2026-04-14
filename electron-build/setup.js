const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appDir = path.join(__dirname, 'app');
const jsDir = path.join(appDir, 'js');
const assetsDir = path.join(appDir, 'assets');

// 폴더 생성
[appDir, jsDir, assetsDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// HTML 복사 + file:// 감지 코드 제거
let html = fs.readFileSync(path.join(root, '디벨로켓 교안 도우미.html'), 'utf-8');
// file:// 프로토콜 차단 스크립트 블록 제거
html = html.replace(
    /<script>\s*\/\/ file:\/\/ 프로토콜 감지[\s\S]*?<\/script>/,
    '<!-- file:// check removed for Electron -->'
);
fs.writeFileSync(path.join(appDir, 'index.html'), html, 'utf-8');
console.log('[OK] HTML copied as index.html (file:// check removed)');

// JS 파일 복사
const jsRoot = path.join(root, 'js');
const jsFiles = fs.readdirSync(jsRoot).filter(f => f.endsWith('.js'));
jsFiles.forEach(f => {
    fs.copyFileSync(path.join(jsRoot, f), path.join(jsDir, f));
});
console.log(`[OK] ${jsFiles.length} JS files copied`);

// Assets 복사
const assetsRoot = path.join(root, 'assets');
if (fs.existsSync(assetsRoot)) {
    const assetFiles = fs.readdirSync(assetsRoot);
    assetFiles.forEach(f => {
        fs.copyFileSync(path.join(assetsRoot, f), path.join(assetsDir, f));
    });
    console.log(`[OK] ${assetFiles.length} asset files copied`);
}

console.log('\n[OK] Setup complete! Run: npm run build');
