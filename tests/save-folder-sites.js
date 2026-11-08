// 기본 저장 폴더 자리 15곳을 실제 함수로 돌리는 틀 (tests/save-folder.test.js S17이 쓴다. 이 파일만으로는 돌지 않는다)
// 자리마다 그 함수가 든 파일(또는 그 함수만 떼어 낸 소스)과 기대는 것을 vm에 싣고 세 갈래로 저장해 본다
//  folder:   save-folder.js를 싣고 가짜 폴더를 골라 둔다. 새 창처럼 쓰기 권한은 'prompt'이고, ZIP·HTML을 다 만든 뒤에는
//            (누른 지 5초가 지난 것처럼) 브라우저가 권한 창을 띄우지 못한다(SecurityError)
//  download: save-folder.js는 있지만 폴더를 고르지 않았다(브라우저 다운로드)
//  old:      save-folder.js가 없다(예전 a.download·saveAs)
// 받은 파일은 { via: 'folder' | 'download' | 'saveAs', name, bytes }로 돌려준다. 실제 파일은 쓰지 않는다
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const scripts = new Map(); // 파일 → vm.Script(자리·갈래마다 다시 읽고 컴파일하지 않게)
const script = file => {
    if (!scripts.has(file)) scripts.set(file, new vm.Script(fs.readFileSync(path.join(root, 'js', file), 'utf8'), { filename: file }));
    return scripts.get(file);
};
const text = file => fs.readFileSync(path.join(root, 'js', file), 'utf8').replace(/\r\n/g, '\n');

// file에서 head로 시작하는 선언 하나를 tail까지 떼어 낸다(함수는 '\n}\n', window.이름 = function은 '\n};\n', 한 줄 상수는 ';\n')
function piece(file, head, tail = '\n}\n') {
    const source = text(file);
    const start = source.indexOf(head);
    const end = start < 0 ? -1 : source.indexOf(tail, start);
    if (end < 0) throw new Error(`${file}에서 ${head}를 찾지 못했습니다`);
    return source.slice(start, end + tail.length);
}

const NOW = new Date(2026, 10, 8, 10, 30).getTime(); // backupStamp() → 20261108-1030
class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
}

const ZIP_TEXT = 'PK-zip';
const JPG_BASE64 = '/9j/4AAQSkZJRg==';
const PNG_BASE64 = 'iVBORw0KGgo=';
const MD_EXPORT = '<!-- teacher-lesson: title=%EB%B3%80%EC%88%98 -->\n# 변수';
const utf8 = value => Buffer.from(value, 'utf8');
const fsError = (name, message = name) => Object.assign(new Error(message), { name });

// 고른 폴더(이름 '수업자료'). activation.alive가 거짓이면 권한을 묻지 못한다
function pickedFolder(activation) {
    const files = new Map(); // 이름 → 쓴 Blob(만들기만 했으면 null)
    const dir = {
        kind: 'directory', name: '수업자료', files, permission: 'prompt', requests: 0,
        async queryPermission() { return dir.permission; },
        async requestPermission() {
            dir.requests += 1;
            if (!activation.alive) throw fsError('SecurityError', 'User activation is required to request permissions.');
            dir.permission = 'granted';
            return dir.permission;
        },
        async getFileHandle(child, opts = {}) {
            if (!files.has(child)) {
                if (!opts.create) throw fsError('NotFoundError');
                files.set(child, null);
            }
            const handle = {
                kind: 'file', name: child,
                async createWritable() {
                    let next = null;
                    return { async write(content) { next = content; }, async close() { files.set(handle.name, next); }, async abort() {} };
                },
                async move(newName) {
                    files.set(newName, files.get(handle.name));
                    files.delete(handle.name);
                    handle.name = newName;
                }
            };
            return handle;
        },
        async removeEntry(child) { files.delete(child); },
        async move() {} // 옮기기(FileSystemHandle.move)를 지원하는 브라우저
    };
    return dir;
}

// 그림이 많은 교과처럼 다 만드는 데 오래 걸리는 ZIP. 다 만들면 누른 지 오래 지났다
function fakeZipClass(activation) {
    return class FakeZip {
        constructor() { this.files = {}; }
        file(name, data) { this.files[name] = data; return this; }
        folder(name) { return { file: (child, data) => this.file(`${name}/${child}`, data), folder: child => this.folder(`${name}/${child}`) }; }
        async generateAsync() {
            activation.alive = false;
            return new Blob([ZIP_TEXT], { type: 'application/zip' });
        }
    };
}

// 교과 '🐍 파이썬'(그림 글자로 시작한다)의 차시 하나
function lessonData() {
    const lesson = { id: 1, title: '변수', content: '# 변수', tabContents: { basicLearn: '# 변수' }, images: {} };
    return { lesson, subject: { id: 's1', title: '🐍 파이썬', lessons: [lesson] } };
}
const COURSE_TITLE = '게임 기획';

// ui.js·data-safety.js·lesson-export.js 문맥: 과정은 전역 객체에 둔다
function useLesson(ctx) {
    const { lesson, subject } = lessonData();
    Object.assign(ctx, { globalState: { courseTitle: COURSE_TITLE, subjects: [subject] }, currentSubjectId: 's1', courseData: subject.lessons, contentHistory: [] });
    return lesson;
}
// state.js는 과정을 let으로 두어 그 안에서 바꾼다
function useStateLesson(exec) {
    const { subject } = lessonData();
    exec(`globalState = sanitizeState(${JSON.stringify({ courseTitle: COURSE_TITLE, subjects: [subject] })}); currentSubjectId = 's1';
        courseData = globalState.subjects[0].lessons; contentHistory = []; currentEditingModuleId = 1;`);
}
function zipStubs(ctx, activation) {
    Object.assign(ctx, {
        JSZip: fakeZipClass(activation), lessonGyosuanFiles: () => [], zipImageParts: () => ({ ext: 'png', data: '' }),
        lessonHtmlForZip: async () => '<html>교안</html>'
    });
}
const mdStubs = ctx => Object.assign(ctx, { lessonTabSources: () => [{ id: 'basicLearn', label: '기본학습', md: '# 변수' }], lessonMarkdownExport: () => MD_EXPORT });

const IMAGE_DECODER = () => [piece('import-stream.js', 'const STREAM_DECODE_STEP', ';\n'), piece('import-stream.js', 'function dataUrlBlob(')];
const SAFE_FILE_NAME = () => piece('filename-convention.js', 'const safeFileName = ', ';\n');
const UI_FILES = ['data-safety.js', 'filename-convention.js', 'ui.js'];
const STATE_FILES = ['filename-convention.js', 'data-safety.js', 'state.js'];

// id: 자리, files: 통째로 싣는 파일, code: 떼어 싣는 소스, setup(ctx, exec, activation, folder): 기대는 것, run: 누른다, name·bytes: 받아야 할 파일 이름과 내용,
// old: 예전 길('download' a.download | 'saveAs'), long: 다 만드는 데 오래 걸린다, bom: CSV의 BOM, toast: 다운로드했다고 알리는 그 자리의 알림
const SITES = [
    {
        id: 'api.js downloadLessonJpgs', code: () => [...IMAGE_DECODER(), piece('api.js', 'function downloadLessonJpgs(')],
        run: ctx => ctx.downloadLessonJpgs({ title: '변수: 기초', images: { img_1: `data:image/jpeg;base64,${JPG_BASE64}` } }, ['img_1']),
        name: '변수__기초_img_1.jpg', bytes: Buffer.from(JPG_BASE64, 'base64'), old: 'download', toast: /이미지 다운로드 시작/
    },
    {
        id: 'course-design.js downloadCourseDesignMd', code: () => [piece('course-design.js', 'window.downloadCourseDesignMd = function', '\n};\n')],
        setup: ctx => Object.assign(ctx, { globalState: { courseTitle: '게임 기획 과정', subjects: [] }, courseDesignMd: () => '# 과정 설계서 - 게임 기획 과정' }),
        run: ctx => ctx.downloadCourseDesignMd(),
        name: '게임_기획_과정_과정설계서.md', bytes: utf8('# 과정 설계서 - 게임 기획 과정'), old: 'download'
    },
    {
        id: 'course-illustrations.js saveIllustrationPng',
        code: () => [...IMAGE_DECODER(), piece('course-illustrations.js', 'function illustrationFileName('), piece('course-illustrations.js', 'async function saveIllustrationPng(')],
        setup: ctx => { ctx.illustrationPng = async () => `data:image/png;base64,${PNG_BASE64}`; },
        run: ctx => ctx.saveIllustrationPng({ title: '마을 풍경' }),
        name: '마을_풍경.png', bytes: Buffer.from(PNG_BASE64, 'base64'), old: 'download'
    },
    {
        id: 'course-qbank.js downloadCsv', code: () => [SAFE_FILE_NAME(), piece('course-qbank.js', 'function downloadCsv(')],
        run: ctx => ctx.downloadCsv('﻿번호,문항\r\n1,변수란?', '파이썬: 기초'),
        name: '파이썬_ 기초_문제은행.csv', bytes: utf8('﻿번호,문항\r\n1,변수란?'), old: 'download', bom: true
    },
    {
        id: 'course-sessions.js downloadMd', code: () => [SAFE_FILE_NAME(), piece('course-sessions.js', 'function downloadMd(')],
        run: ctx => ctx.downloadMd('# 교수안', '01차시_교수안?'),
        name: '01차시_교수안_.md', bytes: utf8('# 교수안'), old: 'download'
    },
    {
        id: 'lesson-export.js downloadTextFile(차시 HTML)', files: ['filename-convention.js', 'lesson-export.js'], long: true,
        setup: (ctx, exec, activation) => {
            useLesson(ctx);
            Object.assign(ctx, { LESSON_TABS: [{ id: 'basicLearn', label: '기본학습' }], lessonSourceScript: () => '<script>원본</script>', lessonSourcePayload: () => ({}) });
            ctx.lessonExportBody = async () => { // 그림이 많은 차시를 그리는 데 오래 걸린다
                activation.alive = false;
                return { tabs: 1, html: '<h1>변수</h1>', videos: 0 };
            };
        },
        run: ctx => ctx.exportLessonDocument(ctx.courseData[0], 'html', null),
        name: '파이썬_01차시_변수.html', bytes: ctx => utf8(ctx.lessonHtmlDocument('변수', '<h1>변수</h1>', '', '<script>원본</script>')), old: 'download'
    },
    {
        id: 'ui.js exportCurrentToMD', files: UI_FILES,
        setup: ctx => {
            const lesson = useLesson(ctx);
            mdStubs(ctx);
            ctx.getEditingModule = () => lesson;
        },
        run: ctx => ctx.exportCurrentToMD(),
        name: '파이썬_01차시_변수.md', bytes: utf8(MD_EXPORT), old: 'download'
    },
    {
        id: 'ui.js exportSubjectToMD', files: UI_FILES,
        setup: ctx => { useLesson(ctx); mdStubs(ctx); },
        run: ctx => ctx.exportSubjectToMD(),
        name: '파이썬_01차시_변수.md', bytes: utf8(MD_EXPORT), old: 'download', toast: /차시 MD 파일 다운로드/
    },
    {
        id: 'ui.js exportSelectedToZip', files: UI_FILES, long: true,
        setup: (ctx, exec, activation) => { useLesson(ctx); zipStubs(ctx, activation); },
        run: ctx => ctx.exportSelectedToZip(),
        name: '파이썬_교안.zip', bytes: utf8(ZIP_TEXT), old: 'saveAs', toast: /ZIP으로 다운로드되었습니다/
    },
    {
        id: 'ui.js exportAllToZip', files: UI_FILES, long: true,
        setup: (ctx, exec, activation) => { useLesson(ctx); zipStubs(ctx, activation); },
        run: ctx => ctx.exportAllToZip(),
        name: '파이썬_전체교안.zip', bytes: utf8(ZIP_TEXT), old: 'saveAs', toast: /ZIP으로 다운로드되었습니다/
    },
    {
        id: 'state.js downloadFile', files: STATE_FILES,
        run: ctx => ctx.downloadFile('과정 요약', '과정_요약.md', 'text/markdown'),
        name: '과정_요약.md', bytes: utf8('과정 요약'), old: 'download'
    },
    {
        id: 'state.js downloadRecordFile', files: STATE_FILES,
        run: ctx => ctx.downloadRecordFile({ 교과: ['변수'] }, '교안_읽지못한저장본_20261108-1030'),
        name: '교안_읽지못한저장본_20261108-1030.json', bytes: utf8(JSON.stringify({ 교과: ['변수'] })), old: 'download'
    },
    {
        id: 'state.js exportCurrentModule', files: STATE_FILES, long: true,
        setup: (ctx, exec, activation) => { zipStubs(ctx, activation); useStateLesson(exec); },
        run: ctx => ctx.exportCurrentModule(),
        name: `${COURSE_TITLE}_파이썬_01차시_변수.zip`, bytes: utf8(ZIP_TEXT), old: 'saveAs'
    },
    {
        id: 'state.js exportAllModules', files: STATE_FILES, long: true,
        setup: (ctx, exec, activation) => { zipStubs(ctx, activation); useStateLesson(exec); },
        run: ctx => ctx.exportAllModules(),
        name: `${COURSE_TITLE}_과정전체백업_20261108-1030.zip`, bytes: utf8(ZIP_TEXT), old: 'saveAs'
    },
    {
        id: 'data-safety.js downloadSafetyBackup(safetyBackupOrAsk)', files: ['data-safety.js'], long: true,
        setup: (ctx, exec, activation) => { useLesson(ctx); ctx.JSZip = fakeZipClass(activation); },
        run: async ctx => {
            if (!(await ctx.safetyBackupOrAsk('불러오기전'))) throw new Error('안전 백업을 받지 못했습니다');
        },
        name: '교안백업_20261108-1030_불러오기전.zip', bytes: utf8(ZIP_TEXT), old: 'saveAs'
    }
];

function makeContext() {
    const store = new Map();
    const seen = { anchors: [], urls: [], saveAs: [], toasts: [], alerts: [] };
    const ctx = {
        console: { log() {}, info() {}, warn() {}, error() {} },
        JSON, Map, Set, Promise, Symbol, Blob, Uint8Array, atob, btoa, Date: FakeDate,
        setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 1)), clearTimeout, // 다운로드 사이를 띄우는 시간은 줄인다
        localStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
        addEventListener() {}, location: { hash: '#editor/s1', href: 'http://localhost/' },
        URL: {
            createObjectURL: blob => {
                seen.urls.push(blob);
                return `blob:${seen.urls.length}`;
            },
            revokeObjectURL() {}
        },
        document: {
            addEventListener() {}, getElementById: () => null, querySelector: () => null, visibilityState: 'visible',
            querySelectorAll: selector => (selector.includes(':checked') ? [{ dataset: { subjId: 's1' } }] : []),
            createElement: () => {
                const el = { href: '', download: '', style: {}, setAttribute() {}, remove() {}, click() { seen.anchors.push({ name: el.download, href: el.href }); } };
                return el;
            },
            body: { appendChild() {} }, activeElement: null
        },
        saveAs: (blob, name) => seen.saveAs.push({ name, blob }),
        STORAGE_KEY: 'test-state', INITIAL_MOCK_STATE: { subjects: [] }, escapeHtml: value => String(value), toggleFolderDropdown() {}, renderSidebar() {},
        seen
    };
    ctx.window = ctx;
    return ctx;
}

// 맡긴 저장·띄운 다운로드가 끝날 때까지 기다린다
async function settle() {
    for (let i = 0; i < 20; i += 1) {
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setTimeout(resolve, 1));
    }
}

const bytesOf = async blob => Buffer.from(await (blob instanceof Blob ? blob : new Blob([blob])).arrayBuffer());

// 받은 파일들: 폴더에 쓴 것, a.download(Blob 주소면 그 Blob, 그림 주소면 푼 바이트), saveAs
async function received(ctx, folder) {
    const files = [];
    for (const [name, blob] of folder?.files || []) files.push({ via: 'folder', name, bytes: blob ? await bytesOf(blob) : Buffer.alloc(0) });
    for (const { name, href } of ctx.seen.anchors) {
        const bytes = href.startsWith('blob:') ? await bytesOf(ctx.seen.urls[Number(href.slice(5)) - 1]) : Buffer.from(href.slice(href.indexOf(',') + 1), 'base64');
        files.push({ via: 'download', name, bytes });
    }
    for (const { name, blob } of ctx.seen.saveAs) files.push({ via: 'saveAs', name, bytes: await bytesOf(blob) });
    return files;
}

// 자리 하나를 한 갈래로 돌린다. { ctx, folder, files, bytes(받아야 할 내용) }
async function runSite(site, mode) {
    const activation = { alive: true }; // 방금 눌렀다
    const folder = mode === 'folder' ? pickedFolder(activation) : null;
    const ctx = makeContext();
    vm.createContext(ctx);
    const exec = code => vm.runInContext(code, ctx);
    (site.files || []).forEach(file => script(file).runInContext(ctx));
    (site.code?.() || []).forEach((code, index) => vm.runInContext(code, ctx, { filename: `${site.id}#${index}` }));
    if (mode !== 'old') {
        ctx.showDirectoryPicker = async () => null; // 폴더 고르기 창이 있는 브라우저(Chrome·Edge)
        script('save-folder.js').runInContext(ctx);
    }
    ctx.showToast = (message, type) => ctx.seen.toasts.push([message, type]);
    ctx.showAlert = message => ctx.seen.alerts.push(message);
    site.setup?.(ctx, exec, activation, folder);
    if (mode !== 'old') ctx.useSaveFolder(folder);
    await site.run(ctx, exec);
    await settle();
    return { ctx, folder, files: await received(ctx, folder), bytes: typeof site.bytes === 'function' ? site.bytes(ctx) : site.bytes };
}

module.exports = { SITES, runSite };
