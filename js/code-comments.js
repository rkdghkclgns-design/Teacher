// code-comments.js - 교안 코드 블록(펜스 코드)에 주석이 넉넉한지 세고, AI가 주석만 더했는지 확인해 끼워 넣는다
// 블록은 앱이 코드 블록으로 보는 규칙(data.js fenceStateAfter, stashCodeFences와 같다)으로 찾는다. data.js를 먼저 불러야 한다.
// 언어마다 작은 lexer로 문자열·주석·히어독·블록 글을 줄을 넘어 따라가, 주석을 넣으면 코드의 뜻이 바뀌는 자리(보호 구역)를 막는다.
// AI 답은 원래 줄을 바이트 그대로 두고, 허용된 자리의 한 줄 주석과 줄 끝 주석만 받아 다시 짠다. 테스트: tests/code-comments.test.js

const CODE_COMMENT_LINES_PER = 10;       // 코드 이만큼마다 주석 하나 이상
const CODE_COMMENT_MAX_CHARS = 300;      // 주석 하나의 최대 글자 수
const CODE_COMMENT_CONTEXT_CHARS = 400;  // AI 지시에 붙이는 앞 설명 글 길이
const CODE_COMMENT_BATCH_BLOCKS = 8;     // 한 번에 보내는 블록 수
const CODE_COMMENT_BATCH_CHARS = 12000;  // 한 번에 보내는 코드 글자 수
const CODE_COMMENT_ZONE_NOTES = 8;       // 블록마다 알려 주는 '넣으면 안 되는 자리' 수
const CODE_COMMENT_LINT_MSG = '코드 블록에 주석을 넣습니다.';
const CODE_COMMENT_RULE_DESC = '코드 첫 줄 위에 무엇을 하는 코드인지, 핵심 줄 위나 끝에 그 줄이 하는 일을 적습니다. 코드 열 줄마다 주석을 하나 이상 둡니다.';
// 코드가 아니어서 검사하지 않는 이름표(실행 결과·다이어그램·데이터·문서)
const CODE_COMMENT_SKIP_LABELS = new Set(['text', 'txt', 'plaintext', 'plain', 'output', 'result', 'console', 'terminal', 'log', 'mermaid', 'json', 'csv', 'tsv', 'diff', 'patch', 'markdown', 'md']);
// 주석을 넣으면 안 되는 까닭(지시와 확인 실패 문구에 쓴다)
const CODE_COMMENT_WHY = {
    string: '여러 줄 문자열 안', comment: '여러 줄 블록 주석 안', heredoc: '히어독 안', block: 'YAML 블록 글(| 또는 >) 안',
    cont: '줄 이어짐 기호 다음', jsx: 'JSX 안', html: 'PHP 코드 밖(HTML 부분)', markup: '태그 안이나 script·style·pre 안',
    verbatim: 'verbatim 안', define: 'define 안', data: '__END__ 뒤 데이터', shebang: '첫 줄(#!) 위', directive: '맨 앞 지시 줄',
    noeol: '이 언어는 줄 끝 주석을 쓰지 않음'
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

// 언어 키: { name: 지시에 쓰는 이름, alias: 별칭, lex: 문자열·특수 문법 묶음(CC_KITS), eol: 줄 끝 주석을 쓸 수 있는지 }
const CODE_COMMENT_LANGS = {
    python: { name: 'Python', alias: ['py', 'python3'], ...CC_HASH, lex: 'py' },
    bash: { name: 'Bash', alias: ['sh', 'shell', 'zsh', 'ksh'], ...CC_HASH, lex: 'sh' },
    powershell: { name: 'PowerShell', alias: ['ps1', 'pwsh'], ...CC_HASH, lex: 'ps' },
    ruby: { name: 'Ruby', alias: ['rb'], ...CC_HASH, lex: 'rb' },
    perl: { name: 'Perl', alias: [], ...CC_HASH, lex: 'pl' },
    r: { name: 'R', alias: [], ...CC_HASH, lex: 'r' },
    yaml: { name: 'YAML', alias: ['yml'], ...CC_HASH, lex: 'yaml' },
    toml: { name: 'TOML', alias: [], ...CC_HASH, lex: 'toml' },
    dockerfile: { name: 'Dockerfile', alias: ['docker'], ...CC_HASH, eol: false, lex: 'docker' },
    makefile: { name: 'Makefile', alias: ['make', 'mk'], ...CC_HASH, eol: false, lex: 'make' },
    gdscript: { name: 'GDScript', alias: ['gd'], ...CC_HASH, lex: 'py' },
    elixir: { name: 'Elixir', alias: ['ex', 'exs'], ...CC_HASH, lex: 'ex' },
    julia: { name: 'Julia', alias: ['jl'], ...CC_HASH, block: ['#=', '=#'], lex: 'jl' },
    graphql: { name: 'GraphQL', alias: ['gql'], ...CC_HASH, lex: 'gql' },
    javascript: { name: 'JavaScript', alias: ['js', 'mjs', 'cjs', 'jsx'], ...CC_SLASH, lex: 'js' },
    typescript: { name: 'TypeScript', alias: ['ts', 'tsx', 'mts', 'cts'], ...CC_SLASH, lex: 'js' },
    java: { name: 'Java', alias: [], ...CC_SLASH, lex: 'java' },
    c: { name: 'C', alias: [], ...CC_SLASH, lex: 'c' },
    cpp: { name: 'C++', alias: ['c++', 'cc', 'cxx', 'hpp', 'h'], ...CC_SLASH, lex: 'cpp' },
    csharp: { name: 'C#', alias: ['cs', 'c#'], ...CC_SLASH, add: ['//', '///'], lex: 'cs' },
    go: { name: 'Go', alias: ['golang'], ...CC_SLASH, lex: 'go' },
    rust: { name: 'Rust', alias: ['rs'], ...CC_SLASH, lex: 'rust' },
    swift: { name: 'Swift', alias: [], ...CC_SLASH, lex: 'swift' },
    kotlin: { name: 'Kotlin', alias: ['kt', 'kts'], ...CC_SLASH, lex: 'kotlin' },
    scala: { name: 'Scala', alias: [], ...CC_SLASH, lex: 'scala' },
    dart: { name: 'Dart', alias: [], ...CC_SLASH, lex: 'dart' },
    php: { name: 'PHP', alias: [], ...CC_SLASH, line: ['//', '#'], add: ['//', '#'], lex: 'php' },
    groovy: { name: 'Groovy', alias: ['gradle'], ...CC_SLASH, lex: 'groovy' },
    glsl: { name: 'GLSL', alias: [], ...CC_SLASH, lex: 'c' },
    hlsl: { name: 'HLSL', alias: [], ...CC_SLASH, lex: 'c' },
    shader: { name: 'ShaderLab', alias: ['shaderlab'], ...CC_SLASH, lex: 'c' },
    objectivec: { name: 'Objective-C', alias: ['objc', 'objective-c'], ...CC_SLASH, lex: 'c' },
    solidity: { name: 'Solidity', alias: ['sol'], ...CC_SLASH, lex: 'clike' },
    protobuf: { name: 'Protocol Buffers', alias: ['proto'], ...CC_SLASH, lex: 'clike' },
    wgsl: { name: 'WGSL', alias: [], ...CC_SLASH, lex: 'clike' },
    gml: { name: 'GML', alias: [], ...CC_SLASH, lex: 'clike' },
    scss: { name: 'SCSS', alias: [], ...CC_SLASH, lex: 'scss' },
    less: { name: 'Less', alias: [], ...CC_SLASH, lex: 'scss' },
    jsonc: { name: 'JSONC', alias: [], ...CC_SLASH, lex: 'clike' },
    json5: { name: 'JSON5', alias: [], ...CC_SLASH, lex: 'clike' },
    css: { name: 'CSS', alias: [], line: [], block: ['/*', '*/'], add: [], addBlock: ['/*', '*/'], eol: true, lex: 'css' },
    sql: { name: 'SQL', alias: ['mysql', 'postgresql', 'postgres', 'sqlite', 'tsql', 'plsql', 'mssql', 'mariadb'], ...CC_DASH, block: ['/*', '*/'], addBlock: ['/*', '*/'], lex: 'sql' },
    lua: { name: 'Lua', alias: [], ...CC_DASH, lex: 'lua' },
    mlua: { name: 'mLua', alias: [], ...CC_DASH, lex: 'lua' },
    haskell: { name: 'Haskell', alias: ['hs'], ...CC_DASH, block: ['{-', '-}'], lex: 'hs' },
    ada: { name: 'Ada', alias: [], ...CC_DASH, lex: 'ada' },
    vhdl: { name: 'VHDL', alias: [], ...CC_DASH, block: ['/*', '*/'], lex: 'vhdl' },
    html: { name: 'HTML', alias: ['htm', 'xhtml'], ...CC_TAGS },
    xml: { name: 'XML', alias: [], ...CC_TAGS },
    svg: { name: 'SVG', alias: [], ...CC_TAGS },
    xaml: { name: 'XAML', alias: [], ...CC_TAGS },
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

// 펜스 이름표 → 언어 키(대소문자 무시). 코드가 아니거나 모르는 이름표, 이름표가 없으면 null
function codeCommentLang(info) {
    const label = codeCommentLabel(info).toLowerCase();
    if (!label || CODE_COMMENT_SKIP_LABELS.has(label)) return null;
    return CC_ALIAS.get(label) || CC_ALIAS.get(label.split(/[:,]/)[0]) || null; // python:main.py 꼴은 앞 낱말로
}

// 지시에 쓰는 주석 기호(예: '#', '// 또는 /* */')
function codeCommentMarks(lang) {
    const spec = CODE_COMMENT_LANGS[lang];
    if (!spec) return '';
    return [...spec.add, ...(spec.addBlock ? [spec.addBlock.join(' ')] : [])].join(' 또는 ');
}

const codeCommentNeed = codeLines => (codeLines > 0 ? Math.max(1, Math.floor(codeLines / CODE_COMMENT_LINES_PER)) : 0);

/* ---------- 2. 블록 찾기 ---------- */
// 문서의 펜스 코드 블록을 차례로. 줄 번호는 '\n'으로 나눈 문서 줄(0부터)이고, lines는 펜스 들여쓰기와 줄 끝 \r을 뗀 코드 줄이다.
// raw는 문서에 적힌 그대로의 코드 줄(되돌릴 때 쓴다). skip: '' 검사함 · nolabel · nocode(text·mermaid…) · unknown · unclosed
function codeCommentBlocks(md) {
    const blocks = [];
    let fence = 0;
    let open = null;
    let section = '';
    let heading = '';
    let prose = [];
    String(md ?? '').split('\n').forEach((line, no) => {
        const was = fence;
        fence = fenceStateAfter(fence, line);
        if (!was && fence) {
            open = { no, line, code: [] };
            return;
        }
        if (was && !fence) {
            blocks.push(ccBlock(blocks.length, open, no, section, ccContext(heading, prose)));
            open = null;
            prose = [];
            return;
        }
        if (was) {
            open.code.push(line);
            return;
        }
        // 펜스 밖 글: ## 섹션 제목(lesson-lint.js lessonCodeSections와 같은 규칙)과 앞 설명을 따라간다
        const body = line.replace(/\r$/, '');
        const sectionTitle = body.match(/^##\s+(.*)/);
        if (sectionTitle) section = sectionTitle[1].trim();
        if (/^#{1,6}\s/.test(body)) {
            heading = body.trim();
            prose = [];
        } else if (body.trim()) {
            prose = [...prose, body.trim()];
        }
    });
    if (open) blocks.push(ccBlock(blocks.length, open, -1, section, ccContext(heading, prose)));
    return blocks;
}

function ccBlock(index, open, closeLine, section, context) {
    const opening = open.line.replace(/\r$/, '');
    const [, indent, fence, rest] = opening.match(/^(\s*)(`{3,})(.*)$/);
    const label = codeCommentLabel(rest);
    const lang = codeCommentLang(rest);
    const lines = open.code.map(line => ccStripIndent(line.replace(/\r$/, ''), indent));
    const lower = label.toLowerCase();
    const skip = closeLine < 0 ? 'unclosed' : !label ? 'nolabel' : CODE_COMMENT_SKIP_LABELS.has(lower) ? 'nocode' : lang ? '' : 'unknown';
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

// 바로 앞 설명 글: 가까운 제목 + 그 뒤 단락(HTML 주석·그림 태그는 뗀다). 길면 블록에 가까운 끝을 남긴다
function ccContext(heading, prose) {
    const text = prose.join(' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/\s+/g, ' ').trim();
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
const CC_SHEBANG = /^#!(?!\[)/; // rust의 #![…] 는 코드다
const CC_CODING = /^[ \t\f]*#.*?coding[:=][ \t]*[-\w.]+/;
const CC_DOCKER_DIRECTIVE = /^#\s*[A-Za-z][\w-]*\s*=/;
// 뒤에 정규식이나 JSX가 올 수 있는 낱말(그 뒤는 식이 시작하는 자리다)
const CC_EXPR_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'and', 'or', 'not', 'if', 'unless', 'when', 'while', 'until', 'elsif', 'split', 'grep', 'map', 'join', 'push', 'unshift']);
const CC_PAIRS = { '(': ')', '[': ']', '{': '}', '<': '>' };
const CC_FRAME_WHY = { str: 'string', blk: 'comment', code: 'string', jsxTag: 'jsx', jsxText: 'jsx', html: 'html' };

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

// 문자열. esc: \ (escCh) 다음 글자를 건너뛴다, dbl: 닫는 기호 두 번은 글자다, multi: 줄을 넘는다, interp: ${ 같은 끼움 식, at: 열 수 있는 자리인지
const ccStrTok = (open, close = open, { esc = true, escCh = '\\', dbl = false, multi = false, interp = '', at = null } = {}) => (lx, text, i, row) => {
    if (!text.startsWith(open, i) || (at && !at(lx, text, i))) return -1;
    lx.stack.push({ k: 'str', close, esc, escCh, dbl, multi, interp, pair: '', depth: 0 });
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

// JSX 여는 태그: 식이 올 자리에서 <글자 또는 <>
function ccJsxOpenTok(lx, text, i, row) {
    if (text[i] !== '<' || lx.sig !== 'op') return -1;
    const next = text[i + 1] || '';
    if (next !== '>' && !/[A-Za-z]/.test(next)) return -1;
    lx.stack.push(next === '>' ? { k: 'jsxText' } : { k: 'jsxTag', closing: false });
    row.code = true;
    return i + (next === '>' ? 2 : 1);
}

// 히어독 여는 꼴. 본문은 이 줄 다음부터 끝 줄까지다. strip: tabs(<<-, 앞 탭을 뗀다) · lead(앞 공백) · php(들여쓴 끝 줄과 뒤 글자)
const CC_HEREDOC = {
    sh: { re: /<<(-?)[ \t]*\\?(['"]?)([A-Za-z_][\w.-]*)\2/y, term: m => m[3], strip: m => (m[1] ? 'tabs' : '') },
    rb: { re: /<<([~-]?)(?:(['"`])([^'"`\s]+)\2|([A-Z_][A-Z0-9_]*))/y, term: m => m[3] ?? m[4], strip: m => (m[1] ? 'lead' : '') },
    pl: { re: /<<(~?)(?:(['"])([^'"\n]*)\2|([A-Za-z_]\w*))/y, term: m => m[3] ?? m[4], strip: m => (m[1] ? 'lead' : '') },
    php: { re: /<<<[ \t]*(['"]?)([A-Za-z_]\w*)\1/y, term: m => m[2], strip: () => 'php' }
};
const ccHeredocTok = kind => (lx, text, i, row) => {
    const rule = CC_HEREDOC[kind];
    if (text[i] !== '<' || text[i - 1] === '<' || (kind !== 'php' && text[i + 2] === '<')) return -1;
    const m = ccExecAt(rule.re, text, i);
    if (!m) return -1;
    lx.pending.push({ term: rule.term(m), strip: rule.strip(m) });
    row.code = true;
    return i + m[0].length;
};

function ccHeredocEnds(doc, text) {
    if (doc.strip === 'php') return new RegExp(`^\\s*${doc.term}(?![A-Za-z0-9_\\x80-\\uffff])`).test(text);
    const body = doc.strip === 'tabs' ? text.replace(/^\t+/, '') : doc.strip === 'lead' ? text.replace(/^\s+/, '') : text;
    return body === doc.term;
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
   splice: 줄 끝 \ 가 // 주석까지 다음 줄로 잇는다(c·cpp), jsx: JSX 규칙, php: <?php 밖은 HTML, escCh: 코드에서 다음 글자를 글자로 만드는 기호 */
const CC_C_TOKENS = [ccBlockTok('/*', '*/'), ccLineTok('//')];
const CC_NEST_TOKENS = [ccBlockTok('/*', '*/', { nest: true }), ccLineTok('//')];
const CC_DQ = ccStrTok('"');
const CC_SQ = ccStrTok("'");
const CC_TRIPLE = [ccStrTok('"""', '"""', { multi: true }), ccStrTok("'''", "'''", { multi: true })];

const CC_KITS = {
    py: { tokens: [ccLineTok('#'), ...CC_TRIPLE, CC_DQ, CC_SQ], cont: /\\$/, coding: true },
    sh: {
        tokens: [ccLineTok('#', { ws: /[\s;|&()]/ }), ccHeredocTok('sh'), ccStrTok("$'", "'", { multi: true }), ccStrTok("'", "'", { esc: false, multi: true }), ccStrTok('"', '"', { multi: true }), ccStrTok('`', '`', { multi: true })],
        cont: /\\$/
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
    js: { tokens: [...CC_C_TOKENS, ccRegexTok, ccJsxOpenTok, ccStrTok('`', '`', { multi: true, interp: '${' }), CC_DQ, CC_SQ], jsx: true },
    java: { tokens: [...CC_C_TOKENS, ccStrTok('"""', '"""', { multi: true }), CC_DQ, CC_SQ] },
    c: { tokens: [...CC_C_TOKENS, CC_DQ, CC_SQ], cont: /\\$/, splice: true },
    cpp: { tokens: [...CC_C_TOKENS, ccOpenTok(/(?:u8|[uUL])?R"([^()\\\s]{0,16})\(/y, m => ({ close: `)${m[1]}"` })), CC_DQ, CC_SQ], cont: /\\$/, splice: true },
    cs: {
        tokens: [...CC_C_TOKENS, ccOpenTok(/\$*("{3,})/y, m => ({ close: m[1] })), ccStrTok('$@"', '"', { esc: false, dbl: true, multi: true }), ccStrTok('@$"', '"', { esc: false, dbl: true, multi: true }),
            ccStrTok('@"', '"', { esc: false, dbl: true, multi: true }), CC_DQ, CC_SQ]
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
    sql: { tokens: dialect => ccSqlTokens(dialect) },
    lua: { tokens: [ccLuaLongTok, ccLineTok('--'), CC_DQ, CC_SQ] },
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
    vb: { tokens: [ccLineTok("'"), ccRemTok(true), ccStrTok('"', '"', { esc: false, dbl: true })], cont: /(?:^|[ \t])_$/ },
    bat: { tokens: [ccRemTok(false), ccLineTok('::', { start: true }), ccStrTok('"', '"', { esc: false })], cont: /(?:^|[^^])(?:\^\^)*\^$/, batch: true }
};

// sql 갈래: mysql은 # 주석과 \ 이스케이프, postgres·tsql은 겹치는 블록 주석, tsql은 [이름], 그 밖은 $태그$ 문자열
function ccSqlTokens(dialect) {
    const mysql = dialect === 'mysql' || dialect === 'mariadb';
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
        if (i + 1 >= text.length) lx.strCont = true; // 줄 끝 \ : 문자열이 다음 줄로 이어진다
        return i + 2;
    }
    if (f.pair && ch === f.pair) {
        f.depth += 1;
        return i + 1;
    }
    if (f.dbl && text.startsWith(f.close + f.close, i)) return i + f.close.length * 2;
    if (f.interp && text.startsWith(f.interp, i)) {
        lx.stack.push({ k: 'code', brace: 0, jsx: false });
        lx.sig = 'op';
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

function ccJsxTagStep(lx, f, text, i, row) {
    const ch = text[i];
    if (!/\s/.test(ch)) row.code = true;
    if (ch === '"' || ch === "'") {
        lx.stack.push({ k: 'str', close: ch, esc: false, multi: true, pair: '', depth: 0 });
        return i + 1;
    }
    if (ch === '{') {
        lx.stack.push({ k: 'code', brace: 0, jsx: true });
        lx.sig = 'op';
        return i + 1;
    }
    const self = text.startsWith('/>', i);
    if (!self && ch !== '>') return i + 1;
    lx.stack.pop();
    if (!self && !f.closing) lx.stack.push({ k: 'jsxText' });
    else {
        if (f.closing && lx.stack[lx.stack.length - 1]?.k === 'jsxText') lx.stack.pop();
        const top = lx.stack[lx.stack.length - 1];
        if (!top || top.k === 'code') lx.sig = 'value'; // JSX 식이 끝났다
    }
    return i + (self ? 2 : 1);
}

function ccJsxTextStep(lx, text, i, row) {
    const ch = text[i];
    if (!/\s/.test(ch)) row.code = true;
    if (ch === '{') {
        lx.stack.push({ k: 'code', brace: 0, jsx: true });
        lx.sig = 'op';
        return i + 1;
    }
    if (ch !== '<') return i + 1;
    const next = text[i + 1] || '';
    if (next === '/') {
        lx.stack.push({ k: 'jsxTag', closing: true });
        return i + 2;
    }
    if (next === '>') {
        lx.stack.push({ k: 'jsxText' });
        return i + 2;
    }
    if (/[A-Za-z]/.test(next)) lx.stack.push({ k: 'jsxTag', closing: false });
    return i + 1;
}

// php의 ?> 와 <?php 사이(HTML 부분)는 코드 글자로 읽고 <?php · <?= · <? 에서 다시 코드다
function ccPhpHtmlStep(lx, text, i, row) {
    if (!/\s/.test(text[i])) row.code = true;
    const m = ccExecAt(/<\?(?:php\b|=|(?=\s|$))/iy, text, i);
    if (!m) return i + 1;
    lx.stack.pop();
    lx.sig = 'op';
    return i + m[0].length;
}

// 틀 밖(코드)의 한 글자: { } 로 끼움 식을 닫고, 낱말·숫자는 통째로 넘긴다. sig는 정규식·JSX가 올 자리인지 판단에 쓴다
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
        lx.sig = CC_EXPR_WORDS.has(word[0]) ? 'op' : 'value';
        return i + word[0].length;
    }
    const num = ccExecAt(CC_NUMBER, text, i);
    if (num) {
        lx.sig = 'value';
        return i + num[0].length;
    }
    lx.sig = ch === ')' || ch === ']' ? 'value' : 'op';
    return lx.kit.escCh && ch === lx.kit.escCh ? i + 2 : i + 1;
}

function ccStep(lx, text, i, row) {
    const top = lx.stack[lx.stack.length - 1];
    if (top && top.k === 'blk') return ccBlockStep(lx, top, text, i, row);
    if (top && top.k === 'str') return ccStrStep(lx, top, text, i, row);
    if (top && top.k === 'jsxTag') return ccJsxTagStep(lx, top, text, i, row);
    if (top && top.k === 'jsxText') return ccJsxTextStep(lx, text, i, row);
    if (top && top.k === 'html') return ccPhpHtmlStep(lx, text, i, row);
    for (const tok of lx.tokens) {
        const next = tok(lx, text, i, row);
        if (next > i) return next;
    }
    return ccPlain(lx, text, i, row, top);
}

// 지금 자리가 코드 한가운데(주석을 넣어도 되는 곳)인지. 아니면 까닭
function ccWhyNow(lx) {
    if (lx.cont || lx.splice) return 'cont';
    if (lx.heredocs.length) return 'heredoc';
    if (lx.mode) return lx.mode.why;
    const top = lx.stack[lx.stack.length - 1];
    return !top || (top.k === 'code' && top.jsx) ? '' : CC_FRAME_WHY[top.k];
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

// 줄 끝: 이어짐·히어독·블록 글을 정하고, 닫히지 않은 한 줄 문자열은 버린다
function ccEndRow(lx, text, row) {
    row.codeText = ccCodeText(text, row.marks);
    const top = lx.stack[lx.stack.length - 1];
    const inCode = !top || (top.k === 'code' && top.jsx);
    const trimmed = row.codeText.replace(/\s+$/, '');
    let why = lx.pending.length ? 'heredoc' : lx.mode ? lx.mode.why : inCode ? '' : CC_FRAME_WHY[top.k];
    if (top && top.k === 'str' && !top.multi && !lx.strCont) lx.stack.pop();
    if (lx.kit.splice && row.lineEnd && /\\$/.test(text)) {
        lx.splice = row.lineEnd;
        why = why || 'cont';
    } else if (inCode && !why && (lx.contFlag || (lx.kit.docker ? trimmed.endsWith(lx.escape) : lx.kit.cont && lx.kit.cont.test(trimmed)))) {
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

function ccLexRow(lx, text, at) {
    const row = ccRow();
    row.startWhy = ccWhyNow(lx);
    lx.cont = false;
    lx.contFlag = false;
    lx.strCont = false;
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

function ccLexCode(spec, lines, dialect) {
    const kit = CC_KITS[spec.lex];
    const lx = {
        kit, tokens: typeof kit.tokens === 'function' ? kit.tokens(dialect) : kit.tokens,
        stack: kit.php && lines.some(line => /<\?(?:php\b|=|\s|$)/i.test(line)) ? [{ k: 'html' }] : [],
        units: 0, sig: 'op', pending: [], heredocs: [], mode: null, cont: false, contFlag: false, splice: 0, strCont: false,
        escape: kit.docker ? ccDockerEscape(lines) : '\\'
    };
    const rows = lines.map((text, at) => ccLexRow(lx, text, at));
    return { rows, tail: ccWhyNow(lx) };
}

/* html·xml·svg·xaml·vue: 태그 안, script·style·textarea·title(글자 그대로)과 pre 안에는 주석 줄을 넣지 않는다 */
const CC_RAW_TAGS = new Set(['script', 'style', 'textarea', 'title', 'xmp']);
const CC_MARKUP_CLOSE = { cdata: ']]>', pi: '?>', decl: '>' };

function ccMarkupStep(st, text, i, row) {
    const ch = text[i];
    if (st.mode === 'comment' || CC_MARKUP_CLOSE[st.mode]) {
        const close = st.mode === 'comment' ? '-->' : CC_MARKUP_CLOSE[st.mode];
        const at = text.indexOf(close, i);
        const end = at < 0 ? text.length : at + close.length;
        if (st.mode === 'comment' && text.slice(i, end).trim()) ccComment(row, i, end, st.unit);
        else if (text.slice(i, end).trim()) row.code = true;
        if (at >= 0) st.mode = 'text';
        return end;
    }
    if (st.mode === 'raw') {
        const at = text.toLowerCase().indexOf(`</${st.name}`, i);
        if (text.slice(i, at < 0 ? text.length : at).trim()) row.code = true;
        if (at < 0) return text.length;
        st.mode = 'tag';
        st.closing = true;
        row.code = true;
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
        return i + opener[1];
    }
    const tag = ch === '<' ? /^<(\/?)([A-Za-z][\w:.-]*)/.exec(text.slice(i, i + 64)) : null;
    if (tag) {
        st.mode = 'tag';
        st.closing = !!tag[1];
        st.name = tag[2].toLowerCase();
        row.code = true;
        return i + tag[0].length;
    }
    if (!/\s/.test(ch)) row.code = true;
    return i + 1;
}

function ccMarkupTagStep(st, text, i, row) {
    const ch = text[i];
    if (!/\s/.test(ch)) row.code = true;
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

// yaml 여러 줄 평문 값(키: 값 · - 값 다음 줄에 더 들여 써 이어지는 글): 주석이 값을 끊으므로 그 사이와 앞 줄 끝에는 넣지 않는다
const CC_YAML_PLAIN = /^\s*(?:-\s+)*(?:[^\s#'"][^#]*?:\s+|-\s+)(?![|>&*!\[{"'#]|-(?:\s|$))\S/;
const CC_YAML_NEW_NODE = /^\s*(?:-(?:\s|$)|#|[^\s#][^#]*?:(?:\s|$))/;
function ccYamlPlainRules(lines, rows, gaps, ends) {
    const indent = line => line.match(/^ */)[0].length;
    let owner = -1; // 여러 줄 평문 값을 시작한 줄
    rows.forEach((row, at) => {
        if (row.kind === 'blank') return;
        if (row.kind !== 'code' && row.kind !== 'mixed') {
            owner = -1;
            return;
        }
        if (owner >= 0 && !row.startWhy && indent(lines[at]) > indent(lines[owner]) && !CC_YAML_NEW_NODE.test(lines[at])) {
            for (let g = owner + 1; g <= at; g += 1) gaps[g] = gaps[g] || 'string';
            for (let e = owner; e < at; e += 1) if (lines[e].trim()) ends[e] = ends[e] || 'string';
            return;
        }
        owner = !row.endWhy && CC_YAML_PLAIN.test(row.codeText) && !row.units.length ? at : -1;
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

// 한 블록을 훑은 결과: rows, gaps(줄 g 위에 넣으면 안 되는 까닭, 마지막은 끝 뒤), ends(줄 끝 까닭), codeLines, comments, need
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
    const depthAfter = kit.batch ? ccBatchDepth(rows) : 0;
    const { codeLines, comments } = ccCountRows(rows);
    return { rows, gaps, ends, depthAfter, codeLines, comments, need: codeCommentNeed(codeLines) };
}

const ccLines = code => (Array.isArray(code) ? code.map(String) : String(code ?? '').split('\n'));

// 코드 줄 수·주석 자리 수·필요한 주석 수·모자란지. 모르는 언어는 검사하지 않는다(모두 0)
function codeCommentCount(lang, lines, { dialect = '' } = {}) {
    if (!CODE_COMMENT_LANGS[lang]) return { codeLines: 0, comments: 0, need: 0, short: false };
    const lex = ccLexBlock(lang, ccLines(lines), dialect);
    return { codeLines: lex.codeLines, comments: lex.comments, need: lex.need, short: lex.comments < lex.need };
}

// 넣을 수 있는 자리: gaps[g](g째 줄 위, 마지막은 끝 뒤)와 ends[i](i째 줄 끝)마다 { ok, why }. 모르는 언어는 null
function codeCommentZones(lang, lines, { dialect = '' } = {}) {
    if (!CODE_COMMENT_LANGS[lang]) return null;
    const lex = ccLexBlock(lang, ccLines(lines), dialect);
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

// 원래 줄과 AI 줄을 맞춘다: { orig: i } 원래 줄, { orig: i, tail } 줄 끝 주석, { add, at } 더한 줄(at번째 원래 줄 위). 원래 줄이 빠지거나 바뀌면 reason
function ccAlign(spec, orig, theirs) {
    const items = [];
    let i = 0;
    for (let j = 0; j < theirs.length; j += 1) {
        const line = theirs[j];
        if (/^\s*(`{3,}|~{3,})/.test(line)) return { reason: `\`\`\` 나 ~~~ 로 시작하는 줄은 코드 블록을 닫아 쓸 수 없습니다: ${ccSnip(line)}` };
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
            if (i >= orig.length) return { reason: `코드 끝에 주석이 아닌 줄(코드)을 더했습니다: ${ccSnip(line)}` };
            const later = theirs.slice(j + 1).some(rest => ccSame(rest, orig[i]));
            return { reason: later ? `${i + 1}째 줄 위에 주석이 아닌 줄(코드)을 더했습니다: ${ccSnip(line)}` : `원래 ${i + 1}째 줄이 바뀌었습니다: ${ccSnip(orig[i])} → ${ccSnip(line)}` };
        }
    }
    for (; i < orig.length && !orig[i].trim(); i += 1) items.push({ orig: i });
    return i < orig.length ? { reason: `원래 ${i + 1}째 줄이 빠졌습니다: ${ccSnip(orig[i])}` } : { items };
}

// 한 줄짜리 줄 주석 모양. 이 언어의 줄 주석 기호로 시작하지 않으면 null, 맞으면 '', 틀리면 까닭
function ccLineShape(spec, text) {
    const marks = [...spec.add].sort((a, b) => b.length - a.length); // 긴 기호부터(c#의 /// 와 //)
    const mark = marks.find(m => (spec.lex === 'bat' ? text.toUpperCase().startsWith(m.toUpperCase()) : text.startsWith(m)));
    if (!mark) return null;
    const rest = text.slice(mark.length);
    if (!rest.trim()) return '주석 내용이 비었습니다';
    if (!rest.startsWith(' ')) return '주석 기호 뒤에 공백을 한 칸 둡니다';
    if (spec.lex === 'php' && rest.includes('?>')) return '?> 가 든 주석은 PHP 코드를 닫습니다';
    if (spec.lex === 'java' && /\\u[0-9a-fA-F]{4}/.test(rest)) return '\\u 이스케이프가 든 주석은 java가 글자로 바꿔 읽습니다';
    if (spec.lex === 'bat' && (/\^\s*$/.test(rest) || /%~/.test(rest) || /^\s*\/\?/.test(rest))) return '^ 로 끝나거나 %~ · /? 가 든 batch 주석은 쓸 수 없습니다';
    if (spec.lex === 'docker' && CC_DOCKER_DIRECTIVE.test(text)) return '# 이름=값 꼴은 지시 줄로 읽힐 수 있습니다';
    return '';
}

// 한 줄에서 닫히는 블록 주석 모양(/* … */, <!-- … -->). 여는 기호로 시작하지 않으면 null
function ccBlockShape(spec, text) {
    if (!spec.addBlock || !text.startsWith(spec.addBlock[0])) return null;
    const [open, close] = spec.addBlock;
    if (!text.endsWith(close) || text.length < open.length + close.length + 2) return '한 줄에서 닫히지 않는 블록 주석은 쓸 수 없습니다';
    const inner = text.slice(open.length, -close.length);
    if (inner.includes(close)) return '닫는 기호가 주석 중간에 또 있습니다';
    if (inner.includes(open)) return '주석 안에 여는 기호가 또 있습니다';
    if (!/^\s/.test(inner) || !/\s$/.test(inner)) return '주석 기호 안쪽 앞뒤에 공백을 둡니다';
    if (!inner.trim()) return '주석 내용이 비었습니다';
    if (open === '<!--' && (inner.includes('--') || inner.trimEnd().endsWith('-'))) return '<!-- --> 안에는 -- 를 쓸 수 없습니다';
    return '';
}

// 주석 하나(앞 공백을 뗀 글)가 이 언어에서 쓸 수 있는 한 줄 주석인지. 맞으면 '', 틀리면 까닭
function ccShape(spec, lang, text) {
    if (/[\u0000-\u0008\u000B-\u001F\u007F\u0085]/.test(text) || CC_LINE_BREAKS.test(text)) return '줄을 나누거나 보이지 않는 글자가 들어 있습니다';
    if (text.length > CODE_COMMENT_MAX_CHARS) return `주석이 ${CODE_COMMENT_MAX_CHARS}자를 넘습니다`;
    if (/(?:\\|\?\?\/)\s*$/.test(text)) return '주석을 \\ 로 끝내면 다음 줄까지 이어질 수 있습니다';
    if (spec.lex === 'lua' && /^--\[=*\[/.test(text)) return '--[[ 로 여는 긴 주석은 쓸 수 없습니다';
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
        if (CC_KITS[spec.lex]?.coding && n <= 1 && CC_CODING.test(text)) return `첫 두 줄의 coding 주석은 파일 인코딩 선언이 됩니다: ${ccSnip(item.add)}`;
    }
    return '';
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

// 내부 확인: 결과에 맞춘 줄(items)도 준다
function ccVerify(block, answer) {
    const spec = CODE_COMMENT_LANGS[block?.lang];
    const orig = Array.isArray(block?.lines) ? block.lines : [];
    const fail = reason => ({ ok: false, code: orig.join('\n'), added: 0, reason, enough: false, comments: 0, need: 0, codeLines: 0, items: null });
    if (!spec) return fail('검사하지 않는 코드 블록입니다.');
    const dialect = String(block.label || '').toLowerCase();
    const theirs = Array.isArray(answer) ? answer.map(String) : String(answer ?? '').split(/\r?\n/);
    const plan = ccAlign(spec, orig, theirs);
    if (plan.reason) return fail(plan.reason);
    const before = ccLexBlock(block.lang, orig, dialect);
    const bad = ccCheckItems(spec, block.lang, before, plan.items);
    if (bad) return fail(bad);
    const out = ccBuild(orig, plan.items);
    const after = ccLexBlock(block.lang, out, dialect);
    const drift = ccDrift(before, after, plan.items);
    if (drift) return fail(drift);
    const added = plan.items.filter(item => item.add !== undefined || item.tail).length;
    return { ok: true, code: out.join('\n'), added, reason: '', enough: after.comments >= after.need, comments: after.comments, need: after.need, codeLines: after.codeLines, items: plan.items };
}

// AI가 돌려준 코드(answer: 글 또는 줄 배열)가 원래 줄은 그대로 두고 허용된 자리에 주석만 더했는지 본다.
// 결과 { ok, code(원래 줄 + 허용된 주석으로 다시 짠 코드, 실패면 원래 코드), added, reason, enough, comments, need, codeLines }
function codeCommentVerify(block, answer) {
    const { items, ...result } = ccVerify(block, answer);
    return result;
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
            if (want === undefined) return;
            const body = want.replace(/\r$/, '');
            if (line === want || (line.replace(/\r$/, '').startsWith(body) && /^[ \t]/.test(line.slice(body.length)) && line.endsWith('\r') === want.endsWith('\r'))) i += 1;
        });
        return i === old.raw.length;
    });
}

// 확인을 지난 고침만 넣은 새 문서. fixes: [{ index(블록 번호), code(AI가 돌려준 코드) }]
// 결과 { md, applied: [블록 번호], rejected: [{ index, reason }] }. 다시 확인하지 못하면 원래 문서를 그대로 돌려준다
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
    [...edits].sort((x, y) => y.block.openLine - x.block.openLine).forEach(({ block, lines }) => raw.splice(block.openLine + 1, block.raw.length, ...lines));
    const next = raw.join('\n');
    const applied = edits.map(edit => edit.block.index).sort((x, y) => x - y);
    if (!ccKeepsCode(source, next)) return { md: source, applied: [], rejected: [...rejected, ...applied.map(index => ({ index, reason: '넣은 뒤 다시 확인하지 못해 넣지 않았습니다.' }))] };
    return { md: next, applied, rejected };
}

/* ---------- 7. AI 지시와 응답 해석 ---------- */
const CC_MARK_OPEN = /^\s*[*`]*\s*<<<\s*code\s*#?\s*(\d+)\s*>>>\s*[*`]*\s*$/i;
const CC_MARK_END = /^\s*[*`]*\s*<<<\s*end\s*#?\s*\d*\s*>>>\s*[*`]*\s*$/i;
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

function ccBlockPrompt(item) {
    const block = item.block;
    const spec = CODE_COMMENT_LANGS[block.lang];
    const lines = item.lines || block.lines;
    const lex = ccLexBlock(block.lang, lines, block.label);
    const no = block.index + 1;
    const where = spec.eol ? '줄 위에 따로 쓰거나 코드 뒤에 한 칸 띄우고 붙입니다' : '줄 위에 따로 씁니다';
    const zones = ccZoneNotes(spec, lex, lines);
    return [
        `[블록 ${no}] ${spec.name} · 주석 기호: ${codeCommentMarks(block.lang)} (${where})`,
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
    const list = (Array.isArray(items) ? items : []).map(item => (item && item.block ? item : { block: item })).filter(item => item.block && CODE_COMMENT_LANGS[item.block.lang]);
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

// 표시 안을 감싼 펜스(```python … ```)를 뗀다
function ccUnwrap(lines) {
    const head = lines.length && CC_FENCE_LINE.test(lines[0]) ? 1 : 0;
    const tail = lines.length > head && /^\s*(?:`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]) ? 1 : 0;
    return ccTrimBlank(lines.slice(head, lines.length - tail));
}

// AI 답 → { 번호: [코드, …] }. 앞뒤 잡담·감싼 펜스·CRLF·표시줄 대소문자와 공백 차이를 견디고, 같은 번호는 차례대로 모두 둔다.
// 닫는 표시가 없으면 다음 여는 표시나 글 끝까지 받는다(확인이 걸러 낸다)
function codeCommentParse(text) {
    const out = {};
    let cur = null;
    const flush = () => {
        if (cur) out[cur.no] = [...(out[cur.no] || []), ccUnwrap(ccTrimBlank(cur.lines)).join('\n')];
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

/* ---------- 8. 일괄 작업 ---------- */
// 주석이 모자란 검사 대상 블록
function codeCommentTargets(md) {
    return codeCommentBlocks(md).filter(block => !block.skip && ccCountBlock(block).short);
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

// 받은 답 하나를 블록에 맞춰 넣는다. 다시 부를 블록이면 { block, reason }, 끝났으면 null
function ccTakeAnswer(job, item, answers) {
    const block = codeCommentBlocks(job.md)[item.block.index]; // 지금 글의 블록(앞에서 받은 주석이 들어 있을 수 있다)
    const candidates = answers[block.index + 1] || [];
    const results = [...candidates].reverse().map(code => ccVerify(block, code));
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
        const answers = codeCommentParse(text);
        items = items.map(item => ccTakeAnswer(job, item, answers)).filter(Boolean); // 중지를 눌러도 받은 답은 넣는다
        if (isStopped()) {
            job.stopped = true;
            return;
        }
    }
}

// 문서의 주석이 모자란 코드 블록에 AI로 주석만 더한다. ask({ system, user }) → Promise<AI 답 글(가공하지 않은 날 글)>.
// 결과 { md, fixed(주석이 넉넉해진 블록 번호), failed([{ index, reason }] 아직 모자란 블록 — 받은 주석은 넣었을 수 있다),
//   remaining(끝난 뒤 주석이 모자란 블록 수), calls(부른 횟수), stopped(중지), error(일괄 작업을 멈춘 오류 글) }. 원래 코드를 바꾼 문서는 돌려주지 않는다
async function codeCommentRun({ md, ask, quiz = false, isStopped = () => false, onStatus = () => {}, maxBlocks = CODE_COMMENT_BATCH_BLOCKS, maxChars = CODE_COMMENT_BATCH_CHARS } = {}) {
    if (typeof ask !== 'function') throw new TypeError('codeCommentRun: ask 함수가 필요합니다.');
    const source = String(md ?? '');
    const job = { md: source, calls: 0, fixed: new Set(), failed: new Map(), stopped: false, error: '' };
    const targets = codeCommentTargets(source);
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
    const safe = ccKeepsCode(source, job.md);
    const finalMd = safe ? job.md : source;
    const failed = safe ? [...job.failed] : targets.map(block => [block.index, '고친 글을 다시 확인하지 못해 넣지 않았습니다.']);
    return {
        md: finalMd,
        fixed: safe ? [...job.fixed].sort((a, b) => a - b) : [],
        failed: failed.map(([index, reason]) => ({ index, reason })).sort((a, b) => a.index - b.index),
        remaining: codeCommentTargets(finalMd).length,
        calls: job.calls, stopped: job.stopped, error: job.error
    };
}

/* ---------- 9. 예고와 점검 ---------- */
// 예고: { checked(검사한 블록 수), needs(주석이 필요한 블록 수), calls(예상 AI 호출 수, 다시 부르기 빼고), unknown(모르는 이름표), skipped(검사하지 않은 블록 수) }
function codeCommentPreview(md, { maxBlocks = CODE_COMMENT_BATCH_BLOCKS, maxChars = CODE_COMMENT_BATCH_CHARS } = {}) {
    const found = codeCommentBlocks(md);
    const checked = found.filter(block => !block.skip);
    const needs = checked.filter(block => ccCountBlock(block).short);
    return {
        checked: checked.length, needs: needs.length,
        calls: ccBatches(needs, ccLimit(maxBlocks, CODE_COMMENT_BATCH_BLOCKS), ccLimit(maxChars, CODE_COMMENT_BATCH_CHARS)).length,
        unknown: [...new Set(found.filter(block => block.skip === 'unknown').map(block => block.label))],
        skipped: found.length - checked.length
    };
}

// 점검: 주석이 모자란 블록을 lesson-lint 이슈 모양으로. where는 블록이 든 ## 섹션 제목(없으면 '본문'), snip은 첫 코드 줄.
// 고치기는 일괄 작업(codeCommentRun)이 맡는다(섹션 글을 통째로 고쳐 쓰는 자동 수정이 코드를 바꾸지 않게 기본은 권장 warn)
function codeCommentIssues(md, { sev = 'warn' } = {}) {
    return codeCommentBlocks(md)
        .filter(block => !block.skip)
        .map(block => ({ block, count: ccCountBlock(block) }))
        .filter(({ count }) => count.short)
        .map(({ block, count }) => ({
            sev, where: block.section || '본문', msg: CODE_COMMENT_LINT_MSG,
            snip: (block.lines.find(line => line.trim()) || '').trim().slice(0, 40),
            block: block.index, lang: block.lang, codeLines: count.codeLines, comments: count.comments, need: count.need
        }));
}
