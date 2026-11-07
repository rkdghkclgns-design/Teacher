// 코드 블록 주석 검사·보강 테스트 (실행: node tests/code-comments.test.js)
// 언어 표, 블록 찾기(data.js stashCodeFences와 같은 규칙), 주석 세기와 필요 수, 주석을 넣으면 안 되는 자리,
// 주석만 더했는지 확인, 적용, AI 지시와 응답 해석, 일괄 작업, 예고·점검 도우미를 실제 파일로 확인한다.
// AI는 가짜 함수(ask)다. 키는 쓰지 않는다.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', 'js') + path.sep;
const source = file => fs.readFileSync(root + file, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

// data.js(펜스 규칙)와 code-comments.js만 싣는다
function makeContext(extra = {}) {
    const ctx = { console: { log() {}, warn() {}, error() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, ...extra };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['data.js', 'code-comments.js'].forEach(file => vm.runInContext(source(file), ctx));
    return ctx;
}

const ctx = makeContext();
const call = name => vm.runInContext(name, ctx);
const lang = info => call('codeCommentLang')(info);
const blocks = md => plain(call('codeCommentBlocks')(md));
const count = (key, code, opts) => plain(call('codeCommentCount')(key, typeof code === 'string' ? code.split('\n') : code, opts));
const zones = (key, code, opts) => plain(call('codeCommentZones')(key, typeof code === 'string' ? code.split('\n') : code, opts));
const verify = (key, code, answer, extra = {}) => plain(call('codeCommentVerify')({ lang: key, lines: code.split('\n'), ...extra }, answer));
const gapWhy = (key, code, g) => zones(key, code).gaps[g].why;
const endWhy = (key, code, i) => zones(key, code).ends[i].why;

let failed = 0;
let total = 0;
async function run(name, fn) {
    total++;
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (e) {
        failed++;
        console.log(`FAIL - ${name}\n  ${e.stack || e.message}`);
    }
}

// data.js stashCodeFences가 찾은 블록(여는 펜스부터 닫는 펜스까지의 줄)
function stashBlocks(md) {
    const stash = call('stashCodeFences')(md, { keepSpaces: true });
    const ids = [...stash.text.matchAll(/\u0000CODE(\d+)\u0000/g)].map(m => m[1]);
    return ids.map(id => stash.restore(`\u0000CODE${id}\u0000`));
}

// 우리 블록을 같은 모양(여는 줄 + 코드 줄 + 닫는 줄)으로
function ownBlocks(md) {
    const lines = String(md).split('\n');
    return blocks(md).map(b => lines.slice(b.openLine, b.closeLine < 0 ? lines.length : b.closeLine + 1).join('\n'));
}

(async () => {
    /* ---------- 언어 표 ---------- */
    await run('언어 표: 별칭·대소문자·뒤 속성을 언어 키로 바꾼다', () => {
        const cases = {
            python: 'python', py: 'python', Python3: 'python', 'python title="a.py"': 'python', 'PY {.numberLines}': 'python',
            sh: 'bash', shell: 'bash', zsh: 'bash', ps1: 'powershell', pwsh: 'powershell', rb: 'ruby', yml: 'yaml', gd: 'gdscript',
            js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
            'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', h: 'cpp', cs: 'csharp', 'C#': 'csharp', golang: 'go', rs: 'rust', kt: 'kotlin', kts: 'kotlin',
            shaderlab: 'shader', mysql: 'sql', postgresql: 'sql', postgres: 'sql', sqlite: 'sql', tsql: 'sql', plsql: 'sql',
            hs: 'haskell', tex: 'latex', bat: 'batch', cmd: 'batch', mlua: 'mlua', lua: 'lua', css: 'css', html: 'html', vue: 'vue',
            ini: 'ini', nasm: 'nasm', asm: 'asm', clojure: 'clojure', autohotkey: 'autohotkey', matlab: 'matlab', erlang: 'erlang',
            prolog: 'prolog', vb: 'vb', vbnet: 'vbnet', vba: 'vba', vbscript: 'vbscript', 'language-python': 'python', '{.python}': 'python',
            'js{1,3}': 'javascript', 'python:main.py': 'python', dockerfile: 'dockerfile', makefile: 'makefile', toml: 'toml', perl: 'perl', r: 'r',
            elixir: 'elixir', julia: 'julia', java: 'java', c: 'c', swift: 'swift', scala: 'scala', dart: 'dart', php: 'php', groovy: 'groovy',
            glsl: 'glsl', hlsl: 'hlsl', solidity: 'solidity', scss: 'scss', less: 'less', jsonc: 'jsonc', json5: 'json5', ada: 'ada', vhdl: 'vhdl',
            xml: 'xml', svg: 'svg', xaml: 'xaml', lisp: 'lisp', scheme: 'scheme'
        };
        Object.entries(cases).forEach(([info, key]) => assert.strictEqual(lang(info), key, info));
    });

    await run('언어 표: 코드가 아닌 이름표·이름표 없음·모르는 이름표는 검사하지 않는다', () => {
        ['text', 'txt', 'plaintext', 'plain', 'output', 'result', 'console', 'terminal', 'log', 'mermaid', 'json', 'csv', 'tsv', 'diff', 'patch', 'markdown', 'md', '', '   ', 'brainfuck', 'constructor', '__proto__']
            .forEach(info => assert.strictEqual(lang(info), null, info));
        const skip = call('CODE_COMMENT_SKIP_LABELS');
        ['text', 'mermaid', 'json', 'md', 'diff'].forEach(label => assert.ok(skip.has(label), label));
        const md = ['```text', 'a', '```', '```', 'b', '```', '```brainfuck', '+++', '```', '```python', 'x = 1', '```'].join('\n');
        assert.deepStrictEqual(blocks(md).map(b => b.skip), ['nocode', 'nolabel', 'unknown', '']);
        assert.deepStrictEqual(plain(call('codeCommentPreview')(md)).unknown, ['brainfuck'], '모르는 이름표는 따로 알린다');
    });

    await run('언어 표: 언어마다 주석 기호와 줄 끝 주석 허용을 둔다', () => {
        const langs = call('CODE_COMMENT_LANGS');
        const expect = { python: '#', bash: '#', javascript: '//', css: '/* */', sql: '--', lua: '--', html: '<!-- -->', ini: ';', matlab: '%', vb: "'", batch: 'REM' };
        Object.entries(expect).forEach(([key, mark]) => assert.ok(call('codeCommentMarks')(key).includes(mark), `${key}: ${call('codeCommentMarks')(key)}`));
        ['dockerfile', 'makefile', 'ini', 'batch'].forEach(key => assert.strictEqual(langs[key].eol, false, key));
        ['python', 'javascript', 'sql', 'html', 'css', 'yaml'].forEach(key => assert.strictEqual(langs[key].eol, true, key));
        assert.ok(Object.values(langs).every(spec => typeof spec.name === 'string' && spec.name));
    });

    await run('언어 표: 모든 언어가 작은 예문을 읽고 줄 위 주석을 받는다', () => {
        const langs = call('CODE_COMMENT_LANGS');
        // xml·svg·xaml은 요소 글자 사이에 주석을 넣지 않으므로 태그로 된 예문을 쓴다
        const SAMPLE = { dockerfile: 'FROM python', makefile: 'all:', yaml: 'a: 1', toml: 'a = 1', ini: 'a=1', batch: 'echo hi', css: 'p { color: red; }', scss: 'p { color: red; }', less: 'p { color: red; }', sql: 'SELECT 1;', xml: '<a/>', svg: '<svg/>', xaml: '<Grid/>' };
        Object.entries(langs).forEach(([key, spec]) => {
            const comment = spec.add.length ? `${spec.add[0]} 설명` : `${spec.addBlock[0]} 설명 ${spec.addBlock[1]}`;
            const code = SAMPLE[key] || 'x = 1';
            const out = verify(key, code, `${comment}\n${code}`);
            assert.ok(out.ok && out.enough && out.added === 1, `${key}: ${out.reason}`);
        });
    });

    /* ---------- 블록 찾기 ---------- */
    const FENCE_DOC = [
        '# 제목', '', '## 1. 첫 절 (⏱ 30분)', '', '반복문을 봅니다.', '',
        '```Python title="a.py"', 'for i in range(3):', '    print(i)', '```', '',
        '~~~js', '```', 'let a = 1;', '```', '~~~', '',
        '````md', '```', '안쪽', '```', '````', '',
        '```npm install```', '',
        '## 2. 목록 안', '', '1. 단계입니다.', '   ```bash', '   echo hi', '     ls', '  pwd', '   ```', '',
        '```js', 'let b = 2;'
    ].join('\n');

    await run('블록 찾기: ``` 펜스·긴 펜스·안쪽 ``` 줄·닫히지 않은 블록·목록 안 들여쓴 펜스·이름표 속성·대문자', () => {
        const found = blocks(FENCE_DOC);
        assert.deepStrictEqual(found.map(b => [b.label, b.lang, b.openLine, b.closeLine]), [
            ['Python', 'python', 6, 9], ['', null, 12, 14], ['md', null, 17, 21], ['bash', 'bash', 28, 32], ['js', 'javascript', 34, -1]
        ]);
        assert.deepStrictEqual(found[0].lines, ['for i in range(3):', '    print(i)']);
        assert.strictEqual(found[0].info, 'Python title="a.py"');
        assert.strictEqual(found[2].fence, '````');
        assert.deepStrictEqual(found[2].lines, ['```', '안쪽', '```'], '여는 펜스보다 짧은 ``` 는 코드다');
        assert.strictEqual(found[3].indent, '   ');
        assert.deepStrictEqual(found[3].lines, ['echo hi', '  ls', 'pwd'], '펜스 들여쓰기만큼(있는 만큼) 뗀다');
        assert.strictEqual(found[4].skip, 'unclosed');
        assert.deepStrictEqual(found.map(b => b.index), [0, 1, 2, 3, 4]);
        assert.strictEqual(found[0].section, '1. 첫 절 (⏱ 30분)');
        assert.strictEqual(found[3].section, '2. 목록 안');
        assert.ok(found[0].context.includes('## 1. 첫 절') && found[0].context.includes('반복문을 봅니다.'), found[0].context);
        assert.ok(!found.some(b => b.label === 'npm'), '한 줄에서 여닫는 ```npm install```은 블록이 아니다');
        // ~~~ 는 앱(stashCodeFences)과 같이 펜스로 보지 않는다. 그 안의 ``` 줄은 펜스다
        assert.ok(!found.some(b => b.openLine === 11 || b.openLine === 15), '~~~ 는 펜스가 아니다');
        assert.deepStrictEqual([found[1].openLine, found[1].lines, found[1].skip], [12, ['let a = 1;'], 'nolabel'], '~~~ 안의 ``` 는 앱처럼 블록을 연다');
    });

    await run('블록 찾기: 같은 글에서 stashCodeFences와 같은 블록을 찾는다(CRLF·특수 공백·여러 경우)', () => {
        const docs = [
            FENCE_DOC,
            FENCE_DOC.replace(/\n/g, '\r\n'),
            '```python\nx = 1\n```\n글\n```\ny\n```',
            '\u00A0```js\nlet a =\u00A01;\n\u00A0```',
            '````python\n```\n````\n```\nz\n',
            '글만 있습니다.\n```npm i```\n끝',
            '```js\n```\n```js\nx\n```'
        ];
        docs.forEach(md => assert.deepStrictEqual(ownBlocks(md), stashBlocks(md), JSON.stringify(md)));
        const crlf = blocks('```python\r\nx = 1\r\n```\r\n');
        assert.deepStrictEqual(crlf[0].lines, ['x = 1'], '줄 끝 \\r 은 코드 줄에서 뗀다');
        assert.strictEqual(crlf[0].eol, '\r\n');
    });

    /* ---------- 주석 세기 ---------- */
    const counted = (key, code, opts) => { const c = count(key, code, opts); return [c.codeLines, c.comments]; };

    await run('주석 세기: 주석 줄 묶음·줄 끝 주석·여러 줄 블록 주석을 하나씩 센다', () => {
        assert.deepStrictEqual(counted('python', '# 합계를 구합니다\ntotal = 0\nfor n in range(3):\n    total += n  # 더합니다\nprint(total)'), [4, 2]);
        assert.deepStrictEqual(counted('python', '# 하나\n# 이어진 줄\n\n# 둘\nx = 1'), [1, 2], '빈 줄이 묶음을 나눈다');
        assert.deepStrictEqual(counted('javascript', '/*\n * 머리말\n */\nlet a = 1; /* 끝 */\nlet b = /* 가운데 */ 2;'), [2, 3]);
        assert.deepStrictEqual(counted('c', '/* 첫 줄\n\n   셋째 줄 */\nint a;'), [1, 1], '빈 줄이 낀 블록 주석도 하나다');
        assert.deepStrictEqual(counted('c', 'int a; /* 길게\n   이어서 */ int b;'), [2, 1], '코드 줄에서 열고 닫는 블록 주석도 하나다');
        assert.deepStrictEqual(counted('python', ''), [0, 0]);
        assert.deepStrictEqual(counted('python', '\n\n'), [0, 0]);
    });

    await run('주석 세기: 문자열 안의 기호는 주석이 아니다(python 따옴표·삼중 따옴표·f/r/b 접두)', () => {
        const code = ['s = "# 주석 아님"', "t = '''", '# 문자열 안', "'''", 'u = f"{s} # 아님"', "v = r'\\d # 아님'", 'w = b"#"', 'x = """한 줄 # 아님"""', 'y = "따옴표 \\" # 아님"'].join('\n');
        assert.deepStrictEqual(counted('python', code), [9, 0]);
        assert.deepStrictEqual(counted('python', 'x = 1  # 진짜 "따옴표" 주석'), [1, 1]);
        assert.deepStrictEqual(counted('gdscript', 'var s = "# 아님"\n# 진짜'), [1, 1]);
    });

    await run('주석 세기: bash의 $# · ${#a[@]} · 단어 중간 # 은 주석이 아니고 #! 첫 줄은 세지 않는다', () => {
        const code = ['#!/bin/bash', 'echo $#', 'echo ${#arr[@]}', 'echo a#b', 'echo "# 아님" \'# 아님\'', 'x=$((16#ff))', 'ls # 목록', 'echo hi;# 끝'].join('\n');
        assert.deepStrictEqual(counted('bash', code), [7, 2]);
        assert.deepStrictEqual(counted('bash', '#!/bin/bash\n# 설명'), [0, 1], '#! 줄은 코드도 주석도 아니다');
        assert.deepStrictEqual(counted('python', '#!/usr/bin/env python3\nprint(1)'), [1, 0]);
        assert.deepStrictEqual(counted('rust', '#![allow(dead_code)]\nfn main() {}'), [2, 0], 'rust의 #![…] 는 코드다');
    });

    await run('주석 세기: yaml은 공백 뒤 # 만, php 8의 #[Attr]는 코드, c·cpp·csharp의 #include·#region·#if는 코드다', () => {
        assert.deepStrictEqual(counted('yaml', '# 설정\nkey: a#b\nurl: http://x.y/#top\nname: x # 이름\nmsg: it\'s # 끝'), [4, 3]);
        assert.deepStrictEqual(counted('php', '<?php\n#[Attribute]\nclass A {}\n# 주석\n// 주석 둘'), [3, 1]);
        assert.deepStrictEqual(counted('php', '<?php\n$a = 1; # 끝\n$b = "# 아님";'), [3, 1]);
        assert.deepStrictEqual(counted('cpp', '#include <stdio.h>\n#if DEBUG\nint x = 1;\n#endif'), [4, 0]);
        assert.deepStrictEqual(counted('csharp', '#region Setup\nint x = 1;\n#endregion'), [3, 0]);
        assert.deepStrictEqual(counted('c', '#define MAX 10 // 최대'), [1, 1]);
    });

    await run('주석 세기: js 템플릿 문자열과 문자열 속 URL의 // 는 주석이 아니다', () => {
        const code = ['const url = "https://example.com/a";', 'const s = `// 아님 ${url} // 아님`;', 'const t = `', '// 템플릿 안', '`;', 'const re = /\\/\\/ 아님/;', "const q = 'http://x.y'; // 진짜"].join('\n');
        assert.deepStrictEqual(counted('javascript', code), [7, 1]);
        assert.deepStrictEqual(counted('typescript', 'const n = `${a + `// 안`}`; // 끝'), [1, 1], '템플릿 안의 템플릿');
        assert.deepStrictEqual(counted('javascript', 'const el = (\n  <p>\n    // 화면 글자\n    {/* 진짜 주석 */}\n  </p>\n);'), [6, 1], 'JSX 안의 // 는 글자다');
    });

    await run('주석 세기: 여러 언어의 문자열·긴 문자열·특수 문법', () => {
        assert.deepStrictEqual(counted('lua', '--[[ 긴\n주석 ]]\nlocal s = [[\n-- 문자열 안\n]]\nprint(s) -- 출력'), [4, 2]);
        assert.deepStrictEqual(counted('sql', "SELECT '--아님' FROM t; -- 끝\n/* 블록 */"), [1, 2]);
        assert.deepStrictEqual(counted('html', '<!-- 머리 -->\n<p>a</p>\n<script>// 아님</script>'), [2, 1]);
        assert.deepStrictEqual(counted('css', 'a { color: red; } /* 빨강 */\nb { background: url(http://x.y/z.png); }'), [2, 1]);
        assert.deepStrictEqual(counted('haskell', 'x = a --> b\n-- 주석\ny = foldl\' f 0 xs'), [2, 1]);
        assert.deepStrictEqual(counted('perl', 'my $n = $#array;\nprint "# 아님"; # 진짜'), [2, 1]);
        assert.deepStrictEqual(counted('ruby', '=begin\n설명\n=end\nputs "# 아님"'), [1, 1]);
        assert.deepStrictEqual(counted('csharp', 'var p = @"C:\\temp\\";\n// 진짜'), [1, 1], 'c# 축자 문자열의 \\ 는 이스케이프가 아니다');
        assert.deepStrictEqual(counted('rust', "fn f<'a>(x: &'a str) -> &'a str { x } // 수명\nlet c = '#';"), [2, 1]);
        assert.deepStrictEqual(counted('batch', '@echo off\nREM 설명\n:: 둘\necho hi'), [2, 1]);
        assert.deepStrictEqual(counted('vb', "Dim s = \"' 아님\" ' 진짜"), [1, 1]);
        assert.deepStrictEqual(counted('matlab', "a = b'; % 전치\ns = 'it''s'; % 문자열"), [2, 2]);
        assert.deepStrictEqual(counted('latex', '100\\% 완료 % 진짜'), [1, 1]);
        assert.deepStrictEqual(counted('lisp', '(char= c #\\;) ; 진짜'), [1, 1]);
        assert.deepStrictEqual(counted('erlang', 'C = $%, % 진짜'), [1, 1]);
    });

    await run('주석 세기: sql 이름표(mysql·tsql·postgres)마다 주석과 문자열 규칙이 다르고, 문자열 안의 줄 머리 구역은 열지 않는다', () => {
        assert.deepStrictEqual(counted('sql', 'SELECT 1; # 끝', { dialect: 'mysql' }), [1, 1], 'mysql의 # 은 주석');
        assert.deepStrictEqual(counted('sql', 'SELECT 5 # 3;'), [1, 0], '다른 sql의 # 은 연산자');
        assert.deepStrictEqual(counted('sql', "SELECT 'it\\'s -- 아님'; -- 끝", { dialect: 'mysql' }), [1, 1], 'mysql 문자열의 \\ 이스케이프');
        assert.deepStrictEqual(counted('sql', 'SELECT [a--b] FROM t; -- 끝', { dialect: 'tsql' }), [1, 1], 'tsql의 [이름]');
        assert.deepStrictEqual(counted('sql', 'CREATE FUNCTION f() AS $$\n-- 본문 안\n$$ LANGUAGE sql;', { dialect: 'postgres' }), [3, 0], '$$ 안은 문자열');
        const mysqlBlock = blocks('```mysql\nSELECT 1; # 끝\n```')[0];
        assert.strictEqual(call('codeCommentCount')(mysqlBlock.lang, mysqlBlock.lines, { dialect: mysqlBlock.label }).comments, 1, '블록 이름표로 갈래를 정한다');
        assert.deepStrictEqual(counted('ruby', 's = "\n=begin\n"\nputs s'), [4, 0], '문자열 안의 =begin 은 주석이 아니다');
        assert.deepStrictEqual(zones('powershell', '$t = @"\n# 안쪽\n"@\nWrite-Host $t').gaps.map(gap => gap.why), ['', 'string', 'string', '', ''], 'powershell here-string');
    });

    await run('필요 수: 코드 줄 0이면 0, 아니면 max(1, floor(코드 줄/10)) — 9·10·19·20줄 경계', () => {
        const lines = n => ['# 설명', ...Array.from({ length: n }, (_, i) => `x${i} = ${i}`)].join('\n');
        const need = n => count('python', lines(n));
        assert.deepStrictEqual([9, 10, 19, 20, 29, 30].map(n => need(n).need), [1, 1, 1, 2, 2, 3]);
        assert.deepStrictEqual([9, 10, 19, 20].map(n => need(n).short), [false, false, false, true]);
        assert.strictEqual(count('python', '# 주석만').need, 0);
        assert.strictEqual(count('python', '# 주석만').short, false);
        assert.strictEqual(count('python', 'x = 1').short, true);
        assert.deepStrictEqual([0, 1, 9, 10, 19, 20].map(n => call('codeCommentNeed')(n)), [0, 1, 1, 1, 1, 2]);
    });

    /* ---------- 주석을 넣으면 안 되는 자리 ---------- */
    // gaps[g]: g째 줄(0부터) 앞에 주석 줄을 넣을 수 있는지(마지막은 끝 뒤), ends[i]: i째 줄 끝에 주석을 붙일 수 있는지. 빈 글이면 된다는 뜻
    const gapsOf = (key, code, opts) => zones(key, code, opts).gaps.map(gap => gap.why);
    const endsOf = (key, code, opts) => zones(key, code, opts).ends.map(end => end.why);

    await run('보호 구역: 여러 줄 문자열(python 삼중 따옴표·js 템플릿·c# @"" 와 """·java·kotlin·swift """·go 백틱·rust·lua [[ ]])', () => {
        assert.deepStrictEqual(gapsOf('python', 'x = 1\ns = """\n안쪽\n"""\ny = 2'), ['', '', 'string', 'string', '', '']);
        assert.deepStrictEqual(endsOf('python', 'x = 1\ns = """\n안쪽\n"""\ny = 2'), ['', 'string', 'string', '', '']);
        assert.deepStrictEqual(gapsOf('python', "s = f'''{x}\n'''"), ['', 'string', '']);
        assert.deepStrictEqual(gapsOf('javascript', 'const t = `\n// 안\n`;\nlet a;'), ['', 'string', 'string', '', '']);
        assert.deepStrictEqual(gapsOf('csharp', 'var a = @"첫\n둘";\nvar b = """\n  raw\n  """;\nint c;'), ['', 'string', '', 'string', 'string', '', '']);
        assert.deepStrictEqual(gapsOf('java', 'String s = """\n  안\n  """;'), ['', 'string', 'string', '']);
        assert.deepStrictEqual(gapsOf('kotlin', 'val s = """\n안\n"""'), ['', 'string', 'string', '']);
        assert.deepStrictEqual(gapsOf('swift', 'let s = """\n안\n"""\nlet r = #"a"b"#'), ['', 'string', 'string', '', '']);
        assert.deepStrictEqual(gapsOf('go', 's := `\n// 안\n`'), ['', 'string', 'string', '']);
        assert.deepStrictEqual(gapsOf('rust', 'let s = "첫\n둘";\nlet r = r#"\n"안"\n"#;'), ['', 'string', '', 'string', 'string', '']);
        assert.deepStrictEqual(gapsOf('lua', 'local s = [==[\n]]\n]==]\nprint(s)'), ['', 'string', 'string', '', '']);
        assert.deepStrictEqual(gapsOf('bash', "echo 'a\nb'\necho \"c\nd\""), ['', 'string', '', 'string', '']);
        assert.deepStrictEqual(gapsOf('sql', "SELECT 'a\nb' FROM t;"), ['', 'string', '']);
        assert.deepStrictEqual(gapsOf('ruby', 'x = "a\nb"\ny = %w[\na\n]'), ['', 'string', '', 'string', 'string', '']);
        assert.deepStrictEqual(gapsOf('php', "<?php\n$a = 'x\ny';"), ['html', '', 'string', '']);
    });

    await run('보호 구역: 셸 히어독(<<EOF · <<-EOF · <<\'EOF\')과 ruby·php 히어독', () => {
        const sh = 'cat <<EOF\n# 안쪽\nEOF\necho done';
        assert.deepStrictEqual(gapsOf('bash', sh), ['', 'heredoc', 'heredoc', '', '']);
        assert.deepStrictEqual(endsOf('bash', sh), ['heredoc', 'heredoc', 'heredoc', '']);
        assert.deepStrictEqual(gapsOf('bash', "cat <<-'END'\n\tx\n\tEND\nls"), ['', 'heredoc', 'heredoc', '', '']);
        assert.deepStrictEqual(gapsOf('bash', 'cat <<EOF\nEOF \nEOF\nls'), ['', 'heredoc', 'heredoc', '', ''], '끝 줄은 글자가 똑같아야 한다');
        assert.deepStrictEqual(gapsOf('bash', 'echo $((1 << 2))\ncat <<< "x"\nls'), ['', '', '', ''], '<< 셈과 <<< 는 히어독이 아니다');
        assert.deepStrictEqual(gapsOf('ruby', 'text = <<~EOS\n  안\n  EOS\nputs text'), ['', 'heredoc', 'heredoc', '', '']);
        assert.deepStrictEqual(gapsOf('php', '<?php\n$t = <<<TXT\n안\n  TXT;\necho $t;'), ['html', '', 'heredoc', 'heredoc', '', '']);
        assert.deepStrictEqual(gapsOf('dockerfile', 'RUN <<EOF\necho hi\nEOF\nCMD ["x"]'), ['', 'heredoc', 'heredoc', '', '']);
    });

    await run('보호 구역: yaml 블록 글(키: | 또는 >, 지시자 포함, 들여쓰기가 끝날 때까지)', () => {
        assert.deepStrictEqual(gapsOf('yaml', 'script: |\n  echo hi\n  # 안쪽\nnext: 1'), ['', 'block', 'block', 'block', '']);
        assert.deepStrictEqual(endsOf('yaml', 'script: |\n  echo hi\n  # 안쪽\nnext: 1'), ['block', 'block', 'block', '']);
        assert.deepStrictEqual(gapsOf('yaml', 'steps:\n  - run: >-\n      a\n\n      b\n    name: x'), ['', '', 'block', 'block', 'block', 'block', '']);
        assert.deepStrictEqual(gapsOf('yaml', 'items:\n  - |2\n    text\n  - b'), ['', '', 'block', 'block', '']);
        assert.deepStrictEqual(gapsOf('yaml', 'a: "x | y"\nb: c # | 아님\nd: 1'), ['', '', '', ''], '문자열·주석 안의 | 는 블록 글이 아니다');
        // 여러 줄 평문 값: 주석 줄이 끼면 값이 끊긴다
        assert.deepStrictEqual(gapsOf('yaml', 'key: this is\n  continued\n\n  more\nnext: 1'), ['', 'string', 'string', 'string', '', '']);
        assert.deepStrictEqual(endsOf('yaml', 'key: this is\n  continued\nnext: 1'), ['string', '', '']);
        assert.deepStrictEqual(gapsOf('yaml', 'list:\n  - a\n  - b: 1\n    c: 2'), ['', '', '', '', ''], '새 키와 목록 항목은 이어지는 글이 아니다');
    });

    await run('보호 구역: 줄 이어짐(\\ · powershell ` · vb " _" · batch ^) 다음과 그 줄 끝', () => {
        assert.deepStrictEqual(gapsOf('python', 'x = 1 + \\\n    2\ny = 3'), ['', 'cont', '', '']);
        assert.deepStrictEqual(endsOf('python', 'x = 1 + \\\n    2\ny = 3'), ['cont', '', '']);
        assert.deepStrictEqual(gapsOf('bash', 'ls \\\n  -la'), ['', 'cont', '']);
        assert.deepStrictEqual(gapsOf('powershell', 'Get-Item `\n  -Path x'), ['', 'cont', '']);
        assert.deepStrictEqual(gapsOf('vb', 'Dim a = 1 + _\n    2'), ['', 'cont', '']);
        assert.deepStrictEqual(gapsOf('batch', 'echo a ^\n b'), ['', 'cont', '']);
        assert.deepStrictEqual(gapsOf('c', '#define A \\\n  1\nint b;'), ['', 'cont', '', '']);
        assert.deepStrictEqual(gapsOf('cpp', '// 설명 \\\nint a;\nint b;'), ['', 'cont', '', ''], 'c·cpp는 // 주석도 \\ 로 다음 줄에 이어진다');
        assert.deepStrictEqual(gapsOf('python', 'x = (1 +\n     2)'), ['', '', ''], '괄호 안의 줄 바꿈은 주석을 넣어도 된다');
    });

    await run('보호 구역: JSX(<로 시작하는 줄 앞, >로 끝나는 줄 뒤, JSX 글자 사이)', () => {
        const jsx = 'return (\n  <div>\n    {count}\n  </div>\n);';
        assert.deepStrictEqual(gapsOf('javascript', jsx), ['', 'jsx', 'jsx', 'jsx', 'jsx', '']);
        assert.deepStrictEqual(endsOf('javascript', jsx), ['', 'jsx', 'jsx', 'jsx', '']);
        assert.deepStrictEqual(gapsOf('typescript', 'const el = <p>\n  Count:\n  {count}\n</p>;\nlet a = 1;'), ['', 'jsx', 'jsx', 'jsx', '', '']);
        assert.deepStrictEqual(gapsOf('javascript', 'const f = () =>\n  x + 1;\nif (a < b) {\n  c();\n}'), ['', '', '', '', '', ''], '=> 와 비교식은 JSX가 아니다');
        assert.deepStrictEqual(gapsOf('javascript', '<button onClick={() => {\n  setCount(count + 1);\n}}>\n</button>'), ['jsx', '', '', 'jsx', 'jsx'], 'JSX 속성의 { } 안은 코드라 주석을 넣어도 된다');
    });

    await run('보호 구역: php의 ?> 와 <?php 사이(HTML 부분), 태그 안·pre·script, 블록 주석 안, define·verbatim, #! 위, 맨 앞 지시 줄', () => {
        assert.deepStrictEqual(gapsOf('php', '<h1>제목</h1>\n<?php\necho 1;\n?>\n<p>끝</p>'), ['html', 'html', '', '', 'html', 'html']);
        assert.deepStrictEqual(endsOf('php', '<h1>제목</h1>\n<?php\necho 1;\n?>\n<p>끝</p>'), ['html', '', '', 'html', 'html']);
        assert.deepStrictEqual(gapsOf('php', '$a = 1;\necho $a;'), ['', '', ''], '<?php 가 없는 조각은 처음부터 코드다');
        assert.deepStrictEqual(gapsOf('html', '<div\n  class="a">\n<pre>\n줄\n</pre>\n<script>\nlet a = 1;\n</script>\n<p>끝</p>'), ['', 'markup', '', 'markup', 'markup', '', 'markup', 'markup', '', '']);
        assert.deepStrictEqual(gapsOf('c', 'int a;\n/* 머리\n   말 */\nint b;'), ['', '', 'comment', '', '']);
        assert.deepStrictEqual(gapsOf('makefile', 'define BODY\n# 안\nendef\nall:'), ['', 'define', 'define', '', '']);
        assert.deepStrictEqual(gapsOf('latex', '\\begin{verbatim}\n% 안\n\\end{verbatim}\n글'), ['', 'verbatim', 'verbatim', '', '']);
        assert.deepStrictEqual(gapsOf('bash', '#!/bin/bash\necho hi'), ['shebang', '', '']);
        assert.strictEqual(endsOf('bash', '#!/bin/bash\necho hi')[0], 'directive');
        assert.deepStrictEqual(gapsOf('dockerfile', '# syntax=docker/dockerfile:1\nFROM python\nRUN pip install x \\\n  y'), ['directive', '', '', 'cont', '']);
        assert.deepStrictEqual(gapsOf('xml', '<?xml version="1.0"?>\n<a/>'), ['directive', '', '']);
        assert.deepStrictEqual(gapsOf('python', '# -*- coding: cp949 -*-\nx = 1'), ['directive', '', '']);
        assert.deepStrictEqual(gapsOf('autohotkey', 'MsgBox,\n(\nLine 1\nLine 2\n)\nReturn'), ['', 'string', 'string', 'string', 'string', '', ''], 'autohotkey 이어 쓰기 구역');
    });

    await run('보호 구역: 줄 끝 주석을 못 쓰는 언어(dockerfile·makefile·ini·batch)', () => {
        assert.deepStrictEqual(endsOf('dockerfile', 'FROM python'), ['noeol']);
        assert.deepStrictEqual(endsOf('makefile', 'X = 1'), ['noeol']);
        assert.deepStrictEqual(endsOf('ini', 'a=1'), ['noeol']);
        assert.deepStrictEqual(endsOf('batch', 'echo hi'), ['noeol']);
        assert.deepStrictEqual(endsOf('python', 'x = 1'), ['']);
    });

    /* ---------- 주석만 더했는지 확인 ---------- */
    const rejects = (key, code, answer, pattern, extra) => {
        const out = verify(key, code, answer, extra);
        assert.strictEqual(out.ok, false, `막아야 한다: ${JSON.stringify(answer)}`);
        assert.strictEqual(out.code, code, '실패하면 원래 코드를 돌려준다');
        assert.strictEqual(out.added, 0);
        if (pattern) assert.ok(pattern.test(out.reason), out.reason);
        return out;
    };
    const passes = (key, code, answer, expected, extra) => {
        const out = verify(key, code, answer, extra);
        assert.strictEqual(out.ok, true, `${JSON.stringify(answer)} → ${out.reason}`);
        if (expected !== undefined) assert.strictEqual(out.code, expected);
        return out;
    };

    await run('확인: 원래 줄 삭제·변경·순서 바꿈·코드 추가를 막는다', () => {
        rejects('python', 'a = 1\nb = 2', '# 설명\na = 1', /2째 줄.*빠졌습니다/);
        rejects('python', 'a = 1\nb = 2', '# 설명\na = 2\nb = 2', /1째 줄.*바뀌었습니다/);
        rejects('python', 'a = 1\nb = 2', 'b = 2\na = 1', /더했습니다|바뀌었습니다|빠졌습니다/);
        rejects('python', 'a = 1\nb = 2', 'a = 1\nb = 2\nc = 3', /코드/);
        rejects('python', 'a = 1', '// 설명\na = 1', /코드/);
        rejects('python', 'a = 1', '    a = 1', /바뀌었습니다/); // 들여쓰기를 바꾸면 막는다
        rejects('python', 'a = 1', 'a = 1; b = 2  # 설명', /바뀌었습니다/);
    });

    await run('확인: 이어짐·히어독·여러 줄 문자열·템플릿·yaml 블록 글·JSX 안의 주석을 막는다', () => {
        rejects('python', 'x = 1 + \\\n    2', 'x = 1 + \\\n# 설명\n    2', /줄 이어짐/);
        rejects('python', 'x = 1 + \\\n    2', 'x = 1 + \\  # 설명\n    2', /줄 이어짐/);
        rejects('bash', 'cat <<EOF\nhi\nEOF', 'cat <<EOF\n# 설명\nhi\nEOF', /히어독/);
        rejects('bash', 'cat <<EOF\nhi\nEOF', 'cat <<EOF\nhi  # 설명\nEOF', /히어독/);
        rejects('python', 's = """\na\n"""', 's = """\n# 설명\na\n"""', /문자열/);
        rejects('javascript', 'const t = `\na\n`;', 'const t = `\n// 설명\na\n`;', /문자열/);
        rejects('yaml', 'run: |\n  echo hi\nname: x', 'run: |\n  # 설명\n  echo hi\nname: x', /블록 글/);
        rejects('javascript', 'const el = (\n  <p>\n    {n}\n  </p>\n);', 'const el = (\n  <p>\n    // 설명\n    {n}\n  </p>\n);', /JSX/);
        rejects('javascript', 'const el = <p>\n  {n}\n</p>;', 'const el = <p> // 설명\n  {n}\n</p>;', /JSX/);
        rejects('php', '<p>a</p>\n<?php echo 1; ?>\n<p>b</p>', '<p>a</p>\n<?php echo 1; ?>\n# 설명\n<p>b</p>', /HTML/);
    });

    await run('확인: 쓸 수 없는 주석 모양을 막는다', () => {
        rejects('c', 'int a;', '/* 여러 줄을\nint a;', /주석/);
        rejects('c', 'int a;', '/* 가 */ 나 */\nint a;', /닫는 기호/);
        rejects('c', 'int a;', '// 설명 \\\nint a;', /\\/);
        rejects('python', 'a = 1', '# 설명 \\\na = 1', /\\/);
        rejects('python', 'a = 1', '```python\na = 1', /```/);
        rejects('python', 'a = 1', '~~~\na = 1', /~~~/);
        rejects('html', '<p>a</p>', '<!-- 가 -- 나 -->\n<p>a</p>', /--/);
        rejects('html', '<p>a</p>', '<!-- 가\n<p>a</p>', /주석/);
        rejects('lua', 'print(1)', '--[[ 설명 ]]\nprint(1)', /--\[\[|기호/);
        rejects('lua', 'print(1)', '--[==[ 설명 ]==]\nprint(1)', /--\[\[|기호/);
        rejects('python', 'a = 1', '#설명\na = 1', /공백/);
        rejects('javascript', 'let a;', '//설명\nlet a;', /공백/);
        rejects('python', 'a = 1', `# ${'가'.repeat(301)}\na = 1`, /300/);
        rejects('python', 'a = 1', '# \na = 1', /비/);
        rejects('dockerfile', 'FROM python', 'FROM python # 설명', /줄 끝/);
        rejects('batch', 'if 1==1 (\n  echo a\n)', 'if 1==1 (\n  :: 설명\n  echo a\n)', /REM/);
        rejects('batch', 'echo a', 'REM 설명 ^\necho a', /\^/);
        rejects('makefile', 'all:\n\techo hi', 'all:\n\t# 설명\n\techo hi', /탭/);
        rejects('php', '<?php\necho 1;', '<?php\n// 설명 ?> 끝\necho 1;', /\?>/);
        rejects('python', 'a = 1', `# 설명${String.fromCharCode(0x2028)}b = 2\na = 1`, /글자/);
        rejects('python', 'x = 1', '# coding: latin-1\nx = 1', /coding/);
    });

    await run('확인: 줄 위 주석·줄 끝 주석·기존 주석 유지는 통과하고 다시 센다', () => {
        const above = passes('python', 'a = 1', '# 값을 정합니다\na = 1', '# 값을 정합니다\na = 1');
        assert.deepStrictEqual([above.added, above.enough, above.comments, above.need], [1, true, 1, 1]);
        passes('python', 'a = 1', 'a = 1  # 값', 'a = 1  # 값');
        passes('python', '# 기존\na = 1', '# 기존\na = 1  # 더함', '# 기존\na = 1  # 더함');
        passes('python', 'def f():\n    return 1', 'def f():\n    # 1을 돌려줍니다\n    return 1');
        passes('javascript', 'let a = 1;', '/* 처음 값 */\nlet a = 1; // 하나');
        passes('csharp', 'int A() => 1;', '/// <summary>1을 돌려줍니다</summary>\nint A() => 1;');
        passes('html', '<p>a</p>', '<!-- 문단 -->\n<p>a</p>');
        passes('css', 'p { color: red; }', '/* 빨간 글자 */\np { color: red; } /* 끝 */');
        passes('sql', 'SELECT 1;', '-- 하나를 고릅니다\nSELECT 1; -- 끝');
        passes('batch', 'echo a', 'REM 글자를 찍습니다\necho a');
        passes('batch', 'if 1==1 (\n  echo a\n)', 'if 1==1 (\n  REM 설명\n  echo a\n)');
        passes('vb', 'Dim a = 1', "' 값을 정합니다\nDim a = 1 ' 하나");
        passes('lua', 'print(1)', '-- [[ 괄호도 글자 ]]\nprint(1)');
        passes('bash', 'cat <<EOF\nhi\nEOF', '# 글을 찍습니다\ncat <<EOF\nhi\nEOF\n# 끝났습니다');
        passes('yaml', 'run: |\n  echo hi\nname: x', '# 실행할 명령\nrun: |\n  echo hi\nname: x  # 이름');
        passes('makefile', 'all:\n\techo hi', '# 기본 목표\nall:\n\techo hi');
        const big = Array.from({ length: 20 }, (_, i) => `x${i} = ${i}`).join('\n');
        const short = passes('python', big, `# 값을 정합니다\n${big}`);
        assert.deepStrictEqual([short.enough, short.comments, short.need], [false, 1, 2], '다시 세어 아직 부족하면 알린다');
    });

    await run('확인: 줄 끝 공백만 다른 줄은 원래 줄을 쓰고, 더한 빈 줄은 버리고, 빠진 빈 줄은 되살린다', () => {
        passes('python', 'a = 1   \nb = 2', '# 설명\na = 1\nb = 2', '# 설명\na = 1   \nb = 2');
        passes('python', 'a = 1  ', 'a = 1  # 설명', 'a = 1  # 설명');
        passes('python', 'a = 1', '# 설명\n\n\na = 1\n', '# 설명\na = 1');
        passes('python', 'a = 1\n\nb = 2', 'a = 1\n# 설명\nb = 2', 'a = 1\n\n# 설명\nb = 2');
        passes('python', 'a = 1\n\nb = 2', 'a = 1\n# 설명\n\nb = 2', 'a = 1\n# 설명\n\nb = 2', undefined); // AI가 빈 줄을 주석 아래에 두었으면 그대로
        passes('python', 'a = 1\u00A0+ 2', '# 설명\na = 1 + 2', '# 설명\na = 1\u00A0+ 2');
        passes('python', 'a = 1', ['# 설명', 'a = 1'], '# 설명\na = 1');
        const out = verify('python', 'a = 1', '# 설명\r\na = 1\r\n');
        assert.deepStrictEqual([out.ok, out.code], [true, '# 설명\na = 1']);
    });

    /* ---------- 적용 ---------- */
    const apply = (md, fixes) => plain(call('codeCommentApply')(md, fixes));
    const APPLY_DOC = ['## 1. 값 (⏱ 30분)', '', '값을 정합니다.', '', '```python', 'a = 1', 'b = 2', '```', '', '글 사이입니다.  ', '', '```js', 'let c = 3;', '```', '끝입니다.'].join('\n');

    await run('적용: 고친 블록의 코드만 바꾸고 블록 밖 글(펜스 줄 포함)은 바이트 하나도 바꾸지 않는다', () => {
        const out = apply(APPLY_DOC, [{ index: 1, code: '// 값을 정합니다\nlet c = 3; // 셋' }]);
        assert.deepStrictEqual(out.applied, [1]);
        assert.deepStrictEqual(out.rejected, []);
        assert.strictEqual(out.md, APPLY_DOC.replace('```js\nlet c = 3;', '```js\n// 값을 정합니다\nlet c = 3; // 셋'));
        const strip = md => call('stashCodeFences')(md, { keepSpaces: true }).text;
        assert.strictEqual(strip(out.md), strip(APPLY_DOC), '블록 밖 글이 같다');
        assert.deepStrictEqual(blocks(out.md)[0].lines, ['a = 1', 'b = 2'], '고치지 않은 블록은 그대로');
        const bad = apply(APPLY_DOC, [{ index: 0, code: '# 설명\na = 9\nb = 2' }]);
        assert.strictEqual(bad.md, APPLY_DOC, '확인에 실패한 고침은 넣지 않는다');
        assert.strictEqual(bad.rejected[0].index, 0);
        assert.ok(/바뀌었습니다/.test(bad.rejected[0].reason), bad.rejected[0].reason);
        assert.strictEqual(apply(APPLY_DOC, [{ index: 9, code: 'x' }]).md, APPLY_DOC, '없는 블록 번호는 넣지 않는다');
    });

    await run('적용: CRLF 문서는 새 줄도 CRLF이고, 목록 안 들여쓴 펜스는 새 주석 줄에도 들여쓰기를 붙인다', () => {
        const crlf = APPLY_DOC.replace(/\n/g, '\r\n');
        const out = apply(crlf, [{ index: 0, code: '# 두 값을 정합니다\na = 1  # 하나\nb = 2' }]);
        assert.strictEqual(out.md, crlf.replace('```python\r\na = 1\r\n', '```python\r\n# 두 값을 정합니다\r\na = 1  # 하나\r\n'));
        assert.ok(!/[^\r]\n/.test(out.md), '모든 줄 끝이 CRLF다');
        const listed = ['1. 단계입니다.', '   ```bash', '   echo hi', '     ls', '   ```', '2. 다음'].join('\n');
        const bash = apply(listed, [{ index: 0, code: '# 인사를 찍습니다\necho hi\n  ls  # 목록' }]);
        assert.strictEqual(bash.md, ['1. 단계입니다.', '   ```bash', '   # 인사를 찍습니다', '   echo hi', '     ls  # 목록', '   ```', '2. 다음'].join('\n'));
        assert.deepStrictEqual(blocks(bash.md)[0].lines, ['# 인사를 찍습니다', 'echo hi', '  ls  # 목록']);
    });

    /* ---------- AI 지시와 응답 해석 ---------- */
    const parse = text => plain(call('codeCommentParse')(text));

    await run('응답 해석: 앞뒤 잡담·감싼 펜스·CRLF·빠진 번호·같은 번호 두 번·표시줄 대소문자와 공백 차이를 견딘다', () => {
        const text = [
            '네, 주석을 달았습니다.', '<<<CODE 1>>>', '# 하나', 'a = 1', '<<<END 1>>>', '',
            '  <<< code 2 >>>  ', '```python', '# 둘', 'b = 2', '```', '<<<end 2>>>',
            '**<<<Code3>>>**', 'c = 3', '<<<END 3>>>',
            '<<<CODE 3>>>', '# 다시', 'c = 3', '<<<END 3>>>',
            '<<<CODE 5>>>', 'e = 5', '', '이상입니다.'
        ].join('\r\n');
        const got = parse(text);
        assert.deepStrictEqual(got['1'], ['# 하나\na = 1']);
        assert.deepStrictEqual(got['2'], ['# 둘\nb = 2'], '감싼 ``` 펜스는 뗀다');
        assert.deepStrictEqual(got['3'], ['c = 3', '# 다시\nc = 3'], '같은 번호는 차례대로 모두 둔다');
        assert.deepStrictEqual(got['5'], ['e = 5\n\n이상입니다.'], '닫는 표시가 없으면 끝까지 받는다(확인이 걸러 낸다)');
        assert.strictEqual(got['4'], undefined);
        assert.deepStrictEqual(parse('잡담뿐입니다.'), {});
        assert.deepStrictEqual(parse(''), {});
    });

    await run('AI 지시: 블록마다 번호·언어·주석 기호·앞 설명·넣으면 안 되는 자리를 붙이고 규칙을 적는다', () => {
        const md = ['## 반복문', '', '세 번 되풀이하는 코드입니다.', '', '```python', 'for i in range(3):', '    s = """', '    안쪽', '    """', '    print(i)', '```', '', '```bash', 'ls \\', '  -la', '```'].join('\n');
        const found = call('codeCommentBlocks')(md);
        const prompt = plain(call('codeCommentPrompt')(found.map(block => ({ block }))));
        ['코드 글자·들여쓰기·빈 줄·순서는 한 글자도 바꾸지 않고 주석만 더합니다', '코드 첫 줄 위', '핵심 줄 위나 줄 끝', '코드 열 줄마다', '한국어로 짧게', '이미 있는 주석은 그대로 둡니다', '<<<CODE 번호>>>', '<<<END 번호>>>']
            .forEach(rule => assert.ok(prompt.system.includes(rule), rule));
        assert.ok(!prompt.system.includes('정답'), '문항 모드가 아니면 정답 안내를 붙이지 않는다');
        assert.ok(prompt.user.includes('<<<CODE 1>>>\nfor i in range(3):') && prompt.user.includes('<<<END 2>>>'), prompt.user);
        assert.ok(prompt.user.includes('Python') && prompt.user.includes('#'), '언어와 주석 기호');
        assert.ok(prompt.user.includes('세 번 되풀이하는 코드입니다.'), '앞 설명');
        assert.ok(/여러 줄 문자열/.test(prompt.user) && /줄 이어짐/.test(prompt.user), '넣으면 안 되는 자리');
        const quiz = plain(call('codeCommentPrompt')(found.map(block => ({ block })), { quiz: true }));
        assert.ok(quiz.system.includes('정답') && quiz.system.includes('출력 결과') && quiz.system.includes('고칠 곳'), quiz.system);
        const retry = plain(call('codeCommentPrompt')([{ block: found[0], reason: '1째 줄이 바뀌었습니다' }]));
        assert.ok(retry.user.includes('1째 줄이 바뀌었습니다'), '다시 부를 때는 틀린 까닭을 붙인다');
        const long = '가'.repeat(900);
        const ctxBlock = call('codeCommentBlocks')(`## 제목\n\n${long}\n\n\`\`\`python\nx = 1\n\`\`\``)[0];
        assert.ok(ctxBlock.context.length <= 400 && ctxBlock.context.startsWith('## 제목'), ctxBlock.context.length);
    });

    /* ---------- 일괄 작업 ---------- */
    // 받은 지시의 표시줄 사이 코드를 고쳐 돌려주는 가짜 AI. transform(code, no) → 돌려줄 코드
    const askWith = (transform, log) => async prompt => {
        log.push(prompt);
        const parts = [...prompt.user.matchAll(/<<<CODE (\d+)>>>\n([\s\S]*?)\n?<<<END \1>>>/g)];
        return `주석을 달았습니다.\n${parts.map(([, no, code]) => `<<<CODE ${no}>>>\n${transform(code, Number(no))}\n<<<END ${no}>>>`).join('\n')}\n이상입니다.`;
    };
    const commentEach = code => code.split('\n').flatMap(line => (line.trim() ? [`${line.match(/^\s*/)[0]}# 이 줄이 하는 일입니다`, line] : [line])).join('\n');
    const RUN_DOC = ['## 1. 합계', '', '합계를 구합니다.', '', '```python', 'total = 0', 'for n in [1, 2]:', '    total += n', '```', '', '```text', '3', '```', '', '## 2. 출력', '', '```python', 'print(total)', '```'].join('\n');
    const runAll = opts => call('codeCommentRun')(opts).then(plain);

    await run('일괄 작업: 가짜 AI로 주석을 더하고, 고친 블록·남은 수·호출 수를 돌려준다', async () => {
        const log = [];
        const status = [];
        const out = await runAll({ md: RUN_DOC, ask: askWith(commentEach, log), onStatus: text => status.push(text) });
        assert.deepStrictEqual(out.fixed, [0, 2]);
        assert.deepStrictEqual(out.failed, []);
        assert.deepStrictEqual([out.remaining, out.calls, log.length], [0, 1, 1]);
        assert.ok(out.md.includes('```python\n# 이 줄이 하는 일입니다\ntotal = 0\n'), out.md);
        assert.ok(out.md.includes('```text\n3\n```'), '검사하지 않는 블록은 그대로');
        assert.ok(status.length >= 1 && status.every(text => typeof text === 'string'));
        const strip = md => call('stashCodeFences')(md, { keepSpaces: true }).text;
        assert.strictEqual(strip(out.md), strip(RUN_DOC));
        const none = await runAll({ md: '```python\n# 이미 있습니다\nx = 1\n```', ask: async () => { throw new Error('부르면 안 됨'); } });
        assert.deepStrictEqual([none.calls, none.fixed, none.remaining], [0, [], 0], '주석이 충분하면 부르지 않는다');
    });

    await run('일괄 작업: 코드를 바꿔치기한 답은 버리고 까닭을 붙여 한 번만 다시 부른다', async () => {
        const log = [];
        const out = await runAll({ md: RUN_DOC, ask: askWith(code => `# 설명\n${code.replace('total = 0', 'total = 100')}`, log) });
        assert.strictEqual(out.md.includes('total = 100'), false, '원래 코드를 바꾼 글은 돌려주지 않는다');
        assert.ok(out.md.includes('```python\ntotal = 0\n'), '바꿔치기한 블록은 그대로');
        assert.deepStrictEqual(out.fixed, [2], '다른 블록은 받는다');
        assert.deepStrictEqual(out.failed.map(item => item.index), [0]);
        assert.ok(/바뀌었습니다/.test(out.failed[0].reason), out.failed[0].reason);
        assert.deepStrictEqual([out.calls, log.length, out.remaining], [2, 2, 1]);
        assert.ok(log[1].user.includes('바뀌었습니다') && !log[1].user.includes('<<<CODE 3>>>'), '다시 부를 때는 실패한 블록만 까닭과 함께 보낸다');
    });

    await run('일괄 작업: 처음 답이 틀리거나 모자라면 다시 불러 채운다', async () => {
        const answers = [
            text => text.replace(/<<<CODE 1>>>[\s\S]*?<<<END 1>>>/, '<<<CODE 1>>>\n# 설명\ntotal = 7\n<<<END 1>>>'),
            text => text
        ];
        let callNo = 0;
        const log = [];
        const ask = async prompt => {
            const base = await askWith(commentEach, log)(prompt);
            return answers[callNo++](base);
        };
        const out = await runAll({ md: RUN_DOC, ask });
        assert.deepStrictEqual([out.fixed, out.failed, out.remaining, out.calls], [[0, 2], [], 0, 2]);
        const big = Array.from({ length: 25 }, (_, i) => `x${i} = ${i}`).join('\n');
        const partial = await runAll({
            md: `\`\`\`python\n${big}\n\`\`\``,
            ask: (() => { let n = 0; return async prompt => { n += 1; const code = prompt.user.match(/<<<CODE 1>>>\n([\s\S]*?)\n<<<END 1>>>/)[1]; return `<<<CODE 1>>>\n${n === 1 ? `# 첫 설명\n${code}` : commentEach(code)}\n<<<END 1>>>`; }; })()
        });
        assert.deepStrictEqual([partial.fixed, partial.failed, partial.calls, partial.remaining], [[0], [], 2, 0], '모자란 블록은 받은 주석 위에 더 채운다');
        assert.ok(partial.md.includes('# 첫 설명\n'));
    });

    await run('일괄 작업: ask가 던지면 그 묶음을 실패로 적고 다음 묶음으로 가고, 멈춤이면 바로 끝낸다', async () => {
        let n = 0;
        const out = await runAll({ md: RUN_DOC, maxBlocks: 1, ask: async prompt => { n += 1; if (n === 1) throw new Error('연결이 끊겼습니다'); return askWith(commentEach, [])(prompt); } });
        assert.deepStrictEqual(out.failed.map(item => item.index), [0]);
        assert.ok(out.failed[0].reason.includes('연결이 끊겼습니다'), out.failed[0].reason);
        assert.deepStrictEqual([out.fixed, out.calls, out.remaining], [[2], 2, 1]);
        const halt = await runAll({ md: RUN_DOC, maxBlocks: 1, ask: async () => { throw Object.assign(new Error('하루 한도'), { status: 429, quota: 'daily', noRetry: true }); } });
        assert.deepStrictEqual([halt.calls, halt.failed.length, halt.remaining], [1, 2, 2], '다시 보내도 같은 오류면 멈춘다(보내지 못한 블록도 failed에 든다)');
        assert.ok(halt.error && halt.error.includes('하루 한도'));
        let stop = false;
        const stopped = await runAll({ md: RUN_DOC, maxBlocks: 1, isStopped: () => stop, ask: async prompt => { stop = true; return askWith(commentEach, [])(prompt); } });
        assert.deepStrictEqual([stopped.calls, stopped.fixed, stopped.remaining, stopped.stopped], [1, [0], 1, true], '받은 답은 붙이고 멈춘다');
        const early = await runAll({ md: RUN_DOC, isStopped: () => true, ask: async () => { throw new Error('부르면 안 됨'); } });
        assert.deepStrictEqual([early.calls, early.md, early.remaining], [0, RUN_DOC, 2]);
    });

    await run('일괄 작업: 문항 모드는 정답·출력 결과·고칠 곳을 주석에 쓰지 말라고 지시한다', async () => {
        const log = [];
        await runAll({ md: RUN_DOC, quiz: true, ask: askWith(commentEach, log) });
        assert.ok(log[0].system.includes('정답') && log[0].system.includes('출력 결과'), log[0].system);
        const plainLog = [];
        await runAll({ md: RUN_DOC, ask: askWith(commentEach, plainLog) });
        assert.ok(!plainLog[0].system.includes('정답'));
        await assert.rejects(() => call('codeCommentRun')({ md: RUN_DOC }), /ask/);
    });

    /* ---------- 고정 섹션 빼기(skipBlock) ---------- */
    // 부르는 쪽이 고치지 않을 블록(고정 섹션)을 skipBlock으로 빼면 대상·일괄 작업·예고에서 빠지고, 그 블록은 held로 센다
    const HELD_DOC = ['## 1. 합계', '', '```python', 'total = 0', 'for n in [1, 2]:', '    total += n', '```', '', '## 고정 섹션 (⏱ 10분)', '', '```python', 'print(total)', '```', '', '## 3. 출력', '', '```python', 'print(total * 2)', '```'].join('\n');
    const skipHeld = block => block.section.startsWith('고정');

    await run('skipBlock: 대상에서 빼고, 주지 않거나 함수가 아니면 예전처럼 모두 고른다', () => {
        assert.deepStrictEqual(plain(call('codeCommentTargets')(HELD_DOC)).map(block => block.index), [0, 1, 2]);
        assert.deepStrictEqual(plain(call('codeCommentTargets')(HELD_DOC, { skipBlock: skipHeld })).map(block => block.index), [0, 2], '고정 섹션의 블록을 뺀다');
        assert.deepStrictEqual(plain(call('codeCommentTargets')(HELD_DOC, { skipBlock: null })).map(block => block.index), [0, 1, 2]);
        assert.deepStrictEqual(plain(call('codeCommentTargets')(HELD_DOC, { skipBlock: 'x' })).map(block => block.index), [0, 1, 2]);
        const seen = [];
        call('codeCommentTargets')(HELD_DOC, { skipBlock: block => { seen.push(block.section); return false; } });
        assert.deepStrictEqual(seen, ['1. 합계', '고정 섹션 (⏱ 10분)', '3. 출력'], 'skipBlock은 주석이 모자란 블록마다 ## 제목(section)을 받는다');
    });

    await run('skipBlock: 일괄 작업은 뺀 블록을 보내지 않고 바이트 그대로 두며, held로 세고 remaining에는 넣지 않는다', async () => {
        const log = [];
        const status = [];
        const out = await runAll({ md: HELD_DOC, ask: askWith(commentEach, log), skipBlock: skipHeld, onStatus: text => status.push(text) });
        assert.deepStrictEqual([out.fixed, out.failed, out.remaining, out.held, out.calls], [[0, 2], [], 0, 1, 1]);
        assert.ok(log[0].user.includes('<<<CODE 1>>>') && log[0].user.includes('<<<CODE 3>>>') && !log[0].user.includes('<<<CODE 2>>>'), log[0].user);
        assert.ok(!log[0].user.includes('print(total)\n'), '뺀 블록의 코드는 지시에 없다');
        assert.ok(out.md.includes('## 고정 섹션 (⏱ 10분)\n\n```python\nprint(total)\n```'), '뺀 블록은 그대로');
        assert.ok(out.md.includes('```python\n# 이 줄이 하는 일입니다\nprint(total * 2)\n```'), out.md);
        assert.ok(status[0].endsWith('2/2개'), `진행 문구는 뺀 블록을 세지 않는다: ${status[0]}`);
        const plainRun = await runAll({ md: HELD_DOC, ask: askWith(commentEach, []) });
        assert.deepStrictEqual([plainRun.fixed, plainRun.held, plainRun.remaining], [[0, 1, 2], 0, 0], '주지 않으면 held는 0');
        const allHeld = await runAll({ md: HELD_DOC, skipBlock: () => true, ask: async () => { throw new Error('부르면 안 됨'); } });
        assert.deepStrictEqual([allHeld.md, allHeld.calls, allHeld.fixed, allHeld.failed, allHeld.remaining, allHeld.held], [HELD_DOC, 0, [], [], 0, 3], '모두 빼면 부르지 않는다');
        const swapped = await runAll({ md: HELD_DOC, skipBlock: skipHeld, ask: askWith(code => `# 설명\n${code.replace('total = 0', 'total = 9')}`, []) });
        assert.deepStrictEqual([swapped.fixed, swapped.failed.map(item => item.index), swapped.remaining, swapped.held], [[2], [0], 1, 1], '고친 블록 확인은 그대로다');
        assert.ok(!swapped.md.includes('total = 9'));
    });

    await run('skipBlock: 예고는 뺀 블록을 needs·calls에서 빼고 held로 알리며, 주지 않으면 예전 모양 그대로다', () => {
        assert.deepStrictEqual(plain(call('codeCommentPreview')(HELD_DOC, { skipBlock: skipHeld })), { checked: 3, needs: 2, calls: 1, unknown: [], skipped: 0, held: 1 });
        assert.deepStrictEqual(plain(call('codeCommentPreview')(HELD_DOC, { skipBlock: skipHeld, maxBlocks: 1 })).calls, 2);
        assert.deepStrictEqual(plain(call('codeCommentPreview')(HELD_DOC, { skipBlock: () => true })), { checked: 3, needs: 0, calls: 0, unknown: [], skipped: 0, held: 3 });
        assert.deepStrictEqual(plain(call('codeCommentPreview')(HELD_DOC)), { checked: 3, needs: 3, calls: 1, unknown: [], skipped: 0 });
        const issues = plain(call('codeCommentIssues')(HELD_DOC));
        assert.deepStrictEqual(issues.map(issue => issue.block), [0, 1, 2], '점검은 고정 섹션의 블록도 보인다');
    });

    /* ---------- 예고·점검 도우미 ---------- */
    await run('예고: 검사한 블록 수·주석이 필요한 블록 수·예상 AI 호출 수', () => {
        const preview = plain(call('codeCommentPreview')(RUN_DOC));
        assert.deepStrictEqual([preview.checked, preview.needs, preview.calls], [2, 2, 1]);
        assert.deepStrictEqual(plain(call('codeCommentPreview')(RUN_DOC, { maxBlocks: 1 })).calls, 2);
        assert.deepStrictEqual(plain(call('codeCommentPreview')('글뿐입니다.')), { checked: 0, needs: 0, calls: 0, unknown: [], skipped: 0 });
    });

    await run('점검: 주석이 필요한 블록을 lesson-lint 이슈 모양으로 알린다(where는 ## 섹션 제목, 없으면 본문)', () => {
        const md = ['```python', 'x = 1', '```', '', RUN_DOC].join('\n');
        const issues = plain(call('codeCommentIssues')(md));
        const msg = call('CODE_COMMENT_LINT_MSG');
        assert.deepStrictEqual(issues.map(issue => [issue.where, issue.msg, issue.snip]), [['본문', msg, 'x = 1'], ['1. 합계', msg, 'total = 0'], ['2. 출력', msg, 'print(total)']]);
        assert.ok(issues.every(issue => issue.sev === 'warn' && typeof issue.block === 'number'));
        assert.deepStrictEqual(plain(call('codeCommentIssues')(md, { sev: 'bad' })).map(issue => issue.sev), ['bad', 'bad', 'bad']);
        assert.deepStrictEqual(plain(call('codeCommentIssues')('```python\n# 됨\nx = 1\n```\n```text\n1\n```\n```js\nlet a')), [], '충분하거나 검사하지 않는 블록은 알리지 않는다');
        // lesson-lint.js와 같은 섹션 나누기(lessonCodeSections)로 where가 같다
        const lctx = { console, window: {} };
        vm.createContext(lctx);
        vm.runInContext(source('lesson-lint.js'), lctx);
        const sections = plain(vm.runInContext('lessonCodeSections', lctx)(md));
        issues.forEach(issue => assert.ok(sections.some(section => (section.title || '본문') === issue.where && section.text.includes(issue.snip)), issue.where));
    });

    /* ---------- 8차 검토 반영(재현 시험) ---------- */
    const BS = String.fromCharCode(92); // 역슬래시 하나

    await run('검토 S1: 줄 배열 답의 원소 안 줄바꿈도 줄로 나눠 보고, 코드를 끼운 원소는 막는다', () => {
        const code = 'total = 0\nprint(total)';
        rejects('python', code, ['total = 0  # 0으로 둡니다\ntotal = 999', 'print(total)'], /코드/);
        rejects('python', code, ['# 합계를 준비합니다\nimport os; os.system("echo HACKED")', 'total = 0', 'print(total)'], /코드/);
        passes('python', code, ['# 합계를 준비합니다\ntotal = 0', 'print(total)  # 찍습니다'], '# 합계를 준비합니다\ntotal = 0\nprint(total)  # 찍습니다');
        const md = '## 합계\n\n```python\ntotal = 0\nprint(total)\n```\n';
        const out = apply(md, [{ index: 0, code: ['total = 0  # 0으로 둡니다\ntotal = 999', 'print(total)'] }]);
        assert.deepStrictEqual([out.md, out.applied, out.rejected.map(item => item.index)], [md, [], [0]]);
        const spec = call('CODE_COMMENT_LANGS').python;
        assert.ok(/글자/.test(call('ccShape')(spec, 'python', '# 설명\ntotal = 999')), '주석 모양 검사도 줄바꿈 글자를 막는다');
    });

    await run('검토 S2: java·groovy·scala 주석의 \\u 는 u 를 여럿 쓴 꼴까지 줄 주석·블록 주석·줄 위·줄 끝 모두 막는다', () => {
        const lines = ['public class Main {', '    public static void main(String[] args) {', '        int total = 0;', '        System.out.println(total);', '    }', '}'];
        const code = lines.join('\n');
        const at3 = line => lines.map((l, k) => (k === 2 ? line : l)).join('\n');
        rejects('java', code, at3(`        int total = 0; // 합계 ${BS}uu000a total = 999;`), /\\u/);
        rejects('java', code, at3(`        int total = 0; /* 합계 ${BS}u002a/ total = 999; // */`), /\\u/);
        rejects('java', code, [...lines.slice(0, 3), `        // 합계를 바꿉니다 ${BS}uuu000a total = 999;`, ...lines.slice(3)].join('\n'), /\\u/);
        rejects('java', code, at3(`        int total = 0; // C:${BS}users 폴더`), /\\u/); // 16진수가 아닌 \u 도 java는 컴파일 오류다
        rejects('groovy', 'def total = 0', `def total = 0 // 합계 ${BS}u000a total = 9`, /\\u/);
        rejects('scala', 'val total = 0', `// 합계 ${BS}u000a val total = 9\nval total = 0`, /\\u/);
        passes('java', code, at3('        int total = 0; // 합계를 0으로 둡니다'));
        passes('kotlin', 'val total = 0', `val total = 0 // C:${BS}users 폴더`); // kotlin은 주석의 \u 를 바꾸지 않는다
    });

    await run('검토 S3·ACC-5: bash 따옴표 밖의 \\\' · \\" · \\# 는 글자이고, $(( )) 안의 << 는 히어독이 아니다', () => {
        const sh = [`echo It${BS}'s a test`, "msg='first line", "second line'", 'echo "$msg"'].join('\n');
        assert.deepStrictEqual(gapsOf('bash', sh), ['', '', 'string', '', '']);
        assert.deepStrictEqual(endsOf('bash', sh), ['', 'string', '', '']);
        rejects('bash', sh, [`echo It${BS}'s a test`, "msg='first line", '# 둘째 줄을 이어 씁니다', "second line'", 'echo "$msg"'].join('\n'), /문자열/);
        rejects('bash', sh, [`echo It${BS}'s a test`, "msg='first line  # 첫 줄", "second line'", 'echo "$msg"'].join('\n'), /문자열/);
        assert.deepStrictEqual(gapsOf('bash', [`echo ${BS}"quoted`, "msg='first line", "second line'"].join('\n')), ['', '', 'string', '']);
        const quote = [`echo 'It'${BS}''s ok'`, '# 인사를 찍습니다', 'echo done'].join('\n');
        assert.deepStrictEqual([counted('bash', quote), gapsOf('bash', quote)], [[2, 1], ['', '', '', '']]);
        passes('bash', quote, [`echo 'It'${BS}''s ok'`, '# 인사를 찍습니다', '# 끝을 알립니다', 'echo done'].join('\n'));
        assert.deepStrictEqual(counted('bash', [`echo ${BS}"hi${BS}"`, '# 설명', 'echo done'].join('\n')), [2, 1]);
        assert.deepStrictEqual(counted('bash', `echo ${BS}# 글자\n# 진짜`), [1, 1], '\\# 는 주석이 아니다');
        const shift = ['mask=$(( 1 << bit ))', '# 마스크를 찍습니다', 'echo $mask'].join('\n');
        assert.deepStrictEqual([counted('bash', shift), gapsOf('bash', shift)], [[2, 1], ['', '', '', '']]);
        assert.deepStrictEqual(gapsOf('bash', '(( x = (1 << n) ))\ncat <<EOF\nhi\nEOF'), ['', '', 'heredoc', 'heredoc', ''], '산술이 닫힌 뒤의 << 는 히어독이다');
    });

    await run('검토 S4: TS 제네릭 화살표를 JSX로 보지 않고, 형 단언일 수 있는 JSX와 미심쩍은 자리에서 연 JSX의 { } 안도 막는다', () => {
        const ts = ['const first = <T,>(items: T[]): T => items[0];', 'const css = `', '.box {', '  width: 10px;', '}', '`;', 'console.log(JSON.stringify(css), first([1]));'].join('\n');
        assert.deepStrictEqual(gapsOf('typescript', ts), ['', '', 'string', 'string', 'string', 'string', '', '']);
        rejects('typescript', ts, ts.replace('.box {\n', '.box {\n  // 너비를 정합니다\n'), /문자열|JSX/);
        const cast = ts.replace('const first = <T,>(items: T[]): T => items[0];', 'const base = <number>Number("2");');
        const castGaps = gapsOf('typescript', cast);
        assert.ok(castGaps.slice(2, 6).every(Boolean), JSON.stringify(castGaps));
        rejects('typescript', cast, cast.replace('.box {\n', '.box {\n  // 너비를 정합니다\n'), /문자열|JSX/);
        const ext = 'const pick = <T extends object>(x: T) => x;\nconst s = `\n{\n  a\n}\n`;';
        assert.deepStrictEqual(gapsOf('typescript', ext).slice(2, 6), ['string', 'string', 'string', 'string']);
        assert.deepStrictEqual(gapsOf('typescript', 'const id = <T>(x: T): T => x;\nconst s = `\n{\n  a\n}\n`;').slice(2, 6), ['string', 'string', 'string', 'string']);
        assert.deepStrictEqual(gapsOf('javascript', 'const el = <div>{\n  a\n}</div>;'), ['', 'jsx', 'jsx', ''], '= 뒤에서 연 JSX의 { } 안은 막는다');
        assert.deepStrictEqual(gapsOf('javascript', 'x;\n<div>{\n  a\n}</div>;'), ['', 'jsx', 'jsx', 'jsx', ''], '; 뒤에서 연 JSX의 { } 안은 막는다');
        assert.deepStrictEqual(gapsOf('javascript', 'return (<div>{\n  a\n}</div>);'), ['', '', '', ''], 'return ( 뒤에서 연 JSX의 { } 안은 코드다');
        assert.deepStrictEqual(gapsOf('tsx', 'return (<div>{\n  a\n}</div>);'), ['', '', '', ''], 'tsx 이름표도 같다');
        assert.deepStrictEqual(gapsOf('typescript', 'return (<div>{\n  a\n}</div>);'), ['', 'jsx', 'jsx', ''], 'ts의 속성 없는 <이름>은 형 단언일 수 있어 { } 안도 막는다');
        assert.deepStrictEqual(gapsOf('typescript', 'return (<div className="a">{\n  a\n}</div>);'), ['', '', '', ''], '속성이 있으면 형 단언이 아니다');
        assert.deepStrictEqual(gapsOf('javascript', '<button onClick={() => {\n  setCount(count + 1);\n}}>\n</button>'), ['jsx', '', '', 'jsx', 'jsx'], '줄 머리에서 연 JSX 속성의 { } 안은 그대로 코드다');
    });

    await run('검토 S5: 닫히지 않은 한 줄 문자열을 버린 다음 줄 위를 막고, c# $@"…{…}…" · $"…" 끼움 식과 vb 여러 줄 문자열을 따라간다', () => {
        const cs = ['var ok = true;', 'var s = $@"Name: {(ok ? "yes" : "no")}', 'second line";', 'System.Console.WriteLine(s);'].join('\n');
        assert.deepStrictEqual(gapsOf('csharp', cs), ['', '', 'string', '', '']);
        assert.deepStrictEqual(endsOf('csharp', cs), ['', 'string', '', '']);
        rejects('csharp', cs, cs.replace('second line', '// 둘째 줄을 이어 씁니다\nsecond line'), /문자열/);
        assert.deepStrictEqual(gapsOf('csharp', 'var s = $@"Name: {(ok ? "yes" : "no")}\nsecond\nthird";\nint n = 1;'), ['', 'string', 'string', '', '']);
        assert.deepStrictEqual(gapsOf('csharp', 'var s = $"{{ {n} }}";\nint m = 1;'), ['', '', ''], '{{ }} 는 글자다');
        assert.deepStrictEqual(counted('csharp', 'var s = $"{(ok ? "a" : "b")}"; // 끝'), [1, 1]);
        const vb = ['Module Program', '    Sub Main()', '        Dim s = "first line', 'second line"', '        Console.WriteLine(s)', '    End Sub', 'End Module'].join('\n');
        assert.deepStrictEqual(gapsOf('vbnet', vb), ['', '', '', 'string', '', '', '', '']);
        rejects('vbnet', vb, vb.replace('second line', "' 둘째 줄\nsecond line"), /문자열/);
        assert.strictEqual(gapsOf('c', `char *s = "abc${BS} \n  def";\nint x;`)[1], 'string', '공통 안전망: 버린 문자열 다음 줄 위는 막는다');
        assert.deepStrictEqual(gapsOf('lua', `local s = "abc${BS}z\n      def"\nprint(s)`), ['', 'string', '', ''], 'lua \\z 는 문자열을 다음 줄로 잇는다');
    });

    await run('검토 S6: python·ruby 첫 두 줄에 coding 선언이 새로 생기거나 밀려나는 고침은 줄 위·줄 끝 모두 막는다', () => {
        const py = '# 인사말 예제\nword = "café"\nprint(len(word), word.upper())';
        rejects('python', py, `# coding: latin-1\n${py}`, /coding/);
        rejects('python', py, py.replace('# 인사말 예제', '# 인사말 예제  # coding: latin-1'), /coding/);
        rejects('ruby', '# 인사\nputs "café"', '# 인사  # encoding: ascii-8bit\nputs "café"', /coding/);
        passes('python', py, py.replace('word = "café"', 'word = "café"  # coding: utf-8'));
        const decl = '# 예제\n# -*- coding: cp949 -*-\nx = 1';
        assert.deepStrictEqual(gapsOf('python', decl).slice(0, 2), ['directive', 'directive'], '맨 위에 줄을 더하면 둘째 줄 선언이 셋째 줄로 밀려난다');
        rejects('python', decl, `# 설명\n${decl}`, /넣을 수 없습니다|coding/);
        passes('python', decl, `${decl}  # 하나`);
    });

    await run('검토 S7: yaml 값이 다음 줄에서 시작하거나 따옴표 키·&앵커·!태그 뒤에 오는 여러 줄 평문 값도 막는다', () => {
        const next = 'description:\n  this is a long\n  description text\nname: demo';
        assert.deepStrictEqual([gapsOf('yaml', next), endsOf('yaml', next)], [['', '', 'string', '', ''], ['', 'string', '', '']]);
        rejects('yaml', next, next.replace('  description text', '  # 설명을 이어 씁니다\n  description text'), /문자열/);
        rejects('yaml', next, next.replace('this is a long', 'this is a long  # 설명'), /문자열/);
        passes('yaml', next, `# 설명\n${next.replace('description:', 'description:  # 키')}`);
        assert.deepStrictEqual(gapsOf('yaml', '"description": this is a long\n  description text\nname: demo'), ['', 'string', '', '']);
        assert.deepStrictEqual(gapsOf('yaml', "'key': it is\n  long"), ['', 'string', '']);
        assert.deepStrictEqual(gapsOf('yaml', 'items:\n  -\n    first part\n    second part'), ['', '', '', 'string', '']);
        assert.deepStrictEqual(gapsOf('yaml', 'base: &b this is a long\n  value text\nnote: !!str this is a long\n  value text'), ['', 'string', '', 'string', '']);
        assert.deepStrictEqual(gapsOf('yaml', 'base: &b\n  this is\n  long'), ['', '', 'string', '']);
        assert.deepStrictEqual(gapsOf('yaml', 'list:\n  - a\n  - b: 1\n    c: 2'), ['', '', '', '', ''], '새 키와 목록 항목은 이어지는 글이 아니다');
        assert.deepStrictEqual(gapsOf('yaml', 'parent:\n  child: 1\n  other: 2'), ['', '', '', ''], '값 없는 키 다음의 하위 키는 평문이 아니다');
    });

    await run('검토 S8: perl << "EOF"(띄운 따옴표 끝말)와 bash <<"END OF"(공백 든 끝말) 히어독을 알아본다', () => {
        assert.deepStrictEqual(gapsOf('perl', 'print << "EOF";\nHello\nWorld\nEOF\nprint "done";'), ['', 'heredoc', 'heredoc', 'heredoc', '', '']);
        rejects('perl', 'print << "EOF";\nHello\nWorld\nEOF', 'print << "EOF";\nHello\n# 둘째 줄을 찍습니다\nWorld\nEOF', /히어독/);
        assert.deepStrictEqual(gapsOf('bash', 'cat <<"END OF"\nHello\nWorld\nEND OF\necho done'), ['', 'heredoc', 'heredoc', 'heredoc', '', '']);
        assert.deepStrictEqual(gapsOf('bash', 'cat <<E"O"F\nhi\nEOF\nls'), ['', 'heredoc', 'heredoc', '', '']);
        assert.deepStrictEqual(gapsOf('perl', 'my $x = 1 << 2;\nprint $x;'), ['', '', ''], '띄운 숫자 앞 << 는 셈이다');
    });

    await run('검토 S9: perl의 # line 숫자 주석은 줄 번호를 바꾸므로 줄 위·줄 끝 모두 막는다', () => {
        const pl = 'my $n = 1;\nwarn "check" if 0;\nprint __LINE__;';
        rejects('perl', pl, pl.replace('warn', '# line 100\nwarn'), /line/);
        rejects('perl', pl, pl.replace('my $n = 1;', 'my $n = 1;  # line 100'), /line/);
        passes('perl', pl, `# 줄 번호를 찍습니다\n${pl}`);
    });

    await run('검토 S10·ACC-10: js의 뒤붙이 ++ 와 map 같은 이름 뒤 / 는 나눗셈이고, cpp의 100\'000 은 숫자다', () => {
        const js1 = 'let i = 3;\nconst x = i++ / 2; const p = `/\n${x}`;\nconsole.log(JSON.stringify(p));';
        assert.deepStrictEqual(gapsOf('javascript', js1), ['', '', 'string', '', '']);
        rejects('javascript', js1, js1.replace('${x}', '// 설명\n${x}'), /문자열/);
        rejects('javascript', js1, js1.replace('const p = `/', 'const p = `/  // 설명'), /문자열/);
        assert.deepStrictEqual(gapsOf('javascript', 'const map = 8;\nconst half = map / 2; const t = `/\ne`;'), ['', '', 'string', '']);
        assert.deepStrictEqual(counted('javascript', 'y = x++ / 2; // 절반'), [1, 1]);
        assert.deepStrictEqual(counted('javascript', 'const w = map / 2; // 절반'), [1, 1]);
        assert.deepStrictEqual(counted('javascript', 'const r = ++i / 2; // 반'), [1, 1]);
        assert.deepStrictEqual(counted('javascript', 'const r = s.split(/,/); // 나눔'), [1, 1]);
        assert.deepStrictEqual(counted('perl', 'my @w = split /,/, $s; # 나눔'), [1, 1], 'perl split 뒤 / 는 정규식이다');
        assert.deepStrictEqual(counted('cpp', "int n = 100'000; // 십만"), [1, 1]);
        assert.deepStrictEqual(endsOf('cpp', "int n = 100'000; // 십만\nint m;"), ['', '']);
    });

    await run('검토 S11: xml·svg·xaml 요소 글자 사이와 그 줄 끝에는 넣지 않고, 태그와 태그 사이만 연다', () => {
        const xml = '<config>\n  <message>Hello\nWorld</message>\n</config>';
        assert.deepStrictEqual([gapsOf('xml', xml), endsOf('xml', xml)], [['', '', 'text', '', ''], ['', 'text', '', '']]);
        rejects('xml', xml, xml.replace('World', '<!-- 둘째 줄 -->\nWorld'), /글자/);
        rejects('xml', xml, xml.replace('Hello', 'Hello <!-- 인사 -->'), /글자/);
        assert.deepStrictEqual(gapsOf('svg', '<svg>\n<text>\nHi\n</text>\n</svg>'), ['', '', 'text', 'text', '', '']);
        passes('xml', xml, `<!-- 설정 -->\n${xml.replace('<config>', '<config> <!-- 뿌리 -->')}`);
        assert.deepStrictEqual(gapsOf('html', xml), ['', '', '', '', ''], 'html은 공백을 합쳐 그대로 둔다');
    });

    await run('검토 S12: 줄 끝 공백이 있는 원래 줄에 붙인 줄 끝 주석도 넣고, 한 블록이 다시 보기에 걸려도 다른 블록 고침은 넣는다', async () => {
        const md = '```python\ntotal = 0   \nprint(total)\n```\n\n```js\nlet a = 1;\n```\n';
        const out = apply(md, [{ index: 0, code: 'total = 0  # 0으로 둡니다\nprint(total)' }, { index: 1, code: '// 값을 정합니다\nlet a = 1;' }]);
        assert.deepStrictEqual([out.applied, out.rejected], [[0, 1], []]);
        assert.ok(out.md.includes('```python\ntotal = 0   # 0으로 둡니다\nprint(total)\n```') && out.md.includes('```js\n// 값을 정합니다\nlet a = 1;'), out.md);
        const ran = await runAll({ md: '```python\ntotal = 0   \nprint(total)\n```', ask: async () => '<<<CODE 1>>>\ntotal = 0  # 0으로 둡니다\nprint(total)\n<<<END 1>>>' });
        assert.deepStrictEqual([ran.fixed, ran.failed, ran.calls], [[0], [], 1]);
        // 다시 보기가 한 블록(BAD 표시)만 거르는 맥락: 다른 블록은 넣는다
        const c2 = makeContext();
        vm.runInContext('const ccKeepsCodeReal = ccKeepsCode; ccKeepsCode = (a, b) => ccKeepsCodeReal(a, b) && !b.includes("BAD");', c2);
        const two = plain(vm.runInContext('codeCommentApply', c2)(md, [{ index: 0, code: 'total = 0  # BAD\nprint(total)' }, { index: 1, code: '// 값을 정합니다\nlet a = 1;' }]));
        assert.deepStrictEqual([two.applied, two.rejected.map(item => item.index)], [[1], [0]]);
        assert.ok(two.md.includes('```js\n// 값을 정합니다\nlet a = 1;') && !two.md.includes('BAD'), two.md);
    });

    await run('검토 S13: 멈춤·중지 뒤 보내지 않은 블록도 까닭과 함께 failed에 넣는다', async () => {
        const md3 = ['```python', 'a = 1', '```', '', '```python', 'b = 2', '```', '', '```python', 'c = 3', '```'].join('\n');
        let stop = false;
        const stopped = await runAll({ md: md3, maxBlocks: 1, isStopped: () => stop, ask: async prompt => { stop = true; return askWith(commentEach, [])(prompt); } });
        assert.deepStrictEqual([stopped.fixed, stopped.failed.map(item => item.index), stopped.remaining, stopped.stopped], [[0], [1, 2], 2, true]);
        assert.ok(stopped.failed.every(item => /멈춰/.test(item.reason)), JSON.stringify(stopped.failed));
        const halt = await runAll({ md: md3, maxBlocks: 1, ask: async () => { throw Object.assign(new Error('하루 한도를 넘었습니다'), { noRetry: true }); } });
        assert.deepStrictEqual([halt.fixed, halt.failed.map(item => item.index), halt.remaining], [[], [0, 1, 2], 3]);
        assert.ok(/하루 한도/.test(halt.failed[0].reason) && /멈춰/.test(halt.failed[1].reason), JSON.stringify(halt.failed));
    });

    await run('검토 ACC-1: 흔한 문서 주석 꼴(/** */ · /*! */ · /// · ## · --- · ;; · %% · \'\'\' · #\')을 받고, rust 문서 주석과 sql의 --- · /*! 는 막는다', () => {
        passes('javascript', 'let hp = 100;', '/** 플레이어 체력 */\nlet hp = 100;');
        passes('typescript', 'let hp = 100;', 'let hp = 100; /** 체력 */');
        passes('java', 'int hp = 100;', '/** 플레이어 체력 */\nint hp = 100;');
        passes('kotlin', 'val hp = 100', '/** 플레이어 체력 */\nval hp = 100');
        passes('cpp', 'int hp = 100;', '/** 플레이어 체력 */\nint hp = 100;');
        passes('c', 'int hp = 100;', '/*! 체력 */\nint hp = 100;');
        passes('css', 'p { color: red; }', '/** 문단 색 */\np { color: red; }');
        passes('swift', 'let hp = 100', '/// 체력을 돌려줍니다\nlet hp = 100');
        passes('dart', 'int hp = 100;', '/// 체력을 돌려줍니다\nint hp = 100;');
        passes('gdscript', 'var hp = 100', '## 플레이어 체력\nvar hp = 100');
        passes('lua', 'local hp = 100', '--- 플레이어 체력\nlocal hp = 100');
        passes('clojure', '(def hp 100)', ';; 플레이어 체력\n(def hp 100)');
        passes('scheme', '(define hp 100)', ';; 플레이어 체력\n(define hp 100)');
        passes('matlab', 'hp = 100;', '%% 체력 정하기\nhp = 100;');
        passes('vbnet', 'Dim hp = 100', "''' <summary>체력</summary>\nDim hp = 100");
        passes('r', 'hp <- 100', "#' 플레이어 체력\nhp <- 100");
        rejects('rust', 'let hp = 100;', '/// 체력\nlet hp = 100;', /문서 주석/);
        rejects('rust', 'let hp = 100;', '/** 체력 */\nlet hp = 100;', /문서 주석/);
        rejects('sql', 'SELECT 1;', '--- 하나\nSELECT 1;', /공백/);
        rejects('sql', 'SELECT 1;', '/*! 하나 */\nSELECT 1;', /!/);
        rejects('typescript', 'let a;', '/// <reference path="a.ts" />\nlet a;', /지시/);
        rejects('lua', 'print(1)', '---[[ 설명 ]]\nprint(1)', /공백/);
        const prompt = plain(call('codeCommentPrompt')([{ block: { index: 0, lang: 'javascript', label: 'js', lines: ['let a;'] } }, { block: { index: 1, lang: 'rust', label: 'rust', lines: ['let a = 1;'] } }]));
        assert.ok(prompt.user.includes('/** */') && prompt.user.includes('///'), prompt.user);
        assert.ok(/\[블록 2\] Rust[^\n]*쓰지 않습니다/.test(prompt.user), prompt.user);
    });

    await run('검토 ACC-2: 여러 줄 블록 주석은 까닭을 바로 알리고, 지시에 한 줄에서 닫는 규칙을 적는다', () => {
        rejects('java', 'int add(int a, int b) {\n    return a + b;\n}', '/**\n * 두 수를 더합니다.\n */\nint add(int a, int b) {\n    return a + b;\n}', /여러 줄 블록 주석/);
        rejects('css', 'p { color: red; }', '/*\n  문단 색\n*/\np { color: red; }', /여러 줄 블록 주석/);
        rejects('html', '<p>a</p>', '<!--\n  문단\n-->\n<p>a</p>', /여러 줄 블록 주석/);
        rejects('c', 'int a;', '/*\n// 안\n*/\nint a;', /여러 줄 블록 주석/);
        rejects('c', 'int a;', 'int a;\n/* 끝 설명\n   이어서 */', /여러 줄 블록 주석/);
        const system = plain(call('codeCommentPrompt')([])).system;
        assert.ok(/한 줄에서 열고 닫/.test(system) && /여러 줄 블록 주석/.test(system), system);
    });

    await run('검토 ACC-3: 필요 수는 주석을 넣을 수 없는 안쪽 줄을 빼고 세며, 따로 넣을 수 있는 자리 수를 넘지 않는다', async () => {
        const doc = ['def move(player, dx, dy):', '    """', ...Array.from({ length: 10 }, (_, i) => `    설명 ${i}`), '    """', ...Array.from({ length: 8 }, (_, i) => `    player.x${i} = dx`)].join('\n');
        assert.deepStrictEqual([count('python', doc).codeLines, count('python', doc).need], [21, 1], 'docstring 안쪽 줄은 필요 수에서 뺀다');
        const sh = ['cat <<EOF > /etc/app.conf', ...Array.from({ length: 30 }, (_, i) => `key${i}=v${i}`), 'EOF'].join('\n');
        assert.deepStrictEqual(count('bash', sh).need, 1);
        const full = verify('bash', sh, `# 설정 파일을 씁니다\n${sh}\n# 끝났습니다`);
        assert.ok(full.ok && full.enough, JSON.stringify(full));
        const out = await runAll({ md: `\`\`\`bash\n${sh}\n\`\`\``, ask: askWith(code => `# 설정 파일을 씁니다\n${code}\n# 끝났습니다`, []) });
        assert.deepStrictEqual([out.fixed, out.failed, out.remaining, out.calls], [[0], [], 0, 1]);
        const sql = ['SQL = """', ...Array.from({ length: 40 }, (_, i) => `SELECT ${i}`), '"""'].join('\n');
        assert.strictEqual(count('python', sql).need, 1);
        // 따로 넣을 수 있는 자리(줄 위 2곳 + 줄 끝 0곳)보다 많이 요구하지 않는다
        const jsx = ['function App() {', '  return (', '    <div>', ...Array.from({ length: 40 }, (_, i) => `      <p>${i}</p>`), '    </div>', '  );', '}'].join('\n');
        const c = count('javascript', jsx);
        const z = zones('javascript', jsx);
        const free = z.gaps.filter(g => g.ok).length + z.ends.filter((e, k) => e.ok && jsx.split('\n')[k].trim()).length;
        assert.ok(c.need <= free && c.need >= 1, JSON.stringify({ c, free }));
        // 필요 수 경계(9·10·19·20·30줄)에 보호 구역이 낀 경우: 문자열 안쪽 3줄은 세지 않는다
        const withString = n => ['# 설명', 'x = """', 'a', 'b', 'c', '"""', ...Array.from({ length: n }, (_, i) => `y${i} = ${i}`)].join('\n');
        assert.deepStrictEqual([7, 8, 17, 18, 28].map(n => count('python', withString(n)).need), [1, 1, 1, 2, 3]);
        assert.deepStrictEqual([7, 8, 17, 18, 28].map(n => count('python', withString(n)).codeLines), [12, 13, 22, 23, 33], '코드 줄 수는 그대로 센다');
    });

    await run('검토 ACC-4: 언어 자리에 이름표(py·js·cs·c#·sh·c++·tsx·mysql)도 받고, constructor 같은 이름은 모르는 언어로 본다', () => {
        ['py', 'python3', 'js', 'cs', 'c#', 'sh', 'c++', 'Python', 'main.py'].forEach(label => assert.strictEqual(count(label, 'x = 1').short, true, label));
        assert.deepStrictEqual(counted('cs', 'int x = 1; // 하나'), [1, 1]);
        assert.ok(zones('js', 'let a = 1;'));
        assert.strictEqual(call('codeCommentMarks')('py'), '#');
        passes('cs', 'int x = 1;', '// 값을 정합니다\nint x = 1;');
        assert.deepStrictEqual(counted('mysql', 'SELECT 1; # 끝'), [1, 1], 'sql 이름표는 갈래로도 쓴다');
        ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'].forEach(name => {
            assert.deepStrictEqual(count(name, 'x'), { codeLines: 0, comments: 0, need: 0, short: false, unknown: true }, name);
            assert.strictEqual(zones(name, 'x'), null, name);
            assert.strictEqual(call('codeCommentMarks')(name), '', name);
            assert.strictEqual(verify(name, 'x', '# a\nx').ok, false, name);
        });
        assert.strictEqual(count('brainfuck', '+++').unknown, true);
        const prompt = plain(call('codeCommentPrompt')([{ block: { index: 0, lang: 'constructor', lines: ['x'] } }, { block: { index: 1, lang: 'py', lines: ['x = 1'] } }]));
        assert.ok(prompt.user.includes('코드 블록 1개') && prompt.user.includes('[블록 2] Python'), prompt.user);
    });

    await run('검토 ACC-6: 원래 코드에 ``` 나 ~~~ 로 시작하는 줄이 있어도 원래 줄은 받고, 더한 줄의 ``` 만 막는다', async () => {
        const doc = 'def area(w, h):\n    """\n    넓이\n    ~~~~\n    """\n    return w * h';
        passes('python', doc, `# 넓이를 구합니다\n${doc}`);
        passes('python', '```\nx = 1', '```\n# 설명\nx = 1');
        rejects('python', 'x = 1', '```\nx = 1', /```/);
        const docMd = `\`\`\`python\n${doc}\n\`\`\``;
        const out1 = await runAll({ md: docMd, ask: askWith(code => `# 넓이를 구합니다\n${code}`, []) });
        assert.deepStrictEqual([out1.fixed, out1.failed], [[0], []]);
        const md = '````python\n```\nx = 1\n````';
        const out2 = await runAll({ md, ask: askWith(code => code.replace('x = 1', '# 설명\nx = 1'), []) });
        assert.deepStrictEqual([out2.fixed, out2.failed], [[0], []], '답 첫 줄이 원래 첫 줄(```)과 같으면 떼지 않는다');
        assert.ok(out2.md.includes('```\n# 설명\nx = 1\n````'), out2.md);
    });

    await run('검토 ACC-7: CRLF 글·줄을 그대로 넘겨도 줄 끝 \\r 을 떼고 읽는다', () => {
        assert.deepStrictEqual(plain(call('codeCommentCount')('bash', 'cat <<EOF\r\nhi\r\nEOF\r\n# 설명\r\necho done')), { codeLines: 4, comments: 1, need: 1, short: false });
        const out = plain(call('codeCommentVerify')({ lang: 'python', lines: 'x = 1\r\ny = 2'.split('\n') }, '# 설명\nx = 1\ny = 2'));
        assert.deepStrictEqual([out.ok, out.code], [true, '# 설명\nx = 1\ny = 2']);
        assert.deepStrictEqual(counted('bash', ['cat <<EOF\r', 'hi\r', 'EOF\r', '# 설명\r', 'echo done']), [4, 1]);
    });

    await run('검토 ACC-8: 게임 교안에 흔한 이름표와 파일 이름 이름표를 언어로 바꾸고, 모르는 이름표는 점검에 알린다', () => {
        const cases = { luau: 'luau', gdshader: 'glsl', cg: 'hlsl', node: 'javascript', nodejs: 'javascript', arduino: 'cpp', ino: 'cpp', sass: 'scss', py3: 'python', pl: 'perl', 'obj-c': 'objectivec', 'c-sharp': 'csharp', 'main.py': 'python', 'Player.cs': 'csharp', 'app.min.js': 'javascript' };
        Object.entries(cases).forEach(([info, key]) => assert.strictEqual(lang(info), key, info));
        assert.deepStrictEqual(blocks('```output.txt\n1\n```\n```package.json\n{}\n```').map(b => b.skip), ['nocode', 'nocode'], '파일 이름의 확장자로 코드가 아닌 블록도 안다');
        assert.deepStrictEqual(counted('luau', 'local s = `점수 {score}점`\n-- 설명'), [1, 1]);
        assert.deepStrictEqual(gapsOf('luau', 'local s = `a {\n  x\n} b`\nprint(s)'), ['', 'string', 'string', '', ''], 'luau 백틱 끼움 식');
        const issues = plain(call('codeCommentIssues')('## 점수\n\n```brainfuck\n+++\n```\n\n```luau\nlocal score = 0\nscore += 10\nprint(score)\n```'));
        assert.deepStrictEqual(issues.map(issue => [issue.sev, issue.where, issue.block]), [['info', '점수', 0], ['warn', '점수', 1]]);
        assert.ok(issues[0].msg.includes('이름표') && issues[0].snip.includes('brainfuck'), JSON.stringify(issues[0]));
    });

    await run('검토 ACC-9: 갈래 없는 sql 블록의 DELIMITER $$ 는 mysql로 읽어 본문을 코드로 본다', () => {
        const proc = 'DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  -- 설명\n  SELECT 1;\nEND$$\nDELIMITER ;';
        assert.deepStrictEqual([counted('sql', proc), gapsOf('sql', proc)], [[6, 1], ['', '', '', '', '', '', '', '']]);
        assert.deepStrictEqual(counted('sql', 'CREATE FUNCTION f() AS $$\n-- 본문 안\n$$ LANGUAGE sql;'), [3, 0], 'DELIMITER 가 없으면 $$ 는 문자열이다');
    });

    await run('검토 ACC-11: 응답 표시줄 앞의 제목·목록 기호와 뒤의 : 를 견딘다', () => {
        assert.deepStrictEqual(parse('### <<<CODE 1>>>\n# c\nx = 1\n### <<<END 1>>>'), { 1: ['# c\nx = 1'] });
        assert.deepStrictEqual(parse('- <<<CODE 1>>>\n# c\nx = 1\n- <<<END 1>>>'), { 1: ['# c\nx = 1'] });
        assert.deepStrictEqual(parse('<<<CODE 1>>>:\n# c\nx = 1\n<<<END 1>>>'), { 1: ['# c\nx = 1'] });
        assert.deepStrictEqual(parse('**<<<CODE 2>>>**:\n# c\n* <<<END 2>>>'), { 2: ['# c'] });
    });

    await run('검토 ACC-12: 앞 설명에서 그림 태그·그림만 든 단락·마크다운 그림을 뗀다', () => {
        const one = blocks("## 1. 점수\n\n<p align='center'><img src='https://example.com/a.png' alt='그림' width='400'></p>\n\n점수를 셉니다.\n\n```python\nscore = 0\n```")[0];
        assert.strictEqual(one.context, '## 1. 점수\n점수를 셉니다.');
        const two = blocks('## 1. 점수\n\n![다이어그램](https://example.com/b.png)\n\n점수를 셉니다. [![배지](https://x.y/b.svg)](https://x.y)\n\n```python\nscore = 0\n```')[0];
        assert.strictEqual(two.context, '## 1. 점수\n점수를 셉니다.');
    });

    console.log(`\n${total - failed}/${total} passed`);
    if (failed) process.exit(1);
})();
