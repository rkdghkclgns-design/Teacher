// capture-guide.js - 사용 가이드(js/tutorial.js)의 화면 캡처와 번호 위치를 만든다
// 빈 브라우저로 앱을 열면 예시 과정(loadMockData)이 나온다. 단계마다 화면 상태를 만들고 1280×800으로 찍은 뒤,
// 번호를 붙일 요소의 위치를 화면 비율(%)로 재서 js/guide-shots.js에 적는다. 화면이 바뀌면 다시 돌린다.
//
// 실행: node scripts/capture-guide.js
//   Playwright(+Chromium)가 필요하다. 이 저장소에는 없으므로 설치된 곳을 PLAYWRIGHT 환경 변수로 알려 준다.
//   예) PLAYWRIGHT="D:/…/node_modules/playwright" node scripts/capture-guide.js
// 결과: guide/NN-이름.jpg, js/guide-shots.js
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'guide');
const MANIFEST = path.join(ROOT, 'js', 'guide-shots.js');
const PORT = 3199;
const VIEW = { width: 1280, height: 800 };
const SCALE = 1.25; // 가이드 창에서 확대해도 글자가 읽히게
const JPEG_QUALITY = 80;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };

function serve() {
    return http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]).replace(/^\/Teacher/, '') || '/';
        const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
        res.end(fs.readFileSync(file));
    }).listen(PORT, '127.0.0.1');
}

/* ---------- 앱 안에서 쓰는 도우미 ---------- */
// 글자로 버튼 찾기 (within 안에서). 보이는 것만
const byText = (text, within = 'body', tag = 'button, summary, a, label') => ({ text, within, tag });

async function rectOf(page, target) {
    return page.evaluate(t => {
        const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        let el = null;
        if (typeof t === 'string') el = [...document.querySelectorAll(t)].find(visible);
        else {
            const root = document.querySelector(t.within) || document.body;
            el = [...root.querySelectorAll(t.tag)].find(node => visible(node) && node.textContent.replace(/\s+/g, ' ').includes(t.text));
        }
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, target);
}

async function openEditor(page) {
    await page.evaluate(() => {
        const open = [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.includes('이 교과 편집기 열기'));
        if (open) open.click();
        else if (typeof openSubjectDetail === 'function') openSubjectDetail(globalState.subjects[0].id);
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
        const open = [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.includes('이 교과 편집기 열기'));
        if (open) open.click();
    });
    await page.waitForTimeout(800);
}

async function openLesson(page) {
    await openEditor(page);
    await page.evaluate(() => viewModule(courseData[0].id));
    await page.waitForTimeout(1200);
}

// 교안에 그림 한 장을 넣는다 (그림 → 판서 영상 바꾸기 화면용 예시)
async function addExampleImage(page) {
    await page.evaluate(async () => {
        const mod = courseData[0];
        const c = document.createElement('canvas');
        c.width = 720; c.height = 360;
        const g = c.getContext('2d');
        g.fillStyle = '#fdf6ec'; g.fillRect(0, 0, 720, 360);
        const nodes = [['도전', 360, 70], ['행동', 560, 180], ['보상', 360, 290], ['성장', 160, 180]];
        g.strokeStyle = '#6d5bd0'; g.lineWidth = 6;
        g.beginPath(); g.ellipse(360, 180, 200, 110, 0, 0, Math.PI * 2); g.stroke();
        nodes.forEach(([label, x, y]) => {
            g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, 46, 0, Math.PI * 2); g.fill();
            g.strokeStyle = '#6d5bd0'; g.lineWidth = 4; g.stroke();
            g.fillStyle = '#2b2550'; g.font = 'bold 24px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x, y);
        });
        g.fillStyle = '#6d5bd0'; g.font = 'bold 22px sans-serif'; g.fillText('코어 루프', 360, 180);
        mod.images = { ...(mod.images || {}), img_guide_loop: c.toDataURL('image/png') };
        const block = '\n\n### ■ 코어 루프 한눈에 보기\n\n플레이어는 도전 → 행동 → 보상 → 성장을 반복하며 게임에 머문다.\n\n<div class="image-wrapper"><img src="local:img_guide_loop" alt="코어 루프 순환도"><button class="image-regenerate-btn" data-lesson-action="regenerate-image" data-keyword="코어 루프" data-img-id="img_guide_loop">다시 생성</button></div>\n';
        const tab = mod.tabContents?.basicLearn ? 'basicLearn' : null;
        if (tab && !mod.tabContents[tab].includes('img_guide_loop')) {
            const text = mod.tabContents[tab];
            const cut = text.indexOf('\n## ', 10);
            mod.tabContents[tab] = cut > 0 ? text.slice(0, cut) + block + text.slice(cut) : block + text;
        }
        viewModule(mod.id);
    });
    await page.waitForTimeout(1200);
}

/* ---------- 단계별 화면 ---------- */
// markers: 번호 순서대로 짚을 요소. scroll: 찍기 전에 화면 안으로 끌어올 요소
const SHOTS = [
    {
        id: 'overview',
        prepare: async page => { await page.evaluate(() => typeof closeDetailPanel === 'function' && closeDetailPanel()); await page.waitForTimeout(500); },
        markers: ['#toolbar-scroll', '#overview-lnb-list', '#diagram-viewport', '#btn-settings']
    },
    {
        id: 'settings',
        prepare: async page => { await page.evaluate(() => openSettingsPanel()); await page.waitForTimeout(500); },
        markers: ['#btn-settings', '#settings-api-key-input', '#settings-claude-key-input', '#settings-google-cx-input']
    },
    {
        id: 'models',
        prepare: async page => {
            await page.evaluate(() => {
                openSettingsPanel();
                const select = document.getElementById('settings-text-model');
                const box = select.closest('.overflow-y-auto');
                const label = select.closest('div').querySelector('label') || select;
                box.scrollTop += label.getBoundingClientRect().top - box.getBoundingClientRect().top - 12; // 모델 칸 제목이 창 위쪽에 오게
            });
            await page.waitForTimeout(500);
        },
        markers: ['#settings-text-model', '#settings-image-model', '#settings-image-amount', '#settings-higgsfield-key-input']
    },
    {
        id: 'subject',
        prepare: async page => { await page.evaluate(() => openSubjectDetail(globalState.subjects[0].id)); await page.waitForTimeout(600); },
        markers: [byText('과정 설계', '#overview-lnb-list, body'), '#overview-lnb-list [onclick^="openSubjectDetail"]', byText('이 교과 편집기 열기')]
    },
    {
        id: 'outline',
        prepare: async page => {
            await openEditor(page);
            await page.evaluate(() => { if (document.getElementById('sidebar-setup-body')?.classList.contains('hidden')) toggleSidebarSetup(); });
            await page.waitForTimeout(400);
        },
        markers: ['#sidebar-setup-toggle', '#topic-input', '#unit-count-input', '#generate-btn']
    },
    {
        id: 'cards',
        prepare: async page => {
            await openEditor(page);
            await page.evaluate(() => { if (!document.getElementById('sidebar-setup-body')?.classList.contains('hidden')) toggleSidebarSetup(); });
            await page.waitForTimeout(300);
            await page.hover('#module-list .module-card[data-id]:not([data-id="mainQuest"]) h3');
            await page.waitForTimeout(300);
        },
        markers: ['#module-list .module-card[data-id]:not([data-id="mainQuest"])', '#module-list .module-card button[aria-label^="교안"]', '#module-list .module-card button[aria-label="차시 삭제"]', '#module-list input[placeholder^="차시 검색"]']
    },
    {
        id: 'generate',
        prepare: openLesson,
        markers: ['#lesson-nav-items', '#lesson-tab-generate', byText('전체 생성', '#editor-content-area'), '#render-view']
    },
    {
        id: 'edit',
        prepare: openLesson,
        markers: ['#toggle-edit', '#reinforce-input', byText('컨벤션 검수', '#editor-content-area'), '#ai-command-input']
    },
    {
        id: 'tools',
        prepare: async page => { await openLesson(page); await page.evaluate(() => { document.getElementById('lesson-tools-menu').open = true; }); await page.waitForTimeout(300); },
        markers: [byText('일괄 이미지 찾기', '#lesson-tools-menu'), byText('섹션 고정', '#lesson-tools-menu'), byText('삽화', '#lesson-tools-menu'), byText('판서 영상', '#lesson-tools-menu')]
    },
    {
        id: 'whiteboard',
        prepare: async page => { await openLesson(page); await page.evaluate(() => openWhiteboardStudio(courseData[0].id)); await page.waitForTimeout(500); },
        markers: ['#wb-dialog-topic', '#wb-dialog-body', '#wb-dialog-reset', '#wb-dialog-ok']
    },
    {
        id: 'image-video',
        prepare: async page => {
            await openLesson(page);
            await addExampleImage(page);
            await page.evaluate(() => document.querySelector('#render-view .image-wrapper')?.scrollIntoView({ block: 'center' }));
            await page.waitForTimeout(400);
            await page.hover('#render-view .image-wrapper img');
            await page.waitForTimeout(400);
        },
        markers: ['#render-view .image-wrapper img', '#render-view [data-lesson-action="whiteboard-video"]']
    },
    {
        id: 'slides',
        prepare: async page => {
            await openLesson(page);
            await page.evaluate(() => [...document.querySelectorAll('#lesson-nav-items button, #editor-content-area button')].find(b => b.textContent.trim().startsWith('슬라이드'))?.click());
            await page.waitForTimeout(900);
        },
        markers: [byText('교수안', '#lesson-nav-items'), byText('슬라이드', '#lesson-nav-items'), '#slide-generate-btn', byText('문제은행', '#lesson-nav-items')]
    },
    {
        id: 'flow',
        prepare: async page => {
            await openEditor(page);
            await page.evaluate(() => {
                if (!document.getElementById('sidebar-setup-body')?.classList.contains('hidden')) toggleSidebarSetup();
                const body = document.querySelector('[data-sidebar-section="subject-flow"] [data-sidebar-body]');
                if (body?.classList.contains('hidden')) toggleSidebarSection('subject-flow');
            });
            await page.waitForTimeout(400);
        },
        markers: [byText('남은 차시 생성', '[data-sidebar-section="subject-flow"]'), byText('차시 구성', '[data-sidebar-section="subject-flow"]'), byText('교수안·편성안 묶음', '[data-sidebar-section="subject-flow"]'), byText('기존 내용 보강', '[data-sidebar-section="subject-flow"]')]
    },
    {
        id: 'export',
        prepare: async page => {
            await openLesson(page);
            await page.click('#export-dropdown-btn');
            await page.waitForTimeout(400);
        },
        markers: ['#export-dropdown-menu', byText('ZIP', '#toolbar-scroll'), byText('히스토리', '#toolbar-scroll'), byText('데이터 연동', 'header')]
    }
];

async function capture(browser, shot, index) {
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, locale: 'ko-KR' });
    // 가이드가 저절로 열리지 않게 하고, 예시 데이터로 시작한다
    await context.addInitScript(() => { try { localStorage.setItem('kyoan_tutorial_done_v8', 'true'); localStorage.setItem('kyoan_notice_done', 'true'); } catch (e) {} });
    const page = await context.newPage();
    page.on('pageerror', err => console.warn(`  [${shot.id}] 페이지 오류: ${err.message}`));
    await page.goto(`http://127.0.0.1:${PORT}/Teacher/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === '확인')?.click());
    if (shot.prepare) await shot.prepare(page);
    await page.waitForTimeout(300);
    const file = `${String(index + 1).padStart(2, '0')}-${shot.id}.jpg`;
    await page.screenshot({ path: path.join(OUT_DIR, file), type: 'jpeg', quality: JPEG_QUALITY });
    const markers = [];
    for (const target of shot.markers) {
        const r = await rectOf(page, target);
        if (!r) throw new Error(`[${shot.id}] 번호 붙일 요소를 못 찾음: ${JSON.stringify(target)}`);
        const pct = (v, total) => Math.round((v / total) * 1000) / 10;
        markers.push({ x: pct(Math.max(0, r.x), VIEW.width), y: pct(Math.max(0, r.y), VIEW.height), w: pct(Math.min(r.w, VIEW.width - r.x), VIEW.width), h: pct(Math.min(r.h, VIEW.height - r.y), VIEW.height) });
    }
    await context.close();
    const kb = Math.round(fs.statSync(path.join(OUT_DIR, file)).size / 1024);
    console.log(`  ${file} (${kb}KB) 번호 ${markers.length}개`);
    return { id: shot.id, src: `./guide/${file}`, markers };
}

(async () => {
    const playwright = require(process.env.PLAYWRIGHT || 'playwright');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const server = serve();
    // Playwright용 Chromium이 없으면 PC에 설치된 Chrome·Edge를 쓴다
    const browser = await playwright.chromium.launch()
        .catch(() => playwright.chromium.launch({ channel: 'chrome' }))
        .catch(() => playwright.chromium.launch({ channel: 'msedge' }));
    const only = process.argv[2];
    try {
        const existing = fs.existsSync(MANIFEST) ? (() => { const m = {}; vm(fs.readFileSync(MANIFEST, 'utf8'), m); return m.shots || {}; })() : {};
        const shots = { ...existing };
        for (const [index, shot] of SHOTS.entries()) {
            if (only && shot.id !== only) continue;
            shots[shot.id] = await capture(browser, shot, index);
        }
        const body = `// guide-shots.js - scripts/capture-guide.js가 만든 파일. 직접 고치지 말고 스크립트를 다시 돌린다\n// 사용 가이드 캡처(guide/*.jpg)와 번호 위치(화면 대비 %: x·y는 왼쪽 위, w·h는 크기)\nconst GUIDE_SHOTS = ${JSON.stringify(shots, null, 2)};\n`;
        fs.writeFileSync(MANIFEST, body);
        console.log(`완료: ${Object.keys(shots).length}장 → ${path.relative(ROOT, MANIFEST)}`);
    } finally {
        await browser.close();
        server.close();
    }
})().catch(err => { console.error(err); process.exit(1); });

// 이전 결과를 읽어 한 장만 다시 찍을 때 나머지를 유지한다
function vm(source, target) {
    target.shots = require('vm').runInNewContext(`${source}\nGUIDE_SHOTS`);
}
