const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 3000;
const DIR = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/디벨로켓 교안 도우미.html';

    const filePath = path.normalize(path.join(DIR, urlPath));

    // 경로 탐색 방지: 정규화 후 DIR 밖의 파일 접근 차단
    if (!filePath.startsWith(DIR + path.sep) && filePath !== DIR) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // node_modules 접근 차단
    if (filePath.includes('node_modules')) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`  [오류] 포트 ${PORT}이 이미 사용 중입니다.`);
    } else {
        console.error(`  [오류] 서버 시작 실패: ${err.message}`);
    }
    process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
    const url = `http://127.0.0.1:${PORT}`;
    console.log('');
    console.log('  [OK] Develoket Lesson Helper Server Running');
    console.log('  [URL] ' + url);
    console.log('  [EXIT] Ctrl+C or Close this window');
    console.log('');

    // 브라우저 자동 열기 — shell: true로 cmd 내장 start 명령 확실 호출
    if (process.platform === 'win32') {
        exec(`start "" "${url}"`, { shell: 'cmd.exe' }, (err) => {
            if (err) {
                console.error('  [경고] 브라우저 자동 열기 실패:', err.message);
                console.log('  → 브라우저에서 직접 ' + url + ' 을 열어주세요.');
            }
        });
    } else {
        const cmd = process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
        exec(cmd, (err) => {
            if (err) console.error('  [경고] 브라우저 자동 열기 실패:', err.message);
        });
    }
});
