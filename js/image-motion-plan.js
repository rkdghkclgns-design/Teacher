// image-motion-plan.js - 그림을 '움직이는 GIF'로 바꾸는 계산(화면 없이 돈다, tests/image-motion.test.js)
// AI에 보낼 요청 글, AI 답 검사(sanitizeMotionPlan), 묶음 모양 알아보기, 한 바퀴 동안 무엇이 어디로 움직이는지(planMotionTimeline),
// 연결선의 시작·끝 자리와 한 장면의 그릴 거리(motionScene). 그리기·창·바꾸기·되돌리기는 image-motion.js

const MOTION_PATTERNS = ['hub', 'mesh', 'chain', 'cycle', 'tree', 'pairs'];
const MOTION_PATTERN_LABELS = { auto: '자동', hub: '중심과 주변', mesh: '서로 연결', chain: '차례 흐름', cycle: '순환', tree: '나무 구조', pairs: '짝 주고받기' };
const MOTION_DIRS = ['both', 'forward', 'none'];
const MOTION_LIMITS = { groups: 4, nodes: 24, edges: 64, title: 40, name: 30, story: 80, id: 12, label: 20, instruction: 300, scan: 400 };
const MOTION_BOX_MIN = 8; // 상자의 가장 작은 폭·높이(0~1000 비율)
const MOTION_DENSE = 0.6; // 이을 수 있는 쌍의 이만큼이 이어져 있으면 '서로 연결'
const MOTION_TIMES = { travel: 0.16, mesh: 0.2, pair: 0.34, pulse: 0.12 }; // 한 바퀴를 1로 본 시간: 한 번 건너가기(중심과 주변·서로 연결·짝), 빛나는 테두리
const MOTION_SYSTEM = '교육용 그림에서 요소와 연결을 읽어 지정한 JSON 하나만 출력합니다.';
// 그림이 밝으면 짙은 색, 어두우면 옅은 색. 점에는 흰 테두리와 그림자를 둘러 어느 쪽에서도 보이게 한다
const MOTION_COLORS = {
    light: { request: '#e11d48', response: '#059669', flow: '#7c3aed', halo: 'rgba(15,23,42,0.32)', outline: '#ffffff' },
    dark: { request: '#fb7185', response: '#34d399', flow: '#c4b5fd', halo: 'rgba(255,255,255,0.4)', outline: '#ffffff' }
};

const isMotionObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const motionOwn = (map, key) => isMotionObject(map) && Object.prototype.hasOwnProperty.call(map, key);

/* ---------- AI에 보낼 요청 ---------- */
// 강사가 쓴 요청은 움직임을 정할 때 참고만 하게 붙인다(그림에 없는 요소·연결은 넣지 않게)
function buildMotionPrompt(instruction = '') {
    const ask = motionText(instruction, MOTION_LIMITS.instruction);
    return [
        '첨부한 그림은 교안에 들어가는 그림입니다. 그림 속 요소(컴퓨터·서버·사람·상자 등)가 선이나 화살표로 어떻게 이어져 있는지 읽어, 그 관계가 보이게 움직이는 GIF를 만드는 데 씁니다.',
        '',
        '[지킬 것]',
        '- 그림에 실제로 그려진 요소와, 실제로 그려진 선·화살표로 이어진 연결만 적습니다. 그려지지 않은 요소나 연결을 지어내지 않습니다.',
        '- 장식(점·작은 아이콘·글자만 있는 꾸밈)과 어디에도 이어지지 않은 요소는 넣지 않습니다.',
        '- box는 그 요소의 그림을 꼭 맞게 감싸는 상자 [ymin, xmin, ymax, xmax]입니다. 그림 전체를 0~1000으로 본 정수이고 왼쪽 위가 0, 0입니다.',
        '- 따로 떨어진 그림(예: 왼쪽 서버 모델, 오른쪽 P2P 구조)은 groups를 나눕니다. groups는 4개, 묶음마다 nodes는 24개, edges는 64개까지입니다.',
        '- pattern: hub(한 요소가 가운데서 여러 요소와 이어짐), mesh(여러 요소가 가운데 없이 서로 이어짐), chain(차례로 이어짐), cycle(차례로 이어져 처음으로 돌아옴), tree(위에서 아래로 갈라짐), pairs(둘씩 주고받음).',
        '- center: hub의 가운데 요소나 tree의 맨 위 요소의 id. 없으면 "".',
        '- dir: both(양쪽 화살표나 주고받음), forward(from에서 to로 가는 한쪽 화살표), none(화살표 없는 선).',
        '- id는 영문·숫자 12자 이내로 겹치지 않게 쓰고, title·name·story·label은 한국어로 짧게 씁니다.',
        ask ? `\n[강사의 요청: 움직임을 정할 때 참고하되, 그림에 없는 요소나 연결은 넣지 않습니다]\n${ask}` : '',
        '',
        '[출력] 아래 모양의 JSON 하나만 출력합니다(설명·코드펜스 없이).',
        '{"title":"그림 제목(40자 이내)","groups":[{"name":"묶음 이름(30자 이내)","pattern":"hub","center":"srv","story":"무엇이 어떻게 오가는지(80자 이내)","nodes":[{"id":"srv","label":"서버","box":[366,205,634,296]},{"id":"c1","label":"클라이언트 1","box":[95,212,217,298]}],"edges":[{"from":"c1","to":"srv","dir":"both","label":"요청·응답"}]}]}'
    ].join('\n');
}

/* ---------- AI 답 검사 ---------- */
// AI가 준 글: 글자·숫자 값만 받아 제어 문자와 꺾쇠를 빼고 빈칸을 하나로 줄인 뒤 자른다(화면에는 escapeHtml을 거쳐 넣는다)
function motionText(value, max) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// 요소 id: 글자·숫자·_·- 만, 12자까지
function motionId(value) {
    return motionText(value, 60).replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, MOTION_LIMITS.id);
}

// 한 쪽(위아래나 좌우)의 두 끝. 너무 좁으면 가운데를 두고 늘린다(0~1000 안에서)
function motionSpan(low, high) {
    if (high - low >= MOTION_BOX_MIN) return [low, high];
    const start = Math.max(0, Math.min(1000 - MOTION_BOX_MIN, Math.round((low + high) / 2 - MOTION_BOX_MIN / 2)));
    return [start, start + MOTION_BOX_MIN];
}

// [ymin, xmin, ymax, xmax](0~1000). 숫자 넷이 아니면 null. 범위 밖은 자르고 뒤바뀐 쪽은 바로잡는다
function motionBox(value) {
    if (!Array.isArray(value) || value.length !== 4) return null;
    const numbers = value.map(item => (typeof item === 'number' || (typeof item === 'string' && item.trim() !== '') ? Number(item) : NaN));
    if (numbers.some(item => !Number.isFinite(item))) return null;
    const [top, left, bottom, right] = numbers.map(item => Math.min(1000, Math.max(0, Math.round(item))));
    const [y1, y2] = motionSpan(Math.min(top, bottom), Math.max(top, bottom));
    const [x1, x2] = motionSpan(Math.min(left, right), Math.max(left, right));
    return [y1, x1, y2, x2];
}

// 같은 두 요소를 잇는 연결 둘을 하나로: 어느 한쪽이 양쪽이면 양쪽, 서로 반대인 한쪽 화살표 둘도 양쪽, 화살표 없는 선과 한쪽 화살표는 한쪽 화살표
function mergeMotionEdges(known, next) {
    const label = known.label || next.label;
    if (known.dir === 'both' || next.dir === 'both') return { ...known, dir: 'both', label };
    if (known.dir === 'forward' && next.dir === 'forward') return { ...known, dir: next.from === known.from ? 'forward' : 'both', label };
    if (known.dir === 'forward') return { ...known, label };
    if (next.dir === 'forward') return { ...next, label };
    return { ...known, label };
}

// 연결의 방향: both·forward·none. backward·reverse는 from과 to를 바꿔 forward로, 모르는 값은 both
function motionEdgeOf(item) {
    let from = motionId(item.from);
    let to = motionId(item.to);
    let dir = typeof item.dir === 'string' ? item.dir.trim().toLowerCase() : '';
    if (dir === 'backward' || dir === 'reverse') {
        [from, to] = [to, from];
        dir = 'forward';
    }
    return { from, to, dir: MOTION_DIRS.includes(dir) ? dir : 'both', label: motionText(item.label, MOTION_LIMITS.label) };
}

function motionNodesOf(list) {
    const nodes = [];
    const ids = new Set();
    for (const item of (Array.isArray(list) ? list : []).slice(0, MOTION_LIMITS.scan)) {
        if (nodes.length >= MOTION_LIMITS.nodes) break;
        if (!isMotionObject(item)) continue;
        const id = motionId(item.id);
        const box = motionBox(item.box);
        if (!id || ids.has(id) || !box) continue;
        ids.add(id);
        nodes.push({ id, label: motionText(item.label, MOTION_LIMITS.label), box });
    }
    return nodes;
}

// 아는 요소 둘을 잇는 연결만(제 자신으로 가는 선은 뺀다). 같은 두 요소의 연결은 하나로 합친다. 64개까지
function motionEdgesOf(list, ids) {
    const edges = [];
    const byPair = new Map();
    for (const item of (Array.isArray(list) ? list : []).slice(0, MOTION_LIMITS.scan)) {
        if (!isMotionObject(item)) continue;
        const edge = motionEdgeOf(item);
        if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue;
        const pair = edge.from < edge.to ? `${edge.from} ${edge.to}` : `${edge.to} ${edge.from}`;
        if (byPair.has(pair)) {
            const at = byPair.get(pair);
            edges[at] = mergeMotionEdges(edges[at], edge);
        } else if (edges.length < MOTION_LIMITS.edges) {
            byPair.set(pair, edges.length);
            edges.push(edge);
        }
    }
    return edges;
}

// 요소마다 이어진 연결 수
function motionDegrees(nodes, edges) {
    const degree = new Map(nodes.map(node => [node.id, 0]));
    edges.forEach(edge => {
        degree.set(edge.from, degree.get(edge.from) + 1);
        degree.set(edge.to, degree.get(edge.to) + 1);
    });
    return degree;
}

// 가장 많이 이어진 요소(같으면 위쪽, 그다음 왼쪽)
function motionBusiest(nodes, degree) {
    return [...nodes].sort((a, b) => degree.get(b.id) - degree.get(a.id) || a.box[0] - b.box[0] || a.box[1] - b.box[1])[0];
}

// 맨 위 요소(나무는 위에서 아래로 그린다. 같은 높이면 더 많이 이어진 요소, 그다음 왼쪽)
function motionTopmost(nodes, degree) {
    return [...nodes].sort((a, b) => a.box[0] - b.box[0] || degree.get(b.id) - degree.get(a.id) || a.box[1] - b.box[1])[0];
}

function motionConnected(nodes, edges) {
    if (!nodes.length) return false;
    const seen = new Set([nodes[0].id]);
    const stack = [nodes[0].id];
    while (stack.length) {
        const id = stack.pop();
        edges.forEach(edge => {
            const other = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
            if (other && !seen.has(other)) {
                seen.add(other);
                stack.push(other);
            }
        });
    }
    return seen.size === nodes.length;
}

// 묶음의 모양으로 무늬를 고른다: 두 요소뿐이면 짝 주고받기, 한 줄이면 차례 흐름(닫히면 순환), 빽빽하면 서로 연결,
// 한 요소가 나머지 모두와 이어지면 중심과 주변, 갈래 없이 갈라지면 나무 구조, 그 밖은 짝 주고받기. center는 중심과 주변·나무 구조의 가운데(그 밖은 '')
function motionShape(nodes, edges) {
    const n = nodes.length;
    const m = edges.length;
    const degree = motionDegrees(nodes, edges);
    const top = motionBusiest(nodes, degree);
    if (n <= 2) return { pattern: 'pairs', center: '' };
    const connected = motionConnected(nodes, edges);
    if (connected && Math.max(...degree.values()) <= 2) return { pattern: m === n ? 'cycle' : 'chain', center: '' };
    if (n >= 4 && m >= MOTION_DENSE * n * (n - 1) / 2) return { pattern: 'mesh', center: '' };
    if (n >= 4 && degree.get(top.id) === n - 1) return { pattern: 'hub', center: top.id };
    if (connected && m === n - 1) return { pattern: 'tree', center: motionTopmost(nodes, degree).id };
    return { pattern: 'pairs', center: '' };
}

// 묶음 하나. 이어진 요소가 둘 이상이고 연결이 하나 이상이어야 쓴다(아니면 null). 어디에도 이어지지 않은 요소는 뺀다
function motionGroupOf(raw, index) {
    if (!isMotionObject(raw)) return null;
    const listed = motionNodesOf(raw.nodes);
    const edges = motionEdgesOf(raw.edges, new Set(listed.map(node => node.id)));
    const linked = new Set(edges.flatMap(edge => [edge.from, edge.to]));
    const nodes = listed.filter(node => linked.has(node.id));
    if (nodes.length < 2 || !edges.length) return null;
    const shape = motionShape(nodes, edges);
    const given = typeof raw.pattern === 'string' ? raw.pattern.trim().toLowerCase() : '';
    const pattern = MOTION_PATTERNS.includes(given) ? given : shape.pattern;
    const center = motionId(raw.center);
    const named = nodes.some(node => node.id === center) ? center : '';
    const degree = motionDegrees(nodes, edges);
    const inferred = pattern === 'hub' ? motionBusiest(nodes, degree).id : pattern === 'tree' ? motionTopmost(nodes, degree).id : '';
    return {
        name: motionText(raw.name, MOTION_LIMITS.name) || `묶음 ${index + 1}`,
        pattern,
        center: named || inferred,
        story: motionText(raw.story, MOTION_LIMITS.story),
        nodes,
        edges
    };
}

// AI 답 → 그릴 계획 { title, groups: [{ name, pattern, center, story, nodes: [{ id, label, box }], edges: [{ from, to, dir, label }] }] }.
// 묶음 배열만 주거나 묶음 하나(nodes·edges)만 줘도 받는다. 쓸 수 있는 묶음(이어진 요소 둘 이상과 연결 하나 이상)이 없으면 null
function sanitizeMotionPlan(raw) {
    const source = Array.isArray(raw) ? { groups: raw } : raw;
    if (!isMotionObject(source)) return null;
    const list = Array.isArray(source.groups) ? source.groups : Array.isArray(source.nodes) ? [source] : [];
    const groups = [];
    for (const item of list.slice(0, MOTION_LIMITS.scan)) {
        if (groups.length >= MOTION_LIMITS.groups) break;
        const group = motionGroupOf(item, groups.length);
        if (group) groups.push(group);
    }
    return groups.length ? { title: motionText(source.title, MOTION_LIMITS.title), groups } : null;
}

/* ---------- 한 바퀴의 움직임 ---------- */
const motionPatternOf = (group, chosen) => (MOTION_PATTERNS.includes(chosen) ? chosen : group.pattern);
const motionCenterOf = box => ({ x: (box[1] + box[3]) / 2, y: (box[0] + box[2]) / 2 });
// 위에서 시계 방향으로 잰 각도. 그림 좌표는 아래로 갈수록 y가 크다. 바로 위에서 조금 왼쪽(3도 안)도 맨 앞으로 친다
function motionAngle(from, to) {
    const angle = (Math.atan2(to.x - from.x, from.y - to.y) + 2 * Math.PI) % (2 * Math.PI);
    return angle > 2 * Math.PI - 0.05 ? angle - 2 * Math.PI : angle;
}
// forward 연결은 from에서 to로만 보낸다
const motionAllows = (edge, fromId) => edge.dir !== 'forward' || edge.from === fromId;

// 요소 번호와 요소마다 이어진 연결(연결 번호, 건너편 요소 번호)
function motionGraph(group) {
    const index = new Map(group.nodes.map((node, i) => [node.id, i]));
    const links = group.nodes.map(() => []);
    group.edges.forEach((edge, i) => {
        const a = index.get(edge.from);
        const b = index.get(edge.to);
        links[a].push({ edge: i, other: b });
        links[b].push({ edge: i, other: a });
    });
    return { index, links };
}

// 가운데 요소: 계획의 center, 없으면 가장 많이 이어진 요소(나무 구조의 맨 위는 맨 위 요소)
function motionHubIndex(group, graph, pick = motionBusiest) {
    if (graph.index.has(group.center)) return graph.index.get(group.center);
    return graph.index.get(pick(group.nodes, motionDegrees(group.nodes, group.edges)).id);
}

// 이어진 요소를 묶음 가운데를 두고 위에서 시계 방향으로
function motionRing(group, graph) {
    const used = group.nodes.map((node, i) => i).filter(i => graph.links[i].length);
    const centers = used.map(i => motionCenterOf(group.nodes[i].box));
    const middle = { x: centers.reduce((sum, c) => sum + c.x, 0) / centers.length, y: centers.reduce((sum, c) => sum + c.y, 0) / centers.length };
    return used.map((i, k) => ({ i, angle: motionAngle(middle, centers[k]) })).sort((a, b) => a.angle - b.angle || a.i - b.i).map(item => item.i);
}

// 점 하나가 연결을 건너간다: 움직임 하나와 도착한 요소의 빛나는 테두리
function motionSend(out, edge, from, to, start, end, tone) {
    out.events.push({ edge, from, to, start, end: Math.min(1, end), tone });
    out.pulses.push({ node: to, at: Math.min(1, end), tone });
}

// 짝 주고받기: 연결마다 앞 절반에 from→to, 뒤 절반에 to→from(한쪽 화살표는 화살표 쪽만). 연결끼리 조금씩 어긋나게
function motionPairs(group, graph, out, edgeIndexes = group.edges.map((edge, i) => i), tones = ['request', 'response']) {
    edgeIndexes.forEach((i, k) => {
        const edge = group.edges[i];
        const a = graph.index.get(edge.from);
        const b = graph.index.get(edge.to);
        const offset = (k % 4) * 0.025;
        if (motionAllows(edge, edge.from)) motionSend(out, i, a, b, 0.03 + offset, 0.03 + offset + MOTION_TIMES.pair, tones[0]);
        if (motionAllows(edge, edge.to)) motionSend(out, i, b, a, 0.53 + offset, 0.53 + offset + MOTION_TIMES.pair, tones[1]);
    });
}

// 중심과 주변: 주변 요소가 가운데로 요청을 보내고(가운데를 두고 위에서 시계 방향으로 차례로), 뒤 절반에 가운데가 주변 요소마다 응답한다.
// 가운데와 이어지지 않은 연결은 같은 두 물결에 짝 주고받기로 함께 움직인다
function motionHub(group, graph, out) {
    const c = motionHubIndex(group, graph);
    const center = motionCenterOf(group.nodes[c].box);
    const spokes = graph.links[c]
        .map(link => ({ ...link, angle: motionAngle(center, motionCenterOf(group.nodes[link.other].box)) }))
        .sort((a, b) => a.angle - b.angle || a.edge - b.edge);
    const step = spokes.length > 1 ? (0.44 - MOTION_TIMES.travel) / (spokes.length - 1) : 0;
    spokes.forEach((spoke, k) => {
        const edge = group.edges[spoke.edge];
        const ask = 0.03 + k * step;
        const answer = 0.53 + k * step;
        if (motionAllows(edge, group.nodes[spoke.other].id)) motionSend(out, spoke.edge, spoke.other, c, ask, ask + MOTION_TIMES.travel, 'request');
        if (motionAllows(edge, group.nodes[c].id)) motionSend(out, spoke.edge, c, spoke.other, answer, answer + MOTION_TIMES.travel, 'response');
    });
    const spokeEdges = new Set(spokes.map(spoke => spoke.edge));
    motionPairs(group, graph, out, group.edges.map((edge, i) => i).filter(i => !spokeEdges.has(i)), ['flow', 'flow']);
}

// 서로 연결: 가운데 없이 요소마다 차례로(묶음 가운데를 두고 위에서 시계 방향) 이웃 모두에게 보낸다. 보내는 요소도 빛나 모든 요소가 같게 빛난다
function motionMesh(group, graph, out) {
    const order = motionRing(group, graph);
    const step = order.length > 1 ? (0.94 - MOTION_TIMES.mesh) / (order.length - 1) : 0;
    order.forEach((i, k) => {
        const start = 0.03 + k * step;
        out.pulses.push({ node: i, at: start, tone: 'flow' });
        graph.links[i].forEach(link => {
            if (motionAllows(group.edges[link.edge], group.nodes[i].id)) motionSend(out, link.edge, i, link.other, start, start + MOTION_TIMES.mesh, 'flow');
        });
    });
}

// 시작 요소: 계획의 center, 아니면 한쪽 끝(한쪽 화살표가 들어오지 않는 끝 먼저), 그다음 왼쪽 위
function motionStartIndex(group, graph, left) {
    if (graph.index.has(group.center) && left.has(graph.index.get(group.center))) return graph.index.get(group.center);
    const incoming = new Set(group.edges.filter(edge => edge.dir === 'forward').map(edge => graph.index.get(edge.to)));
    const score = i => (graph.links[i].length === 1 ? 0 : 2) + (incoming.has(i) ? 1 : 0);
    const box = i => group.nodes[i].box;
    return [...left].sort((a, b) => score(a) - score(b) || (box(a)[1] + box(a)[0]) - (box(b)[1] + box(b)[0]) || a - b)[0];
}

// 연결을 차례로 한 번씩: 시작 요소에서 깊이 먼저 따라가고(화살표 방향으로 갈 수 있는 연결 먼저), 이미 들른 요소로 가는 연결도 그 자리에서 건넌다.
// 떨어진 부분은 다음 시작 요소에서 이어 간다. 한쪽 화살표를 거스르는 걸음은 화살표 방향으로 바꾼다
function motionWalk(group, graph) {
    const steps = [];
    const usedEdges = new Set();
    const left = new Set(group.nodes.map((node, i) => i).filter(i => graph.links[i].length));
    const visit = start => {
        const stack = [start];
        left.delete(start);
        while (stack.length) {
            const u = stack[stack.length - 1];
            const options = graph.links[u].filter(link => !usedEdges.has(link.edge));
            if (!options.length) {
                stack.pop();
                continue;
            }
            const uid = group.nodes[u].id;
            const link = options.find(item => motionAllows(group.edges[item.edge], uid) && left.has(item.other))
                || options.find(item => left.has(item.other))
                || options.find(item => motionAllows(group.edges[item.edge], uid))
                || options[0];
            usedEdges.add(link.edge);
            const edge = group.edges[link.edge];
            const forward = motionAllows(edge, uid);
            steps.push({ edge: link.edge, from: forward ? u : link.other, to: forward ? link.other : u });
            if (left.has(link.other)) {
                left.delete(link.other);
                stack.push(link.other);
            }
        }
    };
    while (left.size) visit(motionStartIndex(group, graph, left));
    return steps;
}

// 차례 흐름: 점 하나가 연결을 하나씩 차례로 건너며 다음 요소를 밝힌다. 순환은 한 바퀴를 빈틈없이 나눠 끝에서 처음으로 이어진다
function motionChain(group, graph, out, wrap = false) {
    const steps = motionWalk(group, graph);
    const span = wrap ? 1 : 0.94;
    const offset = wrap ? 0 : 0.03;
    steps.forEach((step, k) => {
        const start = offset + span * k / steps.length;
        const end = offset + span * (k + 1) / steps.length;
        motionSend(out, step.edge, step.from, step.to, start, end, 'flow');
    });
}

// 나무 구조: 맨 위 요소(계획의 center, 없으면 맨 위에 그려진 요소)에서 단계마다 아래 요소로 함께 내려간다. 떨어진 부분은 그 부분의 맨 위에서 함께 시작한다
function motionTree(group, graph, out) {
    const level = new Map();
    const edgeLevel = new Map();
    const roots = [motionHubIndex(group, graph, motionTopmost), ...group.nodes.map((node, i) => i)];
    for (const root of roots) {
        if (level.has(root) || !graph.links[root].length) continue;
        level.set(root, 0);
        const queue = [root];
        while (queue.length) {
            const u = queue.shift();
            graph.links[u].forEach(link => {
                if (!level.has(link.other)) {
                    level.set(link.other, level.get(u) + 1);
                    queue.push(link.other);
                }
                if (!edgeLevel.has(link.edge)) edgeLevel.set(link.edge, { level: level.get(u), parent: u, child: link.other });
            });
        }
    }
    const depth = Math.max(...[...edgeLevel.values()].map(item => item.level)) + 1;
    const slot = 0.9 / depth;
    [...edgeLevel.entries()].sort((a, b) => a[1].level - b[1].level || a[0] - b[0]).forEach(([i, item]) => {
        const edge = group.edges[i];
        const down = motionAllows(edge, group.nodes[item.parent].id);
        const start = 0.04 + item.level * slot;
        motionSend(out, i, down ? item.parent : item.child, down ? item.child : item.parent, start, start + slot * 0.9, 'flow');
    });
}

const MOTION_PLANNERS = {
    hub: motionHub,
    mesh: motionMesh,
    chain: (group, graph, out) => motionChain(group, graph, out, false),
    cycle: (group, graph, out) => motionChain(group, graph, out, true),
    tree: motionTree,
    pairs: (group, graph, out) => motionPairs(group, graph, out)
};

// 한 바퀴(0~1) 동안의 움직임. patterns[i]: 그 묶음에 고른 무늬('auto'나 모르는 값이면 계획의 무늬).
// 묶음마다 { name, pattern, events: [{ edge, from, to, start, end, tone }], pulses: [{ node, at, tone }] }. from·to·node는 요소 번호, tone은 request·response·flow
function planMotionTimeline(plan, patterns = []) {
    return {
        groups: plan.groups.map((group, index) => {
            const chosen = motionPatternOf(group, patterns[index]);
            const pattern = MOTION_PLANNERS[chosen] ? chosen : 'pairs';
            const out = { events: [], pulses: [] };
            MOTION_PLANNERS[pattern](group, motionGraph(group), out);
            return { name: group.name, pattern, events: out.events, pulses: out.pulses };
        })
    };
}

/* ---------- 그릴 자리 ---------- */
// 상자(0~1000 비율) → 그림 점 단위의 자리·크기·가운데
function motionBoxPixels(box, width, height) {
    const x = box[1] / 1000 * width;
    const y = box[0] / 1000 * height;
    const w = (box[3] - box[1]) / 1000 * width;
    const h = (box[2] - box[0]) / 1000 * height;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

// 두 상자 가운데를 잇는 선을 상자 테두리(와 gap만큼 바깥)에서 자른 시작·끝 점. 상자가 겹쳐 자를 수 없으면 두 가운데를 그대로 잇는다
function motionEdgeEnds(fromBox, toBox, width, height, gap = 0) {
    const a = motionBoxPixels(fromBox, width, height);
    const b = motionBoxPixels(toBox, width, height);
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const length = Math.hypot(dx, dy);
    const plain = { x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy };
    if (!length) return plain;
    const exit = box => Math.min(dx ? box.w / 2 / Math.abs(dx) : Infinity, dy ? box.h / 2 / Math.abs(dy) : Infinity);
    const start = exit(a) + gap / length;
    const end = 1 - exit(b) - gap / length;
    if (!(start < end)) return plain;
    return { x1: a.cx + dx * start, y1: a.cy + dy * start, x2: a.cx + dx * end, y2: a.cy + dy * end };
}

// 천천히 출발해 천천히 닿는다
const motionEase = p => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p));

// t(0~1) 장면에 그릴 것: 지나가는 연결선(lines), 빛나는 테두리(rings), 점과 꼬리(packets). 그림 점 단위
function motionScene(plan, timeline, t, width, height, radius) {
    const lines = [];
    const rings = [];
    const packets = [];
    timeline.groups.forEach((group, g) => {
        const nodes = plan.groups[g].nodes;
        group.events.forEach(event => {
            if (t < event.start || t >= event.end) return;
            const p = (t - event.start) / (event.end - event.start);
            const ends = motionEdgeEnds(nodes[event.from].box, nodes[event.to].box, width, height, radius * 0.6);
            const at = s => ({ x: ends.x1 + (ends.x2 - ends.x1) * s, y: ends.y1 + (ends.y2 - ends.y1) * s });
            lines.push({ ...ends, tone: event.tone, fade: Math.min(1, p / 0.15, (1 - p) / 0.15) });
            const trail = [0.06, 0.12, 0.18].filter(lag => p > lag).map((lag, k) => ({ ...at(motionEase(p - lag)), r: radius * (0.8 - k * 0.18), alpha: 0.42 - k * 0.12 }));
            packets.push({ ...at(motionEase(p)), r: radius, tone: event.tone, trail });
        });
        group.pulses.forEach(pulse => {
            const age = ((t - pulse.at) % 1 + 1) % 1;
            if (age >= MOTION_TIMES.pulse) return;
            const k = age / MOTION_TIMES.pulse;
            const box = motionBoxPixels(nodes[pulse.node].box, width, height);
            const pad = 3 + k * 6;
            rings.push({ x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2, alpha: 0.9 * (1 - k), tone: pulse.tone });
        });
    });
    return { lines, rings, packets };
}

/* ---------- 크기·색 ---------- */
// GIF 크기: 가로는 maxWidth와 원래 가로 가운데 작은 쪽, 세로는 비율대로
function motionFrameSize(naturalWidth, naturalHeight, maxWidth) {
    if (!(naturalWidth > 0) || !(naturalHeight > 0)) throw new Error('그림 크기를 읽지 못했습니다.');
    const width = Math.max(1, Math.round(Math.min(maxWidth, naturalWidth)));
    return { width, height: Math.max(1, Math.round(width * naturalHeight / naturalWidth)) };
}

// 그림 밝기(0~1). 점을 고르게 골라 잰다
function motionLuminance(rgba, step = 16) {
    let sum = 0;
    let count = 0;
    for (let p = 0; p + 2 < rgba.length; p += 4 * step) {
        sum += 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
        count += 1;
    }
    return count ? sum / count / 255 : 1;
}

const motionColors = luminance => (luminance < 0.42 ? MOTION_COLORS.dark : MOTION_COLORS.light);
const motionRgb = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
// GIF 색표에 꼭 넣을 색(점·테두리 색이 다른 색으로 바뀌지 않게)
const motionFixedColors = colors => [colors.request, colors.response, colors.flow, colors.outline].map(motionRgb);

/* ---------- 바꾼 GIF 알아보기 ---------- */
// 그림 값의 짧은 지문(길이 + 고르게 뽑은 글자와 끝 글자의 해시). 그 자리 그림이 이 기능이 만든 GIF 그대로인지 가린다(image-motion.js)
function imageMotionSignature(value) {
    const text = String(value ?? '');
    let hash = 0x811c9dc5;
    const mix = code => {
        hash = Math.imul(hash ^ code, 0x01000193) >>> 0;
    };
    const step = Math.max(1, Math.floor(text.length / 4096));
    for (let i = 0; i < text.length; i += step) mix(text.charCodeAt(i));
    for (let i = Math.max(0, text.length - 64); i < text.length; i++) mix(text.charCodeAt(i));
    return `${text.length.toString(36)}-${hash.toString(36)}`;
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        buildMotionPrompt, sanitizeMotionPlan, motionShape, planMotionTimeline, motionEdgeEnds, motionScene, motionFrameSize,
        motionLuminance, motionColors, motionFixedColors, imageMotionSignature, motionBoxPixels, motionText, motionId, motionBox
    });
}
