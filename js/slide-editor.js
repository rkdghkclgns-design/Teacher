// slide-editor.js — PPTAgent 스타일 슬라이드 구조화 편집기
// v3.0: 자동 스케일 프리뷰 + 하단 가로 썸네일 스트립 + 텍스트 스타일 / 이미지 갤러리 / 레이아웃 프리셋
//       PPTX 주 출력 — PPTX로 제작 버튼을 최상단에 배치

(function () {
    'use strict';

    // ────────────────────────────────────────────────────────────
    // 상태
    // ────────────────────────────────────────────────────────────
    const state = {
        slides: [],        // SlideData[]
        active: 0,
        moduleId: null,
        title: '',
        images: {},        // module.images (local:xxx → base64)
        dirty: false,
    };

    const ICON_RE = /[■▣●📝⚙️🎮💡✅⚠️🧠🏆🚀🔬🎓📘📗📙📕🖥️🧩🎯🔍]/g;

    function genId() { return 'slide_' + Math.random().toString(36).slice(2, 10); }

    // ────────────────────────────────────────────────────────────
    // 파서: 교안 마크다운 → SlideData[]
    // 학생뷰: instructor-callout 블록 제거한 본문
    // 강사뷰(notes): instructor-callout 블록의 내용 → 발표자 노트
    // ────────────────────────────────────────────────────────────
    function isQuizDoc(md) {
        return /^#{2,3}\s*문제\s*\d/m.test(md) && !/^##\s+(?!문제)/m.test(md);
    }

    // 강사 callout 전용 패턴 (convention.js 기반)
    const INSTRUCTOR_MARKERS = [
        /⏱️?\s*\*{0,2}\s*예상\s*소요/,
        /🎚️?\s*\*{0,2}\s*난이도/,
        /🎬\s*\*{0,2}\s*도입\s*멘트/,
        /🗣️?\s*\*{0,2}\s*(?:핵심\s*설명|질문\s*\/?\s*참여|참여\s*유도)/,
        /💡\s*\*{0,2}\s*(?:꼭\s*짚어야|꼭\s*알아야)/,
        /⚠️?\s*\*{0,2}\s*(?:자주\s*헷갈|주의)/,
        /🔗\s*\*{0,2}\s*전환\s*멘트/,
    ];

    function stripInstructorCallouts(body) {
        // 1) <div class="instructor-callout">…</div> 블록 (어떤 순서의 속성도 허용)
        const instructor = [];
        const htmlRe = /<div\b[^>]*\bclass\s*=\s*["'][^"']*instructor-callout[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
        let student = body.replace(htmlRe, (match, inner) => {
            const plain = inner
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/\n{3,}/g, '\n\n').trim();
            if (plain) instructor.push(plain);
            return '';
        });

        // 2) 상태 기반 블록 감지
        // 강사 블록에 진입하면 (명확한 학생 콘텐츠 문단이 나올 때까지) 이후 빈줄로 구분된 단락도 강사로 취급
        const paragraphs = student.split(/\n\s*\n/);
        const studentParas = [];
        let inInstructorBlock = false;

        const hasMarker = (p) => INSTRUCTOR_MARKERS.some((re) => re.test(p));
        // 명확한 학생 콘텐츠 신호: 불릿/번호/헤딩/표/코드/이미지 시작
        const studentStartRe = /^\s*(?:[-*•]\s|\d+\.\s|#{1,4}\s|\|.*\||```|!\[|<img\b|<table\b)/;

        for (const para of paragraphs) {
            if (!para.trim()) continue;
            const marker = hasMarker(para);
            const studentStart = studentStartRe.test(para.trim());
            if (marker) {
                inInstructorBlock = true;
                const clean = para.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
                if (clean) instructor.push(clean);
            } else if (studentStart) {
                inInstructorBlock = false;
                studentParas.push(para);
            } else if (inInstructorBlock) {
                // 강사 블록 연속 단락
                const clean = para.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
                if (clean) instructor.push(clean);
            } else {
                studentParas.push(para);
            }
        }
        student = studentParas.join('\n\n').trim();

        return { student, instructor: instructor.join('\n\n─── 다음 강사 가이드 ───\n\n') };
    }

    function extractImagesFromBody(body) {
        const out = [];
        const re = /!\[[^\]]*\]\(([^)]+)\)|<img[^>]*src=["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(body)) !== null) out.push(m[1] || m[2]);
        return out;
    }

    // 본문에서 이미지 태그/래퍼 제거 (이미지는 슬라이드 이미지 슬롯으로 분리)
    function stripImagesFromBody(body) {
        return String(body || '')
            // image-wrapper div 전체 제거 (버튼·스팬 포함)
            .replace(/<div\b[^>]*\bclass\s*=\s*["'][^"']*image-wrapper[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
            // 단독 img 태그
            .replace(/<img\b[^>]*>/gi, '')
            // 마크다운 이미지
            .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
            // HTML 주석 이미지 지시자 <!-- [IMG: "..."] -->
            .replace(/<!--\s*\[IMG:[\s\S]*?-->/gi, '')
            // 다시 생성 버튼 잔재
            .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function cleanBulletText(raw) {
        let t = String(raw || '');
        // HTML 태그·볼드 마커·백틱·링크 문법 정리
        t = t.replace(/<[^>]+>/g, '');
        t = t.replace(/\*{1,3}/g, '');
        t = t.replace(/`([^`]+)`/g, '$1');
        t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        // 공백 정리
        t = t.replace(/\s+/g, ' ').trim();
        // 스타강사 스타일: 짧고 강렬한 핵심 포인트
        if (t.length > 60) {
            const breakpoint = t.slice(0, 60).search(/[,;—]\s[^,;—]+$/);
            if (breakpoint > 20) {
                t = t.slice(0, breakpoint).trim();
            } else {
                t = t.slice(0, 57).trim() + '...';
            }
        }
        // 꼬리 구두점 제거
        t = t.replace(/[,.、·]+$/, '').trim();
        // 불완전 연결어미로 끝나면 어미만 제거 (기본) 또는 마지막 쉼표까지 되돌림
        // 한국어 연결어미: ~하고 ~되며 ~으며 ~면서 ~하기 ~되기 ~해서 ~하여 ~하고자 ~되어 ~이나 ~거나 ~지만 ~에도
        const incompleteRe = /\s?(?:하고|되며|으며|면서|하기|되기|해서|하여|하고자|되어|이나|거나|지만|에도)\s*$/;
        if (incompleteRe.test(t)) {
            const removed = t.replace(incompleteRe, '').trim();
            const lastBreak = Math.max(t.lastIndexOf(', '), t.lastIndexOf('; '));
            // 어미 제거 후 30자 이상 남거나 구두점 경계가 없으면 어미만 제거, 그렇지 않으면 쉼표까지 되돌림
            if (removed.length >= 30 || lastBreak <= 10) {
                t = removed;
            } else {
                t = t.slice(0, lastBreak).trim();
            }
        }
        return t;
    }

    function extractBulletsAndBody(body) {
        const lines = (body || '').split('\n');
        const bullets = [];
        const bodyLines = [];
        let stillBullet = true;
        for (const line of lines) {
            const bm = line.match(/^\s*[-*•]\s+(.+)/);
            const nm = line.match(/^\s*\d+\.\s+(.+)/);
            if (stillBullet && (bm || nm)) {
                const clean = cleanBulletText(bm ? bm[1] : nm[1]);
                if (clean) bullets.push(clean);
                continue;
            }
            if (stillBullet && line.trim() === '' && bullets.length > 0 && bodyLines.length === 0) { stillBullet = false; continue; }
            stillBullet = false;
            bodyLines.push(line);
        }
        return { bullets, body: bodyLines.join('\n').trim() };
    }

    // 인라인 **소제목:** 을 별도 줄로 정규화 (같은 줄에 여러 소제목 섞여있는 경우 대응)
    function normalizeBoldBreaks(body) {
        if (!body) return body;
        let out = body;
        // "앞 텍스트 🕵 **비즈니스 기획:** 새로운..." → 앞에 \n\n 삽입
        const ICONS = '[🕵🎯💡⚠️📌📝🎬🗣🔗⏱🎚🔬🏆🚀🧠🎓🖥🧩]';
        const re = new RegExp('([^\\n])\\s*(' + ICONS + '+\\s+)?(\\*{2,3}[^*\\n]{2,60}?\\*{2,3}\\s*[:：])', 'g');
        out = out.replace(re, '$1\n\n$2$3');
        // 보너스: "**label:**" 이 본문 중간에 있을 때도 줄바꿈
        const re2 = /([^\n])\s*(\*{2,3}[^*\n]{2,60}?\*{2,3}\s*[:：])/g;
        out = out.replace(re2, '$1\n\n$2');
        return out;
    }

    // 본문에서 **소제목** 패러그래프 또는 인라인 `🕵 **사례: ...**` 패턴을 기준으로 서브 슬라이드 분할
    function splitByBoldSubheadings(slides) {
        const out = [];
        // 줄 시작에서 (옵션 이모지/기호) + **text** 또는 **text:** + (선택) 같은 줄 본문
        // 예: "**커뮤니케이션 능력**"    /  "🕵 **비즈니스 기획:** 새로운 상품을..."
        const subRe = /^(?:\s*[^\w가-힣\n]{0,4}\s*)?\*{2,3}\s*([^*\n]{2,60}?)\s*\*{2,3}\s*[:：]?\s*(.*)$/;
        for (const s of slides) {
            if (!s.body || !s.body.trim()) { out.push(s); continue; }
            // 인라인 소제목을 줄 단위로 정규화
            const normalizedBody = normalizeBoldBreaks(s.body);
            const lines = normalizedBody.split('\n');
            const subs = [];
            let cur = { title: null, lines: [] };

            for (const line of lines) {
                // 표/펜스는 제외
                const looksTable = /^\s*\|.*\|\s*$/.test(line);
                const looksFence = /^\s*```/.test(line);
                if (looksTable || looksFence) { cur.lines.push(line); continue; }
                const m = line.match(subRe);
                // title 내부에 다시 **가 있으면 매칭 무효화 (중첩 볼드)
                if (m && m[1].length >= 2 && !m[1].includes('**')) {
                    if (cur.title !== null || cur.lines.length) subs.push(cur);
                    cur = { title: m[1].replace(/[:：]\s*$/, '').trim(), lines: [] };
                    if (m[2] && m[2].trim()) cur.lines.push(m[2].trim());
                } else {
                    cur.lines.push(line);
                }
            }
            if (cur.title !== null || cur.lines.length) subs.push(cur);

            const subCount = subs.filter((x) => x.title !== null).length;
            if (subCount === 0) { out.push(s); continue; }

            subs.forEach((sub, idx) => {
                const subBody = sub.lines.join('\n').trim();
                if (idx === 0 && sub.title === null) {
                    // 첫 블록(소제목 없음)은 원본 슬라이드 유지
                    out.push({ ...s, body: subBody });
                } else if (sub.title === null) {
                    // 타이틀 없는 후속 블록 — 이전 서브 슬라이드에 귀속
                    const prev = out[out.length - 1];
                    if (prev) prev.body = (prev.body ? prev.body + '\n\n' + subBody : subBody);
                } else {
                    // 서브 슬라이드 이미지 분리 + 본문 정제
                    const subImages = extractImagesFromBody(subBody);
                    const subNoImg = stripImagesFromBody(subBody);
                    const { bullets: subBullets, body: subRest } = extractBulletsAndBody(subNoImg);
                    out.push({
                        id: genId(),
                        level: (s.level || 2) + 1,
                        title: sub.title,
                        bullets: subBullets,
                        body: subRest,
                        // 서브에 이미지가 없으면 원본의 이미지를 물려받음 (동일 주제 공유)
                        images: subImages.length ? subImages : (s.images || []).slice(0, 1),
                        imageLayouts: [], textStyle: {}, notes: '',
                        kind: hasTable(subRest) ? 'data-table' : 'content',
                    });
                }
            });
        }
        return out;
    }

    function hasTable(body) {
        return body && (body.includes('<table') || (body.includes('|') && /\n\s*\|?\s*-{3,}/.test(body)));
    }

    function isObjectivesTitle(t) {
        return /학습\s*목표|학습목표|목표|Objectives?/i.test(t || '');
    }
    function isClosingTitle(t) {
        return /요약|마무리|정리|결론|Q\s*&?\s*A|Thank\s*you|감사합니다/i.test(t || '');
    }

    // 슬라이드의 최종 종류 결정 (콘텐츠 존재 여부 우선)
    function detectKind(s, isFirst) {
        const title = s.title || '';
        const hasContent = (s.bullets && s.bullets.length) || (s.body && s.body.trim());
        if (/^문제\s*\d/.test(title) || /###?\s*문제\s*\d/.test(s.body || '')) return 'quiz';
        if (hasTable(s.body)) return 'data-table';
        if (isObjectivesTitle(title)) return 'objectives';
        if (isClosingTitle(title)) return 'closing';
        if (isFirst && s.level === 1) return 'cover';
        if (!hasContent) return 'section-divider';
        return 'content';
    }

    function parseQuizDoc(md) {
        if (typeof window._parseSlidesFromMD !== 'function') return [];
        return window._parseSlidesFromMD(md || '').map((s) => {
            const { bullets, body } = extractBulletsAndBody(s.body || '');
            return {
                id: genId(), kind: s.type || 'content', level: s.level || 2,
                title: (s.heading || '').replace(ICON_RE, '').trim(),
                bullets, body, images: extractImagesFromBody(s.body || ''),
                imageLayouts: [], textStyle: {}, notes: '',
            };
        });
    }

    // 긴 본문 단락을 핵심 문장 불릿으로 자동 변환 (학습자가 PPT로 이해할 수 있는 요약)
    function condenseBodyToBullets(body, existingBullets) {
        if (!body || !body.trim()) return { bullets: existingBullets || [], body: '' };
        // 이미 충분한 불릿이 있으면 본문은 간단한 보충으로 유지
        if (existingBullets && existingBullets.length >= 3) return { bullets: existingBullets, body: body };

        // 표/코드블록/이미지/Mermaid 블록은 보존 (body로 남김)
        const preserveRe = /(```[\s\S]*?```|<!--\s*\[IMG:[\s\S]*?-->|<img[\s\S]*?>|<table[\s\S]*?<\/table>|(?:^\s*\|[^\n]*\n)+\s*\|?\s*[:\-\s|]+\|?[^\n]*(?:\n\s*\|[^\n]*)*)/gm;
        const blocks = [];
        const textOnly = body.replace(preserveRe, (m) => { blocks.push(m); return `\n__BLOCK_${blocks.length - 1}__\n`; });

        // 텍스트 구간에서 문장 추출 (한글/영문 . ! ? 기준)
        const sentences = [];
        textOnly.split(/\n+/).forEach((para) => {
            const clean = para.replace(/__BLOCK_\d+__/g, '').replace(/<[^>]+>/g, '').trim();
            if (!clean) return;
            // 문장 분리
            const parts = clean.split(/(?<=[.!?。?！？])\s+(?=[가-힣A-Z])/);
            for (const p of parts) {
                const t = p.trim().replace(/^\*\*|\*\*$/g, '').replace(/^[\-\*•]\s+/, '');
                if (t.length >= 8) sentences.push(t);
            }
        });

        // 스타강사 스타일: 최대 4개 불릿, 짧은 문장 우선
        const maxTotal = 4;
        // 기존 불릿을 먼저 정리 (중복 제거, 길이 기준 정리)
        const bullets = [...(existingBullets || [])].map(cleanBulletText).filter(Boolean);
        // 짧은 문장을 우선 채택 (25~55자 구간이 프레젠테이션에 이상적)
        const ranked = sentences
            .map(cleanBulletText)
            .filter((s) => s && s.length >= 8)
            .sort((a, b) => {
                const score = (t) => {
                    const len = t.length;
                    if (len >= 25 && len <= 55) return 0;       // 이상적 구간
                    if (len >= 15 && len < 25) return 1;         // 짧아도 OK
                    if (len > 55 && len <= 70) return 2;         // 약간 긺
                    return 3;                                      // 너무 짧거나 긺
                };
                return score(a) - score(b);
            });
        for (const cleaned of ranked) {
            if (bullets.length >= maxTotal) break;
            if (bullets.some((b) => b.slice(0, 12) === cleaned.slice(0, 12))) continue;
            bullets.push(cleaned);
        }

        // 남은 body는 블록(표/코드)만 보존
        const preservedBody = blocks.length > 0 ? blocks.join('\n\n').trim() : '';
        return { bullets, body: preservedBody };
    }

    function rawParseDeck(markdown) {
        const md = String(markdown || '').replace(/\r\n/g, '\n');
        if (!md.trim()) return [];
        if (isQuizDoc(md)) return parseQuizDoc(md);

        const fences = [];
        const masked = md.replace(/```[\s\S]*?```/g, (block) => { fences.push(block); return `\n__FENCE_${fences.length - 1}__\n`; });
        const restoreFences = (t) => t.replace(/__FENCE_(\d+)__/g, (_, i) => fences[parseInt(i, 10)] || '');

        const lines = masked.split('\n');
        const buckets = [];
        let current = null;
        const push = () => { if (current) buckets.push(current); current = null; };

        for (const line of lines) {
            const hm = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
            if (hm) {
                push();
                current = { level: hm[1].length, title: hm[2].replace(ICON_RE, '').trim(), bodyLines: [] };
            } else if (current) current.bodyLines.push(line);
            else if (line.trim() && line.trim() !== '---') current = { level: 0, title: '', bodyLines: [line] };
        }
        push();

        const raw = [];
        buckets.forEach((b, idx) => {
            const rawBody = restoreFences(b.bodyLines.join('\n')).trim();
            // 학생뷰 / 강사뷰 분리
            const { student, instructor } = stripInstructorCallouts(rawBody);
            // 이미지 URL은 수집, 본문에서 이미지 마크업은 제거
            const images = extractImagesFromBody(student);
            const bodyNoImg = stripImagesFromBody(student);
            const { bullets, body } = extractBulletsAndBody(bodyNoImg);
            // 본문 압축은 서브 슬라이드 분할 이후에 수행 (볼드 소제목 보존 위해)
            const s = {
                id: genId(),
                level: b.level,
                title: b.title,
                bullets, body,
                images,
                imageLayouts: [],
                textStyle: {},
                notes: instructor,
            };
            s.kind = detectKind(s, idx === 0);
            raw.push(s);
        });
        // 완전 빈 슬라이드 제거
        return raw.filter((s) => (s.title && s.title.trim()) || s.bullets.length || (s.body && s.body.trim()) || (s.notes && s.notes.trim()));
    }

    // 밀집 슬라이드 자동 분할: 불릿이 MAX_BULLETS보다 많으면 여러 장으로
    function splitDenseSlides(slides) {
        const MAX = 4; // 스타강사 스타일: 슬라이드당 4개 이하
        const out = [];
        for (const s of slides) {
            if (s.bullets.length <= MAX || s.kind === 'cover' || s.kind === 'closing' || s.kind === 'quiz') {
                out.push(s);
                continue;
            }
            const total = Math.ceil(s.bullets.length / MAX);
            for (let i = 0; i < total; i++) {
                const chunk = s.bullets.slice(i * MAX, (i + 1) * MAX);
                const titleSuffix = total > 1 ? ` (${i + 1}/${total})` : '';
                out.push({
                    ...s, id: genId(),
                    title: s.title + titleSuffix,
                    bullets: chunk,
                    body: i === 0 ? s.body : '',
                    images: i === 0 ? s.images : [],
                    imageLayouts: i === 0 ? s.imageLayouts : [],
                    notes: i === 0 ? s.notes : '', // 노트는 첫 조각에만 연결
                });
            }
        }
        return out;
    }

    // 순서 재정렬 + 표지/마무리 자동 보강
    function reorderAndAugment(slides, courseTitle, tabLabel) {
        const cover = slides.find((s) => s.kind === 'cover') || null;
        const objectives = slides.find((s) => s.kind === 'objectives') || null;
        const closingExisting = [...slides].reverse().find((s) => s.kind === 'closing') || null;
        const others = slides.filter((s) => s !== cover && s !== objectives && s !== closingExisting);

        const result = [];

        // 1) 표지
        if (cover) {
            result.push(cover);
        } else {
            result.push({
                id: genId(), kind: 'cover', level: 1,
                title: courseTitle || '슬라이드',
                bullets: tabLabel ? [tabLabel] : [],
                body: '',
                images: [], imageLayouts: [], textStyle: {}, notes: '',
            });
        }

        // 2) 학습 목표
        if (objectives) result.push(objectives);

        // 3) 본문
        result.push(...others);

        // 4) 마무리
        if (closingExisting) {
            result.push(closingExisting);
        } else {
            const keyPoints = others
                .filter((s) => s.kind === 'content' && s.title)
                .slice(0, 5)
                .map((s) => s.title);
            result.push({
                id: genId(), kind: 'closing', level: 1,
                title: '마무리',
                bullets: keyPoints.length
                    ? ['오늘 학습한 내용을 요약합니다', ...keyPoints.map((t) => '핵심: ' + t)]
                    : ['오늘 학습한 내용을 정리합니다', '궁금한 점은 질문해주세요', '다음 시간에 이어서 학습하겠습니다'],
                body: '',
                images: [], imageLayouts: [], textStyle: {}, notes: '',
            });
        }

        return result;
    }

    // 모든 슬라이드에 본문 압축 적용 (서브 슬라이드 분할 이후)
    function condenseAllSlides(slides) {
        return slides.map((s) => {
            if (s.kind === 'data-table' || s.kind === 'quiz') return s; // 표/퀴즈 원본 보존
            const { bullets, body } = condenseBodyToBullets(s.body, s.bullets);
            return { ...s, bullets, body };
        });
    }

    // 불릿과 표가 한 슬라이드에 있으면 별도 슬라이드로 분리
    function splitTablesOut(slides) {
        const out = [];
        for (const s of slides) {
            if (s.bullets.length > 0 && hasTable(s.body)) {
                // 불릿 슬라이드와 표 슬라이드 분리
                out.push({ ...s, body: '', kind: 'content' });
                out.push({
                    id: genId(),
                    level: s.level,
                    title: s.title + ' (요약 표)',
                    bullets: [],
                    body: s.body,
                    images: [], imageLayouts: [], textStyle: {}, notes: '',
                    kind: 'data-table',
                });
            } else {
                out.push(s);
            }
        }
        return out;
    }

    function parseDeck(markdown, courseTitle, tabLabel) {
        const raw = rawParseDeck(markdown);
        if (!raw.length) return [];
        // 1) 본문 내 **소제목** 기준 서브 슬라이드 분할
        const byBold = splitByBoldSubheadings(raw);
        // 2) 불릿+표 혼재 슬라이드는 별도 슬라이드로 분리
        const tablesOut = splitTablesOut(byBold);
        // 3) 각 슬라이드의 긴 본문을 불릿으로 압축 (최대 5개, 80자 이하)
        const condensed = condenseAllSlides(tablesOut);
        // 4) 불릿 >6개는 여러 장으로 분할
        const dense = splitDenseSlides(condensed);
        // 5) 표지/학습목표/본문/마무리 순서 재정렬 + 자동 보강
        return reorderAndAugment(dense, courseTitle, tabLabel);
    }

    // ────────────────────────────────────────────────────────────
    // 직렬화
    // ────────────────────────────────────────────────────────────
    function slideToMarkdown(sl) {
        const lines = [];
        const level = sl.level || (sl.kind === 'title' ? 1 : (sl.kind === 'section-h2' ? 2 : 3));
        const prefix = '#'.repeat(Math.max(1, Math.min(4, level))) + ' ';
        if (sl.title) lines.push(prefix + sl.title);
        if (sl.bullets && sl.bullets.length) { lines.push(''); for (const b of sl.bullets) lines.push('- ' + b); }
        if (sl.body && sl.body.trim()) { lines.push(''); lines.push(sl.body); }
        return lines.join('\n');
    }

    function deckToMarkdown() { return state.slides.map(slideToMarkdown).join('\n\n'); }

    function resolveImages(htmlOrUrl) {
        if (!state.images || !htmlOrUrl) return htmlOrUrl;
        let out = htmlOrUrl;
        for (const [imgId, b64] of Object.entries(state.images)) {
            out = out.replace(new RegExp(`local:${imgId}`, 'g'), b64);
        }
        return out;
    }

    function resolveImageUrl(url) {
        if (!url) return url;
        if (url.startsWith('local:') && state.images) {
            const id = url.slice(6);
            return state.images[id] || url;
        }
        return url;
    }

    // ────────────────────────────────────────────────────────────
    // 레이아웃 프리셋
    // ────────────────────────────────────────────────────────────
    const LAYOUT_PRESETS = [
        { id: 'right-half', label: '오른쪽 절반', layout: { x: 0.52, y: 0.1, w: 0.43, h: 0.8 } },
        { id: 'left-half', label: '왼쪽 절반', layout: { x: 0.05, y: 0.1, w: 0.43, h: 0.8 } },
        { id: 'full', label: '전체 배경', layout: { x: 0, y: 0, w: 1, h: 1 } },
        { id: 'top-band', label: '상단 밴드', layout: { x: 0.05, y: 0.06, w: 0.9, h: 0.35 } },
        { id: 'bottom-band', label: '하단 밴드', layout: { x: 0.05, y: 0.58, w: 0.9, h: 0.35 } },
        { id: 'center', label: '중앙', layout: { x: 0.25, y: 0.2, w: 0.5, h: 0.6 } },
    ];
    function clampLayout(l) {
        const w = Math.max(0.05, Math.min(1, l.w));
        const h = Math.max(0.05, Math.min(1, l.h));
        const x = Math.max(0, Math.min(1 - w, l.x));
        const y = Math.max(0, Math.min(1 - h, l.y));
        return { x, y, w, h };
    }
    function hasLayoutOverride(sl) {
        return Array.isArray(sl.imageLayouts) && sl.imageLayouts.some((l) => l && typeof l.x === 'number');
    }

    // ────────────────────────────────────────────────────────────
    // 프리뷰 HTML 빌드 (자동 스케일 + 텍스트 스타일 + 이미지 오버레이)
    // ────────────────────────────────────────────────────────────
    function legacyKindOf(sl) {
        // 콘텐츠 존재 시 항상 content 렌더링으로 (섹션 divider는 콘텐츠 없을 때만)
        const hasContent = (sl.bullets && sl.bullets.length) || (sl.body && sl.body.trim());
        if (sl.kind === 'quiz') return 'quiz';
        if (sl.kind === 'data-table') return 'data-table';
        if (sl.kind === 'cover') return 'title';           // 표지: section-slide 중앙정렬
        if (sl.kind === 'closing') return 'title';          // 마무리: section-slide 중앙정렬
        if (sl.kind === 'section-divider' && !hasContent) return 'section';
        if (sl.kind === 'objectives') return 'content';
        return 'content';
    }
    function legacyBodyOf(sl) {
        const parts = [];
        if (sl.bullets && sl.bullets.length) for (const b of sl.bullets) parts.push('- ' + b);
        if (sl.body && sl.body.trim()) { if (parts.length) parts.push(''); parts.push(sl.body); }
        return parts.join('\n');
    }

    // 이미지가 있는 슬라이드의 기본 레이아웃
    function defaultImageLayoutFor(kind, index) {
        if (kind === 'cover' || kind === 'closing') {
            // 표지/마무리: 우측 하단 데코레이션 (제목 겹침 방지)
            return { x: 0.70, y: 0.56, w: 0.27, h: 0.40 };
        }
        if (kind === 'section-divider') {
            // 섹션 구분: 우측 하단 작은 장식
            return { x: 0.75, y: 0.62, w: 0.22, h: 0.32 };
        }
        // content/objectives
        if (index === 0) return { x: 0.55, y: 0.18, w: 0.42, h: 0.72 };
        const tileW = 0.22, tileH = 0.26;
        return { x: 0.05 + (index - 1) * (tileW + 0.02), y: 0.65, w: tileW, h: tileH };
    }

    function buildImageOverlays(sl) {
        const imgs = sl.images || [];
        if (imgs.length === 0) return '';
        const items = [];
        imgs.forEach((url, i) => {
            const layout = (sl.imageLayouts && sl.imageLayouts[i]) || defaultImageLayoutFor(sl.kind, i);
            const src = resolveImageUrl(url);
            // 전체 배경(w>=0.95 && h>=0.95) 이면 z-index를 낮추고 반투명 처리
            const isFullBg = layout.w >= 0.95 && layout.h >= 0.95;
            const zIndex = isFullBg ? 0 : 5;
            const opacity = isFullBg ? 0.35 : 1;
            const fit = isFullBg ? 'cover' : 'contain';
            const shadow = isFullBg ? '' : 'box-shadow:0 8px 32px rgba(0,0,0,0.4);';
            items.push(`<img class="img-overlay" src="${src}" style="position:absolute;left:${(layout.x * 100).toFixed(2)}%;top:${(layout.y * 100).toFixed(2)}%;width:${(layout.w * 100).toFixed(2)}%;height:${(layout.h * 100).toFixed(2)}%;object-fit:${fit};border-radius:10px;z-index:${zIndex};opacity:${opacity};${shadow}">`);
        });
        // 텍스트가 이미지 위에 확실히 보이도록: slide-container 직접 자식의 z-index를 올림
        items.push(`<style>.slide-container > h1, .slide-container > h2, .slide-container > h3, .slide-container > p, .slide-container > div:not(.img-overlay):not(img), .slide-container > .slide-title, .slide-container > .slide-body, .slide-container > hr, .slide-container > .subtitle { position: relative; z-index: 10; }</style>`);
        return items.join('');
    }

    function buildSingleSlideHTML(sl) {
        const SLIDE_CSS = window._SLIDE_CSS || '';
        const slideToHTMLFn = window._slideToHTML;
        if (!slideToHTMLFn) return '<html><body>렌더러 로딩 중</body></html>';

        const legacy = {
            type: legacyKindOf(sl),
            heading: sl.title || '(제목 없음)',
            body: legacyBodyOf(sl),
            level: sl.level || 2,
        };
        let inner;
        try { inner = slideToHTMLFn(legacy); } catch (e) { inner = `<div style="color:#f87171;padding:20px;">렌더 오류: ${e.message}</div>`; }
        inner = resolveImages(inner);
        // Mermaid 코드 정제: [...] 노드명 내부의 () 괄호를 제거 (Mermaid 파서 호환)
        // 부모 컨텍스트에서 수행해야 정규식이 안전하게 처리됨
        inner = inner.replace(/<code\s+class="language-mermaid">([\s\S]*?)<\/code>/gi, (match, code) => {
            const sanitized = code.replace(/\[([^\]]*)\]/g, (m, inside) => '[' + inside.replace(/[()]/g, '') + ']');
            return '<code class="language-mermaid">' + sanitized + '</code>';
        });

        // 이미지 오버레이 삽입 (이미지 있으면 항상)
        if (sl.images && sl.images.length > 0) {
            const overlays = buildImageOverlays(sl);
            if (overlays) {
                // slide-container의 마지막 </div> 직전에 오버레이 삽입
                const lastClose = inner.lastIndexOf('</div>');
                if (lastClose >= 0) {
                    inner = inner.substring(0, lastClose) + overlays + inner.substring(lastClose);
                } else {
                    inner = inner + overlays;
                }
            }
        }

        // 텍스트 스타일 CSS 오버라이드
        const ts = sl.textStyle || {};
        const titleScale = ts.titleScale ?? 1;
        const bulletScale = ts.bulletScale ?? 1;
        const fontFamily = ts.fontFamily || 'display';
        const titleWeight = ts.titleWeight || 'bold';
        const fontMap = {
            display: "'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
            sans: "'Pretendard', 'Malgun Gothic', 'Noto Sans KR', sans-serif",
            serif: "'Noto Serif KR', 'Nanum Myeongjo', serif",
        };

        // 이미지 레이아웃에 따라 본문 컬럼 폭 조정 (이미지와 겹치지 않도록)
        const hasImg = sl.images && sl.images.length > 0 && sl.kind !== 'cover' && sl.kind !== 'closing' && sl.kind !== 'section-divider';
        let bodyWidthPct = 100, bodyMarginLeftPct = 0;
        if (hasImg) {
            const l0 = (sl.imageLayouts && sl.imageLayouts[0]) || defaultImageLayoutFor(sl.kind, 0);
            if (l0.x >= 0.45) { // 이미지 오른쪽
                bodyWidthPct = Math.floor(l0.x * 100) - 3;
            } else if (l0.x + l0.w <= 0.55) { // 이미지 왼쪽
                bodyMarginLeftPct = Math.floor((l0.x + l0.w) * 100) + 3;
                bodyWidthPct = 100 - bodyMarginLeftPct;
            }
            // 전체 배경(full)은 바디 그대로
        }

        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"><\/script>
<style>${SLIDE_CSS}
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden !important; background: #0a0e1a; }
body { display: flex; align-items: center; justify-content: center; font-family: ${fontMap[fontFamily]}; }
.slide-container { transform-origin: center center; flex-shrink: 0; font-family: ${fontMap[fontFamily]}; overflow: hidden !important; }
.slide-container h1, .slide-container h2, .slide-container h3, .slide-container h4, .slide-container .slide-title { font-family: ${fontMap[fontFamily]}; }
.slide-container h1 { font-size: ${Math.round(56 * titleScale)}px !important; font-weight: ${titleWeight === 'bold' ? 700 : 600} !important; }
.slide-container .slide-title { font-size: ${Math.round(36 * titleScale)}px !important; font-weight: ${titleWeight === 'bold' ? 700 : 600} !important; }
.slide-container h3 { font-size: ${Math.round(24 * bulletScale)}px !important; }
.slide-container p, .slide-container li { font-size: ${Math.round(18 * bulletScale)}px !important; }
.slide-container .subtitle { font-size: ${Math.round(22 * bulletScale)}px !important; }
/* 중요: 슬라이드 스크롤 차단 — 넘치는 콘텐츠는 잘림 */
.slide-body { overflow: hidden !important; max-height: 100% !important; width: ${bodyWidthPct}% !important; margin-left: ${bodyMarginLeftPct}% !important; }
.slide-container ul, .slide-container ol { width: ${bodyWidthPct}% !important; margin-left: ${bodyMarginLeftPct}% !important; }
/* 한국어 단어 중간 끊김 방지 — 공백 경계에서만 줄바꿈 */
.slide-container, .slide-container *, .slide-body, .slide-body *, .slide-body li, .slide-body p, .slide-body h1, .slide-body h2, .slide-body h3 {
  word-break: keep-all !important;
  overflow-wrap: break-word !important;
  line-break: strict !important;
}
.slide-body img, .slide-container img { max-height: 360px !important; max-width: 100% !important; object-fit: contain !important; }
.slide-body .image-wrapper { max-height: 360px; overflow: hidden; }
.slide-body ul, .slide-body ol { margin: 4px 0 !important; padding-left: 20px !important; }
.slide-body li { margin: 2px 0 !important; line-height: 1.5 !important; }
.slide-body p { margin: 4px 0 !important; line-height: 1.5 !important; }
.mermaid { background: transparent; text-align: center; margin: 10px 0; max-height: 300px; overflow: hidden; }
.mermaid svg { max-width: 100%; max-height: 300px; height: auto; }
.img-overlay { pointer-events: none; }
</style></head><body>${inner}
<script>
// 슬라이드(1280x720)를 iframe 뷰포트에 자동 스케일로 피팅
(function() {
  const el = document.querySelector('.slide-container');
  if (!el) return;
  const SLIDE_W = 1280, SLIDE_H = 720;
  const PAD = 20; // 여백
  function fit() {
    const vw = window.innerWidth - PAD;
    const vh = window.innerHeight - PAD;
    const scale = Math.min(vw / SLIDE_W, vh / SLIDE_H);
    el.style.transform = 'scale(' + scale + ')';
  }
  fit();
  window.addEventListener('resize', fit);
  setTimeout(fit, 50);
  setTimeout(fit, 200);
})();
// Mermaid 렌더 + 에러 시 fallback
try {
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', themeVariables: { primaryColor: '#1f2937', primaryTextColor: '#f3f4f6', lineColor: '#22d3ee' } });
    document.querySelectorAll('pre code.language-mermaid, code.language-mermaid').forEach(el => {
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = el.textContent || '';
      (el.closest('pre') || el).replaceWith(div);
    });
    setTimeout(() => {
      try { mermaid.run({ suppressErrors: true }); }
      catch (e) { console.warn('mermaid run', e); }
      setTimeout(() => {
        document.querySelectorAll('.mermaid').forEach((el) => {
          if (el.querySelector('.error-text, .error-icon') || /Syntax error/i.test(el.textContent || '')) {
            el.style.display = 'none';
          }
        });
      }, 400);
    }, 150);
  }
} catch (e) { console.warn('preview mermaid', e); }
<\/script></body></html>`;
    }

    function buildFullDeckHTML() {
        if (typeof window._buildSlideHTML !== 'function') return '';
        const md = deckToMarkdown();
        let html = window._buildSlideHTML(md, state.title || '슬라이드');
        return resolveImages(html);
    }

    // ────────────────────────────────────────────────────────────
    // UI
    // ────────────────────────────────────────────────────────────
    const C = {
        bg: 'rgba(10,14,26,0.96)',
        panel: '#111827',
        panel2: '#1a1a2e',
        border: 'rgba(255,255,255,0.1)',
        accent: '#22d3ee',
        accent2: '#a78bfa',
        text: '#f3f4f6',
        muted: '#9ca3af',
    };

    const KIND_LABEL = {
        cover: '표지',
        objectives: '학습 목표',
        'section-divider': '섹션',
        section: '섹션',
        content: '본문',
        quiz: '퀴즈',
        'data-table': '표',
        closing: '마무리',
        // 구버전 호환
        title: '표지', 'section-h2': '섹션',
    };

    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function renderShell() {
        document.getElementById('slide-editor-root')?.remove();
        const root = document.createElement('div');
        root.id = 'slide-editor-root';
        root.style.cssText = `position:fixed;inset:0;z-index:9998;background:${C.bg};display:flex;flex-direction:column;backdrop-filter:blur(8px);`;
        root.innerHTML = `
          <!-- 헤더 -->
          <header style="display:flex;align-items:center;gap:10px;padding:10px 18px;background:${C.panel};border-bottom:1px solid ${C.border};flex-shrink:0;">
            <i class="ph-fill ph-presentation-chart" style="color:${C.accent};font-size:18px;"></i>
            <h3 style="color:${C.text};font-size:14px;font-weight:700;margin:0;flex:1;">슬라이드 편집기 — ${esc(state.title)}
              <span id="sed-dirty" style="display:none;margin-left:8px;padding:2px 8px;font-size:10px;font-weight:700;background:rgba(245,158,11,0.15);color:#f59e0b;border-radius:10px;">편집됨</span>
              <span id="sed-count" style="margin-left:6px;padding:2px 8px;font-size:10px;font-weight:700;background:rgba(34,211,238,0.1);color:${C.accent};border-radius:10px;">0장</span>
            </h3>
            <button id="sed-pptx" title="PPTX로 제작 (주 출력)"
                    style="padding:8px 16px;font-size:12px;font-weight:700;border:1px solid rgba(34,211,238,0.6);background:linear-gradient(135deg,rgba(34,211,238,0.25),rgba(167,139,250,0.25));color:${C.text};border-radius:6px;cursor:pointer;box-shadow:0 0 0 1px rgba(34,211,238,0.3);">
              📊 PPTX로 제작
            </button>
            <button id="sed-save" title="교안에 저장" style="padding:7px 14px;font-size:12px;font-weight:700;border:1px solid rgba(34,197,94,0.5);background:rgba(34,197,94,0.1);color:#22c55e;border-radius:6px;cursor:pointer;">💾 교안 저장</button>
            <button id="sed-html" style="padding:7px 12px;font-size:12px;font-weight:700;border:1px solid ${C.border};background:transparent;color:${C.muted};border-radius:6px;cursor:pointer;">HTML</button>
            <button id="sed-fullscreen" style="padding:7px 12px;font-size:12px;font-weight:700;border:1px solid ${C.border};background:transparent;color:${C.muted};border-radius:6px;cursor:pointer;">🔍</button>
            <button id="sed-close" style="padding:7px 12px;font-size:12px;font-weight:700;border:1px solid rgba(248,113,113,0.3);background:transparent;color:#f87171;border-radius:6px;cursor:pointer;">✕</button>
          </header>

          <!-- 본문: 프리뷰(좌) + 편집패널(우) -->
          <div style="flex:1;display:grid;grid-template-columns:1fr 400px;min-height:0;">
            <!-- 라이브 프리뷰 -->
            <main style="position:relative;overflow:hidden;padding:14px 20px;display:flex;flex-direction:column;gap:8px;background:radial-gradient(ellipse at top,rgba(34,211,238,0.04),transparent 70%);">
              <div style="display:flex;align-items:center;gap:10px;padding:0 2px;flex-shrink:0;">
                <span id="sed-nav-info" style="font-size:11px;color:${C.muted};font-weight:600;"></span>
                <span id="sed-kind-badge" style="padding:2px 8px;font-size:10px;font-weight:700;color:${C.accent2};background:rgba(167,139,250,0.1);border-radius:10px;"></span>
                <div style="flex:1;"></div>
                <button id="sed-prev" style="padding:4px 12px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">◀ 이전</button>
                <button id="sed-next" style="padding:4px 12px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">다음 ▶</button>
              </div>
              <iframe id="sed-preview" sandbox="allow-scripts"
                      style="flex:1;width:100%;border:1px solid ${C.border};border-radius:10px;background:#0F172A;min-height:0;"></iframe>
            </main>

            <!-- 편집 패널 -->
            <aside style="border-left:1px solid ${C.border};background:rgba(0,0,0,0.25);overflow-y:auto;padding:14px;">
              <div id="sed-editor"></div>
            </aside>
          </div>

          <!-- 하단 가로 썸네일 스트립 -->
          <footer style="border-top:1px solid ${C.border};background:rgba(0,0,0,0.4);padding:10px 14px;flex-shrink:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:10px;color:${C.muted};font-weight:700;letter-spacing:1px;text-transform:uppercase;">전체 슬라이드</span>
              <span style="font-size:10px;color:${C.muted};">← 가로 스크롤로 탐색 · 클릭하여 이동</span>
            </div>
            <div id="sed-thumbs" style="display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;padding-bottom:6px;scrollbar-width:thin;"></div>
          </footer>`;
        document.body.appendChild(root);

        // 키보드
        root._escHandler = (e) => {
            if (e.key === 'Escape') closeEditor();
            const tag = (e.target?.tagName || '').toUpperCase();
            const isText = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
            if (!isText) {
                if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); navigate(-1); }
                if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); navigate(1); }
            }
        };
        document.addEventListener('keydown', root._escHandler);

        document.getElementById('sed-close').addEventListener('click', closeEditor);
        document.getElementById('sed-save').addEventListener('click', saveToModule);
        document.getElementById('sed-html').addEventListener('click', downloadHTML);
        document.getElementById('sed-pptx').addEventListener('click', downloadPPTX);
        document.getElementById('sed-fullscreen').addEventListener('click', openPreviewFullscreen);
        document.getElementById('sed-prev').addEventListener('click', () => navigate(-1));
        document.getElementById('sed-next').addEventListener('click', () => navigate(1));
    }

    function renderThumbs() {
        const strip = document.getElementById('sed-thumbs');
        if (!strip) return;
        strip.innerHTML = state.slides.map((sl, i) => {
            const active = i === state.active;
            const label = KIND_LABEL[sl.kind] || '본문';
            const img = (sl.images && sl.images.length) ? resolveImageUrl(sl.images[0]) : null;
            return `
              <div class="sed-thumb" data-idx="${i}"
                   style="position:relative;width:140px;height:80px;flex-shrink:0;padding:6px 8px;border-radius:6px;cursor:pointer;
                          display:flex;flex-direction:column;gap:2px;overflow:hidden;
                          background:${active ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.04)'};
                          border:1px solid ${active ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.08)'};
                          transition:all 0.15s;">
                ${img ? `<img src="${esc(img)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.25;">` : ''}
                <div style="position:relative;display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:9px;color:${active ? C.accent : C.muted};font-weight:700;">${i + 1}</span>
                  <span style="font-size:8px;color:${C.accent2};padding:0 5px;border-radius:6px;background:rgba(167,139,250,0.15);">${label}</span>
                </div>
                <div style="position:relative;font-size:10px;color:${C.text};font-weight:600;line-height:1.25;
                            display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                  ${esc(sl.title || '(제목 없음)')}
                </div>
                <div style="position:relative;font-size:8px;color:${C.muted};line-height:1.3;
                            display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                  ${esc(String(sl.bullets[0] || sl.body || '').replace(/[#*`<>]/g, '').slice(0, 60))}
                </div>
              </div>`;
        }).join('') + `
          <button id="sed-add-btn" title="슬라이드 추가"
                  style="width:60px;height:80px;flex-shrink:0;border-radius:6px;border:1px dashed rgba(34,211,238,0.4);
                         background:rgba(34,211,238,0.04);color:${C.accent};font-size:18px;font-weight:700;cursor:pointer;">
            +
          </button>`;
        strip.querySelectorAll('.sed-thumb').forEach((el) => {
            el.addEventListener('click', () => {
                state.active = parseInt(el.dataset.idx, 10);
                refresh();
                // 썸네일 화면 내 스크롤
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            });
        });
        document.getElementById('sed-add-btn')?.addEventListener('click', addSlide);
    }

    function renderEditor() {
        const pane = document.getElementById('sed-editor');
        if (!pane) return;
        const sl = state.slides[state.active];
        if (!sl) { pane.innerHTML = `<div style="color:${C.muted};padding:40px;text-align:center;">슬라이드가 없습니다.</div>`; return; }

        const kindOpts = [
            ['cover', '표지'], ['objectives', '학습 목표'], ['section-divider', '섹션 구분'],
            ['content', '본문'], ['data-table', '표'], ['quiz', '퀴즈'], ['closing', '마무리'],
        ].map(([v, l]) => `<option value="${v}" ${sl.kind === v ? 'selected' : ''}>${l}</option>`).join('');

        const ts = sl.textStyle = sl.textStyle || {};
        const titleScale = ts.titleScale ?? 1;
        const bulletScale = ts.bulletScale ?? 1;
        const fontFamily = ts.fontFamily || 'display';
        const titleWeight = ts.titleWeight || 'bold';

        pane.innerHTML = `
          <!-- 툴바 -->
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;padding:7px;background:rgba(255,255,255,0.03);border:1px solid ${C.border};border-radius:7px;margin-bottom:12px;">
            <button id="sed-move-up" title="위로" style="padding:4px 8px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">↑</button>
            <button id="sed-move-dn" title="아래로" style="padding:4px 8px;font-size:11px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">↓</button>
            <button id="sed-dup" style="padding:4px 10px;font-size:11px;background:transparent;color:${C.accent2};border:1px solid rgba(167,139,250,0.3);border-radius:4px;cursor:pointer;">복제</button>
            <button id="sed-del" style="padding:4px 10px;font-size:11px;background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:4px;cursor:pointer;">삭제</button>
            <div style="flex:1;"></div>
            <select id="sed-kind" style="font-size:11px;padding:3px 7px;background:${C.panel2};color:${C.text};border:1px solid ${C.border};border-radius:4px;outline:none;">${kindOpts}</select>
          </div>

          <!-- 제목 -->
          <label style="display:block;font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:5px;">제목</label>
          <input id="sed-title" type="text" value="${esc(sl.title)}" placeholder="슬라이드 제목"
                 style="width:100%;padding:8px 11px;font-size:14px;font-weight:700;background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:6px;outline:none;margin-bottom:12px;box-sizing:border-box;" />

          <!-- 불릿 -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <label style="font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;">불릿 (${sl.bullets.length})</label>
            <button id="sed-add-bullet" style="padding:2px 8px;font-size:10px;background:rgba(34,211,238,0.1);color:${C.accent};border:1px solid rgba(34,211,238,0.3);border-radius:4px;cursor:pointer;">+ 추가</button>
          </div>
          <div id="sed-bullets" style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px;"></div>

          <!-- 본문 -->
          <label style="display:block;font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:5px;">추가 본문 (마크다운 · HTML)</label>
          <textarea id="sed-body" placeholder="표, 이미지, Mermaid 등"
                    style="width:100%;height:140px;padding:8px 10px;font-size:11px;font-family:Consolas,monospace;background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:6px;outline:none;resize:vertical;line-height:1.5;box-sizing:border-box;">${esc(sl.body)}</textarea>

          <!-- 텍스트 스타일 -->
          <div style="margin-top:14px;padding:12px;background:rgba(167,139,250,0.05);border:1px solid rgba(167,139,250,0.2);border-radius:7px;">
            <label style="display:block;font-size:9px;font-weight:700;color:${C.accent2};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:8px;">텍스트 스타일</label>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
              <span style="font-size:10px;color:${C.muted};">제목 크기</span>
              <span id="sed-ts-title-val" style="font-size:10px;color:${C.accent2};font-weight:700;">${titleScale.toFixed(2)}×</span>
            </div>
            <input id="sed-ts-title" type="range" min="0.7" max="1.6" step="0.05" value="${titleScale}"
                   style="width:100%;accent-color:${C.accent2};margin-bottom:10px;" />

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
              <span style="font-size:10px;color:${C.muted};">본문 크기</span>
              <span id="sed-ts-body-val" style="font-size:10px;color:${C.accent};font-weight:700;">${bulletScale.toFixed(2)}×</span>
            </div>
            <input id="sed-ts-body" type="range" min="0.7" max="1.6" step="0.05" value="${bulletScale}"
                   style="width:100%;accent-color:${C.accent};margin-bottom:10px;" />

            <div style="font-size:10px;color:${C.muted};margin-bottom:4px;">서체</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:10px;">
              ${['display', 'sans', 'serif'].map((v) => {
                const label = { display: '디스플레이', sans: '프리텐다드', serif: '명조' }[v];
                const on = fontFamily === v;
                return `<button class="sed-font-btn" data-v="${v}" style="padding:5px 4px;font-size:10px;border-radius:5px;cursor:pointer;border:1px solid ${on ? 'rgba(167,139,250,0.6)' : C.border};background:${on ? 'rgba(167,139,250,0.15)' : 'transparent'};color:${on ? C.accent2 : C.muted};">${label}</button>`;
              }).join('')}
            </div>

            <div style="font-size:10px;color:${C.muted};margin-bottom:4px;">제목 굵기</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;">
              ${['semibold', 'bold'].map((v) => {
                const label = { semibold: '보통', bold: '굵게' }[v];
                const on = titleWeight === v;
                return `<button class="sed-weight-btn" data-v="${v}" style="padding:5px;font-size:10px;border-radius:5px;cursor:pointer;border:1px solid ${on ? 'rgba(167,139,250,0.6)' : C.border};background:${on ? 'rgba(167,139,250,0.15)' : 'transparent'};color:${on ? C.accent2 : C.muted};">${label}</button>`;
              }).join('')}
            </div>
            <button id="sed-ts-reset" style="width:100%;padding:5px;font-size:10px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:5px;cursor:pointer;">기본값으로 초기화</button>
          </div>

          <!-- 이미지 갤러리 -->
          <div style="margin-top:14px;padding:12px;background:rgba(34,211,238,0.04);border:1px solid rgba(34,211,238,0.18);border-radius:7px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <label style="font-size:9px;font-weight:700;color:${C.accent};letter-spacing:1.2px;text-transform:uppercase;">이미지 갤러리 (${sl.images.length})</label>
              <label style="padding:3px 9px;font-size:10px;background:rgba(34,211,238,0.15);color:${C.accent};border:1px solid rgba(34,211,238,0.4);border-radius:4px;cursor:pointer;">
                + 업로드
                <input id="sed-img-upload" type="file" accept="image/*" multiple style="display:none;" />
              </label>
            </div>
            <div id="sed-images" style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;"></div>
            <div style="font-size:10px;color:${C.muted};margin-bottom:5px;">이미지 배치 (선택된 이미지에 적용)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:4px;">
              ${LAYOUT_PRESETS.map((p) => `<button class="sed-preset-btn" data-id="${p.id}" style="padding:5px 3px;font-size:10px;border-radius:5px;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.text};">${p.label}</button>`).join('')}
            </div>
            <button id="sed-layout-reset" style="width:100%;padding:4px;font-size:10px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:4px;cursor:pointer;">배치 초기화 (기본 레이아웃)</button>
          </div>

          <!-- 도움말 -->
          <div style="margin-top:12px;padding:8px;background:rgba(255,255,255,0.02);border:1px solid ${C.border};border-radius:5px;font-size:9px;color:${C.muted};line-height:1.6;">
            💡 단축키 <kbd style="padding:0 4px;background:${C.panel2};border:1px solid ${C.border};border-radius:3px;">◀</kbd> <kbd style="padding:0 4px;background:${C.panel2};border:1px solid ${C.border};border-radius:3px;">▶</kbd> 이동 ·
            <kbd style="padding:0 4px;background:${C.panel2};border:1px solid ${C.border};border-radius:3px;">ESC</kbd> 닫기
          </div>`;

        renderBullets();
        renderImages();

        document.getElementById('sed-title').addEventListener('input', (e) => { sl.title = e.target.value; markDirty(); schedulePreview(); debounce('thumbs', renderThumbs, 250); });
        document.getElementById('sed-body').addEventListener('input', (e) => { sl.body = e.target.value; markDirty(); schedulePreview(); debounce('thumbs', renderThumbs, 350); });
        document.getElementById('sed-kind').addEventListener('change', (e) => {
            sl.kind = e.target.value;
            if (sl.kind === 'cover' || sl.kind === 'closing') sl.level = 1;
            else if (sl.kind === 'section-divider') sl.level = 2;
            else if (!sl.level || sl.level < 2) sl.level = 3;
            markDirty(); schedulePreview(); renderThumbs(); updateNavInfo();
        });
        document.getElementById('sed-add-bullet').addEventListener('click', () => {
            sl.bullets.push(''); markDirty(); renderBullets(); schedulePreview();
            setTimeout(() => { const inputs = document.querySelectorAll('.sed-bullet-input'); inputs[inputs.length - 1]?.focus(); }, 0);
        });
        document.getElementById('sed-move-up').addEventListener('click', () => moveSlide(-1));
        document.getElementById('sed-move-dn').addEventListener('click', () => moveSlide(1));
        document.getElementById('sed-dup').addEventListener('click', duplicateSlide);
        document.getElementById('sed-del').addEventListener('click', deleteSlide);

        // 텍스트 스타일 바인딩
        document.getElementById('sed-ts-title').addEventListener('input', (e) => {
            ts.titleScale = parseFloat(e.target.value);
            document.getElementById('sed-ts-title-val').textContent = ts.titleScale.toFixed(2) + '×';
            markDirty(); schedulePreview();
        });
        document.getElementById('sed-ts-body').addEventListener('input', (e) => {
            ts.bulletScale = parseFloat(e.target.value);
            document.getElementById('sed-ts-body-val').textContent = ts.bulletScale.toFixed(2) + '×';
            markDirty(); schedulePreview();
        });
        pane.querySelectorAll('.sed-font-btn').forEach((el) => el.addEventListener('click', () => {
            ts.fontFamily = el.dataset.v; markDirty(); schedulePreview(); renderEditor();
        }));
        pane.querySelectorAll('.sed-weight-btn').forEach((el) => el.addEventListener('click', () => {
            ts.titleWeight = el.dataset.v; markDirty(); schedulePreview(); renderEditor();
        }));
        document.getElementById('sed-ts-reset').addEventListener('click', () => {
            sl.textStyle = {}; markDirty(); schedulePreview(); renderEditor();
        });

        // 이미지 업로드
        document.getElementById('sed-img-upload').addEventListener('change', handleImageUpload);

        // 레이아웃 프리셋
        pane.querySelectorAll('.sed-preset-btn').forEach((el) => el.addEventListener('click', () => applyLayoutPreset(el.dataset.id)));
        document.getElementById('sed-layout-reset').addEventListener('click', () => {
            sl.imageLayouts = []; markDirty(); schedulePreview();
        });
    }

    function renderBullets() {
        const wrap = document.getElementById('sed-bullets');
        const sl = state.slides[state.active];
        if (!wrap || !sl) return;
        if (!sl.bullets || sl.bullets.length === 0) {
            wrap.innerHTML = `<div style="font-size:11px;color:${C.muted};padding:6px 2px;">불릿 없음</div>`;
            return;
        }
        wrap.innerHTML = sl.bullets.map((b, i) => `
          <div style="display:flex;gap:3px;align-items:center;">
            <span style="width:18px;height:18px;border-radius:50%;background:rgba(34,211,238,0.15);color:${C.accent};font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</span>
            <input type="text" value="${esc(b)}" data-bidx="${i}" class="sed-bullet-input"
                   style="flex:1;padding:5px 8px;font-size:11px;background:${C.panel};color:${C.text};border:1px solid ${C.border};border-radius:4px;outline:none;" />
            <button data-bidx="${i}" class="sed-bullet-del"
                    style="padding:2px 6px;font-size:10px;background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.25);border-radius:3px;cursor:pointer;">✕</button>
          </div>`).join('');
        wrap.querySelectorAll('.sed-bullet-input').forEach((el) => el.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.bidx, 10);
            sl.bullets[idx] = e.target.value;
            markDirty(); schedulePreview(); debounce('thumbs', renderThumbs, 250);
        }));
        wrap.querySelectorAll('.sed-bullet-del').forEach((el) => el.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.bidx, 10);
            sl.bullets.splice(idx, 1); markDirty(); renderBullets(); schedulePreview(); renderThumbs();
        }));
    }

    function renderImages() {
        const wrap = document.getElementById('sed-images');
        const sl = state.slides[state.active];
        if (!wrap || !sl) return;
        if (!sl.images || sl.images.length === 0) {
            wrap.innerHTML = `<div style="font-size:10px;color:${C.muted};padding:8px;text-align:center;border:1px dashed ${C.border};border-radius:5px;">이미지 없음 — 업로드로 추가</div>`;
            return;
        }
        wrap.innerHTML = sl.images.map((src, i) => {
            const resolved = resolveImageUrl(src);
            const primary = i === 0;
            const hasLayout = sl.imageLayouts && sl.imageLayouts[i];
            return `
              <div style="display:flex;gap:5px;align-items:center;padding:4px;background:rgba(0,0,0,0.2);border:1px solid ${primary ? 'rgba(34,211,238,0.4)' : C.border};border-radius:5px;">
                <img src="${esc(resolved)}" style="width:50px;height:30px;object-fit:cover;border-radius:3px;flex-shrink:0;" />
                <div style="flex:1;min-width:0;">
                  <div style="font-size:9px;font-weight:700;color:${primary ? C.accent : C.muted};">${primary ? '대표' : '추가 #' + i}${hasLayout ? ' · 커스텀 배치' : ''}</div>
                  <div style="font-size:8px;color:${C.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(String(src).slice(0, 40))}</div>
                </div>
                <button data-iidx="${i}" class="sed-img-up" style="padding:2px 5px;font-size:10px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:3px;cursor:pointer;${i === 0 ? 'opacity:0.3;cursor:not-allowed;' : ''}">↑</button>
                <button data-iidx="${i}" class="sed-img-dn" style="padding:2px 5px;font-size:10px;background:transparent;color:${C.muted};border:1px solid ${C.border};border-radius:3px;cursor:pointer;${i >= sl.images.length - 1 ? 'opacity:0.3;cursor:not-allowed;' : ''}">↓</button>
                <button data-iidx="${i}" class="sed-img-sel" style="padding:2px 7px;font-size:10px;background:${C.imgSelIdx === i ? 'rgba(167,139,250,0.2)' : 'transparent'};color:${C.accent2};border:1px solid rgba(167,139,250,0.3);border-radius:3px;cursor:pointer;">선택</button>
                <button data-iidx="${i}" class="sed-img-del" style="padding:2px 5px;font-size:10px;background:transparent;color:#f87171;border:1px solid rgba(248,113,113,0.25);border-radius:3px;cursor:pointer;">✕</button>
              </div>`;
        }).join('');
        wrap.querySelectorAll('.sed-img-up').forEach((el) => el.addEventListener('click', () => moveImage(parseInt(el.dataset.iidx, 10), -1)));
        wrap.querySelectorAll('.sed-img-dn').forEach((el) => el.addEventListener('click', () => moveImage(parseInt(el.dataset.iidx, 10), 1)));
        wrap.querySelectorAll('.sed-img-del').forEach((el) => el.addEventListener('click', () => removeImage(parseInt(el.dataset.iidx, 10))));
        wrap.querySelectorAll('.sed-img-sel').forEach((el) => el.addEventListener('click', () => {
            state.imgSelIdx = parseInt(el.dataset.iidx, 10);
            renderImages();
        }));
    }

    function updatePreview() {
        const iframe = document.getElementById('sed-preview');
        const sl = state.slides[state.active];
        if (!iframe || !sl) return;
        iframe.srcdoc = buildSingleSlideHTML(sl);
    }

    function updateNavInfo() {
        const el = document.getElementById('sed-nav-info');
        const sl = state.slides[state.active];
        if (el && sl) el.textContent = `${state.active + 1} / ${state.slides.length}`;
        const badge = document.getElementById('sed-kind-badge');
        if (badge && sl) badge.textContent = KIND_LABEL[sl.kind] || '본문';
        const cnt = document.getElementById('sed-count');
        if (cnt) cnt.textContent = `${state.slides.length}장`;
    }

    function refresh() {
        renderThumbs();
        renderEditor();
        updatePreview();
        updateNavInfo();
    }

    function navigate(delta) {
        const next = state.active + delta;
        if (next < 0 || next >= state.slides.length) return;
        state.active = next;
        refresh();
    }

    // ────────────────────────────────────────────────────────────
    // 조작
    // ────────────────────────────────────────────────────────────
    function markDirty() {
        state.dirty = true;
        const b = document.getElementById('sed-dirty');
        if (b) b.style.display = 'inline-block';
    }
    function clearDirty() {
        state.dirty = false;
        const b = document.getElementById('sed-dirty');
        if (b) b.style.display = 'none';
    }

    function addSlide() {
        state.slides.splice(state.active + 1, 0, {
            id: genId(), kind: 'content', level: 3,
            title: '새 슬라이드', bullets: [], body: '',
            images: [], imageLayouts: [], textStyle: {}, notes: '',
        });
        state.active += 1; markDirty(); refresh();
    }
    function duplicateSlide() {
        const cur = state.slides[state.active]; if (!cur) return;
        const copy = JSON.parse(JSON.stringify(cur));
        copy.id = genId(); copy.title = (cur.title || '슬라이드') + ' (복사)';
        state.slides.splice(state.active + 1, 0, copy);
        state.active += 1; markDirty(); refresh();
    }
    function deleteSlide() {
        if (state.slides.length <= 1) { if (window.showAlert) window.showAlert('최소 한 장이 필요합니다.'); return; }
        if (!confirm('이 슬라이드를 삭제하시겠습니까?')) return;
        state.slides.splice(state.active, 1);
        state.active = Math.min(state.active, state.slides.length - 1);
        markDirty(); refresh();
    }
    function moveSlide(dir) {
        const i = state.active; const j = i + dir;
        if (j < 0 || j >= state.slides.length) return;
        const t = state.slides[i]; state.slides[i] = state.slides[j]; state.slides[j] = t;
        state.active = j; markDirty(); refresh();
    }

    function moveImage(i, dir) {
        const sl = state.slides[state.active]; if (!sl) return;
        const j = i + dir;
        if (j < 0 || j >= sl.images.length) return;
        [sl.images[i], sl.images[j]] = [sl.images[j], sl.images[i]];
        if (!sl.imageLayouts) sl.imageLayouts = [];
        while (sl.imageLayouts.length < sl.images.length) sl.imageLayouts.push(null);
        [sl.imageLayouts[i], sl.imageLayouts[j]] = [sl.imageLayouts[j], sl.imageLayouts[i]];
        markDirty(); renderImages(); schedulePreview(); debounce('thumbs', renderThumbs, 200);
    }
    function removeImage(i) {
        const sl = state.slides[state.active]; if (!sl) return;
        sl.images.splice(i, 1);
        if (sl.imageLayouts) sl.imageLayouts.splice(i, 1);
        if (state.imgSelIdx === i) state.imgSelIdx = null;
        markDirty(); renderImages(); schedulePreview(); renderThumbs();
    }

    async function handleImageUpload(e) {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        const sl = state.slides[state.active]; if (!sl) return;
        for (const f of files) {
            if (!f.type.startsWith('image/')) continue;
            if (f.size > 8 * 1024 * 1024) { if (window.showAlert) window.showAlert(`${f.name}: 8MB 초과`); continue; }
            const dataUrl = await new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(String(r.result || ''));
                r.onerror = () => rej(new Error('읽기 실패'));
                r.readAsDataURL(f);
            });
            sl.images.push(dataUrl);
            if (!sl.imageLayouts) sl.imageLayouts = [];
            sl.imageLayouts.push(null);
        }
        e.target.value = '';
        markDirty(); renderImages(); schedulePreview(); renderThumbs();
        if (window.showToast) window.showToast(`이미지 ${files.length}장 추가`, 'success');
    }

    function applyLayoutPreset(presetId) {
        const sl = state.slides[state.active]; if (!sl) return;
        const idx = state.imgSelIdx ?? 0;
        if (idx >= sl.images.length) { if (window.showAlert) window.showAlert('먼저 이미지를 업로드하세요.'); return; }
        const preset = LAYOUT_PRESETS.find((p) => p.id === presetId); if (!preset) return;
        if (!sl.imageLayouts) sl.imageLayouts = [];
        while (sl.imageLayouts.length <= idx) sl.imageLayouts.push(null);
        sl.imageLayouts[idx] = clampLayout(preset.layout);
        markDirty(); renderImages(); schedulePreview();
    }

    const _timers = {};
    function debounce(key, fn, ms) {
        if (_timers[key]) clearTimeout(_timers[key]);
        _timers[key] = setTimeout(() => { fn(); delete _timers[key]; }, ms || 150);
    }
    function schedulePreview() { debounce('preview', updatePreview, 250); }

    // ────────────────────────────────────────────────────────────
    // 내보내기
    // ────────────────────────────────────────────────────────────
    function downloadHTML() {
        const html = buildFullDeckHTML(); if (!html) return;
        const safe = (state.title || 'slide').replace(/[^\w가-힣]/g, '_');
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = safe + '_슬라이드.html'; a.click();
        URL.revokeObjectURL(a.href);
        if (window.showToast) window.showToast('📥 HTML 다운로드', 'success');
    }

    // ────────────────────────────────────────────────────────────
    // 전용 PPTX 엔진 — 구조화된 슬라이드 데이터 → PPTX
    // 학생뷰(title/bullets/body)만 슬라이드에 렌더, 강사뷰(notes)는 speaker notes로
    // ────────────────────────────────────────────────────────────
    function pptxFontFace(textStyle) {
        if (!textStyle) return 'Malgun Gothic';
        if (textStyle.fontFamily === 'serif') return 'Noto Serif KR';
        return 'Malgun Gothic';
    }

    function cleanForPptx(text) {
        return String(text || '')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(ICON_RE, '')
            .replace(/[■▣●]/g, '')
            .trim();
    }

    function renderCoverSlide(pptx, s, sl, T) {
        s.background = { color: T.bg };
        const ts = sl.textStyle || {};
        const titleScale = ts.titleScale ?? 1;
        const bulletScale = ts.bulletScale ?? 1;
        const fontFace = pptxFontFace(ts);
        const bold = ts.titleWeight !== 'semibold';

        // 중앙 배치 타이틀 (section-slide 느낌)
        s.addText(cleanForPptx(sl.title), {
            x: 0.5, y: 2.4, w: 12.33, h: 1.8,
            fontSize: Math.round(48 * titleScale), fontFace, color: T.h,
            bold, align: 'center', valign: 'middle',
        });
        // 서브타이틀 (첫 불릿 or 본문 50자)
        const sub = (sl.bullets && sl.bullets[0]) || (sl.body || '').slice(0, 80);
        if (sub) {
            s.addText(cleanForPptx(sub), {
                x: 0.5, y: 4.3, w: 12.33, h: 0.8,
                fontSize: Math.round(20 * bulletScale), fontFace, color: T.sub, align: 'center',
            });
        }
        // 장식 바
        s.addShape(pptx.ShapeType.rect, { x: 5.55, y: 5.3, w: 2.2, h: 0.04, fill: { color: T.accent } });
    }

    function renderSectionDividerSlide(pptx, s, sl, T) {
        s.background = { color: T.bg };
        const ts = sl.textStyle || {};
        const titleScale = ts.titleScale ?? 1;
        const fontFace = pptxFontFace(ts);
        s.addShape(pptx.ShapeType.rect, { x: 5.6, y: 2.6, w: 2.1, h: 0.04, fill: { color: T.accent } });
        s.addText(cleanForPptx(sl.title), {
            x: 0.5, y: 2.9, w: 12.33, h: 1.4,
            fontSize: Math.round(36 * titleScale), fontFace, color: T.h,
            bold: true, align: 'center',
        });
    }

    function renderContentSlide(pptx, s, sl, T) {
        s.background = { color: T.bg };
        const ts = sl.textStyle || {};
        const titleScale = ts.titleScale ?? 1;
        const bulletScale = ts.bulletScale ?? 1;
        const fontFace = pptxFontFace(ts);
        const bold = ts.titleWeight !== 'semibold';

        // 타이틀
        const titleText = cleanForPptx(sl.title) || '';
        s.addText(titleText.length > 80 ? titleText.slice(0, 77) + '...' : titleText, {
            x: 0.6, y: 0.3, w: 12.13, h: 0.85,
            fontSize: Math.round(26 * titleScale), fontFace, color: T.accent, bold,
        });
        // 구분선
        s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.2, w: 12.13, h: 0.02, fill: { color: T.border } });

        // 이미지 배치
        const hasImg = sl.images && sl.images.length > 0;
        let contentW = 12.13;
        let contentX = 0.6;
        if (hasImg) {
            const src = resolveImageUrl(sl.images[0]);
            const layout = (sl.imageLayouts && sl.imageLayouts[0]) || { x: 0.56, y: 0.18, w: 0.4, h: 0.72 };
            const ix = layout.x * 13.33;
            const iy = layout.y * 7.5;
            const iw = layout.w * 13.33;
            const ih = layout.h * 7.5;
            try { s.addImage({ data: src, x: ix, y: iy, w: iw, h: ih, sizing: { type: 'contain', w: iw, h: ih } }); }
            catch (e) { /* 상대 경로 이미지 등 — 무시 */ }
            // 텍스트 영역은 이미지 반대편
            if (layout.x < 0.5) {
                contentX = (layout.x + layout.w) * 13.33 + 0.3;
                contentW = 13.33 - contentX - 0.5;
            } else {
                contentW = layout.x * 13.33 - 0.6 - 0.3;
            }
            if (contentW < 4) contentW = 4; // 최소폭 보장
        }

        // 불릿 + 본문 → 단일 텍스트 블록으로 구성
        const parts = [];
        (sl.bullets || []).forEach((b) => {
            const cleaned = cleanForPptx(b);
            if (!cleaned) return;
            parts.push({
                text: cleaned,
                options: {
                    fontSize: Math.round(16 * bulletScale), fontFace, color: T.txt,
                    bullet: { color: T.accent }, breakLine: true, paraSpaceAfter: 6,
                },
            });
        });
        // body 요약 (2줄 이내)
        if (sl.body && sl.body.trim()) {
            const bodySummary = cleanForPptx(sl.body).split(/\n+/).filter(Boolean).slice(0, 3).join(' ').slice(0, 300);
            if (bodySummary) {
                parts.push({
                    text: bodySummary,
                    options: { fontSize: Math.round(14 * bulletScale), fontFace, color: T.muted, breakLine: true, paraSpaceBefore: 8 },
                });
            }
        }
        if (parts.length > 0) {
            s.addText(parts, {
                x: contentX, y: 1.45, w: contentW, h: 5.7, valign: 'top',
                shrinkText: true, paraSpaceBefore: 4,
            });
        }
    }

    function renderDataTableSlide(pptx, s, sl, T) {
        s.background = { color: T.bg };
        const ts = sl.textStyle || {};
        const titleScale = ts.titleScale ?? 1;
        const fontFace = pptxFontFace(ts);
        s.addText(cleanForPptx(sl.title), {
            x: 0.6, y: 0.3, w: 12.13, h: 0.85,
            fontSize: Math.round(26 * titleScale), fontFace, color: T.accent, bold: true,
        });
        s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.2, w: 12.13, h: 0.02, fill: { color: T.border } });
        // 간단 변환: body의 마크다운 표를 행렬로 파싱
        const rows = [];
        const bodyLines = (sl.body || '').split('\n');
        for (const line of bodyLines) {
            if (!line.trim().startsWith('|')) continue;
            if (/^\s*\|\s*[:\-\s|]+\|\s*$/.test(line)) continue;
            const cells = line.split('|').map((c) => c.trim()).filter((c, i, arr) => !(c === '' && (i === 0 || i === arr.length - 1)));
            if (cells.length) rows.push(cells.map(cleanForPptx));
        }
        if (rows.length >= 2) {
            const header = rows[0];
            const data = rows.slice(1, 9);
            const colW = header.map(() => 12 / header.length);
            const tblRows = [
                header.map((h) => ({ text: h, options: { fontSize: 14, fontFace, color: T.accent, bold: true, fill: { color: T.card }, border: { pt: 1, color: T.border } } })),
                ...data.map((row) => row.map((cell) => ({ text: cell, options: { fontSize: 13, fontFace, color: T.h, fill: { color: T.bg }, border: { pt: 1, color: T.border } } }))),
            ];
            s.addTable(tblRows, { x: 0.6, y: 1.45, w: 12.13, colW, rowH: 0.5 });
        } else {
            // 표 아니면 content로 폴백
            renderContentSlide(pptx, s, sl, T);
        }
    }

    function renderQuizSlide(pptx, s, sl, T) {
        s.background = { color: T.bg };
        const ts = sl.textStyle || {};
        const titleScale = ts.titleScale ?? 1;
        const bulletScale = ts.bulletScale ?? 1;
        const fontFace = pptxFontFace(ts);
        s.addText(cleanForPptx(sl.title), {
            x: 0.6, y: 0.3, w: 12.13, h: 0.85,
            fontSize: Math.round(24 * titleScale), fontFace, color: T.accent, bold: true,
        });
        s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.2, w: 12.13, h: 0.02, fill: { color: T.border } });
        // 본문에서 보기 추출 (①②③④⑤)
        const body = (sl.body || '').replace(/<[^>]+>/g, '');
        const prompt = body.split(/[①②③④⑤]/)[0].trim();
        const choices = body.match(/[①②③④⑤][^①②③④⑤]+/g) || [];
        if (prompt) {
            s.addText(cleanForPptx(prompt), {
                x: 0.6, y: 1.45, w: 12.13, h: 2.3,
                fontSize: Math.round(18 * bulletScale), fontFace, color: T.h, valign: 'top', shrinkText: true,
            });
        }
        if (choices.length) {
            const bullets = choices.map((c) => ({
                text: cleanForPptx(c),
                options: { fontSize: Math.round(16 * bulletScale), fontFace, color: T.txt, breakLine: true, paraSpaceAfter: 6 },
            }));
            s.addText(bullets, { x: 0.8, y: 3.8, w: 11.7, h: 3.5, valign: 'top' });
        }
    }

    async function exportDeckAsPptx() {
        if (typeof PptxGenJS === 'undefined') {
            if (window.showAlert) window.showAlert('PptxGenJS 라이브러리를 불러오는 중입니다.');
            return;
        }
        try {
            const pptx = new PptxGenJS();
            pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
            pptx.layout = 'WIDE';
            pptx.title = state.title || '슬라이드';
            pptx.author = '디벨로켓 교안 도우미';

            const T = {
                bg: '0F172A', accent: '22d3ee', sub: 'a78bfa',
                h: 'f1f5f9', txt: 'd1d5db', muted: '94a3b8',
                border: '334155', card: '1e293b',
            };

            for (const sl of state.slides) {
                const s = pptx.addSlide();
                try {
                    if (sl.kind === 'cover' || sl.kind === 'closing') {
                        renderCoverSlide(pptx, s, sl, T);
                    } else if (sl.kind === 'section-divider') {
                        renderSectionDividerSlide(pptx, s, sl, T);
                    } else if (sl.kind === 'data-table') {
                        renderDataTableSlide(pptx, s, sl, T);
                    } else if (sl.kind === 'quiz') {
                        renderQuizSlide(pptx, s, sl, T);
                    } else {
                        // content, objectives 등
                        renderContentSlide(pptx, s, sl, T);
                    }
                } catch (e) {
                    console.warn('[PPTX] 슬라이드 렌더 실패:', sl.title, e);
                    // 폴백: 최소 타이틀만 표기
                    s.background = { color: T.bg };
                    s.addText(cleanForPptx(sl.title || '슬라이드'), { x: 0.6, y: 3, w: 12.13, h: 1.5, fontSize: 32, color: T.h, align: 'center' });
                }
                // 강사뷰 → speaker notes
                if (sl.notes && sl.notes.trim()) {
                    try {
                        const plain = cleanForPptx(sl.notes).slice(0, 4000);
                        if (plain) s.addNotes(plain);
                    } catch (e) { /* notes 실패는 무시 */ }
                }
            }

            const fname = (state.title || 'slide').replace(/[^\w가-힣]/g, '_') + '_슬라이드.pptx';
            await pptx.writeFile({ fileName: fname });
            if (window.showToast) window.showToast('📊 PPTX 다운로드 완료 (강사 노트 포함)', 'success');
        } catch (e) {
            console.error('[SlideEditor PPTX]', e);
            if (window.showAlert) window.showAlert('PPTX 생성 오류: ' + (e.message || e));
        }
    }

    function downloadPPTX() { exportDeckAsPptx(); }

    function saveToModule() {
        const mod = typeof getEditingModule === 'function' ? getEditingModule(state.moduleId) : null;
        if (!mod) return;
        if (!confirm('편집 내용을 교안에 반영합니다. 계속하시겠습니까?')) return;
        const tabKey = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
        const newMd = deckToMarkdown();
        if (tabKey && mod.tabContents) mod.tabContents[tabKey] = newMd;
        mod.content = newMd;
        // 업로드 이미지 머지
        state.slides.forEach((sl) => (sl.images || []).forEach((url, i) => {
            if (typeof url === 'string' && url.startsWith('data:')) {
                if (!mod.images) mod.images = {};
                const id = `sed_${sl.id}_${i}`;
                mod.images[id] = url;
            }
        }));
        if (typeof window.saveState === 'function') window.saveState();
        clearDirty();
        if (window.showToast) window.showToast('✅ 교안에 저장됨', 'success');
    }

    // ────────────────────────────────────────────────────────────
    // 전체 확대 미리보기
    // ────────────────────────────────────────────────────────────
    function openPreviewFullscreen() {
        const html = buildFullDeckHTML(); if (!html) return;
        document.getElementById('sed-full-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'sed-full-overlay';
        overlay.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;`;
        overlay.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;background:${C.panel};border-bottom:1px solid ${C.border};">
            <span style="color:${C.text};font-size:13px;font-weight:700;flex:1;">🔍 전체 데크 — ${esc(state.title)}</span>
            <button id="sed-full-close" style="padding:6px 14px;font-size:12px;font-weight:700;border:1px solid rgba(248,113,113,0.3);background:transparent;color:#f87171;border-radius:6px;cursor:pointer;">✕ 닫기</button>
          </div>
          <iframe sandbox="allow-scripts" style="flex:1;width:100%;border:none;background:#0F172A;"></iframe>`;
        document.body.appendChild(overlay);
        overlay.querySelector('iframe').srcdoc = html;
        const onEsc = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
        document.addEventListener('keydown', onEsc);
        document.getElementById('sed-full-close').addEventListener('click', () => { overlay.remove(); document.removeEventListener('keydown', onEsc); });
    }

    // ────────────────────────────────────────────────────────────
    // 진입 / 종료
    // ────────────────────────────────────────────────────────────
    function openEditor(moduleId) {
        const mod = typeof getEditingModule === 'function' ? getEditingModule(moduleId) : null;
        if (!mod) { if (window.showAlert) window.showAlert('교안을 먼저 선택해주세요.'); return; }
        const tabKey = typeof currentLessonTab !== 'undefined' ? currentLessonTab : null;
        const content = (tabKey && mod.tabContents ? mod.tabContents[tabKey] : null) || mod.content || '';
        if (!content) { if (window.showAlert) window.showAlert('교안 내용이 없습니다.'); return; }

        // 탭 라벨 (LESSON_TABS에서 조회)
        const tabLabel = (typeof LESSON_TABS !== 'undefined' && tabKey)
            ? (LESSON_TABS.find((t) => t.id === tabKey) || {}).label || ''
            : '';

        state.slides = parseDeck(content, mod.title || '슬라이드', tabLabel);
        if (state.slides.length === 0) {
            state.slides = [{ id: genId(), kind: 'cover', level: 1, title: mod.title || '새 슬라이드', bullets: [], body: '', images: [], imageLayouts: [], textStyle: {}, notes: '' }];
        }
        state.active = 0;
        state.moduleId = moduleId;
        state.title = mod.title || '슬라이드';
        state.images = mod.images || {};
        state.imgSelIdx = null;
        state.dirty = false;

        renderShell();
        refresh();
    }

    function closeEditor() {
        if (state.dirty && !confirm('편집된 내용이 저장되지 않았습니다. 닫으시겠습니까?')) return;
        const root = document.getElementById('slide-editor-root');
        if (root) {
            if (root._escHandler) document.removeEventListener('keydown', root._escHandler);
            root.remove();
        }
        document.getElementById('sed-full-overlay')?.remove();
    }

    window.openSlideEditor = openEditor;
    window.closeSlideEditor = closeEditor;
})();
