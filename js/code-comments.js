// code-comments.js - 교안 코드 블록(펜스 코드)에 주석이 넉넉한지 세고, AI가 주석만 더했는지 확인해 끼워 넣는다
// 블록은 화면(marked)이 코드 블록으로 그리는 ``` · ~~~ 펜스로 찾는다(api.js pictureFenceAfter와 같다). data.js를 먼저 불러야 한다(## 섹션 제목은 data.js fenceStateAfter로 가린다).
// ~~~ 블록은 앱의 다른 글 정리(data.js stashCodeFences·컨벤션 점검·낭독 분량)가 코드로 보지 않아 주석을 넣으면 그쪽이 글로 읽으므로, 주석을 넣지 않고 정보로 알린다.
// 언어마다 작은 lexer로 문자열·주석·히어독·블록 글을 줄을 넘어 따라가, 주석을 넣으면 코드의 뜻이 바뀌는 자리(보호 구역)를 막는다.
// AI 답은 원래 줄을 바이트 그대로 두고, 허용된 자리의 한 줄 주석과 줄 끝 주석만 받아 다시 짠다. 테스트: tests/code-comments.test.js
// 확실히 읽지 못하는 곳은 막는 쪽으로 읽는다: 미심쩍은 자리에서 연 JSX는 그 안 { } 까지, 줄 끝에서 닫히지 않은 한 줄 문자열은 다음 줄 위까지 막는다.
// 한계: lexer가 모르는 문법(이 표에 없는 문자열 꼴 따위)에서는 주석이 문자열 안에 들어갈 수 있다. 넣은 뒤 다시 훑는 확인도 같은 lexer라 이런 경우는 잡지 못한다.

const CODE_COMMENT_LINES_PER = 10;       // 코드 이만큼마다 주석 하나 이상
const CODE_COMMENT_MAX_CHARS = 300;      // 주석 하나의 최대 글자 수
const CODE_COMMENT_CONTEXT_CHARS = 400;  // AI 지시에 붙이는 앞 설명 글 길이
const CODE_COMMENT_BATCH_BLOCKS = 8;     // 한 번에 보내는 블록 수
const CODE_COMMENT_BATCH_CHARS = 12000;  // 한 번에 보내는 코드 글자 수
const CODE_COMMENT_ZONE_NOTES = 8;       // 블록마다 알려 주는 '넣으면 안 되는 자리' 수
const CODE_COMMENT_LINT_MSG = '코드 블록에 주석을 넣습니다.';
const CODE_COMMENT_UNKNOWN_MSG = '이름표를 몰라 주석을 확인하지 못한 코드 블록입니다.';
const CODE_COMMENT_TILDE_MSG = '~~~ 펜스로 쓴 코드 블록이라 주석을 확인하지 못했습니다. 펜스를 ```로 바꾸면 확인하고 주석을 넣습니다.';
const CODE_COMMENT_RULE_DESC = '코드 첫 줄 위에 무엇을 하는 코드인지, 핵심 줄 위나 끝에 그 줄이 하는 일을 적습니다. 코드 열 줄마다 주석을 하나 이상 둡니다.';
// 코드가 아니어서 검사하지 않는 이름표(실행 결과·다이어그램·데이터·문서)
const CODE_COMMENT_SKIP_LABELS = new Set(['text', 'txt', 'plaintext', 'plain', 'output', 'result', 'console', 'terminal', 'log', 'mermaid', 'json', 'csv', 'tsv', 'diff', 'patch', 'markdown', 'md']);
// 주석을 넣으면 안 되는 까닭(지시와 확인 실패 문구에 쓴다)
const CODE_COMMENT_WHY = {
    string: '여러 줄 문자열 안', comment: '여러 줄 블록 주석 안', heredoc: '히어독 안', block: 'YAML 블록 글(| 또는 >) 안',
    cont: '줄 이어짐 기호 다음', jsx: 'JSX 안', html: 'PHP 코드 밖(HTML 부분)', markup: '태그 안이나 script·style·pre 안',
    verbatim: 'verbatim 안', define: 'define 안', data: '__END__ 뒤 데이터', shebang: '첫 줄(#!) 위', directive: '맨 앞 지시 줄',
    noeol: '이 언어는 줄 끝 주석을 쓰지 않음', text: '요소의 글자(값) 사이'
};

/* ---------- 1. 언어 표 ---------- */
// 주석 문법 묶음. line: 셀 때 보는 줄 주석 기호, block: 블록 주석, add: 새로 넣을 줄 주석 기호, addBlock: 새로 넣을 한 줄 블록 주석
const CC_HASH = { line: ['#'], add: ['#'], eol: true };
const CC_SLASH = { line: ['//'], block: ['/*', '*/'], add: ['//'], addBlock: ['/*', '*/'], eol: true };
const CC_DASH = { line: ['--'], add: ['--'], eol: true };
const CC_TAGS = { line: [], block: ['<!--', '-->'], add: [], addBlock: ['<!--', '-->'], eol: true, lex: 'markup' };
const CC_SEMI = { line: [';'], add: [';'], eol: true };
const CC_PCT = { line: ['%'], add: ['%'], eol: true };
const CC_TICK = { line: ["'"], add: ["'"], eol: true, lex: 'vb' };

// 언어 키: { name: 지시에 쓰는 이름, alias: 별칭, lex: 문자열·특수 문법 묶음(CC_KITS), eol: 줄 끝 주석을 쓸 수 있는지,
//   ts: TypeScript(< 가 제네릭·형 단언일 수 있다), xmlText: 요소 글자가 값이라 글자 사이에 주석을 넣지 않는다 }
const CODE_COMMENT_LANGS = {
    python: { name: 'Python', alias: ['py', 'python3', 'py3'], ...CC_HASH, lex: 'py' },
    bash: { name: 'Bash', alias: ['sh', 'shell', 'zsh', 'ksh'], ...CC_HASH, lex: 'sh' },
    powershell: { name: 'PowerShell', alias: ['ps1', 'pwsh'], ...CC_HASH, lex: 'ps' },
    ruby: { name: 'Ruby', alias: ['rb'], ...CC_HASH, lex: 'rb' },
    perl: { name: 'Perl', alias: ['pl'], ...CC_HASH, lex: 'pl' },
    r: { name: 'R', alias: [], ...CC_HASH, lex: 'r' },
    yaml: { name: 'YAML', alias: ['yml'], ...CC_HASH, lex: 'yaml' },
    toml: { name: 'TOML', alias: [], ...CC_HASH, lex: 'toml' },
    dockerfile: { name: 'Dockerfile', alias: ['docker'], ...CC_HASH, eol: false, lex: 'docker' },
    makefile: { name: 'Makefile', alias: ['make', 'mk'], ...CC_HASH, eol: false, lex: 'make' },
    gdscript: { name: 'GDScript', alias: ['gd'], ...CC_HASH, lex: 'py' },
    elixir: { name: 'Elixir', alias: ['ex', 'exs'], ...CC_HASH, lex: 'ex' },
    julia: { name: 'Julia', alias: ['jl'], ...CC_HASH, block: ['#=', '=#'], lex: 'jl' },
    graphql: { name: 'GraphQL', alias: ['gql'], ...CC_HASH, lex: 'gql' },
    javascript: { name: 'JavaScript', alias: ['js', 'mjs', 'cjs', 'jsx', 'node', 'nodejs'], ...CC_SLASH, lex: 'js' },
    typescript: { name: 'TypeScript', alias: ['ts', 'tsx', 'mts', 'cts'], ...CC_SLASH, lex: 'js', ts: true },
    java: { name: 'Java', alias: [], ...CC_SLASH, lex: 'java' },
    c: { name: 'C', alias: [], ...CC_SLASH, lex: 'c' },
    cpp: { name: 'C++', alias: ['c++', 'cc', 'cxx', 'hpp', 'h', 'arduino', 'ino'], ...CC_SLASH, lex: 'cpp' },
    csharp: { name: 'C#', alias: ['cs', 'c#', 'c-sharp'], ...CC_SLASH, add: ['//', '///'], lex: 'cs' },
    go: { name: 'Go', alias: ['golang'], ...CC_SLASH, lex: 'go' },
    rust: { name: 'Rust', alias: ['rs'], ...CC_SLASH, lex: 'rust' },
    swift: { name: 'Swift', alias: [], ...CC_SLASH, lex: 'swift' },
    kotlin: { name: 'Kotlin', alias: ['kt', 'kts'], ...CC_SLASH, lex: 'kotlin' },
    scala: { name: 'Scala', alias: [], ...CC_SLASH, lex: 'scala' },
    dart: { name: 'Dart', alias: [], ...CC_SLASH, lex: 'dart' },
    php: { name: 'PHP', alias: [], ...CC_SLASH, line: ['//', '#'], add: ['//', '#'], lex: 'php' },
    groovy: { name: 'Groovy', alias: ['gradle'], ...CC_SLASH, lex: 'groovy' },
    glsl: { name: 'GLSL', alias: ['gdshader'], ...CC_SLASH, lex: 'c' },
    hlsl: { name: 'HLSL', alias: ['cg'], ...CC_SLASH, lex: 'c' },
    shader: { name: 'ShaderLab', alias: ['shaderlab'], ...CC_SLASH, lex: 'c' },
    objectivec: { name: 'Objective-C', alias: ['objc', 'objective-c', 'obj-c'], ...CC_SLASH, lex: 'c' },
    solidity: { name: 'Solidity', alias: ['sol'], ...CC_SLASH, lex: 'clike' },
    protobuf: { name: 'Protocol Buffers', alias: ['proto'], ...CC_SLASH, lex: 'clike' },
    wgsl: { name: 'WGSL', alias: [], ...CC_SLASH, lex: 'clike' },
    gml: { name: 'GML', alias: [], ...CC_SLASH, lex: 'clike' },
    scss: { name: 'SCSS', alias: ['sass'], ...CC_SLASH, lex: 'scss' },
    less: { name: 'Less', alias: [], ...CC_SLASH, lex: 'scss' },
    jsonc: { name: 'JSONC', alias: [], ...CC_SLASH, lex: 'clike' },
    json5: { name: 'JSON5', alias: [], ...CC_SLASH, lex: 'clike' },
    css: { name: 'CSS', alias: [], line: [], block: ['/*', '*/'], add: [], addBlock: ['/*', '*/'], eol: true, lex: 'css' },
    sql: { name: 'SQL', alias: ['mysql', 'postgresql', 'postgres', 'sqlite', 'tsql', 'plsql', 'mssql', 'mariadb'], ...CC_DASH, block: ['/*', '*/'], addBlock: ['/*', '*/'], lex: 'sql' },
    lua: { name: 'Lua', alias: [], ...CC_DASH, lex: 'lua' },
    mlua: { name: 'mLua', alias: [], ...CC_DASH, lex: 'lua' },
    luau: { name: 'Luau', alias: [], ...CC_DASH, lex: 'luau' },
    haskell: { name: 'Haskell', alias: ['hs'], ...CC_DASH, block: ['{-', '-}'], lex: 'hs' },
    ada: { name: 'Ada', alias: [], ...CC_DASH, lex: 'ada' },
    vhdl: { name: 'VHDL', alias: [], ...CC_DASH, block: ['/*', '*/'], lex: 'vhdl' },
    html: { name: 'HTML', alias: ['htm', 'xhtml'], ...CC_TAGS },
    xml: { name: 'XML', alias: [], ...CC_TAGS, xmlText: true },
    svg: { name: 'SVG', alias: [], ...CC_TAGS, xmlText: true },
    xaml: { name: 'XAML', alias: [], ...CC_TAGS, xmlText: true },
    vue: { name: 'Vue', alias: [], ...CC_TAGS },
    ini: { name: 'INI', alias: [], line: [';', '#'], add: [';', '#'], eol: false, lex: 'ini' },
    asm: { name: 'Assembly', alias: [], ...CC_SEMI, lex: 'asm' },
    nasm: { name: 'NASM', alias: [], ...CC_SEMI, lex: 'asm' },
    lisp: { name: 'Lisp', alias: ['elisp', 'emacs-lisp', 'common-lisp'], ...CC_SEMI, block: ['#|', '|#'], lex: 'lisp' },
    clojure: { name: 'Clojure', alias: ['clj', 'cljs'], ...CC_SEMI, lex: 'clj' },
    scheme: { name: 'Scheme', alias: ['racket', 'rkt'], ...CC_SEMI, block: ['#|', '|#'], lex: 'lisp' },
    autohotkey: { name: 'AutoHotkey', alias: ['ahk'], ...CC_SEMI, lex: 'ahk' },
    matlab: { name: 'MATLAB', alias: ['octave'], ...CC_PCT, lex: 'matlab' },
    latex: { name: 'LaTeX', alias: ['tex'], ...CC_PCT, lex: 'tex' },
    erlang: { name: 'Erlang', alias: ['erl'], ...CC_PCT, lex: 'erl' },
    prolog: { name: 'Prolog', alias: [], ...CC_PCT, block: ['/*', '*/'], lex: 'prolog' },
    vb: { name: 'Visual Basic', alias: [], ...CC_TICK },
    vbnet: { name: 'VB.NET', alias: ['vb.net'], ...CC_TICK },
    vba: { name: 'VBA', alias: [], ...CC_TICK },
    vbscript: { name: 'VBScript', alias: ['vbs'], ...CC_TICK },
    batch: { name: 'Batch', alias: ['bat', 'cmd'], line: ['REM', '::'], add: ['REM', '::'], eol: false, lex: 'bat' }
};

// 이름표(소문자) → 언어 키. Map이라 constructor 같은 기본 속성 이름에 걸리지 않는다
const CC_ALIAS = new Map(Object.entries(CODE_COMMENT_LANGS).flatMap(([key, spec]) => [[key, key], ...spec.alias.map(alias => [alias, key])]));

// 펜스 뒤 글의 이름표(첫 낱말, 쓴 그대로). {.python} 꼴과 language- 앞붙이, js{1,3}의 뒤 속성을 받아 준다
function codeCommentLabel(info) {
    const text = String(info ?? '').trim();
    const braced = text.match(/^\{\s*\.?([^\s{}.,]+)/);
    const word = braced ? braced[1] : (text.match(/^[^\s{]+/) || [''])[0];
    return word.replace(/^language-/i, '');
}

// 파일 이름 꼴 이름표(main.py · Player.cs)의 확장자. 점이 없으면 ''
const ccExt = label => (label.includes('.') ? label.slice(label.lastIndexOf('.') + 1) : '');
// 코드가 아니어서 검사하지 않는 이름표인지(output.txt · package.json 같은 파일 이름도 확장자로 본다)
const ccSkips = label => CODE_COMMENT_SKIP_LABELS.has(label) || CODE_COMMENT_SKIP_LABELS.has(ccExt(label));

// 펜스 이름표 → 언어 키(대소문자 무시). 코드가 아니거나 모르는 이름표, 이름표가 없으면 null
function codeCommentLang(info) {
    const label = codeCommentLabel(info).toLowerCase();
    if (!label || ccSkips(label)) return null;
    // python:main.py 꼴은 앞 낱말로, main.py 꼴은 확장자로 찾는다
    return CC_ALIAS.get(label) || CC_ALIAS.get(label.split(/[:,]/)[0]) || CC_ALIAS.get(ccExt(label)) || null;
}

// 언어 키 또는 이름표(py · cs · c# · tsx · mysql…) → 언어 키. 모르면 ''. constructor 같은 기본 속성 이름에 걸리지 않는다
function ccKey(lang) {
    const text = String(lang ?? '');
    return Object.prototype.hasOwnProperty.call(CODE_COMMENT_LANGS, text) ? text : codeCommentLang(text) || '';
}

// { key: 언어 키, dialect: 갈래 }. 이름표로 받았고 갈래를 따로 주지 않았으면 그 이름표를 갈래로 쓴다(mysql → sql의 mysql 갈래, tsx)
function ccResolve(lang, dialect = '') {
    const key = ccKey(lang);
    const label = codeCommentLabel(lang).toLowerCase();
    return { key, dialect: String(dialect || (key && label !== key ? label : '')).toLowerCase() };
}

// 지시에 쓰는 주석 기호(예: '#', '// 또는 /* */'). 언어 자리에 이름표도 받는다
function codeCommentMarks(lang) {
    const spec = CODE_COMMENT_LANGS[ccKey(lang)];
    if (!spec) return '';
    return [...spec.add, ...(spec.addBlock ? [spec.addBlock.join(' ')] : [])].join(' 또는 ');
}

const codeCommentNeed = codeLines => (codeLines > 0 ? Math.max(1, Math.floor(codeLines / CODE_COMMENT_LINES_PER)) : 0);

/* ---------- 2. 블록 찾기 ---------- */
// 펜스 줄 따라가기: ``` 와 ~~~ (3개 이상, 들여쓰기 허용). 여는 글자와 같은 글자로 같거나 더 길게 닫는다(api.js pictureFenceAfter와 같은 규칙).
// 언어 칸에 `가 든 ``` 줄(```npm install```)은 인라인 코드다(data.js fenceStateAfter와 같다). 펜스 밖이면 null
function ccFenceAfter(fence, line) {
    const [, marks, rest] = String(line).match(/^\s*(`{3,}|~{3,})(.*?)\r?$/) || [];
    if (!marks) return fence;
    if (!fence) return marks[0] === '`' && rest.includes('`') ? null : { mark: marks[0], size: marks.length };
    return marks[0] === fence.mark && marks.length >= fence.size && !rest.trim() ? null : fence;
}

// 문서의 펜스 코드 블록을 차례로. 줄 번호는 '\n'으로 나눈 문서 줄(0부터)이고, lines는 펜스 들여쓰기와 줄 끝 \r을 뗀 코드 줄이다.
// raw는 문서에 적힌 그대로의 코드 줄(되돌릴 때 쓴다). skip: '' 검사함 · nolabel · nocode(text·mermaid…) · unknown · unclosed · tilde(~~~ 블록)
// section은 블록을 연 자리의 ## 섹션 제목이다. 제목은 앱의 섹션 규칙(lesson-editor-tools.js mdSections, ``` 만 따라간다)과 같게 가려, 고정 섹션을 같은 곳으로 본다
function codeCommentBlocks(md) {
    const blocks = [];
    let fence = null;
    let plain = 0;
    let open = null;
    let section = '';
    let heading = '';
    let prose = [];
    String(md ?? '').split('\n').forEach((line, no) => {
        const was = fence;
        const wasPlain = plain;
        fence = ccFenceAfter(fence, line);
        plain = fenceStateAfter(plain, line);
        const body = line.replace(/\r$/, '');
        const sectionTitle = !wasPlain && !plain && body.match(/^##\s+(.*)/);
        if (sectionTitle) section = sectionTitle[1].trim();
        if (!was && fence) {
            open = { no, line, code: [], section };
            return;
        }
        if (was && !fence) {
            blocks.push(ccBlock(blocks.length, open, no, ccContext(heading, prose)));
            open = null;
            prose = [];
            return;
        }
        if (was) {
            open.code.push(line);
            return;
        }
        // 펜스 밖 글: 앞 설명(가까운 제목과 단락)을 따라간다
        if (/^#{1,6}\s/.test(body)) {
            heading = body.trim();
            prose = [];
        } else if (body.trim()) {
            prose = [...prose, body.trim()];
        }
    });
    if (open) blocks.push(ccBlock(blocks.length, open, -1, ccContext(heading, prose)));
    return blocks;
}

function ccBlock(index, open, closeLine, context) {
    const opening = open.line.replace(/\r$/, '');
    const [, indent, fence, rest] = opening.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    const label = codeCommentLabel(rest);
    const lang = codeCommentLang(rest);
    const lines = open.code.map(line => ccStripIndent(line.replace(/\r$/, ''), indent));
    const lower = label.toLowerCase();
    const section = open.section;
    const skip = closeLine < 0 ? 'unclosed' : fence[0] === '~' ? 'tilde' : !label ? 'nolabel' : ccSkips(lower) ? 'nocode' : lang ? '' : 'unknown';
    return {
        index, lang, label, info: rest.trim(), indent, fence, openLine: open.no, closeLine, lines, raw: open.code,
        eol: open.line.endsWith('\r') ? '\r\n' : '\n', section, context, skip
    };
}

// 여는 펜스의 들여쓰기만큼(코드 줄에 있는 만큼) 앞 공백을 뗀다
function ccStripIndent(line, indent) {
    let k = 0;
    while (k < indent.length && line[k] === indent[k]) k += 1;
    return line.slice(k);
}

// 바로 앞 설명 글: 가까운 제목 + 그 뒤 단락. 길면 블록에 가까운 끝을 남긴다.
// HTML 주석, 그림(<img …> · ![…](…) · 링크로 감싼 [![…](…)](…)), 그림만 들었던 <p …></p> 같은 빈 단락 태그는 뗀다
function ccContext(heading, prose) {
    const text = prose.join(' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/<img\b[^>]*>/gi, ' ')
        .replace(/<(p|div|figure|picture|center)\b[^>]*>\s*<\/\1>/gi, ' ')
        .replace(/\s+/g, ' ').trim();
    const head = heading.slice(0, 100);
    const room = CODE_COMMENT_CONTEXT_CHARS - (head ? head.length + 1 : 0);
    const body = text.length > room ? `…${text.slice(text.length - room + 1)}` : text;
    return [head, body].filter(Boolean).join('\n');
}

/* ---------- 3. 줄 훑기(lexer) ---------- */
// 줄마다 남기는 것: code(코드 글자가 있음), units(걸친 주석 번호), marks(주석 글자 자리), startWhy(이 줄 위에 주석 줄을 넣으면 안 되는 까닭),
// endWhy(이 줄 끝에 주석을 붙이면 안 되는 까닭), lineEnd(줄 끝까지 간 줄 주석 번호), codeText(주석을 공백으로 지운 줄)
const ccRow = () => ({ code: false, units: [], marks: [], startWhy: '', endWhy: '', kind: '', lineEnd: 0, codeText: '' });
const CC_WORD = /[A-Za-z_$\u00C0-\uFFFF][\w$\u00C0-\uFFFF]*/y;
const CC_NUMBER = /[0-9][\w.]*/y;
// c·cpp 숫자: 숫자 사이의 ' 는 자릿수 구분이다(100'000)
const CC_C_NUMBER = /[0-9](?:'?[\w.])*/y;
const CC_SHEBANG = /^#!(?!\[)/; // rust의 #![…] 는 코드다
const CC_CODING = /^[ \t\f]*#.*?coding[:=][ \t]*[-\w.]+/;
const CC_DOCKER_DIRECTIVE = /^#\s*[A-Za-z][\w-]*\s*=/;
// 뒤에 정규식이 올 수 있는 낱말(그 뒤는 식이 시작하는 자리다). 기본은 perl·ruby 낱말까지, js는 js 낱말만(map / 2 는 나눗셈이다)
const CC_EXPR_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'and', 'or', 'not', 'if', 'unless', 'when', 'while', 'until', 'elsif', 'split', 'grep', 'map', 'join', 'push', 'unshift']);
const CC_JS_EXPR_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const CC_PAIRS = { '(': ')', '[': ']', '{': '}', '<': '>' };
const CC_FRAME_WHY = { str: 'string', blk: 'comment', code: 'string', jsxTag: 'jsx', jsxText: 'jsx', html: 'html' };
// 두 글자 연산자(JSX를 믿을 수 있는 앞 자리를 가릴 때 쓴다)
const CC_TWO_OPS = new Set(['=>', '&&', '||', '??']);
// JSX를 믿고 그 안 { } 자리를 코드로 보는 앞 자리: 줄 머리('') · return · ( · => · ? · : · && · || · ?? · , · [ · { · yield
// 그 밖(= · ; 뒤 등)에서 연 JSX는 제네릭·형 단언을 잘못 읽었을 수 있어 그 안 { } 자리도 막는다
const CC_JSX_TRUSTED = new Set(['', 'return', '(', '=>', '?', ':', '&&', '||', '??', ',', '[', '{', 'yield']);
// TS 제네릭 꼴(<T,> · <T extends X> · <T = X> · <const T> · <T>(x: T): R =>)은 JSX가 아니다
const CC_TS_GENERIC = /<\s*(?:const\s+)?[A-Za-z_$][\w$]*\s*(?:,|extends\s+(?!=)|=(?![>=]))/y;
const CC_TS_GENERIC_ARROW = /<\s*[A-Za-z_$][\w$]*\s*>\s*\([^()<>]*\)\s*(?::[^=<>]*)?=>/y;

function ccExecAt(re, text, i) {
    re.lastIndex = i;
    return re.exec(text);
}

// 주석 글자 자리를 남긴다(앞 자리와 붙으면 늘린다)
function ccComment(row, from, to, unit) {
    if (!row.units.includes(unit)) row.units.push(unit);
    const last = row.marks[row.marks.length - 1];
    if (last && last[1] === from) last[1] = to;
    else row.marks.push([from, to]);
}

function ccCodeText(text, marks) {
    if (!marks.length) return text;
    const chars = text.split('');
    marks.forEach(([from, to]) => { for (let k = from; k < to; k += 1) chars[k] = ' '; });
    return chars.join('');
}

const ccBackslashes = (text, i) => {
    let n = 0;
    while (i - n - 1 >= 0 && text[i - n - 1] === '\\') n += 1;
    return n;
};

/* 토큰: (lx, text, i, row) → 다음 자리, 맞지 않으면 -1 */
// 줄 주석. ws: 앞 글자가 이 모양일 때만(줄 머리는 늘 된다), start: 줄 머리에서만, not: 이 모양이면 주석이 아니다,
// until: 이 글자 앞에서 끝난다(php ?>), escaped: 앞의 \ 가 홀수면 글자다(makefile \#, latex \%)
const ccLineTok = (mark, { ws = null, start = false, not = null, until = '', escaped = false } = {}) => (lx, text, i, row) => {
    if (!text.startsWith(mark, i)) return -1;
    if (start && text.slice(0, i).trim()) return -1;
    if (ws && i > 0 && !ws.test(text[i - 1])) return -1;
    if (not && not.test(text.slice(i))) return -1;
    if (escaped && ccBackslashes(text, i) % 2) return -1;
    const at = until ? text.indexOf(until, i + mark.length) : -1;
    const end = at < 0 ? text.length : at;
    const unit = ++lx.units;
    ccComment(row, i, end, unit);
    if (end === text.length) row.lineEnd = unit;
    return end;
};

const ccBlockTok = (open, close, { nest = false } = {}) => (lx, text, i, row) => {
    if (!text.startsWith(open, i)) return -1;
    const unit = ++lx.units;
    lx.stack.push({ k: 'blk', open, close, nest, depth: 1, unit });
    ccComment(row, i, i + open.length, unit);
    return i + open.length;
};

// 문자열. esc: \ (escCh) 다음 글자를 건너뛴다, dbl: 닫는 기호 두 번은 글자다, multi: 줄을 넘는다, interp: ${ 같은 끼움 식, at: 열 수 있는 자리인지,
// dblBrace: {{ · }} 는 글자다(c#·vb 끼움 문자열), zap: 줄 끝의 \z 는 문자열을 다음 줄로 잇는다(lua)
const ccStrTok = (open, close = open, { esc = true, escCh = '\\', dbl = false, multi = false, interp = '', at = null, dblBrace = false, zap = false } = {}) => (lx, text, i, row) => {
    if (!text.startsWith(open, i) || (at && !at(lx, text, i))) return -1;
    lx.stack.push({ k: 'str', close, esc, escCh, dbl, multi, interp, pair: '', depth: 0, dblBrace, zap });
    row.code = true;
    return i + open.length;
};

// 정규식으로 여는 문자열(닫는 기호를 맞춰 만든다). make(m) → { close, esc, multi, pair, parts }
const ccOpenTok = (re, make) => (lx, text, i, row) => {
    const m = ccExecAt(re, text, i);
    if (!m) return -1;
    lx.stack.push({ k: 'str', esc: false, escCh: '\\', dbl: false, multi: true, interp: '', pair: '', depth: 0, parts: 1, ...make(m, lx) });
    row.code = true;
    return i + m[0].length;
};

// 글자 하나 문자열('a', '\n'). 수명('a)·기호('sym)·식별자의 ' 는 코드다
const ccCharTok = (lx, text, i, row) => {
    const m = text[i] === "'" ? ccExecAt(/'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|[^\n])|[^'\\\n])'/uy, text, i) : null;
    if (!m) return -1;
    row.code = true;
    lx.sig = 'value';
    return i + m[0].length;
};

// 글자 몇 개를 코드로 건너뛴다(lisp #\; · clojure \; · erlang $% · prolog 0'% · elixir ?#)
const ccSkipTok = (re, ok = () => true) => (lx, text, i, row) => {
    const m = ccExecAt(re, text, i);
    if (!m || !ok(text, i)) return -1;
    row.code = true;
    lx.sig = 'value';
    return i + m[0].length;
};

// 정규식 글자(/…/): 식이 올 자리에서만. 줄 안에서 닫히지 않으면 나눗셈으로 본다
function ccRegexTok(lx, text, i, row) {
    if (text[i] !== '/' || lx.sig !== 'op' || text[i + 1] === '/' || text[i + 1] === '*') return -1;
    let j = i + 1;
    let cls = false;
    for (; j < text.length; j += 1) {
        const c = text[j];
        if (c === '\\') j += 1;
        else if (cls) cls = c !== ']';
        else if (c === '[') cls = true;
        else if (c === '/') break;
    }
    if (j >= text.length) return -1;
    j += 1;
    while (j < text.length && /[A-Za-z]/.test(text[j])) j += 1;
    row.code = true;
    lx.sig = 'value';
    return j;
}

// JSX 여는 태그: 식이 올 자리에서 <글자 또는 <>. 제네릭 꼴(CC_TS_GENERIC)은 JSX가 아니다.
// guard: 이 JSX의 { } 자리도 막는다(믿을 수 없는 앞 자리에서 열었거나, ts에서 형 단언일 수 있는 속성 없는 <이름>이거나, 바깥 JSX가 그렇다)
function ccJsxOpenTok(lx, text, i, row) {
    if (text[i] !== '<' || lx.sig !== 'op') return -1;
    const next = text[i + 1] || '';
    if (next !== '>' && !/[A-Za-z]/.test(next)) return -1;
    if (ccExecAt(CC_TS_GENERIC, text, i) || ccExecAt(CC_TS_GENERIC_ARROW, text, i)) return -1;
    const parent = lx.stack[lx.stack.length - 1];
    const bare = next !== '>' && /^<[A-Za-z_$][\w$.]*>/.test(text.slice(i, i + 80));
    const trusted = CC_JSX_TRUSTED.has(lx.opBy) && !(lx.ts && !lx.tsx && bare);
    const guard = !trusted || !!parent?.guard;
    lx.stack.push(next === '>' ? { k: 'jsxText', guard } : { k: 'jsxTag', closing: false, guard });
    row.code = true;
    return i + (next === '>' ? 2 : 1);
}

// 셸 히어독 여는 꼴: << · <<- 뒤 낱말. 끝말은 따옴표와 \ 를 뗀 글이다(<<"END OF" · <<'EOF' · <<\EOF · <<E"O"F)
function ccShHeredoc(text, i) {
    const m = ccExecAt(/<<(-?)[ \t]*/y, text, i);
    if (!m) return null;
    let term = '';
    let k = i + m[0].length;
    while (k < text.length && !/[\s;&|<>()]/.test(text[k])) {
        const ch = text[k];
        if (ch === "'" || ch === '"') {
            const close = text.indexOf(ch, k + 1);
            if (close < 0) return null; // 닫히지 않은 따옴표는 문자열로 읽게 둔다
            term += text.slice(k + 1, close);
            k = close + 1;
        } else if (ch === '\\') {
            term += text[k + 1] ?? '';
            k += 2;
        } else {
            term += ch;
            k += 1;
        }
    }
    return term ? { term, strip: m[1] ? 'tabs' : '', end: k } : null;
}

// 정규식 꼴 히어독: m → { term, strip, end }
const ccHeredocRe = (re, term, strip) => (text, i) => {
    const m = ccExecAt(re, text, i);
    return m ? { term: term(m), strip: strip(m), end: i + m[0].length } : null;
};

// 히어독 여는 꼴. 본문은 이 줄 다음부터 끝 줄까지다. strip: tabs(<<-, 앞 탭을 뗀다) · lead(앞 공백) · php(들여쓴 끝 줄과 뒤 글자)
// perl은 따옴표 끝말 앞 공백을 받는다(print << "EOF"). 띄운 낱말(<< EOF)은 받지 않는다(1 << 2 는 셈이다)
const CC_HEREDOC = {
    sh: ccShHeredoc,
    rb: ccHeredocRe(/<<([~-]?)(?:(['"`])([^'"`\s]+)\2|([A-Z_][A-Z0-9_]*))/y, m => m[3] ?? m[4], m => (m[1] ? 'lead' : '')),
    pl: ccHeredocRe(/<<(~?)(?:[ \t]*(['"])([^'"\n]*)\2|([A-Za-z_]\w*))/y, m => m[3] ?? m[4], m => (m[1] ? 'lead' : '')),
    php: ccHeredocRe(/<<<[ \t]*(['"]?)([A-Za-z_]\w*)\1/y, m => m[2], () => 'php')
};
// sh의 $(( )) · (( )) 안의 << 는 비트 이동이라 열지 않는다
const ccHeredocTok = kind => (lx, text, i, row) => {
    if (text[i] !== '<' || text[i - 1] === '<' || (kind !== 'php' && text[i + 2] === '<') || (kind === 'sh' && lx.arith)) return -1;
    const doc = CC_HEREDOC[kind](text, i);
    if (!doc) return -1;
    lx.pending.push({ term: doc.term, strip: doc.strip });
    row.code = true;
    return doc.end;
};

// 히어독 끝 줄인지(줄 끝 \r 은 보지 않는다)
function ccHeredocEnds(doc, text) {
    const line = String(text).replace(/\r$/, '');
    if (doc.strip === 'php') return new RegExp(`^\\s*${doc.term}(?![A-Za-z0-9_\\x80-\\uffff])`).test(line);
    const body = doc.strip === 'tabs' ? line.replace(/^\t+/, '') : doc.strip === 'lead' ? line.replace(/^\s+/, '') : line;
    return body === doc.term;
}

// sh 산술 $(( … )) · (( … )): 괄호 깊이를 lx.arith로 센다(줄마다 처음부터. 닫히지 않으면 다음 줄의 << 는 히어독으로 보아 막는 쪽이다)
function ccShArithTok(lx, text, i, row) {
    const ch = text[i];
    if (lx.arith) {
        if (ch === '(') lx.arith += 1;
        else if (ch === ')') lx.arith -= 1;
        else return -1;
        row.code = true;
        return i + 1;
    }
    const m = ccExecAt(/\$?\(\(/y, text, i);
    if (!m) return -1;
    lx.arith = 2;
    row.code = true;
    return i + m[0].length;
}

// lua 긴 주석(--[[ ]] · --[==[ ]==])과 긴 문자열([[ ]])
function ccLuaLongTok(lx, text, i, row) {
    const comment = text.startsWith('--', i);
    const from = comment ? i + 2 : i;
    const m = ccExecAt(/\[(=*)\[/y, text, from);
    if (!m) return -1;
    const close = `]${m[1]}]`;
    const end = from + m[0].length;
    if (comment) {
        const unit = ++lx.units;
        lx.stack.push({ k: 'blk', open: '', close, nest: false, depth: 1, unit });
        ccComment(row, i, end, unit);
    } else {
        lx.stack.push({ k: 'str', close, esc: false, multi: true, pair: '', depth: 0 });
        row.code = true;
    }
    return end;
}

// haskell 줄 주석: 연산자(-->, |--)가 아닌 -- 만
const CC_HS_SYMBOL = /[!#$%&*+./<=>?@\\^|\-~:]/;
function ccHsLineTok(lx, text, i, row) {
    const m = ccExecAt(/-{2,}/y, text, i);
    if (!m || CC_HS_SYMBOL.test(text[i - 1] || '') || CC_HS_SYMBOL.test(text[i + m[0].length] || '')) return -1;
    const unit = ++lx.units;
    ccComment(row, i, text.length, unit);
    row.lineEnd = unit;
    return text.length;
}

// 줄 머리 낱말 주석: batch REM(@REM), vb REM(줄 머리나 : 뒤)
const ccRemTok = afterColon => (lx, text, i, row) => {
    if (!ccExecAt(/@?rem(?=[\s.:\/\\;,=+(]|$)/iy, text, i)) return -1;
    const before = text.slice(0, i).trim().replace(/^@/, '');
    if (before && !(afterColon && before.endsWith(':'))) return -1;
    const unit = ++lx.units;
    ccComment(row, i, text.length, unit);
    row.lineEnd = unit;
    return text.length;
};

// powershell here-string(@" 또는 @' 로 줄이 끝나면 "@ · '@ 로 시작하는 줄까지)
function ccPsHereTok(lx, text, i, row) {
    if (text[i] !== '@' || (text[i + 1] !== '"' && text[i + 1] !== "'") || text.slice(i + 2).trim()) return -1;
    lx.mode = { k: 'lines', why: 'string', depth: 1, end: text[i + 1] === '"' ? /^"@/ : /^'@/ };
    row.code = true;
    return text.length;
}

// php ?> : 다음 <?php 까지는 HTML이다
function ccPhpCloseTok(lx, text, i, row) {
    if (!text.startsWith('?>', i)) return -1;
    lx.stack.push({ k: 'html' });
    row.code = true;
    return i + 2;
}

// matlab ... : 다음 줄로 이어지고 뒤 글은 주석이다
function ccMatlabContTok(lx, text, i, row) {
    if (!text.startsWith('...', i)) return -1;
    lx.contFlag = true;
    if (text.slice(i + 3).trim()) ccComment(row, i + 3, text.length, ++lx.units);
    return text.length;
}

// 앞 글자가 이 모양이면 ' 는 전치 연산자다(matlab·julia)
const ccTransposed = (text, i) => /[\w)\]}.']/.test(text[i - 1] || '');

// yaml 따옴표는 값이 시작하는 자리(줄 머리, : - ? 와 공백 뒤, [ { , 뒤)에서만 문자열을 연다(it's 의 ' 는 글자다)
function ccYamlScalarStart(lx, text, i) {
    const before = text.slice(0, i);
    const trimmed = before.trimEnd();
    if (!trimmed) return true;
    const last = trimmed[trimmed.length - 1];
    return '[{,'.includes(last) || (':-?'.includes(last) && /\s$/.test(before));
}

// perl q·qq·qw·qx·qr·m·s·tr·y 와 구분 기호(짝 괄호는 겹침을 센다. s·tr·y는 두 칸)
function ccPerlQuoteTok(lx, text, i, row) {
    const m = ccExecAt(/(qq|qw|qx|qr|q|m|s|tr|y)\s*([^\w\s])/y, text, i);
    if (!m || (m[2] === '=' && text[i + m[0].length] === '>') || m[2] === ',' || m[2] === ';') return -1;
    const close = CC_PAIRS[m[2]] || m[2];
    const two = ['s', 'tr', 'y'].includes(m[1]);
    lx.stack.push({ k: 'str', close, esc: true, escCh: '\\', dbl: false, multi: true, interp: '', pair: CC_PAIRS[m[2]] ? m[2] : '', depth: 0, parts: two && !CC_PAIRS[m[2]] ? 2 : 1, then: two && !!CC_PAIRS[m[2]] });
    row.code = true;
    return i + m[0].length;
}

/* 줄 머리에서 보는 줄 단위 구역: true면 그 줄을 다 읽었다 */
// 줄 단위 구역을 열고 그 줄을 주석(comment) 또는 코드로 남긴다
function ccOpenLines(lx, row, text, mode) {
    const unit = mode.comment ? ++lx.units : 0;
    if (mode.comment && text.trim()) ccComment(row, 0, text.length, unit);
    else row.code = !!text.trim();
    lx.mode = { k: 'lines', depth: 1, ...mode, unit };
    row.endWhy = mode.why;
    return true;
}

const CC_ROW_START = {
    // ruby =begin … =end, __END__ 뒤 데이터
    rb(lx, text, row) {
        if (/^=begin(\s|$)/.test(text)) return ccOpenLines(lx, row, text, { why: 'comment', comment: true, end: /^=end(\s|$)/ });
        if (/^__END__\s*$/.test(text)) return ccOpenLines(lx, row, text, { why: 'data', data: true, end: null });
        return false;
    },
    // perl POD(=head1 … =cut), __END__·__DATA__ 뒤 데이터
    pl(lx, text, row) {
        if (/^=[A-Za-z]/.test(text) && !/^=cut\b/.test(text)) return ccOpenLines(lx, row, text, { why: 'comment', comment: true, end: /^=cut\b/ });
        if (/^__(?:END|DATA)__\s*$/.test(text)) return ccOpenLines(lx, row, text, { why: 'data', data: true, end: null });
        return false;
    },
    // matlab %{ … %} (겹칠 수 있다)
    matlab(lx, text, row) {
        if (!/^\s*%\{\s*$/.test(text)) return false;
        return ccOpenLines(lx, row, text, { why: 'comment', comment: true, end: /^\s*%\}\s*$/, open: /^\s*%\{\s*$/ });
    },
    // autohotkey /* … */ (줄 머리에서 연다), 이어 쓰기 구역 ( … ) 안은 글자 그대로(그 앞 줄과 붙으므로 위 자리도 막는다)
    ahk(lx, text, row) {
        if (/^\s*\((?:\s*(?:Join\S*|LTrim0?|RTrim0|Comments?|Com|C|%|,|`))*\s*$/i.test(text)) {
            row.startWhy = row.startWhy || 'string';
            return ccOpenLines(lx, row, text, { why: 'string', end: /^\s*\)/ });
        }
        if (!/^\s*\/\*/.test(text)) return false;
        const unit = ++lx.units;
        ccComment(row, 0, text.length, unit);
        if (/\*\/\s*$/.test(text.replace(/^\s*\/\*/, ''))) return true;
        lx.mode = { k: 'lines', why: 'comment', comment: true, unit, depth: 1, end: /^\s*\*\/|\*\/\s*$/ };
        row.endWhy = 'comment';
        return true;
    },
    // latex verbatim 꼴 환경은 글자 그대로(보호), comment 환경은 주석
    tex(lx, text, row) {
        const m = text.match(/\\begin\{(verbatim\*?|Verbatim\*?|BVerbatim|lstlisting|minted|alltt|filecontents\*?|comment)\}/);
        const percent = ccTexPercent(text);
        if (!m || (percent >= 0 && percent < m.index)) return false;
        const end = new RegExp(`\\\\end\\{${m[1].replace(/\*/g, '\\*')}\\}`);
        if (end.test(text.slice(m.index))) return false;
        const comment = m[1] === 'comment';
        ccOpenLines(lx, row, text, { why: comment ? 'comment' : 'verbatim', comment, end });
        if (text.slice(0, m.index).trim()) row.code = true;
        return true;
    },
    // makefile define … endef 안은 값 그대로
    make(lx, text, row) {
        if (!/^\s*(?:(?:export|override|private)\s+)*define\b/.test(text)) return false;
        return ccOpenLines(lx, row, text, { why: 'define', end: /^\s*endef\b/ });
    }
};

// latex에서 주석을 여는 % 자리(앞의 \ 가 짝수일 때). 없으면 -1
function ccTexPercent(text) {
    for (let i = text.indexOf('%'); i >= 0; i = text.indexOf('%', i + 1)) if (ccBackslashes(text, i) % 2 === 0) return i;
    return -1;
}

// yaml 블록 글(키: | 또는 >)을 여는 줄이면 부모 들여쓰기를 돌려준다. - | 꼴은 마지막 - 자리, 키: | 꼴은 키 자리다
function ccYamlBlockIndent(text, trimmed) {
    if (!/(?:^|[ \t])[|>][-+0-9]*$/.test(trimmed) || !(trimmed.includes(':') || /^\s*(?:-\s+)+[|>]/.test(trimmed) || /^---\s/.test(trimmed))) return -1;
    const lead = text.match(/^( *)((?:- +)*)/);
    const after = text.slice(lead[0].length);
    if (lead[2] && /^[|>]/.test(after)) return lead[1].length + lead[2].replace(/- +$/, '').length;
    return lead[1].length + lead[2].length;
}

/* 문자열·특수 문법 묶음(kit). tokens: 차례로 맞춰 보는 토큰, word: 낱말 모양, cont: 줄 이어짐 모양(주석을 지운 줄 끝),
   splice: 줄 끝 \ 가 // 주석까지 다음 줄로 잇는다(c·cpp), jsx: JSX 규칙, php: <?php 밖은 HTML, escCh: 코드에서 다음 글자를 글자로 만드는 기호,
   exprWords: 뒤에 정규식이 올 수 있는 낱말(없으면 CC_EXPR_WORDS), number: 숫자 모양(없으면 CC_NUMBER) */
const CC_C_TOKENS = [ccBlockTok('/*', '*/'), ccLineTok('//')];
const CC_NEST_TOKENS = [ccBlockTok('/*', '*/', { nest: true }), ccLineTok('//')];
const CC_DQ = ccStrTok('"');
const CC_SQ = ccStrTok("'");
const CC_TRIPLE = [ccStrTok('"""', '"""', { multi: true }), ccStrTok("'''", "'''", { multi: true })];

const CC_KITS = {
    py: { tokens: [ccLineTok('#'), ...CC_TRIPLE, CC_DQ, CC_SQ], cont: /\\$/, coding: true },
    // 따옴표 밖의 \ 다음 한 글자는 글자다(\' · \" · \# 는 문자열·주석을 열지 않는다)
    sh: {
        tokens: [ccShArithTok, ccLineTok('#', { ws: /[\s;|&()]/ }), ccHeredocTok('sh'), ccStrTok("$'", "'", { multi: true }), ccStrTok("'", "'", { esc: false, multi: true }), ccStrTok('"', '"', { multi: true }), ccStrTok('`', '`', { multi: true })],
        cont: /\\$/, escCh: '\\'
    },
    ps: {
        tokens: [ccBlockTok('<#', '#>'), ccLineTok('#', { ws: /[\s;|&(){}]/ }), ccPsHereTok, ccStrTok("'", "'", { esc: false, dbl: true, multi: true }), ccStrTok('"', '"', { escCh: '`', dbl: true, multi: true })],
        cont: /`$/, escCh: '`'
    },
    rb: {
        tokens: [ccLineTok('#'), ccHeredocTok('rb'), ccOpenTok(/%[qQwWiIrsx]([(\[{<|!\/^])/y, m => ({ close: CC_PAIRS[m[1]] || m[1], pair: CC_PAIRS[m[1]] ? m[1] : '', esc: true })), ccRegexTok, ccStrTok('"', '"', { multi: true }), ccStrTok("'", "'", { multi: true }), ccStrTok('`', '`', { multi: true })],
        cont: /\\$/, rowStart: CC_ROW_START.rb, coding: true
    },
    pl: {
        tokens: [ccLineTok('#'), ccHeredocTok('pl'), ccPerlQuoteTok, ccRegexTok, ccStrTok('"', '"', { multi: true }), ccStrTok("'", "'", { multi: true }), ccStrTok('`', '`', { multi: true })],
        word: /\$#\w*|[A-Za-z_$@%][\w]*/y, rowStart: CC_ROW_START.pl
    },
    r: { tokens: [ccLineTok('#'), ccOpenTok(/[rR](["'])(-*)([(\[{])/y, m => ({ close: `${CC_PAIRS[m[3]]}${m[2]}${m[1]}` })), ccStrTok('"', '"', { multi: true }), ccStrTok("'", "'", { multi: true }), ccStrTok('`', '`', { multi: true })] },
    yaml: { tokens: [ccLineTok('#', { ws: /\s/ }), ccStrTok("'", "'", { esc: false, dbl: true, multi: true, at: ccYamlScalarStart }), ccStrTok('"', '"', { multi: true, at: ccYamlScalarStart })], yaml: true },
    toml: { tokens: [ccLineTok('#'), ccStrTok('"""', '"""', { multi: true }), ccStrTok("'''", "'''", { esc: false, multi: true }), CC_DQ, ccStrTok("'", "'", { esc: false })] },
    docker: { tokens: [ccLineTok('#', { start: true }), ccHeredocTok('sh')], docker: true },
    make: { tokens: [ccLineTok('#', { escaped: true })], cont: /\\$/, rowStart: CC_ROW_START.make },
    ex: {
        tokens: [ccLineTok('#'), ...CC_TRIPLE, ccOpenTok(/~[A-Za-z]+("""|'''|[\/|"'(\[{<])/y, m => ({ close: CC_PAIRS[m[1]] || m[1], pair: CC_PAIRS[m[1]] ? m[1] : '', esc: true })),
            ccSkipTok(/\?\\?[^\s]/y, (text, i) => !/[\w?!]/.test(text[i - 1] || '')), ccStrTok('"', '"', { multi: true }), ccStrTok("'", "'", { multi: true })]
    },
    jl: { tokens: [ccBlockTok('#=', '=#', { nest: true }), ccLineTok('#'), ccStrTok('"""', '"""', { multi: true }), ccStrTok('"', '"', { multi: true }), (lx, text, i, row) => (ccTransposed(text, i) ? -1 : ccCharTok(lx, text, i, row)), ccStrTok('`', '`', { multi: true })] },
    gql: { tokens: [ccLineTok('#'), ccStrTok('"""', '"""', { multi: true }), CC_DQ] },
    js: { tokens: [...CC_C_TOKENS, ccRegexTok, ccJsxOpenTok, ccStrTok('`', '`', { multi: true, interp: '${' }), CC_DQ, CC_SQ], jsx: true, exprWords: CC_JS_EXPR_WORDS },
    java: { tokens: [...CC_C_TOKENS, ccStrTok('"""', '"""', { multi: true }), CC_DQ, CC_SQ] },
    c: { tokens: [...CC_C_TOKENS, CC_DQ, CC_SQ], cont: /\\$/, splice: true, number: CC_C_NUMBER },
    cpp: { tokens: [...CC_C_TOKENS, ccOpenTok(/(?:u8|[uUL])?R"([^()\\\s]{0,16})\(/y, m => ({ close: `)${m[1]}"` })), CC_DQ, CC_SQ], cont: /\\$/, splice: true, number: CC_C_NUMBER },
    // c# 끼움 문자열($"…" · $@"…" · @$"…")은 { } 안을 코드로 따라간다({{ }} 는 글자). 그래야 { } 안의 " 에서 문자열이 닫히지 않는다
    cs: {
        tokens: [...CC_C_TOKENS, ccOpenTok(/\$*("{3,})/y, m => ({ close: m[1] })),
            ccStrTok('$@"', '"', { esc: false, dbl: true, multi: true, interp: '{', dblBrace: true }), ccStrTok('@$"', '"', { esc: false, dbl: true, multi: true, interp: '{', dblBrace: true }),
            ccStrTok('$"', '"', { interp: '{', dblBrace: true }), ccStrTok('@"', '"', { esc: false, dbl: true, multi: true }), CC_DQ, CC_SQ]
    },
    go: { tokens: [...CC_C_TOKENS, ccStrTok('`', '`', { esc: false, multi: true }), CC_DQ, CC_SQ] },
    rust: { tokens: [...CC_NEST_TOKENS, ccOpenTok(/[bc]?r(#*)"/y, m => ({ close: `"${m[1]}` })), ccStrTok('"', '"', { multi: true }), ccCharTok] },
    swift: { tokens: [...CC_NEST_TOKENS, ccOpenTok(/(#+)("""|")/y, m => ({ close: `${m[2]}${m[1]}`, multi: m[2] === '"""' })), ccStrTok('"""', '"""', { multi: true }), CC_DQ] },
    kotlin: { tokens: [...CC_NEST_TOKENS, ccStrTok('"""', '"""', { esc: false, multi: true }), CC_DQ, CC_SQ] },
    scala: { tokens: [...CC_NEST_TOKENS, ccStrTok('"""', '"""', { esc: false, multi: true }), CC_DQ, ccCharTok] },
    dart: {
        tokens: [...CC_NEST_TOKENS, ccStrTok("r'''", "'''", { esc: false, multi: true }), ccStrTok('r"""', '"""', { esc: false, multi: true }), ccStrTok("r'", "'", { esc: false }), ccStrTok('r"', '"', { esc: false }),
            ...CC_TRIPLE, CC_DQ, CC_SQ]
    },
    php: {
        tokens: [ccBlockTok('/*', '*/'), ccLineTok('//', { until: '?>' }), ccLineTok('#', { until: '?>', not: /^#\[/ }), ccPhpCloseTok,
            ccHeredocTok('php'), ccStrTok('"', '"', { multi: true }), ccStrTok("'", "'", { multi: true }), ccStrTok('`', '`', { multi: true })],
        php: true
    },
    groovy: { tokens: [...CC_C_TOKENS, ...CC_TRIPLE, CC_DQ, CC_SQ] },
    clike: { tokens: [...CC_C_TOKENS, CC_DQ, CC_SQ] },
    scss: { tokens: [...CC_C_TOKENS, ccSkipTok(/url\(\s*(?!['"])[^)]*\)/iy), CC_DQ, CC_SQ] },
    css: { tokens: [ccBlockTok('/*', '*/'), ccSkipTok(/url\(\s*(?!['"])[^)]*\)/iy), CC_DQ, CC_SQ] },
    sql: { tokens: (dialect, lines) => ccSqlTokens(dialect, lines) },
    lua: { tokens: [ccLuaLongTok, ccLineTok('--'), ccStrTok('"', '"', { zap: true }), ccStrTok("'", "'", { zap: true })] },
    // luau(로블록스): lua에 백틱 끼움 문자열(`점수 {score}점`)을 더한다
    luau: { tokens: [ccLuaLongTok, ccLineTok('--'), ccStrTok('`', '`', { interp: '{' }), ccStrTok('"', '"', { zap: true }), ccStrTok("'", "'", { zap: true })] },
    hs: { tokens: [ccStrTok('{-#', '#-}', { esc: false, multi: true }), ccBlockTok('{-', '-}', { nest: true }), ccHsLineTok, CC_DQ, ccCharTok], word: /[A-Za-z_\u00C0-\uFFFF][\w'\u00C0-\uFFFF]*/y },
    ada: { tokens: [ccLineTok('--'), ccStrTok('"', '"', { esc: false, dbl: true }), ccSkipTok(/'[^\n]'/y, (text, i) => !/[\w)]/.test(text[i - 1] || ''))] },
    vhdl: { tokens: [ccBlockTok('/*', '*/'), ccLineTok('--'), ccStrTok('"', '"', { esc: false, dbl: true }), ccSkipTok(/'[^\n]'/y, (text, i) => !/[\w)]/.test(text[i - 1] || ''))] },
    ini: { tokens: [ccLineTok(';', { start: true }), ccLineTok('#', { start: true })] },
    asm: { tokens: [ccLineTok(';'), CC_DQ, CC_SQ, ccStrTok('`')] },
    lisp: { tokens: [ccBlockTok('#|', '|#', { nest: true }), ccSkipTok(/#\\./y), ccLineTok(';'), ccStrTok('"', '"', { multi: true })] },
    clj: { tokens: [ccSkipTok(/\\./y), ccLineTok(';'), ccStrTok('"', '"', { multi: true })] },
    ahk: { tokens: [ccLineTok(';', { ws: /\s/ }), ccStrTok('"', '"', { escCh: '`', dbl: true })], escCh: '`', rowStart: CC_ROW_START.ahk },
    matlab: { tokens: [ccMatlabContTok, ccLineTok('%'), ccStrTok("'", "'", { esc: false, dbl: true, at: (lx, text, i) => !ccTransposed(text, i) }), ccStrTok('"', '"', { esc: false, dbl: true })], rowStart: CC_ROW_START.matlab },
    tex: { tokens: [ccLineTok('%', { escaped: true }), ccOpenTok(/\\verb\*?([^\sA-Za-z*])/y, m => ({ close: m[1], multi: false }))], rowStart: CC_ROW_START.tex },
    erl: { tokens: [ccLineTok('%'), ccSkipTok(/\$\\?[^\n]/y), ccStrTok('"""', '"""', { multi: true }), ccStrTok('"', '"', { multi: true }), CC_SQ] },
    prolog: { tokens: [ccBlockTok('/*', '*/'), ccLineTok('%'), ccSkipTok(/0'(?:\\.|''|[^\n])/y, (text, i) => !/\w/.test(text[i - 1] || '')), ccStrTok('"', '"', { multi: true }), ccStrTok("'", "'", { dbl: true }), ccStrTok('`')] },
    // vb 문자열은 여러 줄일 수 있다(VB14). $"…" 는 { } 안을 코드로 따라간다
    vb: {
        tokens: [ccLineTok("'"), ccRemTok(true), ccStrTok('$"', '"', { esc: false, dbl: true, multi: true, interp: '{', dblBrace: true }), ccStrTok('"', '"', { esc: false, dbl: true, multi: true })],
        cont: /(?:^|[ \t])_$/
    },
    bat: { tokens: [ccRemTok(false), ccLineTok('::', { start: true }), ccStrTok('"', '"', { esc: false })], cont: /(?:^|[^^])(?:\^\^)*\^$/, batch: true }
};

// sql 갈래: mysql은 # 주석과 \ 이스케이프, postgres·tsql은 겹치는 블록 주석, tsql은 [이름], 그 밖은 $태그$ 문자열.
// 갈래가 없는데(sql) DELIMITER 줄이 있으면 mysql로 읽는다(DELIMITER $$ 는 문자열이 아니라 끝 표시다)
function ccSqlTokens(dialect, lines = []) {
    const plain = !dialect || dialect === 'sql';
    const mysql = dialect === 'mysql' || dialect === 'mariadb' || (plain && lines.some(line => /^\s*delimiter\b/i.test(line)));
    const tsql = dialect === 'tsql' || dialect === 'mssql';
    const nest = tsql || dialect === 'postgresql' || dialect === 'postgres';
    return [
        ccBlockTok('/*', '*/', { nest }), ccLineTok('--'), ...(mysql ? [ccLineTok('#')] : []),
        ...(mysql || tsql ? [] : [ccOpenTok(/\$([A-Za-z_]\w*)?\$/y, m => ({ close: m[0] }))]),
        ...(tsql ? [ccStrTok('[', ']', { esc: false })] : []),
        ccStrTok("E'", "'", { multi: true }), ccStrTok("'", "'", { esc: mysql, dbl: true, multi: true }), ccStrTok('"', '"', { esc: false, dbl: true, multi: true }),
        ...(mysql ? [ccStrTok('`', '`', { esc: false, dbl: true })] : [])
    ];
}

/* 틀(frame) 안에서 한 글자씩 */
function ccBlockStep(lx, f, text, i, row) {
    if (f.nest && f.open && text.startsWith(f.open, i)) {
        f.depth += 1;
        ccComment(row, i, i + f.open.length, f.unit);
        return i + f.open.length;
    }
    if (text.startsWith(f.close, i)) {
        ccComment(row, i, i + f.close.length, f.unit);
        f.depth -= 1;
        if (!f.depth) lx.stack.pop();
        return i + f.close.length;
    }
    if (!/\s/.test(text[i])) ccComment(row, i, i + 1, f.unit);
    return i + 1;
}

function ccStrStep(lx, f, text, i, row) {
    const ch = text[i];
    if (!/\s/.test(ch)) row.code = true;
    if (f.esc && ch === f.escCh) {
        // 줄 끝 \ (lua는 뒤에 공백만 남은 \z 도): 문자열이 다음 줄로 이어진다
        if (i + 1 >= text.length || (f.zap && text[i + 1] === 'z' && !text.slice(i + 2).trim())) lx.strCont = true;
        return i + 2;
    }
    if (f.pair && ch === f.pair) {
        f.depth += 1;
        return i + 1;
    }
    if (f.dbl && text.startsWith(f.close + f.close, i)) return i + f.close.length * 2;
    if (f.dblBrace && (text.startsWith('{{', i) || text.startsWith('}}', i))) return i + 2;
    if (f.interp && text.startsWith(f.interp, i)) {
        lx.stack.push({ k: 'code', brace: 0, jsx: false });
        lx.sig = 'op';
        lx.opBy = '{';
        return i + f.interp.length;
    }
    if (!text.startsWith(f.close, i)) return i + 1;
    if (f.pair && f.depth) {
        f.depth -= 1;
        return i + 1;
    }
    if (f.parts > 1) { // perl s/a/b/ 의 가운데 기호
        f.parts -= 1;
        return i + f.close.length;
    }
    lx.stack.pop();
    lx.sig = 'value';
    const next = i + f.close.length;
    if (!f.then) return next;
    const k = next + (text.slice(next).match(/^\s*/)[0].length); // perl s{a}{b} 의 둘째 칸
    const open = text[k];
    if (!open || /[\w\s]/.test(open)) return next;
    lx.stack.push({ k: 'str', close: CC_PAIRS[open] || open, esc: true, escCh: '\\', dbl: false, multi: true, interp: '', pair: CC_PAIRS[open] ? open : '', depth: 0, parts: 1 });
    return k + 1;
}

// JSX 안의 { } 는 코드 틀로 연다(guard는 바깥 JSX를 따른다)
function ccJsxBrace(lx, f) {
    lx.stack.push({ k: 'code', brace: 0, jsx: true, guard: !!f.guard });
    lx.sig = 'op';
    lx.opBy = '{';
}

function ccJsxTagStep(lx, f, text, i, row) {
    const ch = text[i];
    if (!/\s/.test(ch)) row.code = true;
    if (ch === '"' || ch === "'") {
        lx.stack.push({ k: 'str', close: ch, esc: false, multi: true, pair: '', depth: 0 });
        return i + 1;
    }
    if (ch === '{') {
        ccJsxBrace(lx, f);
        return i + 1;
    }
    const self = text.startsWith('/>', i);
    if (!self && ch !== '>') return i + 1;
    lx.stack.pop();
    if (!self && !f.closing) lx.stack.push({ k: 'jsxText', guard: !!f.guard });
    else {
        if (f.closing && lx.stack[lx.stack.length - 1]?.k === 'jsxText') lx.stack.pop();
        const top = lx.stack[lx.stack.length - 1];
        if (!top || top.k === 'code') lx.sig = 'value'; // JSX 식이 끝났다
    }
    return i + (self ? 2 : 1);
}

function ccJsxTextStep(lx, f, text, i, row) {
    const ch = text[i];
    if (!/\s/.test(ch)) row.code = true;
    if (ch === '{') {
        ccJsxBrace(lx, f);
        return i + 1;
    }
    if (ch !== '<') return i + 1;
    const next = text[i + 1] || '';
    const guard = !!f.guard;
    if (next === '/') {
        lx.stack.push({ k: 'jsxTag', closing: true, guard });
        return i + 2;
    }
    if (next === '>') {
        lx.stack.push({ k: 'jsxText', guard });
        return i + 2;
    }
    if (/[A-Za-z]/.test(next)) lx.stack.push({ k: 'jsxTag', closing: false, guard });
    return i + 1;
}

// php의 ?> 와 <?php 사이(HTML 부분)는 코드 글자로 읽고 <?php · <?= · <? 에서 다시 코드다
function ccPhpHtmlStep(lx, text, i, row) {
    if (!/\s/.test(text[i])) row.code = true;
    const m = ccExecAt(/<\?(?:php\b|=|(?=\s|$))/iy, text, i);
    if (!m) return i + 1;
    lx.stack.pop();
    lx.sig = 'op';
    lx.opBy = '';
    return i + m[0].length;
}

// 틀 밖(코드)의 한 글자: { } 로 끼움 식을 닫고, 낱말·숫자는 통째로 넘긴다. sig는 정규식·JSX가 올 자리인지 판단에 쓰고,
// opBy는 sig를 'op'로 만든 낱말이나 기호(JSX를 믿을 수 있는 자리인지 볼 때 쓴다)
function ccPlain(lx, text, i, row, top) {
    const ch = text[i];
    if (top && top.k === 'code') {
        if (ch === '{') top.brace += 1;
        else if (ch === '}' && !top.brace) {
            lx.stack.pop();
            row.code = true;
            lx.sig = 'value';
            return i + 1;
        } else if (ch === '}') top.brace -= 1;
    }
    if (/\s/.test(ch)) return i + 1;
    row.code = true;
    const word = ccExecAt(lx.kit.word || CC_WORD, text, i);
    if (word) {
        lx.sig = (lx.kit.exprWords || CC_EXPR_WORDS).has(word[0]) ? 'op' : 'value';
        if (lx.sig === 'op') lx.opBy = word[0];
        return i + word[0].length;
    }
    const num = ccExecAt(lx.kit.number || CC_NUMBER, text, i);
    if (num) {
        lx.sig = 'value';
        return i + num[0].length;
    }
    // ++ · -- : 뒤붙이(x++)면 값 그대로, 앞붙이(++x)면 식 자리 그대로다(x++ / 2 의 / 는 나눗셈이다)
    if ((ch === '+' || ch === '-') && text[i + 1] === ch) return i + 2;
    lx.sig = ch === ')' || ch === ']' ? 'value' : 'op';
    if (lx.sig === 'op') {
        const two = text.slice(i - 1, i + 1);
        lx.opBy = i > 0 && CC_TWO_OPS.has(two) ? two : ch;
    }
    return lx.kit.escCh && ch === lx.kit.escCh ? i + 2 : i + 1;
}

function ccStep(lx, text, i, row) {
    const top = lx.stack[lx.stack.length - 1];
    if (top && top.k === 'blk') return ccBlockStep(lx, top, text, i, row);
    if (top && top.k === 'str') return ccStrStep(lx, top, text, i, row);
    if (top && top.k === 'jsxTag') return ccJsxTagStep(lx, top, text, i, row);
    if (top && top.k === 'jsxText') return ccJsxTextStep(lx, top, text, i, row);
    if (top && top.k === 'html') return ccPhpHtmlStep(lx, text, i, row);
    for (const tok of lx.tokens) {
        const next = tok(lx, text, i, row);
        if (next > i) return next;
    }
    return ccPlain(lx, text, i, row, top);
}

// 맨 위 틀 안에 주석을 넣으면 안 되는 까닭. 틀이 없거나 믿을 수 있는 JSX의 { } 안(코드)이면 ''
function ccFrameWhy(top) {
    if (!top) return '';
    if (top.k === 'code' && top.jsx) return top.guard ? 'jsx' : '';
    return CC_FRAME_WHY[top.k];
}

// 지금 자리가 코드 한가운데(주석을 넣어도 되는 곳)인지. 아니면 까닭
function ccWhyNow(lx) {
    if (lx.cont || lx.splice) return 'cont';
    if (lx.heredocs.length) return 'heredoc';
    if (lx.mode) return lx.mode.why;
    return ccFrameWhy(lx.stack[lx.stack.length - 1]);
}

// 줄 단위 구역(히어독 본문, yaml 블록 글, =begin·POD·%{·verbatim·define·here-string·데이터) 안의 줄이면 읽고 true
function ccLineModes(lx, text, row) {
    if (lx.heredocs.length) {
        row.code = !!text.trim();
        row.endWhy = 'heredoc';
        if (ccHeredocEnds(lx.heredocs[0], text)) lx.heredocs = lx.heredocs.slice(1);
        return true;
    }
    const mode = lx.mode;
    if (!mode) return false;
    if (mode.k === 'yaml') {
        if (text.trim() && text.match(/^ */)[0].length <= mode.indent) {
            lx.mode = null; // 블록 글이 끝났다. 이 줄은 보통으로 읽는다(이 줄 위 자리는 이미 막았다)
            return false;
        }
        row.code = !!text.trim();
        row.endWhy = 'block';
        return true;
    }
    if (mode.data) row.kind = 'data';
    else if (mode.comment && text.trim()) ccComment(row, 0, text.length, mode.unit);
    else row.code = !!text.trim();
    row.endWhy = mode.why;
    if (mode.open && mode.open.test(text)) mode.depth += 1;
    else if (mode.end && mode.end.test(text)) {
        mode.depth = (mode.depth || 1) - 1;
        if (mode.depth <= 0) lx.mode = null;
    }
    return true;
}

// c·cpp: \ 로 끝난 // 주석은 다음 줄까지 주석이다
function ccSpliceRow(lx, text, row) {
    if (text.trim()) ccComment(row, 0, text.length, lx.splice);
    lx.splice = /\\$/.test(text) ? lx.splice : 0;
    row.endWhy = lx.splice ? 'cont' : '';
}

// 줄 끝: 이어짐·히어독·블록 글을 정하고, 닫히지 않은 한 줄 문자열은 버린다.
// 버린 문자열은 실제로는 다음 줄로 이어질 수 있으므로(c# 끼움 식·lua \z·문자열 안 \ 뒤 공백 따위) lx.cut으로 다음 줄 위 자리를 막는다
function ccEndRow(lx, text, row) {
    row.codeText = ccCodeText(text, row.marks);
    const top = lx.stack[lx.stack.length - 1];
    const trimmed = row.codeText.replace(/\s+$/, '');
    let why = lx.pending.length ? 'heredoc' : lx.mode ? lx.mode.why : ccFrameWhy(top);
    if (top && top.k === 'str' && !top.multi && !lx.strCont) {
        lx.stack.pop();
        lx.cut = true;
    }
    if (lx.kit.splice && row.lineEnd && /\\$/.test(text)) {
        lx.splice = row.lineEnd;
        why = why || 'cont';
    } else if (!why && (lx.contFlag || (lx.kit.docker ? trimmed.endsWith(lx.escape) : lx.kit.cont && lx.kit.cont.test(trimmed)))) {
        lx.cont = true;
        why = 'cont';
    }
    if (!why && lx.kit.yaml) {
        const indent = ccYamlBlockIndent(text, trimmed);
        if (indent >= 0) {
            lx.mode = { k: 'yaml', why: 'block', indent };
            why = 'block';
        }
    }
    lx.heredocs = [...lx.heredocs, ...lx.pending];
    lx.pending = [];
    row.endWhy = why;
}

// 이 줄 위 자리의 까닭: 지금 틀의 까닭, 없으면 앞 줄 끝에서 버린 한 줄 문자열(lx.cut)
const ccStartWhy = lx => ccWhyNow(lx) || (lx.cut ? 'string' : '');

function ccLexRow(lx, text, at) {
    const row = ccRow();
    row.startWhy = ccStartWhy(lx);
    lx.cut = false;
    lx.cont = false;
    lx.contFlag = false;
    lx.strCont = false;
    lx.arith = 0;
    if (at === 0 && CC_SHEBANG.test(text)) {
        row.kind = 'directive';
        row.endWhy = 'directive';
        return row;
    }
    if (lx.splice) {
        ccSpliceRow(lx, text, row);
        return row;
    }
    // 줄 머리 구역(=begin·POD·%{·define·verbatim)은 코드 한가운데서만 연다(문자열 안의 =begin 은 글자다)
    if (ccLineModes(lx, text, row) || (lx.kit.rowStart && !lx.stack.length && lx.kit.rowStart(lx, text, row))) {
        row.codeText = row.code ? text : '';
        return row;
    }
    for (let i = 0; i < text.length;) i = ccStep(lx, text, i, row);
    ccEndRow(lx, text, row);
    return row;
}

// dockerfile의 # escape=` 지시(줄 이어짐 기호를 바꾼다)
function ccDockerEscape(lines) {
    for (const line of lines) {
        if (!CC_DOCKER_DIRECTIVE.test(line)) break;
        const m = line.match(/^#\s*escape\s*=\s*(\S)/i);
        if (m) return m[1];
    }
    return '\\';
}

// lx: 훑는 동안의 상태. sig·opBy(정규식·JSX 자리), stack(틀), pending·heredocs(히어독), mode(줄 단위 구역), cut(버린 한 줄 문자열),
// arith(sh 산술 괄호 깊이), ts·tsx(TypeScript와 tsx 이름표: 속성 없는 <이름>을 형 단언으로 볼지)
function ccLexCode(spec, lines, dialect) {
    const kit = CC_KITS[spec.lex];
    const lx = {
        kit, tokens: typeof kit.tokens === 'function' ? kit.tokens(dialect, lines) : kit.tokens,
        stack: kit.php && lines.some(line => /<\?(?:php\b|=|\s|$)/i.test(line)) ? [{ k: 'html' }] : [],
        units: 0, sig: 'op', opBy: '', pending: [], heredocs: [], mode: null, cont: false, contFlag: false, splice: 0, strCont: false, cut: false, arith: 0,
        ts: !!spec.ts, tsx: dialect === 'tsx',
        escape: kit.docker ? ccDockerEscape(lines) : '\\'
    };
    const rows = lines.map((text, at) => ccLexRow(lx, text, at));
    return { rows, tail: ccStartWhy(lx) };
}

/* html·xml·svg·xaml·vue: 태그 안, script·style·textarea·title(글자 그대로)과 pre 안에는 주석 줄을 넣지 않는다 */
const CC_RAW_TAGS = new Set(['script', 'style', 'textarea', 'title', 'xmp']);
const CC_MARKUP_CLOSE = { cdata: ']]>', pi: '?>', decl: '>' };

// 줄에서 처음과 마지막으로 본 것(tag: 태그·선언, text: 요소 글자·CDATA). 주석은 보지 않는다(xml 글자 사이 판단에 쓴다)
function ccSeen(row, kind) {
    if (!row.first) row.first = kind;
    row.last = kind;
}

function ccMarkupStep(st, text, i, row) {
    const ch = text[i];
    if (st.mode === 'comment' || CC_MARKUP_CLOSE[st.mode]) {
        const close = st.mode === 'comment' ? '-->' : CC_MARKUP_CLOSE[st.mode];
        const at = text.indexOf(close, i);
        const end = at < 0 ? text.length : at + close.length;
        if (st.mode === 'comment' && text.slice(i, end).trim()) ccComment(row, i, end, st.unit);
        else if (text.slice(i, end).trim()) {
            row.code = true;
            ccSeen(row, st.mode === 'cdata' ? 'text' : 'tag');
        }
        if (at >= 0) st.mode = 'text';
        return end;
    }
    if (st.mode === 'raw') {
        const at = text.toLowerCase().indexOf(`</${st.name}`, i);
        if (text.slice(i, at < 0 ? text.length : at).trim()) {
            row.code = true;
            ccSeen(row, 'text');
        }
        if (at < 0) return text.length;
        st.mode = 'tag';
        st.closing = true;
        row.code = true;
        ccSeen(row, 'tag');
        return at + 2 + st.name.length;
    }
    if (st.mode === 'tag') return ccMarkupTagStep(st, text, i, row);
    if (text.startsWith('<!--', i)) {
        st.mode = 'comment';
        st.unit = ++st.units;
        ccComment(row, i, i + 4, st.unit);
        return i + 4;
    }
    const opener = text.startsWith('<![CDATA[', i) ? ['cdata', 9] : text.startsWith('<?', i) ? ['pi', 2] : text.startsWith('<!', i) ? ['decl', 2] : null;
    if (opener) {
        st.mode = opener[0];
        row.code = true;
        ccSeen(row, opener[0] === 'cdata' ? 'text' : 'tag');
        return i + opener[1];
    }
    const tag = ch === '<' ? /^<(\/?)([A-Za-z][\w:.-]*)/.exec(text.slice(i, i + 64)) : null;
    if (tag) {
        st.mode = 'tag';
        st.closing = !!tag[1];
        st.name = tag[2].toLowerCase();
        row.code = true;
        ccSeen(row, 'tag');
        return i + tag[0].length;
    }
    if (!/\s/.test(ch)) {
        row.code = true;
        ccSeen(row, 'text');
    }
    return i + 1;
}

function ccMarkupTagStep(st, text, i, row) {
    const ch = text[i];
    if (!/\s/.test(ch)) {
        row.code = true;
        ccSeen(row, 'tag');
    }
    if (st.quote) {
        if (ch === st.quote) st.quote = '';
        return i + 1;
    }
    if (ch === '"' || ch === "'") {
        st.quote = ch;
        return i + 1;
    }
    if (ch !== '>') return i + 1;
    const self = text[i - 1] === '/';
    if (st.closing) {
        if (st.name === 'pre') st.pre = Math.max(0, st.pre - 1);
        st.mode = 'text';
    } else if (!self && CC_RAW_TAGS.has(st.name)) st.mode = 'raw';
    else {
        if (!self && st.name === 'pre') st.pre += 1;
        st.mode = 'text';
    }
    return i + 1;
}

function ccLexMarkup(lines) {
    const st = { mode: 'text', quote: '', name: '', closing: false, pre: 0, units: 0, unit: 0 };
    const why = () => (st.mode === 'comment' ? 'comment' : st.mode === 'text' && !st.pre ? '' : 'markup');
    const rows = lines.map(text => {
        const row = ccRow();
        row.startWhy = why();
        for (let i = 0; i < text.length;) i = ccMarkupStep(st, text, i, row);
        row.endWhy = why();
        row.codeText = ccCodeText(text, row.marks);
        return row;
    });
    return { rows, tail: why() };
}

// xml·svg·xaml: 요소 글자는 값이라 주석 줄이나 줄 끝 주석이 끼면 글자(줄바꿈·공백)가 바뀐다.
// 앞에 마지막으로 본 것과 뒤에 처음 보는 것이 모두 태그(또는 블록 처음·끝)인 자리만 열고, 글자가 닿는 자리는 'text'로 막는다
function ccMarkupTextRules(rows, gaps, ends) {
    const lastUpTo = at => {
        for (let k = at; k >= 0; k -= 1) if (rows[k].last) return rows[k].last;
        return '';
    };
    const firstFrom = at => {
        for (let k = at; k < rows.length; k += 1) if (rows[k].first) return rows[k].first;
        return '';
    };
    gaps.forEach((why, g) => {
        if (!why && (lastUpTo(g - 1) === 'text' || firstFrom(g) === 'text')) gaps[g] = 'text';
    });
    ends.forEach((why, at) => {
        if (!why && rows[at].kind !== 'blank' && (lastUpTo(at) === 'text' || firstFrom(at + 1) === 'text')) ends[at] = 'text';
    });
}

/* ---------- 4. 주석 세기와 넣을 수 있는 자리 ---------- */
// 줄 갈래: blank · comment(주석만) · mixed(코드 + 주석) · code · directive(#! 같은 지시 줄) · data(__END__ 뒤)
function ccKind(row, text) {
    if (row.kind) return row.kind;
    if (!text.trim()) return 'blank';
    if (row.code) return row.units.length ? 'mixed' : 'code';
    return row.units.length ? 'comment' : 'code';
}

// 맨 앞 지시 줄(python·ruby coding, dockerfile # 이름=값, xml 선언): 그 줄 위에는 넣지 않고 주석으로 세지 않는다
function ccHeadRules(spec, kit, lines, rows, gaps) {
    if (rows[0] && rows[0].kind === 'directive') gaps[0] = 'shebang';
    if (kit.coding) {
        [0, 1].filter(at => rows[at] && rows[at].kind === 'comment' && CC_CODING.test(lines[at])).forEach(at => {
            rows[at].kind = 'directive';
            gaps[at] = gaps[at] || 'directive';
            if (at === 1) gaps[0] = gaps[0] || 'directive'; // 맨 위에 줄을 더하면 둘째 줄 선언이 셋째 줄로 밀려나 선언이 아니게 된다
        });
    }
    if (kit.docker) {
        for (let at = 0; at < lines.length && rows[at].kind === 'comment' && CC_DOCKER_DIRECTIVE.test(lines[at]); at += 1) {
            rows[at].kind = 'directive';
            gaps[at] = gaps[at] || 'directive';
        }
    }
    if (spec.lex === 'markup' && /^\s*<\?xml\b/i.test(lines[0] || '')) gaps[0] = gaps[0] || 'directive';
}

// JSX처럼 보이는 줄: < 로 시작하는 줄 앞, > 로 끝나는 줄 뒤(=> 는 빼고), 그런 줄 끝에는 넣지 않는다
const ccJsxOpens = row => /^\s*<(?![<=])/.test(row.codeText);
const ccJsxCloses = row => />\s*$/.test(row.codeText) && !/=>\s*$/.test(row.codeText);
function ccJsxRules(lines, rows, gaps, ends) {
    const filled = lines.map(line => !!line.trim());
    gaps.forEach((why, g) => {
        if (why) return;
        let prev = g - 1;
        while (prev >= 0 && !filled[prev]) prev -= 1;
        let next = g;
        while (next < lines.length && !filled[next]) next += 1;
        if ((prev >= 0 && ccJsxCloses(rows[prev])) || (next < lines.length && ccJsxOpens(rows[next]))) gaps[g] = 'jsx';
    });
    rows.forEach((row, at) => { if (!ends[at] && filled[at] && (ccJsxOpens(row) || ccJsxCloses(row))) ends[at] = 'jsx'; });
}

// yaml 여러 줄 평문 값: 주석이 값을 끊으므로 이어지는 줄 사이와 앞 줄 끝에는 넣지 않는다.
// 값이 시작하는 줄: 키: 값 · - 값(따옴표 키, &앵커·!태그 뒤 값도), 또는 값 없는 키:·-(&앵커·!태그만 있어도) 다음 줄에 더 들여 써 시작한 평문
const CC_YAML_NEW_NODE = /^\s*(?:-(?:\s|$)|#|[^\s#][^#]*?:(?:\s|$))/;
const CC_YAML_ENTRY = /^\s*((?:-(?:[ \t]+|$))*)(?:("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s'"?][^\n]*?)[ \t]*:(?:[ \t]+|$))?/;
const CC_YAML_NOT_PLAIN = /^(?:[|>*\[{"'#%@`]|[-?:](?:\s|$))/; // 블록 글·별칭·흐름·따옴표·주석·예약 글자로 시작하면 평문이 아니다

// 줄 머리 뜯어보기(주석을 지운 줄): { plain: 같은 줄에서 평문 값이 시작함, empty: 값이 비어 다음 줄에서 시작할 수 있음 }
function ccYamlHead(codeText) {
    const m = codeText.match(CC_YAML_ENTRY);
    const lead = !!m[1] || m[2] !== undefined; // - 항목이거나 키가 있다
    const value = codeText.slice(m[0].length).replace(/^(?:[&!]\S*[ \t]*)+/, '').trim(); // &앵커 · !태그는 뗀다
    return { plain: lead && !!value && !CC_YAML_NOT_PLAIN.test(value), empty: lead && !value };
}

function ccYamlPlainRules(lines, rows, gaps, ends) {
    const indent = line => line.match(/^ */)[0].length;
    let start = -1;   // 여러 줄 평문 값의 첫 줄
    let parent = -1;  // 이어지는 줄이 넘어야 하는 들여쓰기
    let pending = -1; // 값 없는 키:·- 줄의 들여쓰기(다음 줄에서 평문 값이 시작할 수 있다)
    const protect = (from, to) => {
        for (let g = from + 1; g <= to; g += 1) gaps[g] = gaps[g] || 'string';
        for (let e = from; e < to; e += 1) if (lines[e].trim()) ends[e] = ends[e] || 'string';
    };
    rows.forEach((row, at) => {
        if (row.kind === 'blank') return;
        if (row.kind !== 'code' && row.kind !== 'mixed') {
            start = -1;
            pending = -1;
            return;
        }
        const deeper = limit => limit >= 0 && !row.startWhy && indent(lines[at]) > limit && !CC_YAML_NEW_NODE.test(lines[at]);
        if (start >= 0 && deeper(parent)) {
            protect(start, at);
            return;
        }
        if (pending >= 0 && deeper(pending) && ccYamlHead(`- ${row.codeText.trim()}`).plain) { // 값 없는 키 아래에서 평문 값이 시작한다
            start = !row.endWhy && !row.units.length ? at : -1;
            parent = pending;
            pending = -1;
            return;
        }
        const head = ccYamlHead(row.codeText);
        start = !row.endWhy && head.plain && !row.units.length ? at : -1;
        parent = indent(lines[at]);
        pending = !row.endWhy && head.empty ? indent(lines[at]) : -1;
    });
}

// batch 괄호 블록 깊이(줄 머리 기준). 괄호 안에서는 :: 대신 REM을 쓴다
function ccBatchDepth(rows) {
    let depth = 0;
    rows.forEach(row => {
        row.depth = depth;
        const code = row.codeText.replace(/"[^"]*"/g, '').replace(/\^./g, '');
        for (const ch of code) {
            if (ch === '(') depth += 1;
            else if (ch === ')') depth = Math.max(0, depth - 1);
        }
    });
    return depth;
}

// 주석 자리 수: 이어진 주석 줄 묶음 하나, 코드 줄의 주석 하나, 여러 줄 블록 주석 하나를 각각 1로 센다(같은 블록 주석은 한 번만)
function ccCountRows(rows) {
    const parent = new Map();
    const find = unit => (parent.get(unit) === unit ? unit : find(parent.get(unit)));
    const join = (a, b) => parent.set(find(a), find(b));
    let codeLines = 0;
    let prev = null;
    rows.forEach(row => {
        if (row.kind === 'code' || row.kind === 'mixed') codeLines += 1;
        if (row.kind === 'comment' || row.kind === 'mixed') row.units.forEach(unit => { if (!parent.has(unit)) parent.set(unit, unit); });
        if (row.kind === 'comment') {
            row.units.forEach(unit => { if (prev !== null) join(unit, prev); });
            prev = row.units[0];
        } else {
            prev = null; // 빈 줄·코드 줄이 묶음을 나눈다
        }
    });
    return { codeLines, comments: new Set([...parent.keys()].map(find)).size };
}

// 주석을 넣을 수 없는 안쪽 줄의 까닭(줄 위와 줄 끝이 모두 이 까닭이면 필요 수를 셀 때 그 줄을 뺀다)
const CC_INNER_WHY = new Set(['string', 'heredoc', 'block', 'define', 'verbatim', 'markup', 'comment', 'text']);

// 필요한 주석 수: 안쪽 줄(문자열·히어독·블록 글 안)을 뺀 코드 줄로 센 수와, 지금 주석 + 새 주석 묶음을 따로 더할 수 있는 자리 수 가운데 작은 쪽.
// 따로 더할 수 있는 자리: 주석 줄과 붙지 않은 허용된 줄 위 자리, 주석이 없는 코드 줄의 허용된 줄 끝. 그래서 필요 수는 언제나 채울 수 있다
function ccNeed(rows, gaps, ends, codeLines, comments) {
    const hasCode = row => row.kind === 'code' || row.kind === 'mixed';
    const inner = rows.filter((row, at) => hasCode(row) && CC_INNER_WHY.has(gaps[at]) && CC_INNER_WHY.has(ends[at])).length;
    const isComment = at => rows[at]?.kind === 'comment';
    const above = gaps.filter((why, g) => !why && !isComment(g - 1) && !isComment(g)).length;
    const after = rows.filter((row, at) => row.kind === 'code' && !ends[at]).length;
    return Math.min(codeCommentNeed(codeLines - inner), comments + above + after);
}

// 한 블록을 훑은 결과: rows, gaps(줄 g 위에 넣으면 안 되는 까닭, 마지막은 끝 뒤), ends(줄 끝 까닭), codeLines, comments, need. lang은 언어 키다
function ccLexBlock(lang, lines, dialect = '') {
    const spec = CODE_COMMENT_LANGS[lang];
    const kit = CC_KITS[spec.lex] || {};
    const base = spec.lex === 'markup' ? ccLexMarkup(lines) : ccLexCode(spec, lines, String(dialect || '').toLowerCase());
    const rows = base.rows.map((row, at) => ({ ...row, kind: ccKind(row, lines[at]) }));
    const gaps = [...rows.map(row => row.startWhy), base.tail];
    ccHeadRules(spec, kit, lines, rows, gaps);
    const ends = rows.map(row => (row.kind === 'blank' ? '' : row.endWhy || (row.kind === 'directive' || row.kind === 'data' ? row.kind : '') || (spec.eol ? '' : 'noeol')));
    if (kit.jsx) ccJsxRules(lines, rows, gaps, ends);
    if (kit.yaml) ccYamlPlainRules(lines, rows, gaps, ends);
    if (spec.xmlText) ccMarkupTextRules(rows, gaps, ends);
    const depthAfter = kit.batch ? ccBatchDepth(rows) : 0;
    const { codeLines, comments } = ccCountRows(rows);
    return { rows, gaps, ends, depthAfter, codeLines, comments, need: ccNeed(rows, gaps, ends, codeLines, comments) };
}

// 코드 줄: 글이면 줄마다, 배열이면 원소 안의 줄바꿈도 줄로 나누고, 줄 끝 \r 을 뗀다(CRLF 글·줄을 그대로 넘겨도 된다)
const ccLines = code => (Array.isArray(code) ? code : [code ?? '']).flatMap(text => String(text).split('\n')).map(line => line.replace(/\r$/, ''));

// 코드 줄 수·주석 자리 수·필요한 주석 수·모자란지. lang은 언어 키나 이름표(py · cs · mysql…).
// 모르는 언어는 검사하지 않는다(모두 0, unknown: true)
function codeCommentCount(lang, lines, { dialect = '' } = {}) {
    const { key, dialect: kind } = ccResolve(lang, dialect);
    if (!key) return { codeLines: 0, comments: 0, need: 0, short: false, unknown: true };
    const lex = ccLexBlock(key, ccLines(lines), kind);
    return { codeLines: lex.codeLines, comments: lex.comments, need: lex.need, short: lex.comments < lex.need };
}

// 넣을 수 있는 자리: gaps[g](g째 줄 위, 마지막은 끝 뒤)와 ends[i](i째 줄 끝)마다 { ok, why }. 모르는 언어는 null
function codeCommentZones(lang, lines, { dialect = '' } = {}) {
    const { key, dialect: kind } = ccResolve(lang, dialect);
    if (!key) return null;
    const lex = ccLexBlock(key, ccLines(lines), kind);
    const mark = why => ({ ok: !why, why });
    return { gaps: lex.gaps.map(mark), ends: lex.ends.map(mark) };
}

const ccCountBlock = block => codeCommentCount(block.lang, block.lines, { dialect: block.label });

/* ---------- 5. 주석만 더했는지 확인 ---------- */
const CC_LINE_BREAKS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}\\r]`); // 줄을 나누는 글자(js는 U+2028·U+2029와 \r 하나도 줄 끝으로 읽는다)
const ccSnip = text => {
    const one = String(text).trim();
    return one.length > 60 ? `${one.slice(0, 60)}…` : one;
};
const ccNorm = text => String(text).replace(/\u00A0/g, ' ').replace(/[ \t]+$/, ''); // 줄 끝 공백과 특수 공백 차이는 봐준다
const ccSame = (a, b) => ccNorm(a) === ccNorm(b);
const ccWhyText = why => CODE_COMMENT_WHY[why] || why;

// 이 언어의 주석 기호로 시작하는 줄인지(맞는 모양인지는 ccShape가 본다)
function ccLooksComment(spec, text) {
    const t = text.replace(/^[ \t]+/, '');
    if (spec.lex === 'bat') return /^(?:@?rem\b|::)/i.test(t);
    return spec.line.some(mark => t.startsWith(mark)) || [spec.addBlock, spec.block].some(pair => pair && t.startsWith(pair[0]));
}

// AI 줄이 원래 줄 뒤에 공백 + 주석만 붙인 꼴이면 붙인 부분(앞 공백 포함, 뒤 공백 뗌)
function ccTail(orig, line) {
    if (!orig.trim()) return null;
    const base = ccNorm(orig);
    if (!line.replace(/\u00A0/g, ' ').startsWith(base)) return null;
    const rest = line.slice(base.length).replace(/[ \t]+$/, '');
    return /^[ \t]+\S/.test(rest) ? rest : null;
}

// AI가 이 주석 줄 뒤, 다음 코드 줄 앞에 빈 줄을 두었는지(그렇다면 원래 빈 줄은 주석 아래에 둔다)
function ccBlankAhead(spec, theirs, j) {
    for (let k = j + 1; k < theirs.length; k += 1) {
        if (!theirs[k].trim()) return true;
        if (!ccLooksComment(spec, theirs[k])) return false;
    }
    return false;
}

// 앞서 맞춘 줄 가운데 블록 주석을 열고 그 줄에서 닫지 않은 주석(여러 줄 블록 주석을 쓰려 한 꼴). 없으면 null
function ccOpenedBlock(spec, items) {
    const pairs = [spec.addBlock, spec.block].filter(Boolean);
    const opens = text => pairs.some(([open, close]) => text.startsWith(open) && !text.slice(open.length).includes(close));
    for (let n = items.length - 1; n >= 0; n -= 1) {
        const text = (items[n].add ?? items[n].tail ?? '').trim();
        if (text && opens(text)) return text;
    }
    return null;
}

// 원래 줄과 AI 줄을 맞춘다: { orig: i } 원래 줄, { orig: i, tail } 줄 끝 주석, { add, at } 더한 줄(at번째 원래 줄 위). 원래 줄이 빠지거나 바뀌면 reason.
// 원래 줄과 같은 줄은 ``` · ~~~ 로 시작해도 받는다(앱은 ``` 만 펜스로 보므로, 더한 줄에서는 ``` 만 막는다)
function ccAlign(spec, orig, theirs) {
    const items = [];
    let i = 0;
    for (let j = 0; j < theirs.length; j += 1) {
        const line = theirs[j];
        for (;;) {
            if (i < orig.length && ccSame(line, orig[i])) {
                items.push({ orig: i });
                i += 1;
                break;
            }
            if (!line.trim()) break; // AI가 더한 빈 줄은 버린다
            const tail = i < orig.length ? ccTail(orig[i], line) : null;
            if (tail !== null) {
                items.push({ orig: i, tail });
                i += 1;
                break;
            }
            const comment = ccLooksComment(spec, line);
            if (i < orig.length && !orig[i].trim() && !(comment && ccBlankAhead(spec, theirs, j))) { // AI가 뺀 빈 줄은 되살리고 다시 맞춘다
                items.push({ orig: i });
                i += 1;
                continue;
            }
            if (comment) {
                items.push({ add: line.replace(/[ \t]+$/, ''), at: i });
                break;
            }
            if (/^\s*`{3,}/.test(line)) return { reason: `\`\`\` 로 시작하는 줄은 코드 블록을 닫아 쓸 수 없습니다: ${ccSnip(line)}` };
            const opened = ccOpenedBlock(spec, items);
            if (opened !== null) return { reason: `여러 줄 블록 주석은 쓸 수 없습니다. 블록 주석은 한 줄에서 열고 닫습니다: ${ccSnip(opened)}` };
            if (i >= orig.length) return { reason: `코드 끝에 주석이 아닌 줄(코드)을 더했습니다: ${ccSnip(line)}` };
            const later = theirs.slice(j + 1).some(rest => ccSame(rest, orig[i]));
            return { reason: later ? `${i + 1}째 줄 위에 주석이 아닌 줄(코드)을 더했습니다: ${ccSnip(line)}` : `원래 ${i + 1}째 줄이 바뀌었습니다: ${ccSnip(orig[i])} → ${ccSnip(line)}` };
        }
    }
    for (; i < orig.length && !orig[i].trim(); i += 1) items.push({ orig: i });
    return i < orig.length ? { reason: `원래 ${i + 1}째 줄이 빠졌습니다: ${ccSnip(orig[i])}` } : { items };
}

// 기호를 겹쳐 쓴 꼴(/// · ## · --- · ;; · %% · ''')을 받지 않는 갈래: rust(/// · //! 는 문서 주석), sql(mysql은 -- 뒤에 공백을 요구한다), batch
const CC_NO_REPEAT = new Set(['rust', 'sql', 'bat']);
// 주석 안의 \u 를 소스 앞 단계에서 글자로 바꿔 읽는 갈래(java·groovy·scala 2). \u 뒤가 16진수가 아니면 java는 컴파일 오류다
const CC_UNICODE_ESCAPES = new Set(['java', 'groovy', 'scala']);

// 한 줄짜리 줄 주석 모양. 이 언어의 줄 주석 기호로 시작하지 않으면 null, 맞으면 '', 틀리면 까닭
function ccLineShape(spec, text) {
    const marks = [...spec.add].sort((a, b) => b.length - a.length); // 긴 기호부터(c#의 /// 와 //)
    const mark = marks.find(m => (spec.lex === 'bat' ? text.toUpperCase().startsWith(m.toUpperCase()) : text.startsWith(m)));
    if (!mark) return null;
    let rest = text.slice(mark.length);
    if (spec.lex === 'rust' && /^[/!]/.test(rest)) return 'rust의 /// · //! 는 문서 주석이라 쓸 수 없습니다';
    if (!CC_NO_REPEAT.has(spec.lex)) {
        const last = mark[mark.length - 1];
        let k = 0;
        while (rest[k] === last) k += 1; // 겹쳐 쓴 기호는 기호로 본다(/// · ## · ---)
        rest = rest.slice(k);
    }
    if (spec.lex === 'r') rest = rest.replace(/^'/, ''); // roxygen #'
    if (!rest.trim()) return '주석 내용이 비었습니다';
    if (!rest.startsWith(' ')) return '주석 기호 뒤에 공백을 한 칸 둡니다';
    if (spec.lex === 'js' && /^\/\/\/\s*</.test(text)) return '/// < 꼴은 TypeScript 지시 주석으로 읽힙니다';
    if (spec.lex === 'pl' && /^#\s*line\s+\d/.test(text)) return 'perl의 # line 숫자 꼴 주석은 줄 번호를 바꿉니다';
    if (spec.lex === 'php' && rest.includes('?>')) return '?> 가 든 주석은 PHP 코드를 닫습니다';
    if (spec.lex === 'bat' && (/\^\s*$/.test(rest) || /%~/.test(rest) || /^\s*\/\?/.test(rest))) return '^ 로 끝나거나 %~ · /? 가 든 batch 주석은 쓸 수 없습니다';
    if (spec.lex === 'docker' && CC_DOCKER_DIRECTIVE.test(text)) return '# 이름=값 꼴은 지시 줄로 읽힐 수 있습니다';
    return '';
}

// 한 줄에서 닫히는 블록 주석 모양(/* … */, /** … */, /*! … */, <!-- … -->). 여는 기호로 시작하지 않으면 null
function ccBlockShape(spec, text) {
    if (!spec.addBlock || !text.startsWith(spec.addBlock[0])) return null;
    const [open, close] = spec.addBlock;
    if (!text.endsWith(close) || text.length < open.length + close.length + 2) return '한 줄에서 닫히지 않는 블록 주석은 쓸 수 없습니다';
    const inner = text.slice(open.length, -close.length);
    if (inner.includes(close)) return '닫는 기호가 주석 중간에 또 있습니다';
    if (inner.includes(open)) return '주석 안에 여는 기호가 또 있습니다';
    if (spec.lex === 'rust' && /^[*!]/.test(inner)) return 'rust의 /** */ · /*! */ 는 문서 주석이라 쓸 수 없습니다';
    if (spec.lex === 'sql' && /^[!+]/.test(inner)) return 'sql의 /*! */ · /*+ */ 는 코드나 힌트로 읽힙니다';
    const body = open === '/*' ? inner.replace(/^(?:\*+|!)/, '') : inner; // 문서 주석 꼴 /** … */ · /*! … */
    if (!/^\s/.test(body) || !/\s$/.test(body)) return '주석 기호 안쪽 앞뒤에 공백을 둡니다';
    if (!body.trim()) return '주석 내용이 비었습니다';
    if (open === '<!--' && (inner.includes('--') || inner.trimEnd().endsWith('-'))) return '<!-- --> 안에는 -- 를 쓸 수 없습니다';
    return '';
}

// 주석 하나(앞 공백을 뗀 글)가 이 언어에서 쓸 수 있는 한 줄 주석인지. 맞으면 '', 틀리면 까닭
function ccShape(spec, lang, text) {
    if (/[\u0000-\u0008\u000A-\u001F\u007F\u0085]/.test(text) || CC_LINE_BREAKS.test(text)) return '줄을 나누거나 보이지 않는 글자가 들어 있습니다';
    if (text.length > CODE_COMMENT_MAX_CHARS) return `주석이 ${CODE_COMMENT_MAX_CHARS}자를 넘습니다`;
    if (/(?:\\|\?\?\/)\s*$/.test(text)) return '주석을 \\ 로 끝내면 다음 줄까지 이어질 수 있습니다';
    if (CC_UNICODE_ESCAPES.has(spec.lex) && /\\u/.test(text)) return `\\u 가 든 주석은 ${spec.name}가 이스케이프로 바꿔 읽습니다(줄바꿈이나 */ 가 될 수 있습니다)`;
    if ((spec.lex === 'lua' || spec.lex === 'luau') && /^--\[=*\[/.test(text)) return '--[[ 로 여는 긴 주석은 쓸 수 없습니다';
    const line = ccLineShape(spec, text);
    if (line !== null) return line;
    const block = ccBlockShape(spec, text);
    if (block !== null) return block;
    return `${spec.name}에서 쓰는 주석 기호(${codeCommentMarks(lang)})로 시작하지 않습니다`;
}

// 맞춘 줄마다 자리와 모양을 본다. 틀리면 까닭
function ccCheckItems(spec, lang, lex, items) {
    for (let n = 0; n < items.length; n += 1) {
        const item = items[n];
        if (item.tail) {
            const end = lex.ends[item.orig];
            if (end) return `${item.orig + 1}째 줄 끝에는 주석을 달 수 없습니다(${ccWhyText(end)}): ${ccSnip(item.tail)}`;
            const why = ccShape(spec, lang, item.tail.replace(/^[ \t]+/, ''));
            if (why) return `${item.orig + 1}째 줄 끝 주석을 쓸 수 없습니다(${why}): ${ccSnip(item.tail)}`;
        }
        if (item.add === undefined) continue;
        const where = item.at < lex.rows.length ? `${item.at + 1}째 줄 위` : '코드 끝 뒤';
        const gap = lex.gaps[item.at];
        if (gap) return `${where}에는 주석을 넣을 수 없습니다(${ccWhyText(gap)}): ${ccSnip(item.add)}`;
        const lead = item.add.match(/^\s*/)[0];
        if (/[^ \t]/.test(lead)) return `주석 줄 앞에는 공백과 탭만 씁니다: ${ccSnip(item.add)}`;
        if (spec.lex === 'make' && lead.includes('\t')) return `makefile에서 탭으로 시작하는 줄은 명령이 됩니다. 주석 줄은 탭 없이 씁니다: ${ccSnip(item.add)}`;
        const text = item.add.slice(lead.length);
        const why = ccShape(spec, lang, text);
        if (why) return `${where}의 주석을 쓸 수 없습니다(${why}): ${ccSnip(item.add)}`;
        if (spec.lex === 'bat' && text.startsWith('::') && (item.at < lex.rows.length ? lex.rows[item.at].depth : lex.depthAfter) > 0) return `괄호 블록 안에서는 :: 대신 REM 을 씁니다: ${ccSnip(item.add)}`;
    }
    return '';
}

// python·ruby: 첫 두 줄의 coding 선언(주석만 있는 줄의 coding: · coding=)이 고친 뒤에도 그대로인지. 줄 위 주석이든 줄 끝 주석이든
// 새 선언이 생기거나 원래 선언이 셋째 줄 밖으로 밀려나면 까닭
function ccCodingDrift(orig, out) {
    const declared = lines => lines.slice(0, 2).filter(line => CC_CODING.test(line));
    const before = declared(orig);
    const after = declared(out);
    const added = after.find(line => !before.includes(line));
    if (added !== undefined) return `첫 두 줄의 coding 주석은 파일 인코딩 선언이 됩니다: ${ccSnip(added)}`;
    const lost = before.find(line => !after.includes(line));
    return lost === undefined ? '' : `coding 선언이 첫 두 줄 밖으로 밀려납니다: ${ccSnip(lost)}`;
}

// 다시 짠 코드를 다시 훑어, 더한 줄이 주석으로 읽히고 원래 줄의 코드 여부와 앞 상태가 그대로인지 본다
function ccDrift(before, after, items) {
    for (let n = 0; n < items.length; n += 1) {
        const item = items[n];
        const row = after.rows[n];
        if (item.add !== undefined) {
            if (row.kind !== 'comment') return `더한 줄이 주석으로 읽히지 않습니다: ${ccSnip(item.add)}`;
            continue;
        }
        const old = before.rows[item.orig];
        const hasCode = kind => kind === 'code' || kind === 'mixed';
        if (hasCode(old.kind) !== hasCode(row.kind) || old.startWhy !== row.startWhy) return `주석을 더하면 ${item.orig + 1}째 줄을 읽는 방법이 바뀝니다: ${ccSnip(item.add ?? item.tail ?? '')}`;
    }
    return '';
}

const ccWithTail = (line, tail) => line + (/[ \t]$/.test(line) ? tail.replace(/^[ \t]+/, '') : tail);
const ccBuild = (orig, items) => items.map(item => (item.add !== undefined ? item.add : item.tail ? ccWithTail(orig[item.orig], item.tail) : orig[item.orig]));

// 내부 확인: 결과에 맞춘 줄(items)도 준다. 원래 줄과 답 모두 ccLines로 나눈다(배열 원소 안의 줄바꿈도 줄을 나눈다)
function ccVerify(block, answer) {
    const { key, dialect } = ccResolve(block?.lang, block?.label);
    const spec = key ? CODE_COMMENT_LANGS[key] : null;
    const orig = ccLines(Array.isArray(block?.lines) ? block.lines : []);
    const fail = reason => ({ ok: false, code: orig.join('\n'), added: 0, reason, enough: false, comments: 0, need: 0, codeLines: 0, items: null });
    if (!spec) return fail('검사하지 않는 코드 블록입니다.');
    const theirs = ccLines(answer);
    const plan = ccAlign(spec, orig, theirs);
    if (plan.reason) return fail(plan.reason);
    const before = ccLexBlock(key, orig, dialect);
    const bad = ccCheckItems(spec, key, before, plan.items);
    if (bad) return fail(bad);
    const out = ccBuild(orig, plan.items);
    const coding = CC_KITS[spec.lex]?.coding ? ccCodingDrift(orig, out) : '';
    if (coding) return fail(coding);
    const after = ccLexBlock(key, out, dialect);
    const drift = ccDrift(before, after, plan.items);
    if (drift) return fail(drift);
    const added = plan.items.filter(item => item.add !== undefined || item.tail).length;
    return { ok: true, code: out.join('\n'), added, reason: '', enough: after.comments >= after.need, comments: after.comments, need: after.need, codeLines: after.codeLines, items: plan.items };
}

// AI가 돌려준 코드(answer: 글 또는 줄 배열)가 원래 줄은 그대로 두고 허용된 자리에 주석만 더했는지 본다.
// 줄 배열이면 원소 안의 줄바꿈(\n · \r\n)도 줄을 나누는 글자로 본다(원소 하나에 주석과 코드를 함께 넣어도 코드는 막힌다).
// 결과 { ok, code(원래 줄 + 허용된 주석으로 다시 짠 코드, 실패면 원래 코드), added, reason, enough, comments, need, codeLines }
function codeCommentVerify(block, answer) {
    const { items, ...result } = ccVerify(block, answer);
    return result;
}

// 주석을 뺀 코드 줄(차례대로): 주석만 든 줄은 빼고, 코드 줄은 주석 글자(사이 공백까지)를 지운 뒤 줄 끝 공백을 뗀다. 빈 줄은 남기고,
// 맨 앞 지시 줄(#! · coding 선언)과 __END__ 뒤 데이터는 주석처럼 보여도 코드라 그대로 둔다
function ccCodeSkeleton(key, lines, dialect) {
    const lex = ccLexBlock(key, lines, dialect);
    return lex.rows.flatMap((row, at) => {
        if (row.kind === 'comment') return [];
        const text = lines[at];
        if (row.kind === 'directive' || row.kind === 'data' || !row.marks.length) return [text.replace(/[ \t]+$/, '')];
        // 공백만 끼어 있는 주석 글자 자리는 한 주석이다(lexer는 주석 안의 낱말마다 자리를 남긴다)
        const spans = row.marks.reduce((list, [from, to]) => {
            const last = list[list.length - 1];
            return last && !text.slice(last[1], from).trim() ? [...list.slice(0, -1), [last[0], to]] : [...list, [from, to]];
        }, []);
        const kept = spans.map(([from], k) => text.slice(k ? spans[k - 1][1] : 0, from)).join('') + text.slice(spans[spans.length - 1][1]);
        return [kept.replace(/[ \t]+$/, '')];
    });
}

// 답(answer: 글 또는 줄 배열)이 주석만 고치거나 지웠는가: 주석을 뺀 코드 줄이 차례대로 같다. 주석을 더하기만 했는지는 codeCommentVerify가 본다.
// 문항의 교차 검수가 정답·출력 결과를 드러낸다고 지적한 주석을 고친 답을 받을 때 쓴다(lesson-review.js). 모르는 언어면 false
function codeCommentSameCode(block, answer) {
    const { key, dialect } = ccResolve(block?.lang, block?.label);
    if (!key) return false;
    const skeleton = lines => ccCodeSkeleton(key, lines, dialect).join('\n');
    return skeleton(ccLines(Array.isArray(block?.lines) ? block.lines : [])) === skeleton(ccLines(answer));
}

/* ---------- 6. 적용 ---------- */
// 블록 하나를 문서에 쓸 줄로: 원래 줄은 적힌 그대로, 줄 끝 주석은 원래 줄 뒤에, 더한 줄은 펜스 들여쓰기와 문서 줄끝을 붙인다
function ccRawLines(block, items) {
    const cr = block.eol === '\r\n' ? '\r' : '';
    return items.map(item => {
        if (item.add !== undefined) return `${block.indent}${item.add}${cr}`;
        const raw = block.raw[item.orig];
        if (!item.tail) return raw;
        const ends = raw.endsWith('\r');
        return ccWithTail(ends ? raw.slice(0, -1) : raw, item.tail) + (ends ? '\r' : '');
    });
}

// 고친 줄(line)이 원래 줄(want, 문서에 적힌 그대로)과 같거나, 원래 줄 뒤에 줄 끝 주석만 붙인 줄인지(ccWithTail과 같은 규칙:
// 원래 줄이 공백으로 끝나면 바로 붙고, 아니면 공백을 두고 붙는다). 빈 줄에는 줄 끝 주석이 붙지 않는다. 줄 끝 \r 여부도 같아야 한다
function ccKeptLine(line, want) {
    if (line === want) return true;
    const cr = want.endsWith('\r');
    if (line.endsWith('\r') !== cr) return false;
    const body = cr ? want.slice(0, -1) : want;
    const got = cr ? line.slice(0, -1) : line;
    const rest = got.slice(body.length);
    return !!body.trim() && got.startsWith(body) && !!rest.trim() && (/[ \t]$/.test(body) || /^[ \t]/.test(rest));
}

// 고친 뒤에도 블록 밖 글(펜스 줄 포함)이 같고, 블록마다 원래 줄이 차례대로 다 남았는지(줄 끝 주석만 붙었는지)
function ccKeepsCode(before, after) {
    const a = codeCommentBlocks(before);
    const b = codeCommentBlocks(after);
    if (a.length !== b.length) return false;
    const outside = (md, blocks) => {
        const inside = new Set(blocks.flatMap(block => block.raw.map((_, k) => block.openLine + 1 + k)));
        return md.split('\n').filter((_, k) => !inside.has(k)).join('\n');
    };
    if (outside(before, a) !== outside(after, b)) return false;
    return a.every((old, k) => {
        let i = 0;
        b[k].raw.forEach(line => {
            const want = old.raw[i];
            if (want !== undefined && ccKeptLine(line, want)) i += 1;
        });
        return i === old.raw.length;
    });
}

// 고친 블록들의 줄을 문서 줄에 끼운 새 문서 글(아래 블록부터 끼워 위 블록의 줄 번호가 밀리지 않게 한다)
function ccSplice(raw, edits) {
    return [...edits].sort((x, y) => y.block.openLine - x.block.openLine)
        .reduce((lines, { block, lines: add }) => [...lines.slice(0, block.openLine + 1), ...add, ...lines.slice(block.openLine + 1 + block.raw.length)], raw)
        .join('\n');
}

// 확인을 지난 고침만 넣은 새 문서. fixes: [{ index(블록 번호), code(AI가 돌려준 코드: 글 또는 줄 배열) }]
// 결과 { md, applied: [블록 번호], rejected: [{ index, reason }] }. 넣은 뒤 다시 확인하지 못한 블록은 그 블록만 빼고 넣는다
function codeCommentApply(md, fixes) {
    const source = String(md ?? '');
    const found = codeCommentBlocks(source);
    const edits = [];
    const rejected = [];
    (Array.isArray(fixes) ? fixes : []).forEach(fix => {
        const block = found[fix?.index];
        if (!block || block.skip || edits.some(edit => edit.block === block)) {
            rejected.push({ index: fix?.index, reason: '고칠 수 있는 코드 블록이 아닙니다.' });
            return;
        }
        const result = ccVerify(block, fix.code);
        if (!result.ok) rejected.push({ index: block.index, reason: result.reason });
        else edits.push({ block, lines: ccRawLines(block, result.items) });
    });
    const raw = source.split('\n');
    const indexes = list => list.map(edit => edit.block.index).sort((x, y) => x - y);
    const next = ccSplice(raw, edits);
    if (ccKeepsCode(source, next)) return { md: next, applied: indexes(edits), rejected };
    // 한 블록 때문에 같은 호출의 다른 블록까지 버리지 않게, 블록을 하나씩 더해 보며 다시 확인한다
    const kept = edits.reduce((list, edit) => (ccKeepsCode(source, ccSplice(raw, [...list, edit])) ? [...list, edit] : list), []);
    const dropped = edits.filter(edit => !kept.includes(edit)).map(edit => ({ index: edit.block.index, reason: '넣은 뒤 다시 확인하지 못해 넣지 않았습니다.' }));
    return { md: ccSplice(raw, kept), applied: indexes(kept), rejected: [...rejected, ...dropped] };
}

/* ---------- 7. AI 지시와 응답 해석 ---------- */
// 표시줄: 앞의 마크다운 제목(###)·목록 기호(- * +)·강조(** `)와 뒤의 강조·: 는 받아 준다
const CC_MARK_OPEN = /^\s*(?:#{1,6}\s+|[-*+]\s+)?[*`]*\s*<<<\s*code\s*#?\s*(\d+)\s*>>>\s*[*`]*\s*:?\s*$/i;
const CC_MARK_END = /^\s*(?:#{1,6}\s+|[-*+]\s+)?[*`]*\s*<<<\s*end\s*#?\s*\d*\s*>>>\s*[*`]*\s*:?\s*$/i;
const CC_FENCE_LINE = /^\s*(?:`{3,}|~{3,})[^`]*$/;

function ccSystemPrompt(quiz) {
    return [
        '교안의 코드 예제에 주석을 더하는 일을 합니다.',
        '[규칙]',
        '- 코드 글자·들여쓰기·빈 줄·순서는 한 글자도 바꾸지 않고 주석만 더합니다.',
        '- 코드 첫 줄 위에는 무엇을 하는 코드인지 적은 주석을 둡니다.',
        '- 핵심 줄 위나 줄 끝에는 그 줄이 하는 일을 적은 주석을 둡니다.',
        '- 코드 열 줄마다 주석을 하나 이상 둡니다.',
        '- 주석은 한국어로 짧게, 한 줄에 80자 안쪽으로 씁니다.',
        '- 이미 있는 주석은 그대로 둡니다.',
        '- 블록마다 알려 준 주석 기호만 쓰고, 기호 뒤에는 공백을 한 칸 둡니다.',
        '- 블록 주석(/* */ · <!-- -->)은 한 줄에서 열고 닫습니다. 여러 줄 블록 주석은 쓰지 않습니다.',
        '- 넣으면 안 되는 자리로 알려 준 곳(문자열·히어독 안, 줄 이어짐 다음 등)에는 주석을 넣지 않습니다.',
        '- 주석을 \\ 로 끝내지 않고, ``` 나 ~~~ 로 시작하는 줄을 쓰지 않습니다.',
        ...(quiz ? ['- 이 코드는 문항(문제)에 쓰는 코드입니다. 정답, 출력 결과, 고칠 곳을 주석에 쓰지 않고 코드가 하려는 일만 씁니다.'] : []),
        '[답하는 모양]',
        '- 블록마다 <<<CODE 번호>>> 줄, 주석을 더한 코드 전체, <<<END 번호>>> 줄을 차례로 씁니다.',
        '- 표시줄은 한 줄을 다 차지합니다. 코드를 ``` 로 감싸지 않고, 표시줄 밖에는 아무것도 쓰지 않습니다.'
    ].join('\n');
}

// 이어진 같은 까닭을 'a~b째 줄 위' 꼴로 묶는다
function ccRuns(list, label) {
    const notes = [];
    list.forEach((why, k) => {
        const last = notes[notes.length - 1];
        if (!why) return;
        if (last && last.why === why && last.to === k - 1) last.to = k;
        else notes.push({ why, from: k, to: k });
    });
    return notes.map(note => `- ${label(note)}: ${ccWhyText(note.why)}`);
}

// 블록마다 붙이는 '넣으면 안 되는 자리' 안내(줄 번호는 1부터)
function ccZoneNotes(spec, lex, lines) {
    const n = lines.length;
    const span = (from, to) => (from === to ? `${from + 1}째` : `${from + 1}~${to + 1}째`);
    const gapLabel = note => (note.from >= n ? '코드 끝 뒤' : `${span(note.from, Math.min(note.to, n - 1))} 줄 위${note.to >= n ? '와 코드 끝 뒤' : ''}`);
    const ends = lex.ends.map((why, k) => (why === 'noeol' || !lines[k].trim() ? '' : why));
    const notes = [...ccRuns(lex.gaps, gapLabel), ...ccRuns(ends, note => `${span(note.from, note.to)} 줄 끝`)].slice(0, CODE_COMMENT_ZONE_NOTES);
    const eol = spec.eol ? [] : ['- 이 언어는 줄 끝 주석을 쓰지 않습니다. 주석은 줄 위에 따로 씁니다.'];
    return [...eol, ...notes];
}

// 주석 기호 안내에 붙이는 '쓸 수 있는 꼴 · 쓰지 않는 꼴'(확인이 받는 꼴과 같다). 겹쳐 쓴 꼴은 첫 기호로 보이되(vb는 ''' 문서 주석), 이미 기호로 알린 꼴은 뺀다
function ccFormsNote(spec) {
    if (spec.lex === 'rust') return '/// · //! · /** */ 문서 주석은 쓰지 않습니다';
    if (spec.lex === 'sql') return '--- 와 /*! */ 는 쓰지 않습니다';
    const mark = spec.add[0];
    const repeat = !mark || CC_NO_REPEAT.has(spec.lex) ? '' : mark === "'" ? "'''" : mark + mark[mark.length - 1];
    const forms = [
        ...(repeat && !spec.add.includes(repeat) ? [repeat] : []),
        ...(spec.addBlock && spec.addBlock[0] === '/*' ? ['/** */'] : [])
    ];
    return forms.length ? `${forms.join(' · ')} 꼴도 됩니다` : '';
}

function ccBlockPrompt(item) {
    const block = item.block;
    const { key, dialect } = ccResolve(block.lang, block.label);
    const spec = CODE_COMMENT_LANGS[key];
    const lines = ccLines(item.lines || block.lines);
    const lex = ccLexBlock(key, lines, dialect);
    const no = block.index + 1;
    const where = spec.eol ? '줄 위에 따로 쓰거나 코드 뒤에 한 칸 띄우고 붙입니다' : '줄 위에 따로 씁니다';
    const zones = ccZoneNotes(spec, lex, lines);
    const forms = ccFormsNote(spec);
    return [
        `[블록 ${no}] ${spec.name} · 주석 기호: ${codeCommentMarks(key)} (${where})${forms ? ` · ${forms}` : ''}`,
        ...(block.context ? [`앞 설명: ${block.context.replace(/\n/g, ' / ')}`] : []),
        `코드 ${lex.codeLines}줄 · 지금 주석 ${lex.comments}개 · 주석 ${lex.need}개 이상 필요`,
        ...(zones.length ? ['넣으면 안 되는 자리:', ...zones] : []),
        ...(item.reason ? [`지난 답에서 고칠 점: ${item.reason} 코드는 그대로 두고 주석만 더해 다시 보내 주세요.`] : []),
        `<<<CODE ${no}>>>`, ...lines, `<<<END ${no}>>>`
    ].join('\n');
}

// 주석이 필요한 블록들을 보내는 지시 { system, user }. items: [{ block, lines?(지금 코드), reason?(지난 답이 틀린 까닭) }] 또는 블록 배열.
// quiz: 문항 모드(학습이해도·심화이해도·문제은행) — 정답·출력 결과·고칠 곳을 주석에 쓰지 않게 한다
function codeCommentPrompt(items, { quiz = false } = {}) {
    const list = (Array.isArray(items) ? items : []).map(item => (item && item.block ? item : { block: item })).filter(item => item.block && ccKey(item.block.lang));
    const user = [`아래 코드 블록 ${list.length}개에 주석을 더해 주세요.`, ...list.map(ccBlockPrompt)].join('\n\n');
    return { system: ccSystemPrompt(!!quiz), user };
}

const ccTrimBlank = lines => {
    let from = 0;
    let to = lines.length;
    while (from < to && !lines[from].trim()) from += 1;
    while (to > from && !lines[to - 1].trim()) to -= 1;
    return lines.slice(from, to);
};

// 표시 안을 감싼 펜스(```python … ```)를 뗀다. orig(원래 코드 줄)를 주면 원래 첫 줄·끝 줄과 같은 줄은 떼지 않는다(``` 로 시작하는 코드)
function ccUnwrap(lines, orig = null) {
    const same = (line, want) => !!orig && orig.length > 0 && want !== undefined && ccSame(line, want);
    const head = lines.length && CC_FENCE_LINE.test(lines[0]) && !same(lines[0], orig?.[0]) ? 1 : 0;
    const last = lines[lines.length - 1];
    const tail = lines.length > head && /^\s*(?:`{3,}|~{3,})\s*$/.test(last) && !same(last, orig?.[orig.length - 1]) ? 1 : 0;
    return ccTrimBlank(lines.slice(head, lines.length - tail));
}

// AI 답 → { 번호: [[줄, …], …] }(표시 안의 날 줄, 앞뒤 빈 줄만 뗀다). 같은 번호는 차례대로 모두 둔다
function ccParseRaw(text) {
    const out = {};
    let cur = null;
    const flush = () => {
        if (cur) out[cur.no] = [...(out[cur.no] || []), ccTrimBlank(cur.lines)];
        cur = null;
    };
    String(text ?? '').split(/\r?\n/).forEach(line => {
        const open = line.match(CC_MARK_OPEN);
        if (open) {
            flush();
            cur = { no: Number(open[1]), lines: [] };
        } else if (CC_MARK_END.test(line)) flush();
        else if (cur) cur.lines.push(line);
    });
    flush();
    return out;
}

// AI 답 → { 번호: [코드, …] }. 앞뒤 잡담·감싼 펜스·CRLF·표시줄 대소문자와 공백 차이·제목과 목록 기호를 견디고, 같은 번호는 차례대로 모두 둔다.
// 닫는 표시가 없으면 다음 여는 표시나 글 끝까지 받는다(확인이 걸러 낸다)
function codeCommentParse(text) {
    const raw = ccParseRaw(text);
    return Object.fromEntries(Object.keys(raw).map(no => [no, raw[no].map(lines => ccUnwrap(lines).join('\n'))]));
}

// 받은 답 하나에서 확인해 볼 코드: 원래 코드와 견준 펜스 떼기, 그리고 날 줄 그대로(답 첫 줄이 원래 첫 줄인 ``` 일 수 있다)
const ccAnswerCodes = (lines, orig) => [...new Set([ccUnwrap(lines, orig), lines].map(list => list.join('\n')))];

/* ---------- 8. 일괄 작업 ---------- */
// 블록(codeCommentBlocks 결과) 가운데 주석이 모자란 검사 대상을 고칠 블록(targets)과 부르는 쪽이 빼 둔 블록(held: skipBlock(block)이 참, 예: 고정 섹션)으로 나눈다.
// skipBlock은 주석이 모자란 블록마다 블록(section은 ## 제목 글)을 받는다. 함수가 아니면 빼지 않는다
function ccSplitTargets(blocks, skipBlock) {
    const short = blocks.filter(block => !block.skip && ccCountBlock(block).short);
    const held = typeof skipBlock === 'function' ? short.filter(block => skipBlock(block)) : [];
    return { targets: short.filter(block => !held.includes(block)), held };
}

// 주석이 모자란 검사 대상 블록(skipBlock이 참인 블록은 뺀다)
function codeCommentTargets(md, { skipBlock = null } = {}) {
    return ccSplitTargets(codeCommentBlocks(md), skipBlock).targets;
}

// 블록을 묶는다(묶음마다 블록 수·코드 글자 수 한도. 한도보다 큰 블록은 혼자 간다)
function ccBatches(blocks, maxBlocks, maxChars) {
    const size = block => block.lines.join('\n').length;
    return blocks.reduce((batches, block) => {
        const last = batches[batches.length - 1];
        const used = last ? last.reduce((sum, item) => sum + size(item), 0) : 0;
        return last && last.length < maxBlocks && used + size(block) <= maxChars ? [...batches.slice(0, -1), [...last, block]] : [...batches, [block]];
    }, []);
}

const ccLimit = (value, fallback) => Math.max(1, Math.floor(Number(value) || fallback));
// 다시 보내도 같은 오류(하루 한도·키 문제 등, ai-errors.js)이거나 중지면 일괄 작업을 멈춘다
const ccHalts = err => err?.name === 'AbortError' || !!err?.noRetry || (typeof aiErrorStopsRun === 'function' && aiErrorStopsRun(err));

// 받은 답 하나를 블록에 맞춰 넣는다. answers는 ccParseRaw 결과(번호마다 날 줄 목록). 다시 부를 블록이면 { block, reason }, 끝났으면 null
function ccTakeAnswer(job, item, answers) {
    const block = codeCommentBlocks(job.md)[item.block.index]; // 지금 글의 블록(앞에서 받은 주석이 들어 있을 수 있다)
    // 나중 답부터, 답마다 펜스를 뗀 코드 → 날 줄 차례로 본다(실패 까닭은 마지막 답의 펜스를 뗀 코드로 알린다)
    const candidates = [...(answers[block.index + 1] || [])].reverse().flatMap(lines => ccAnswerCodes(lines, block.lines));
    const results = candidates.map(code => ccVerify(block, code));
    const good = results.find(result => result.ok);
    const retry = reason => {
        job.failed.set(block.index, reason);
        return { block: codeCommentBlocks(job.md)[block.index], reason };
    };
    if (!good) return retry(results.length ? results[0].reason : 'AI 답에 이 블록이 없습니다.');
    const applied = codeCommentApply(job.md, [{ index: block.index, code: good.code }]);
    if (!applied.applied.length) return retry(applied.rejected[0]?.reason || '받은 주석을 넣지 못했습니다.');
    job.md = applied.md;
    if (good.enough) {
        job.fixed.add(block.index);
        job.failed.delete(block.index);
        return null;
    }
    return retry(`주석이 아직 부족합니다(코드 ${good.codeLines}줄에 주석 ${good.comments}개, ${good.need}개 이상 필요).`);
}

// 묶음 하나: 부르고, 확인에 실패했거나 아직 부족한 블록만 까닭을 붙여 한 번 더 부른다
async function ccRunBatch(job, batch, { ask, quiz, isStopped, onStatus }) {
    let items = batch.map(block => ({ block }));
    for (let round = 0; round < 2 && items.length; round += 1) {
        if (round && isStopped()) {
            job.stopped = true;
            return;
        }
        if (round) onStatus(`💬 코드 블록 ${items.length}개의 주석을 다시 받는 중입니다...`);
        job.calls += 1;
        let text;
        try {
            text = await ask(codeCommentPrompt(items, { quiz }));
        } catch (err) {
            const message = String(err?.message || err || '알 수 없는 오류');
            items.forEach(item => job.failed.set(item.block.index, `AI 호출에 실패했습니다: ${message}`));
            if (ccHalts(err)) job.error = message;
            return;
        }
        const answers = ccParseRaw(text);
        items = items.map(item => ccTakeAnswer(job, item, answers)).filter(Boolean); // 중지를 눌러도 받은 답은 넣는다
        if (isStopped()) {
            job.stopped = true;
            return;
        }
    }
}

// 문서의 주석이 모자란 코드 블록에 AI로 주석만 더한다. ask({ system, user }) → Promise<AI 답 글(가공하지 않은 날 글)>.
// skipBlock(block)이 참인 블록(고정 섹션 등)은 보내지도 고치지도 않는다.
// 결과 { md, fixed(주석이 넉넉해진 블록 번호), failed([{ index, reason }] 아직 모자란 블록 모두 — 받은 주석은 넣었을 수 있다.
//   중지·오류로 멈춰 보내지 못한 블록도 '멈춰서 보내지 않았습니다.'로 든다), remaining(끝난 뒤 주석이 모자란 블록 수, 뺀 블록은 세지 않는다),
//   held(주석이 모자라지만 skipBlock으로 빼서 고치지 않은 블록 수), calls(부른 횟수), stopped(중지), error(일괄 작업을 멈춘 오류 글) }.
// 원래 코드를 바꾼 문서는 돌려주지 않는다
async function codeCommentRun({ md, ask, quiz = false, isStopped = () => false, onStatus = () => {}, maxBlocks = CODE_COMMENT_BATCH_BLOCKS, maxChars = CODE_COMMENT_BATCH_CHARS, skipBlock = null } = {}) {
    if (typeof ask !== 'function') throw new TypeError('codeCommentRun: ask 함수가 필요합니다.');
    const source = String(md ?? '');
    const job = { md: source, calls: 0, fixed: new Set(), failed: new Map(), stopped: false, error: '' };
    const { targets, held } = ccSplitTargets(codeCommentBlocks(source), skipBlock);
    const batches = ccBatches(targets, ccLimit(maxBlocks, CODE_COMMENT_BATCH_BLOCKS), ccLimit(maxChars, CODE_COMMENT_BATCH_CHARS));
    let done = 0;
    for (const batch of batches) {
        if (isStopped()) {
            job.stopped = true;
            break;
        }
        onStatus(`💬 코드 블록에 주석을 다는 중입니다 · ${done + batch.length}/${targets.length}개`);
        await ccRunBatch(job, batch, { ask, quiz: !!quiz, isStopped, onStatus });
        done += batch.length;
        if (job.stopped || job.error) break;
    }
    // 멈춰서 보내지 못한 블록도 failed에 넣는다(failed만 보고 '실패 0개'로 알리면 남은 블록을 숨기게 된다)
    targets.filter(block => !job.fixed.has(block.index) && !job.failed.has(block.index)).forEach(block => job.failed.set(block.index, '멈춰서 보내지 않았습니다.'));
    const safe = ccKeepsCode(source, job.md);
    const finalMd = safe ? job.md : source;
    const failed = safe ? [...job.failed] : targets.map(block => [block.index, '고친 글을 다시 확인하지 못해 넣지 않았습니다.']);
    return {
        md: finalMd,
        fixed: safe ? [...job.fixed].sort((a, b) => a - b) : [],
        failed: failed.map(([index, reason]) => ({ index, reason })).sort((a, b) => a.index - b.index),
        remaining: codeCommentTargets(finalMd, { skipBlock }).length,
        held: held.length,
        calls: job.calls, stopped: job.stopped, error: job.error
    };
}

/* ---------- 9. 예고와 점검 ---------- */
// 예고: { checked(검사한 블록 수), needs(주석이 필요한 블록 수), calls(예상 AI 호출 수, 다시 부르기 빼고), unknown(모르는 이름표), skipped(검사하지 않은 블록 수) }.
// skipBlock을 주면 그 블록을 needs·calls에서 빼고 held(뺀 블록 가운데 주석이 모자란 수)를 더한다(주지 않으면 held 없이 예전 모양)
function codeCommentPreview(md, { maxBlocks = CODE_COMMENT_BATCH_BLOCKS, maxChars = CODE_COMMENT_BATCH_CHARS, skipBlock = null } = {}) {
    const found = codeCommentBlocks(md);
    const checked = found.filter(block => !block.skip);
    const { targets: needs, held } = ccSplitTargets(found, skipBlock);
    return {
        checked: checked.length, needs: needs.length,
        calls: ccBatches(needs, ccLimit(maxBlocks, CODE_COMMENT_BATCH_BLOCKS), ccLimit(maxChars, CODE_COMMENT_BATCH_CHARS)).length,
        unknown: [...new Set(found.filter(block => block.skip === 'unknown').map(block => block.label))],
        skipped: found.length - checked.length,
        ...(typeof skipBlock === 'function' ? { held: held.length } : {})
    };
}

// 점검: 주석이 모자란 블록을 lesson-lint 이슈 모양으로. where는 블록이 든 ## 섹션 제목(없으면 '본문'), snip은 첫 코드 줄.
// 고치기는 일괄 작업(codeCommentRun)이 맡는다(섹션 글을 통째로 고쳐 쓰는 자동 수정이 코드를 바꾸지 않게 기본은 권장 warn).
// 모르는 이름표의 블록과 ~~~ 펜스로 쓴 코드 블록(언어를 아는 것만)은 주석을 확인하지 못했다고 정보(info)로 알린다(snip은 이름표)
function codeCommentIssues(md, { sev = 'warn' } = {}) {
    return codeCommentBlocks(md).flatMap(block => {
        const where = block.section || '본문';
        if (block.skip === 'unknown') return [{ sev: 'info', where, msg: CODE_COMMENT_UNKNOWN_MSG, snip: block.label.slice(0, 40), block: block.index, lang: null, label: block.label }];
        if (block.skip === 'tilde' && block.lang) return [{ sev: 'info', where, msg: CODE_COMMENT_TILDE_MSG, snip: block.label.slice(0, 40), block: block.index, lang: block.lang, label: block.label }];
        if (block.skip) return [];
        const count = ccCountBlock(block);
        if (!count.short) return [];
        return [{
            sev, where, msg: CODE_COMMENT_LINT_MSG,
            snip: (block.lines.find(line => line.trim()) || '').trim().slice(0, 40),
            block: block.index, lang: block.lang, codeLines: count.codeLines, comments: count.comments, need: count.need
        }];
    });
}
