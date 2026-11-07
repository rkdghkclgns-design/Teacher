// 테스트 도우미: data.js의 갈래 정의(LESSON_TRACKS와 그 도움 함수 lessonTrack·tabTrack·isQuestionBankTab·gyosuanOf·trackHasContent)만 꺼내 vm 문맥에 싣는다.
// data.js 전체를 싣지 않는 테스트가 쓴다. tabs: true면 실제 탭 목록(LESSON_TABS)도 함께 싣는다(문맥에 탭 목록이 없을 때)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DATA = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8').replace(/\r\n/g, '\n');
const slice = (start, end) => {
    const from = DATA.indexOf(start);
    const to = DATA.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error(`data.js에서 ${start}를 찾지 못했습니다`);
    return DATA.slice(from, to);
};
const TABS_SRC = slice('const LESSON_TABS = [', '\n// 2-4.');
const TRACKS_SRC = slice('// 2-4.', '\n// 3. 모의 데이터');

function loadLessonTracks(ctx, { tabs = false } = {}) {
    vm.runInContext(`${tabs ? TABS_SRC : ''}\n${TRACKS_SRC}`, ctx);
    return ctx;
}

module.exports = { loadLessonTracks, TRACKS_SRC, TABS_SRC };
