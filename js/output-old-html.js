// output-old-html.js - 숨은 원본이 없는 예전 교안 HTML을 고칠 수 있는 차시로 되살린다(내보낸 교안 다시 불러오기)
// 화면에 그린 HTML(탭마다 <section class="lesson-tab">, 243a92e 전 파일은 <body>에 바로)을 Turndown으로 교안 마크다운으로 바꾼다.
// Turndown은 이런 파일을 고를 때만 CDN에서 받는다(버전 고정, 무결성 확인). 받지 못하면 인터넷이 필요하다고 알린다.
// 마크다운으로 같게 그릴 수 없는 것(표, 색 글씨, 용어 문단, 모양을 준 목록)은 앱이 그리는 HTML 그대로 두고, 그림 칸은 앱의 그림 칸으로 다시 쓴다.
// 그림(data:image)은 새 키로 images에, 판서 영상은 표지 그림 자리와 함께 되살린다(영상 파일은 넣을 때 저장한다, output-import.js).
// 받은 파일의 값은 output-import.js normalizeImportedLesson이 다시 검사한다. 테스트: tests/output-import.test.js

const OLD_HTML_TURNDOWN_SOURCES = [
    'https://cdn.jsdelivr.net/npm/turndown@7.2.4/dist/turndown.js',
    'https://cdnjs.cloudflare.com/ajax/libs/turndown/7.2.4/turndown.js'
];
const OLD_HTML_TURNDOWN_SRI = 'sha384-VRHmZZ8b5mH5yknWcg48OJS6RmXZmlgvsqhOXJqY0rwvwirs1M12xd+49c3NpW6a'; // npm turndown@7.2.4 dist/turndown.js(두 CDN이 같은 파일)
const OLD_HTML_LOAD_MS = 20000;
const OLD_HTML_LESSON_DOC = '<main class="lesson-doc">'; // lesson-export.js lessonHtmlDocument
const OLD_HTML_TAB_SECTION = '<section class="lesson-tab">';
const OLD_HTML_FIRST_STYLE = 'max-width:900px;margin:0 auto;padding:40px;line-height:1.8;color:#1a1a2e;'; // 243a92e 전 HTML 내보내기의 문서 서식
const OLD_HTML_OL_MARK = '<!-- 번호 목록 -->'; // lesson-format.js LF_OL_MARK와 같은 표시
const OLD_HTML_DROP = 'script, iframe, frame, object, embed, applet, form, noscript, template, link, meta, base, audio, canvas'; // 그림을 꺼내기 전에 뺀다(서식·영상 안의 source는 그 뒤에)
const OLD_HTML_LEFTOVER = 'style, source, track'; // 다이어그램 SVG·영상을 꺼낸 뒤에 남은 것
const OLD_HTML_RAW_TAGS = new Set(['TABLE', 'U', 'MARK', 'SUB', 'SUP', 'SMALL', 'KBD', 'ABBR', 'INS', 'FONT', 'CENTER', 'DETAILS', 'FIGURE', 'DL', 'SVG']);
const OLD_HTML_BLOCK_PARENTS = new Set(['SECTION', 'ARTICLE', 'MAIN', 'BODY', 'BLOCKQUOTE']);
const OLD_HTML_DISC_LIST = /list-style:\s*disc;\s*padding-left:\s*1\.5rem;?\s*$/i; // postprocessHtml이 번호 목록(<ol>)을 바꾼 모양
const OLD_HTML_DECIMAL_LIST = /list-style:\s*decimal;\s*padding-left:\s*1\.5rem;?\s*$/i; // 서식 막대로 고른 번호 목록(keepChosenNumbering)
const OLD_HTML_PICTURE_CLASS = 'rounded-lg border-2 border-accent/30 shadow-md max-w-full';
const OLD_HTML_URL_ATTRS = /^(href|src|xlink:href|action|formaction|poster|background|data)$/i;
const OLD_HTML_SCRIPT_URL = /^(javascript|vbscript):/i;
const OLD_HTML_LESSONS_MAX = 2000; // output-import.js OUTPUT_FILE_LESSONS와 같은 상한

let oldHtmlLoading = null;

// 이 앱이 원본 없이 내보낸 교안 HTML인지(숨은 원본이 있으면 그 원본을 읽는다)
function isOldOutputHtml(text) {
    const html = String(text || '');
    return html.includes(OLD_HTML_LESSON_DOC) ? html.includes(OLD_HTML_TAB_SECTION) : html.includes(OLD_HTML_FIRST_STYLE);
}

/* ---------- Turndown 받기 ---------- */
function oldHtmlScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timer = setTimeout(() => {
            script.remove();
            reject(new Error('시간이 지났습니다'));
        }, OLD_HTML_LOAD_MS);
        script.src = src;
        script.integrity = OLD_HTML_TURNDOWN_SRI;
        script.crossOrigin = 'anonymous';
        script.referrerPolicy = 'no-referrer';
        script.onload = () => {
            clearTimeout(timer);
            resolve();
        };
        script.onerror = () => {
            clearTimeout(timer);
            script.remove();
            reject(new Error('받지 못했습니다'));
        };
        document.head.appendChild(script);
    });
}

// 처음 쓸 때 한 번만 받는다. 첫 CDN이 막히면 다음 CDN(같은 파일)에서 받는다
function loadTurndown() {
    if (typeof TurndownService === 'function') return Promise.resolve(TurndownService);
    if (!oldHtmlLoading) {
        oldHtmlLoading = (async () => {
            for (const src of OLD_HTML_TURNDOWN_SOURCES) {
                try {
                    await oldHtmlScript(src);
                    if (typeof TurndownService === 'function') return TurndownService;
                } catch (err) {
                    console.warn('[불러오기] 변환 도구를 받지 못했습니다:', src, err.message);
                }
            }
            throw new Error('예전 형식 HTML을 교안 글로 바꾸는 도구를 받지 못했습니다. 인터넷에 연결된 상태에서 다시 불러오세요');
        })().catch(err => {
            oldHtmlLoading = null;
            throw err;
        });
    }
    return oldHtmlLoading;
}

/* ---------- 차시와 탭 찾기 ---------- */
const oldHtmlHasClass = (el, name) => new RegExp(`(^|\\s)${name}(\\s|$)`).test(el?.getAttribute?.('class') || '');
const oldHtmlHasAttr = (el, name) => !!String(el.getAttribute(name) || '').trim(); // 빈 class·style은 없는 것으로 본다
const oldHtmlChildren = (el, tag) => Array.from(el.children || []).filter(child => child.nodeName === tag);

// 탭 띠(<div class="lesson-tab-label">)를 떼고 그 이름을 돌려준다
function oldHtmlTakeLabel(section) {
    const label = Array.from(section.children || []).find(child => oldHtmlHasClass(child, 'lesson-tab-label'));
    if (!label) return '';
    label.parentNode.removeChild(label);
    return label.textContent.trim();
}

// 243a92e 전 파일: <body>에 바로 화면 글. 차시 파일은 탭 id 머리(<h1>basicLearn</h1>)와 구분선으로 탭을 나눴다
function oldHtmlBodySections(doc) {
    const sections = [];
    let current = null;
    for (const node of Array.from(doc.body ? doc.body.childNodes : [])) {
        const tab = node.nodeType === 1 && node.nodeName === 'H1' ? tabIdOf(node.textContent) : null;
        if (tab || !current) {
            current = { label: tab || '', node: doc.createElement('section') };
            sections.push(current);
            if (tab) continue;
        }
        current.node.appendChild(node);
    }
    sections.slice(0, -1).forEach(section => {
        const last = section.node.lastElementChild;
        if (last && last.nodeName === 'HR') section.node.removeChild(last); // 탭 사이 구분선
    });
    return sections;
}

// [{ title, titleRank, sections: [{ label, node }] }]. 교과 HTML은 차시마다 <article class="lesson-break">
function oldHtmlContainers(doc, fileTitle, fileTitleRank) {
    const main = doc.querySelector('main.lesson-doc');
    if (!main) return [{ title: fileTitle, titleRank: fileTitleRank, sections: oldHtmlBodySections(doc) }];
    const articles = oldHtmlChildren(main, 'ARTICLE');
    return (articles.length ? articles : [main]).map((box, index) => ({
        title: articles.length ? `${index + 1}차시` : fileTitle,
        titleRank: articles.length ? 0 : fileTitleRank,
        sections: oldHtmlChildren(box, 'SECTION').map(section => ({ label: oldHtmlTakeLabel(section), node: section }))
    }));
}

/* ---------- 그림·영상·다이어그램 자리 ---------- */
function oldHtmlBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

// 그린 다이어그램(SVG)을 그림으로. 원본 코드는 파일에 없다. 크기는 viewBox로 정해 그림만으로도 같은 크기로 보이게 한다
function oldHtmlSvgData(svg) {
    try {
        const copy = svg.cloneNode(true);
        const box = String(copy.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
            copy.setAttribute('width', String(Math.round(box[2])));
            copy.setAttribute('height', String(Math.round(box[3])));
            copy.removeAttribute('style');
        }
        if (!copy.getAttribute('xmlns')) copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const xml = typeof XMLSerializer === 'function' ? new XMLSerializer().serializeToString(copy) : copy.outerHTML;
        return `data:image/svg+xml;base64,${oldHtmlBase64(xml)}`;
    } catch (err) {
        console.warn('[불러오기] 다이어그램을 그림으로 옮기지 못했습니다:', err.message);
        return '';
    }
}

function oldHtmlPicture(doc, key, alt) {
    const img = doc.createElement('img');
    img.setAttribute('src', `local:${key}`);
    img.setAttribute('alt', alt);
    img.setAttribute('class', OLD_HTML_PICTURE_CLASS);
    return img;
}

function oldHtmlClosestClass(node, name) {
    for (let el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) if (oldHtmlHasClass(el, name)) return el;
    return null;
}

// 판서 영상 → 표지 그림 자리. 표지 그림과 영상이 모두 있어야 영상을 되살린다(아니면 표지만, 표지도 없으면 빈 그림 자리)
function oldHtmlTakeVideo(video, read, media) {
    const key = media.nextKey();
    const poster = read.dataOf(video.getAttribute('poster') || '');
    const src = read.dataOf(video.getAttribute('src') || video.querySelector('source')?.getAttribute('src') || '');
    const caption = oldHtmlClosestClass(video, 'image-wrapper')?.querySelector('.image-caption')?.textContent.trim() || '';
    const title = String(video.getAttribute('aria-label') || '').replace(/^판서 영상:\s*/, '').trim().slice(0, OUTPUT_VIDEO_TITLE) || caption;
    if (OUTPUT_IMAGE_RE.test(poster)) media.images[key] = poster;
    if (media.images[key] && OUTPUT_VIDEO_RE.test(src)) media.videos.push({ key, data: src, title });
    else media.notes.videosLost += 1;
    video.parentNode.replaceChild(oldHtmlPicture(video.ownerDocument, key, caption || title), video);
}

// 다이어그램: 그린 SVG는 그림으로(원본 코드가 없다), 그리지 못해 코드가 남았으면 ```mermaid 코드로
function oldHtmlTakeDiagram(box, media) {
    const doc = box.ownerDocument;
    const svg = box.querySelector('svg');
    if (svg) {
        const key = media.nextKey();
        const data = oldHtmlSvgData(svg);
        if (OUTPUT_IMAGE_RE.test(data)) {
            media.images[key] = data;
            media.notes.diagrams += 1;
        }
        const img = doc.createElement('img');
        img.setAttribute('src', `local:${key}`);
        img.setAttribute('alt', '다이어그램');
        box.parentNode.replaceChild(img, box);
    } else if (!box.children.length && box.textContent.trim()) {
        const pre = doc.createElement('pre');
        const code = doc.createElement('code');
        code.setAttribute('class', 'language-mermaid');
        code.textContent = box.textContent.trim();
        pre.appendChild(code);
        box.parentNode.replaceChild(pre, box);
    }
}

// 그림: 진짜 그림은 새 키로 images에, 찾지 못한 그림은 빈 그림 자리(local:키, 확인 창이 센다). 인터넷 주소 그림은 그대로
function oldHtmlTakePicture(img, read, media) {
    const src = read.dataOf(img.getAttribute('src') || '');
    if (/^https?:\/\//i.test(src)) return;
    const key = media.nextKey();
    if (OUTPUT_IMAGE_RE.test(src)) media.images[key] = src;
    img.setAttribute('src', `local:${key}`);
}

// 그림·영상·다이어그램을 글의 차례대로 새 키에 담는다(키 번호가 글 차례와 같게). 실행되는 요소는 먼저 뺀다(그 안의 그림은 담지 않는다)
function oldHtmlTakeMedia(section, read, media) {
    Array.from(section.querySelectorAll(OLD_HTML_DROP)).forEach(el => el.parentNode && el.parentNode.removeChild(el));
    for (const el of Array.from(section.querySelectorAll('video, div.mermaid, img'))) {
        if (el.nodeName === 'VIDEO') oldHtmlTakeVideo(el, read, media);
        else if (el.nodeName === 'DIV') oldHtmlTakeDiagram(el, media);
        else if (!oldHtmlClosestClass(el, 'mermaid')) oldHtmlTakePicture(el, read, media);
    }
}

// 화면에서 뗀 것(버튼·고치기 칸)과 서식 요소를 걷어 내고, postprocessHtml이 바꾼 번호 목록을 마크다운 번호 목록으로 되돌린다.
// HTML 그대로 둘 부분에 인라인 핸들러(on…)와 스크립트 주소가 남지 않게 지운다(화면에서 다시 정리되지만 저장하는 글에도 남기지 않는다)
function oldHtmlTidy(section) {
    const all = selector => Array.from(section.querySelectorAll(selector));
    all(OLD_HTML_LEFTOVER).forEach(el => el.parentNode && el.parentNode.removeChild(el));
    all(EXPORT_CONTROLS).forEach(el => el.parentNode && el.parentNode.removeChild(el));
    all('.hidden').forEach(el => el.classList.remove('hidden'));
    all('*').forEach(el => Array.from(el.attributes).forEach(({ name, value }) => {
        if (/^on/i.test(name) || (OLD_HTML_URL_ATTRS.test(name) && OLD_HTML_SCRIPT_URL.test(String(value).replace(/[\u0000- ]+/g, '')))) el.removeAttribute(name);
    }));
    for (const list of all('ul[style]')) {
        const style = list.getAttribute('style') || '';
        const decimal = OLD_HTML_DECIMAL_LIST.test(style);
        if (!decimal && !OLD_HTML_DISC_LIST.test(style)) continue;
        const ordered = list.ownerDocument.createElement('ol');
        if (decimal) ordered.setAttribute('data-teacher-numbered', '1');
        while (list.firstChild) ordered.appendChild(list.firstChild);
        list.parentNode.replaceChild(ordered, list);
    }
}

/* ---------- 마크다운으로 ---------- */
// 마크다운 블록 안에서 끊기지 않게 빈 줄을 뺀 HTML(그 블록은 marked가 그대로 둔다).
// 표는 원문에서 고치기 쉽게 줄마다 나눈다(표의 줄 사이 빈칸은 그리는 모양을 바꾸지 않는다)
function oldHtmlRaw(node) {
    let html = String(node.outerHTML || '');
    if (node.nodeName === 'TABLE') {
        const copy = node.cloneNode(true);
        const line = () => copy.ownerDocument.createTextNode('\n');
        Array.from(copy.querySelectorAll('thead, tbody, tfoot, tr')).forEach(el => el.parentNode.insertBefore(line(), el));
        [copy, ...Array.from(copy.querySelectorAll('thead, tbody, tfoot'))].forEach(el => el.appendChild(line()));
        html = copy.outerHTML;
    }
    return html.replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n');
}

// 코드 블록 글. postprocessHtml이 코드 안의 **굵게**까지 <strong>으로 바꿨으므로 되돌린다
function oldHtmlCodeText(node) {
    return Array.from(node.childNodes, child => {
        if (child.nodeType === 3) return child.nodeValue;
        if (child.nodeType !== 1) return '';
        if (child.nodeName === 'BR') return '\n';
        const inner = oldHtmlCodeText(child);
        return child.nodeName === 'STRONG' || child.nodeName === 'B' ? `**${inner}**` : inner;
    }).join('');
}

function oldHtmlFence(pre) {
    const code = pre.children.length === 1 && pre.firstElementChild.nodeName === 'CODE' && !pre.textContent.replace(pre.firstElementChild.textContent, '').trim()
        ? pre.firstElementChild : null;
    if (!code) return `\n\n${oldHtmlRaw(pre)}\n\n`;
    const language = ((code.getAttribute('class') || '').match(/language-(\S+)/) || [])[1] || '';
    const text = oldHtmlCodeText(code).replace(/\n$/, '');
    const longest = Math.max(0, ...(text.match(/^`{3,}/gm) || []).map(run => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
}

const oldHtmlMdText = text => String(text).replace(/([\\[\]])/g, '\\$1').replace(/\s+/g, ' ').trim();
function oldHtmlImageMd(img) {
    const src = String(img.getAttribute('src') || '').replace(/([<>()])/g, '\\$1');
    return `![${oldHtmlMdText(img.getAttribute('alt') || '')}](${/\s/.test(src) ? `<${src}>` : src})`;
}

// 앱의 그림 칸(api.js imageWrapperHtml: 그림, 다시 찾기 버튼, 한글 설명)으로 다시 쓴다. 인터넷 주소 그림이면 받은 칸 그대로
function oldHtmlWrapper(div) {
    const img = div.querySelector('img');
    const key = (/^local:([\w-]{1,80})$/.exec(img.getAttribute('src') || '') || [])[1];
    const caption = div.querySelector('.image-caption')?.textContent.replace(/\s+/g, ' ').trim() || '';
    const alt = (img.getAttribute('alt') || caption).replace(/\s+/g, ' ').trim();
    if (!key || typeof imageWrapperHtml !== 'function') return oldHtmlRaw(div);
    return imageWrapperHtml(key, alt, exportEscape(alt), exportEscape(caption));
}

// 마크다운으로 같게 그릴 수 없어 HTML 그대로 둘 요소
function oldHtmlKeepsRaw(node) {
    const name = String(node.nodeName).toUpperCase();
    const styled = oldHtmlHasAttr(node, 'style');
    const classed = oldHtmlHasAttr(node, 'class');
    if (OLD_HTML_RAW_TAGS.has(name)) return true;
    if (name === 'P') return styled || classed; // 용어 문단(p.lesson-term) 등
    if (name === 'DIV') return (styled || classed) && !oldHtmlHasClass(node, 'image-wrapper') && !oldHtmlHasClass(node, 'lesson-code') && !node.hasAttribute('data-imgid');
    if (name === 'UL' || name === 'OL') return styled || Array.from(node.querySelectorAll('li')).some(item => oldHtmlHasAttr(item, 'style'));
    if (name === 'I') return classed; // 아이콘
    if (name === 'IMG') return styled || node.hasAttribute('width') || node.hasAttribute('height');
    return styled && /^(SPAN|A|STRONG|B|EM|CODE|H[1-6]|BLOCKQUOTE|HR)$/.test(name);
}

// 빈 요소(Turndown은 빼 버린다) 가운데 화면에 자리가 보이는 것: 빈 목록 항목과 그 목록, 빈 제목, HTML로 둘 요소.
// 목록·항목 모양은 Turndown의 목록 규칙과 같게 만든다(빈 항목 안의 빈 목록도 '-   1.'처럼 이어진다)
function oldHtmlBlank(content, node) {
    const name = node.nodeName;
    const parent = node.parentNode;
    if (name === 'LI') {
        const index = Array.prototype.indexOf.call(parent?.children || [], node);
        const prefix = parent?.nodeName === 'OL' ? `${index + 1}.  ` : '-   ';
        const body = content.replace(/^\n+|\n+$/g, '').replace(/\n/g, `\n${' '.repeat(prefix.length)}`);
        return prefix + body + (node.nextSibling ? '\n' : '');
    }
    if (name === 'UL' || name === 'OL') return parent?.nodeName === 'LI' && parent.lastElementChild === node ? `\n${content}` : `\n\n${content}\n\n`;
    if (/^H[1-6]$/.test(name)) return `\n\n${'#'.repeat(Number(name[1]))}\n\n`;
    if (oldHtmlKeepsRaw(node)) return node.isBlock ? `\n\n${oldHtmlRaw(node)}\n\n` : oldHtmlRaw(node);
    return node.isBlock ? '\n\n' : '';
}

function oldHtmlService(Turndown) {
    const service = new Turndown({
        headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced', fence: '```',
        emDelimiter: '*', strongDelimiter: '**', linkStyle: 'inlined',
        blankReplacement: oldHtmlBlank
    });
    // 글 속 '<'와 엔티티처럼 보이는 '&'는 글자 그대로 보이게, 띄어쓰기 없는 빈칸(nbsp)은 &nbsp;로(앱이 쓰는 모양)
    const escape = service.escape.bind(service);
    service.escape = text => escape(String(text)).replace(/&(?=#?[A-Za-z0-9]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/ /g, '&nbsp;');
    service.addRule('teacherDel', { filter: ['del', 's', 'strike'], replacement: content => (content.trim() ? `~~${content}~~` : '') });
    service.addRule('teacherCode', { filter: 'pre', replacement: (content, node) => oldHtmlFence(node) });
    service.addRule('teacherNumbered', {
        filter: node => node.nodeName === 'OL' && node.getAttribute('data-teacher-numbered') === '1',
        replacement: (content, node) => (node.parentNode?.nodeName === 'LI' && node.parentNode.lastElementChild === node ? `\n${content}` : `\n\n${OLD_HTML_OL_MARK}\n${content}\n\n`)
    });
    // 블록 사이의 <br>(교안 글의 빈 줄 대신 쓴 <br> 줄)은 그 줄 그대로, 문단 안의 <br>은 줄바꿈 태그로
    service.addRule('teacherBreak', {
        filter: 'br',
        replacement: (content, node) => (OLD_HTML_BLOCK_PARENTS.has(node.parentNode?.nodeName) ? '\n\n<br>\n\n' : '<br>')
    });
    service.addRule('teacherMarkdownImage', {
        filter: node => node.nodeName === 'DIV' && node.hasAttribute('data-imgid') && !!node.querySelector('img'),
        replacement: (content, node) => `\n\n${oldHtmlImageMd(node.querySelector('img'))}\n\n`
    });
    service.addRule('teacherImageWrapper', {
        filter: node => node.nodeName === 'DIV' && oldHtmlHasClass(node, 'image-wrapper') && !!node.querySelector('img'),
        replacement: (content, node) => `\n\n${oldHtmlWrapper(node)}\n\n`
    });
    // 언어 이름표를 단 코드 블록(api.js lessonCodeBlockHtml)은 안의 코드로 펜스를 다시 쓴다. HTML로 두면 코드의 빈 줄이 빠진다
    service.addRule('teacherCodeBox', {
        filter: node => node.nodeName === 'DIV' && oldHtmlHasClass(node, 'lesson-code') && !!node.querySelector('pre'),
        replacement: (content, node) => oldHtmlFence(node.querySelector('pre'))
    });
    service.addRule('teacherRaw', {
        filter: oldHtmlKeepsRaw,
        replacement: (content, node) => (node.isBlock ? `\n\n${oldHtmlRaw(node)}\n\n` : oldHtmlRaw(node))
    });
    return service;
}

// 탭 하나를 마크다운으로. 남은 표시(코드 속 data URL 등)는 원래 글로 되돌린다
function oldHtmlMarkdown(service, section, read) {
    const md = service.turndown(section).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return read.restore(md);
}

/* ---------- 파일 하나 ---------- */
// [{ raw, from: 'html', titleRank }]. 되살릴 글이 없으면 까닭을 담아 던진다
async function readOldOutputHtml(name, read, progress = null) {
    progress?.say?.('예전 형식 HTML을 교안 글로 바꾸는 중…');
    const Turndown = await loadTurndown();
    if (typeof DOMParser !== 'function') throw new Error('이 브라우저에서는 HTML을 읽을 수 없습니다');
    await streamPause(); // 바꾸는 중이라는 글이 먼저 그려지게
    const doc = new DOMParser().parseFromString(read.text, 'text/html');
    const docTitle = String(doc.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim();
    const fileTitle = docTitle || outputFileBase(name).replace(OUTPUT_HTML_NAME, '').trim();
    const containers = oldHtmlContainers(doc, fileTitle, docTitle ? 2 : fileTitle ? 1 : 0);
    if (containers.length > OLD_HTML_LESSONS_MAX) throw new Error(`차시가 너무 많은 파일입니다(${outputCount(OLD_HTML_LESSONS_MAX)}개 넘음). '백업 ZIP으로 되살리기'를 쓰세요`);
    const service = oldHtmlService(Turndown);
    const lessons = [];
    for (const box of containers) {
        const media = { images: {}, videos: [], count: 0, notes: { old: 1, videosLost: 0, diagrams: 0, unlabeled: 0, unknownTabs: 0 } };
        media.nextKey = () => {
            media.count += 1;
            return `img_r${media.count}`;
        };
        const tabContents = {};
        for (const section of box.sections) {
            // 영상의 표지 그림과 다이어그램 SVG(안의 서식 포함)를 먼저 꺼낸 뒤 화면 요소를 걷어 낸다
            oldHtmlTakeMedia(section.node, read, media);
            oldHtmlTidy(section.node);
            const md = oldHtmlMarkdown(service, section.node, read);
            if (!md) continue;
            const named = section.label ? tabIdOf(section.label) : null;
            if (section.label && !named) media.notes.unknownTabs += 1;
            if (!section.label) media.notes.unlabeled += 1;
            const tab = named || LESSON_TABS.find(item => !tabContents[item.id])?.id || 'basicLearn';
            tabContents[tab] = tabContents[tab] ? `${tabContents[tab]}\n\n${md}` : md;
        }
        if (!Object.keys(tabContents).length) continue;
        lessons.push({
            raw: { title: box.title, tabContents, images: media.images, videos: media.videos, importNotes: media.notes },
            from: 'html',
            titleRank: box.titleRank
        });
    }
    if (!lessons.length) throw new Error('되살릴 교안 글이 없습니다');
    return lessons;
}

/* ---------- 예전(version 1) 교수안 HTML의 교수안 그림 ---------- */
// af5287a~c8b9987의 교수안 HTML은 원본(version 1)에 교수안 그림 칸이 없고, 그림은 화면 교수안 문서에만 표시 없이 그려져 있다.
// 원본 교수안 글의 ![..](local:키)를 자리 표시로 바꿔 화면과 같은 파서(KBuilder.parseDoc)로 읽은 그림 차례를 화면 그림 차례와 맞춘다.
// 그림 수가 같고, 글에 박힌 그림이 제자리에 있고, 같은 키가 같은 그림일 때만 채운다(아니면 지금처럼 빈 그림 자리로 센다).
// 차시 그림과 같은 그림은 다시 담지 않는다(교수안은 차시 그림 위에 교수안 그림을 얹어 그린다)
const OLD_GYOSUAN_VIEW = '<body class="gyosuan-view">';
const OLD_GYOSUAN_DOC_BODY = '<div class="doc-body">';
const OLD_GYOSUAN_DOC_REFS = '<section class="doc-refs">'; // 문서 끝 참고 이미지(교수안 그림이 아니다)
const OLD_GYOSUAN_SLOT = 'data:image/x-teacher-slot,'; // 자리 표시. base64가 아니라 진짜 그림과 섞이지 않는다
const OLD_GYOSUAN_MD_IMAGE = /!\[([^\]]*)\]\(local:([^)\s]+)\)/g; // gyosuan.js resolveGyosuanImages와 같은 모양
const oldTagSrcs = html => outputTags(String(html || ''), 'img').map(attrs => attrs.get('src') ?? '');

// 교수안 글이 화면에 그리는 그림 차례: { key } 또는 { src }(글에 박힌 그림). 파서가 없으면 null
function oldGyosuanSlots(docMd) {
    const parseDoc = typeof window !== 'undefined' ? window.KBuilder?.parseDoc : null;
    if (typeof parseDoc !== 'function') return null;
    const keys = [];
    const md = String(docMd).replace(OLD_GYOSUAN_MD_IMAGE, (match, alt, key) => `![${alt}](${OLD_GYOSUAN_SLOT}${keys.push(key) - 1})`);
    const srcs = parseDoc(md).blocks.flatMap(block => {
        if (block.type === 'image') return [block.src];
        if (block.type === 'list') return block.items.flatMap(item => oldTagSrcs(item.text));
        if (block.type === 'table') return [...block.headers, ...block.rows.flat()].flatMap(oldTagSrcs);
        return oldTagSrcs(block.html);
    });
    // 바꿔 넣은 자리 표시만 키로 본다(교수안 글에 원래 있던 같은 모양의 글은 그냥 그림으로 본다)
    return srcs.map(src => {
        const slot = String(src).startsWith(OLD_GYOSUAN_SLOT) ? String(src).slice(OLD_GYOSUAN_SLOT.length) : null;
        return slot !== null && /^\d{1,6}$/.test(slot) && Number(slot) < keys.length ? { key: keys[Number(slot)] } : { src: String(src) };
    });
}

// 화면 교수안 문서의 그림 src(문서 차례, 끝의 참고 이미지는 빼고). 교수안 문서가 없으면 null
function oldGyosuanPictures(html, read, dom) {
    const doc = dom();
    if (doc) {
        const body = doc.querySelector('.doc-body');
        if (!body) return null;
        return Array.from(body.querySelectorAll('img')).filter(img => !oldHtmlClosestClass(img, 'doc-refs')).map(img => read.dataOf(img.getAttribute('src') || ''));
    }
    const start = html.indexOf(OLD_GYOSUAN_DOC_BODY);
    if (start < 0) return null;
    const ends = [html.indexOf(OLD_GYOSUAN_DOC_REFS, start), html.indexOf(OUTPUT_SOURCE_OPEN, start)].filter(at => at >= 0);
    return outputTags(html, 'img', start, ends.length ? Math.min(...ends) : html.length).map(attrs => read.dataOf(attrs.get('src') ?? ''));
}

// 원본에 교수안 그림 칸이 없는 예전 교수안 HTML이면 화면 문서에서 되찾은 그림을 넣은 새 차시, 아니면 받은 차시 그대로
function withOldGyosuanImages(lesson, html, read, dom) {
    try {
        const gyosuan = lesson && typeof lesson === 'object' ? lesson.gyosuan : null;
        if (!gyosuan || typeof gyosuan !== 'object' || gyosuan.images !== undefined || typeof gyosuan.docMd !== 'string' || !html.includes(OLD_GYOSUAN_VIEW)) return lesson;
        const slots = oldGyosuanSlots(gyosuan.docMd);
        const pictures = slots && oldGyosuanPictures(html, read, dom);
        if (!slots || !pictures || slots.length !== pictures.length) return lesson;
        const found = {};
        for (const [i, slot] of slots.entries()) {
            if (slot.key === undefined) {
                if (slot.src !== pictures[i]) return lesson; // 글에 박힌 그림이 제자리에 없다
            } else if (Object.prototype.hasOwnProperty.call(found, slot.key)) {
                if (found[slot.key] !== pictures[i]) return lesson; // 같은 키가 다른 그림이다
            } else {
                found[slot.key] = pictures[i];
            }
        }
        const own = lesson.images && typeof lesson.images === 'object' ? lesson.images : {};
        const images = Object.fromEntries(Object.entries(found).filter(([key, src]) => OUTPUT_IMAGE_RE.test(src) && own[key] !== src));
        return Object.keys(images).length ? { ...lesson, gyosuan: { ...gyosuan, images } } : lesson;
    } catch (err) {
        console.warn('[불러오기] 예전 교수안 HTML의 교수안 그림을 되찾지 못했습니다:', err.message);
        return lesson;
    }
}

if (typeof window !== 'undefined') {
    Object.assign(window, { isOldOutputHtml, loadTurndown, readOldOutputHtml, withOldGyosuanImages });
}
