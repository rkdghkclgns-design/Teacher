// 기본 저장 폴더: 설정(⚙ → 저장 위치)에서 고른 PC 폴더에 내보내기·백업 파일(MD·HTML·CSV·그림·ZIP)을 바로 저장한다.
// 웹 페이지는 경로를 글자로 받을 수 없어 Chrome·Edge의 폴더 고르기 창(showDirectoryPicker, File System Access API)으로 고른다.
// 고른 폴더 손잡이는 IndexedDB(이름 'defaultSaveFolderHandle')에 두고, 처음 저장하거나 설정을 열 때 꺼낸다.
// 폴더를 고르지 않았거나, 이 브라우저가 지원하지 않거나, 권한을 받지 못했거나, 쓰다 실패하면 예전처럼 브라우저 다운로드로 같은 이름으로 받는다
// (파일을 잃지 않게. 폴더 문제는 한 번 알린다). 폴더에서는 같은 이름이 있으면 덮어쓰지 않고 ' (2)', ' (3)'을 붙인다.
// 맡긴 저장은 차례로 하고(같은 이름 고르기가 겹치지 않게), 한꺼번에 맡긴 파일은 알림을 하나로 묶는다.
// 다 쓰기 전에는 '이름.저장중'에 쓰고 다 쓴 뒤 원래 이름으로 옮긴다(쓰는 도중 창이 닫혀도 그 이름의 빈 파일이 남지 않게). 쓰는 동안 창을 닫으면 묻는다(isFolderSavePending).
// 오래 걸리는 내보내기(ZIP·HTML·안전 백업)는 누른 직후 prepareSaveFolder로 쓰기 권한을 받아 둔다(다 만든 뒤에는 브라우저가 권한 창을 띄우지 못한다).
// 기대는 것: state.js(DBManager, connectProjectFolder·disconnectProjectFolder·folderConnectionState·reconnectLockedFolder), ui.js(showToast·showAlert),
// index.html 설정 패널의 저장 위치 칸(settings-save-folder-*, settings-project-folder-*). 내보내는 자리들은 typeof saveFileToFolder로 이 파일이 있는지 본다

const SAVE_FOLDER_KEY = 'defaultSaveFolderHandle';
const SAVE_FOLDER_DEFAULT_LABEL = '브라우저 기본 다운로드 폴더';
const SAVE_FOLDER_UNSUPPORTED = '이 브라우저는 폴더 지정을 지원하지 않아 다운로드 폴더에 저장됩니다.';
const SAVE_DOWNLOAD_GAP_MS = 300; // 다운로드를 잇달아 받을 때 띄우는 시간(한꺼번에 누르면 브라우저가 몇 개를 빠뜨린다)
const SAVE_URL_KEEP_MS = 60000; // 내려받기가 시작될 때까지 Blob 주소를 남겨 둔다
const SAVE_NAME_TRIES = 999; // 같은 이름 뒤에 붙여 볼 번호의 끝
const SAVE_TEMP_SUFFIX = '.저장중'; // 다 쓰기 전의 이름(고른 이름 뒤에 붙인다). 쓰는 도중 창이 닫히면 이 이름만 남는다
// Chrome이 폴더에 쓰지 못하게 막는 글자(File System Access IsSafePathComponent → base::i18n::IsFilenameLegal):
// Windows가 받지 않는 \ / : * ? " < > |, 제어 문자(Cc), ZWJ·ZWSP 같은 서식 글자(Cf), 짝 없는 서로게이트(Cs), 비문자
const SAVE_NAME_BAD_CHARS = /[\\/:*?"<>|\p{Cc}\p{Cf}\p{Cs}\p{Noncharacter_Code_Point}]/gu;
const SAVE_NAME_BAD_ENDS = /^[\s.~]+|[\s.~]+$/gu; // 처음과 끝의 빈칸·점·물결(~)도 막는다
// Windows가 장치·폴더 설정에 쓰는 이름(net::IsReservedNameOnWindows: 'CON', 'CON.md'처럼 그 이름 뒤가 끝이거나 점, desktop.ini·thumbs.db)
const SAVE_RESERVED_NAME = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.|$)|^(?:desktop\.ini|thumbs\.db)$/i;
const SAVE_STRICT_NAME_DROP = /[^\p{L}\p{M}\p{N} _\-().]/gu; // 그래도 받지 않으면 글자·숫자와 빈칸 _ - ( ) . 만 남겨 한 번 더 써 본다

let saveFolderHandle = null; // 고른 FileSystemDirectoryHandle | null
let saveFolderRestored = false; // 저장소에서 꺼내 봤는지(이 창에서 고르거나 되돌렸어도 true)
let saveFolderRestoring = null; // 저장소에서 꺼내는 중인 Promise
let saveFolderWarned = false; // 폴더 문제로 다운로드로 받았다고 알렸는지(다시 폴더에 저장되면 거둔다)
let saveFolderQueue = Promise.resolve(); // 맡긴 저장을 차례로 한다
let saveFolderPending = 0; // 아직 끝나지 않은 저장 수
let saveFolderBatch = null; // 이번에 폴더에 저장한 파일 { folder, names }. 맡긴 저장이 다 끝나면 한 번 알린다
let saveFolderLastDownload = 0; // 마지막으로 다운로드를 시작한 시각

// 이 브라우저에 폴더 고르기 창이 있는지(Chrome·Edge. Firefox·Safari에는 없다)
function saveFolderSupported() {
    return typeof window.showDirectoryPicker === 'function';
}

// 지금 고른 기본 저장 폴더 이름. 없거나 아직 저장소에서 꺼내지 않았으면 ''
function saveFolderName() {
    return saveFolderHandle?.name || '';
}

// 고른 폴더에 쓰거나 내려받는 중인 파일이 있는지. 창을 닫기 전에 묻는다(ui.js warnBeforeUnload. 닫으면 그 파일을 잃는다)
function isFolderSavePending() {
    return saveFolderPending > 0;
}

function isSaveFolderHandle(value) {
    return !!value && value.kind === 'directory' && typeof value.getFileHandle === 'function';
}

// 이 창에서 쓸 기본 저장 폴더를 바꾼다(null이면 브라우저 다운로드). 폴더 문제 알림도 다시 한다
function useSaveFolder(handle) {
    saveFolderHandle = handle;
    saveFolderRestored = true;
    saveFolderWarned = false;
}

// 고른 폴더를 저장소에서 한 번만 꺼낸다(동시에 불러도 한 번 읽는다)
function restoreSaveFolder() {
    if (saveFolderRestored) return Promise.resolve(saveFolderHandle);
    if (!saveFolderRestoring) saveFolderRestoring = readSaveFolder().finally(() => { saveFolderRestoring = null; });
    return saveFolderRestoring;
}

// 저장소를 읽지 못하면 이번에는 없는 것으로 보고 다음 저장 때 다시 읽는다. 읽는 사이 고르거나 되돌렸으면 그것을 따른다
async function readSaveFolder() {
    if (typeof DBManager === 'undefined') {
        saveFolderRestored = true;
        return saveFolderHandle;
    }
    try {
        const stored = await DBManager.getItem(SAVE_FOLDER_KEY);
        if (!saveFolderRestored) {
            saveFolderHandle = isSaveFolderHandle(stored) ? stored : null;
            saveFolderRestored = true;
        }
    } catch (err) {
        console.warn('[기본 저장 폴더] 고른 폴더를 읽지 못해 이번에는 브라우저 다운로드로 받습니다:', err);
    }
    return saveFolderHandle;
}

// 새로 열어도 같은 폴더에 저장하도록 기억한다. 기억하지 못하면 false(이 창에서는 쓴다)
async function rememberSaveFolder(handle) {
    if (typeof DBManager === 'undefined') return false;
    try {
        await DBManager.setItem(SAVE_FOLDER_KEY, handle);
        return true;
    } catch (err) {
        console.warn('[기본 저장 폴더] 고른 폴더를 기억하지 못했습니다:', err);
        return false;
    }
}

/* ---------- 설정: 고르기·되돌리기 ---------- */
// '폴더 고르기': 고르기 창(쓰기 권한까지)으로 고르고 기억한다. 고르면 true, 창을 닫거나 못 고르면 false(고른 폴더는 그대로)
async function chooseSaveFolder() {
    if (!saveFolderSupported()) {
        window.showAlert?.(SAVE_FOLDER_UNSUPPORTED);
        return false;
    }
    let handle;
    try {
        handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (err) {
        if (err?.name === 'AbortError') return false; // 고르기 창을 닫았다
        console.error('[기본 저장 폴더] 폴더를 고르지 못했습니다:', err);
        window.showAlert?.(`폴더를 고르지 못했습니다(${err?.message || '알 수 없는 오류'}).`);
        return false;
    }
    useSaveFolder(handle);
    renderSaveLocationSettings();
    const remembered = await rememberSaveFolder(handle);
    window.showToast?.(remembered
        ? `이제 ${handle.name} 폴더에 내보내기·백업 파일을 저장합니다.`
        : `이 창에서만 ${handle.name} 폴더에 저장합니다. 브라우저가 폴더를 기억하지 못해 새로 열면 다시 골라야 합니다.`, remembered ? 'success' : 'warning');
    return true;
}

// '기본으로 되돌리기': 고른 폴더를 잊고 브라우저 기본 다운로드 폴더로 받는다
async function clearSaveFolder() {
    useSaveFolder(null);
    renderSaveLocationSettings();
    let forgot = true;
    try {
        if (typeof DBManager !== 'undefined') await DBManager.deleteItem(SAVE_FOLDER_KEY);
    } catch (err) {
        forgot = false;
        console.warn('[기본 저장 폴더] 고른 폴더를 저장소에서 지우지 못했습니다:', err);
    }
    window.showToast?.(forgot
        ? `기본 저장 폴더 지정을 풀었습니다. 이제 ${SAVE_FOLDER_DEFAULT_LABEL}에 받습니다.`
        : `이 창에서는 ${SAVE_FOLDER_DEFAULT_LABEL}에 받지만, 브라우저가 고른 폴더를 잊지 못해 새로 열면 그 폴더에 다시 저장할 수 있습니다.`, forgot ? 'success' : 'warning');
}

/* ---------- 저장 ---------- */
// 파일 하나를 저장한다(data: Blob이나 글). 끝나면 { saved: 'folder' | 'download', fileName, folderName }.
// 브라우저 다운로드마저 못 할 때만 거부한다(기다리지 않는 자리는 .catch(showSaveFailure)로 알린다)
async function saveFileToFolder(data, fileName, mimeType = '') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType || 'text/plain;charset=utf-8' });
    const name = String(fileName || '파일');
    saveFolderPending += 1;
    const turn = saveFolderQueue.then(() => saveOneFile(blob, name));
    saveFolderQueue = turn.catch(() => {}); // 하나가 실패해도 뒤 저장은 이어 간다(실패는 아래에서 부른 쪽에 돌려준다)
    try {
        return await turn;
    } finally {
        saveFolderPending -= 1;
        if (!saveFolderPending) announceSavedFiles();
    }
}

// 차례가 오면 하나를 저장한다. 고른 폴더가 있으면 그 폴더에, 없거나 쓰지 못하면 브라우저 다운로드로
async function saveOneFile(blob, fileName) {
    const folder = await restoreSaveFolder();
    if (!folder) return downloadSaveFile(blob, fileName);
    try {
        if (!(await saveFolderWritable(folder))) throw Object.assign(new Error('폴더에 쓸 권한이 없습니다'), { name: 'NotAllowedError' });
        const name = await writeToSaveFolder(folder, fileName, blob);
        saveFolderWarned = false;
        addSavedFile(folder.name, name);
        return { saved: 'folder', fileName: name, folderName: folder.name };
    } catch (err) {
        console.warn('[기본 저장 폴더] 폴더에 저장하지 못해 브라우저 다운로드로 받습니다:', err);
        warnSaveFolderOnce(folder.name, err, fileName);
        return downloadSaveFile(blob, fileName);
    }
}

// 쓰기 권한을 확인하고 물어야 하면 묻는다. 누른 직후에만 묻는 창이 뜨고, 긴 내보내기 뒤에는 브라우저가 SecurityError를 던진다(그래서 prepareSaveFolder)
async function saveFolderWritable(folder) {
    const mode = { mode: 'readwrite' };
    let state = await folder.queryPermission(mode);
    if (state === 'prompt') state = await folder.requestPermission(mode);
    return state === 'granted';
}

// 오래 걸리는 내보내기(ZIP·HTML·안전 백업)를 누른 직후, 만들기 전에 부른다. 새 창에서 저장소에서 꺼낸 폴더는 권한이 'prompt'인데
// 다 만든 뒤(누른 지 5초가 지나) 차례가 오면 브라우저가 권한 창을 띄우지 못하므로 지금 받아 둔다. 폴더가 없거나 이미 받았으면 그대로 두고,
// 묻지 못하거나 거절해도 던지지 않는다(저장할 때 다시 보고, 못 쓰면 브라우저 다운로드로 받는다)
async function prepareSaveFolder() {
    try {
        const folder = await restoreSaveFolder();
        if (folder && await folder.queryPermission({ mode: 'readwrite' }) === 'prompt') await folder.requestPermission({ mode: 'readwrite' });
    } catch (err) {
        console.warn('[기본 저장 폴더] 쓰기 권한을 미리 받지 못했습니다(저장할 때 다시 봅니다):', err);
    }
}

// 폴더에 쓰는 이름. Chrome이 막는 글자(SAVE_NAME_BAD_CHARS)는 브라우저 다운로드처럼 _로 바꾸고 처음과 끝의 빈칸·점·~는 떼며,
// Windows 예약 이름은 그 이름 뒤에 _를 붙인다(CON.md → CON_.md). 다 떼어 비면 '파일'
function folderFileName(fileName) {
    const name = fileName.replace(SAVE_NAME_BAD_CHARS, '_').replace(SAVE_NAME_BAD_ENDS, '');
    return (SAVE_RESERVED_NAME.test(name) ? name.replace(/^[^.]*/, stem => `${stem}_`) : name) || '파일';
}

// 고른 폴더에 같은 이름으로(있으면 ' (2)'…) 쓰고 쓴 이름을 돌려준다. 그래도 브라우저가 이름을 받지 않으면(TypeError 'Name is not allowed.')
// 글자·숫자만 남긴 이름으로 한 번 더 써 보고, 그것도 받지 않으면 SaveNameError를 던진다(폴더 문제가 아니라 이름 때문이라고 알린다)
async function writeToSaveFolder(folder, fileName, blob) {
    const names = new Set([folderFileName(fileName), folderFileName(fileName.replace(SAVE_STRICT_NAME_DROP, '_'))]);
    let refused = null;
    for (const name of names) {
        try {
            const free = await freeSaveFileName(folder, name);
            await writeSaveFile(folder, free, blob);
            return free;
        } catch (err) {
            if (err?.name !== 'TypeError') throw err; // 권한·디스크 같은 다른 까닭은 바로 던진다
            console.warn(`[기본 저장 폴더] 브라우저가 이름(${name})을 받지 않습니다:`, err);
            refused = err;
        }
    }
    throw Object.assign(new Error(`브라우저가 파일 이름을 받지 않습니다(${fileName})`), { name: 'SaveNameError', cause: refused });
}

// 폴더에 없는 이름: 그대로, 있으면 '이름 (2).확장자', '이름 (3).확장자'…
async function freeSaveFileName(folder, fileName) {
    const dot = fileName.lastIndexOf('.');
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : '';
    for (let n = 1; n <= SAVE_NAME_TRIES; n += 1) {
        const name = n === 1 ? fileName : `${base} (${n})${ext}`;
        if (!(await saveFileExists(folder, name))) return name;
    }
    throw new Error(`같은 이름의 파일이 ${SAVE_NAME_TRIES}개를 넘습니다`);
}

async function saveFileExists(folder, name) {
    try {
        await folder.getFileHandle(name);
        return true;
    } catch (err) {
        if (err?.name === 'NotFoundError') return false;
        if (err?.name === 'TypeMismatchError') return true; // 같은 이름의 폴더가 있다
        throw err;
    }
}

// 다 쓴 파일을 이름만 바꿔 옮길 수 있는 브라우저인지(move: Chrome 111부터 PC 폴더에서도 된다. 폴더 손잡이나 파일 손잡이의 원형에 있다)
function saveFolderCanMove(folder) {
    return typeof folder.move === 'function' || typeof globalThis.FileSystemFileHandle?.prototype?.move === 'function';
}

// 새 파일을 쓴다. 옮기기가 되면 '이름.저장중'에 다 쓴 뒤 그 이름으로 옮겨, 쓰는 도중 창이 닫혀도 그 이름의 빈 파일이 남지 않게 한다.
// 옮기기가 없거나 옮기지 못하면(Safe Browsing이 막는 등) 그 이름에 바로 쓰고 임시 파일은 지운다
async function writeSaveFile(folder, name, blob) {
    if (!saveFolderCanMove(folder)) {
        await writeSaveFileAs(folder, name, blob);
        return;
    }
    const temp = `${name}${SAVE_TEMP_SUFFIX}`;
    const handle = await writeSaveFileAs(folder, temp, blob);
    try {
        await handle.move(name);
    } catch (err) {
        console.warn('[기본 저장 폴더] 다 쓴 파일을 그 이름으로 옮기지 못해 그 이름에 바로 씁니다:', err);
        try {
            await writeSaveFileAs(folder, name, blob);
        } finally {
            await tidySaveFile(() => folder.removeEntry(temp));
        }
    }
}

// 그 이름으로 파일을 만들어 쓰고 그 손잡이를 돌려준다. 쓰다 실패하면 쓰다 만 내용과 방금 만든 빈 파일을 치우고 던진다
async function writeSaveFileAs(folder, name, blob) {
    const handle = await folder.getFileHandle(name, { create: true });
    let writable = null;
    try {
        writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return handle;
    } catch (err) {
        await tidySaveFile(() => writable?.abort());
        await tidySaveFile(() => folder.removeEntry(name));
        throw err;
    }
}

// 치우다 난 오류는 원래 오류를 가리지 않게 콘솔에만 남긴다
async function tidySaveFile(step) {
    try {
        await step();
    } catch (err) {
        console.warn('[기본 저장 폴더] 쓰다 만 파일을 치우지 못했습니다:', err);
    }
}

// 브라우저 다운로드로 같은 이름으로 받는다(예전과 같다). 잇달아 받을 때는 앞 다운로드와 띄운다
async function downloadSaveFile(blob, fileName) {
    const wait = saveFolderLastDownload + SAVE_DOWNLOAD_GAP_MS - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    saveFolderLastDownload = Date.now();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body?.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), SAVE_URL_KEEP_MS);
    return { saved: 'download', fileName, folderName: '' };
}

/* ---------- 알림 ---------- */
// 폴더에 저장한 파일을 이번 묶음에 더한다(사이에 폴더를 바꿨으면 앞 묶음을 먼저 알린다)
function addSavedFile(folder, name) {
    if (saveFolderBatch && saveFolderBatch.folder !== folder) announceSavedFiles();
    saveFolderBatch = saveFolderBatch ? { ...saveFolderBatch, names: [...saveFolderBatch.names, name] } : { folder, names: [name] };
}

// 맡긴 저장이 다 끝나면 폴더에 저장한 파일을 한 번 알린다
function announceSavedFiles() {
    const batch = saveFolderBatch;
    saveFolderBatch = null;
    if (!batch) return;
    const [first] = batch.names;
    const more = batch.names.length - 1;
    window.showToast?.(more ? `${batch.folder} 폴더에 ${first} 외 ${more}개를 저장했습니다.` : `${batch.folder} 폴더에 ${first} 파일을 저장했습니다.`, 'success');
}

// 고른 폴더에 저장하지 못해 다운로드로 받았다고 한 번 알린다(다시 폴더에 저장되면 다음 실패는 또 알린다).
// 브라우저가 이름을 받지 않았으면(SaveNameError) 폴더를 다시 골라도 같으므로 이름 때문이라고 알린다
function warnSaveFolderOnce(folder, err, fileName) {
    if (saveFolderWarned) return;
    saveFolderWarned = true;
    if (err?.name === 'SaveNameError') {
        window.showToast?.(`파일 이름(${fileName}) 때문에 ${folder} 폴더에 저장하지 못해 브라우저 다운로드 폴더에 받았습니다. 폴더는 다시 고르지 않아도 됩니다.`, 'warning');
        return;
    }
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
    window.showToast?.(`${folder} 폴더에 ${denied ? '쓸 권한을 받지 못해' : '저장하지 못해'} 브라우저 다운로드 폴더에 받았습니다. ⚙ 설정 → 저장 위치에서 폴더를 다시 고를 수 있습니다.`, 'warning');
}

// 폴더에도 다운로드로도 받지 못했을 때(거의 없다) 앱 창으로 알린다
function showSaveFailure(err) {
    console.error('[저장] 파일을 저장하지 못했습니다:', err);
    window.showAlert?.(`파일을 저장하지 못했습니다(${err?.message || '알 수 없는 오류'}). 다시 시도해 주세요.`);
}

/* ---------- 설정 패널의 저장 위치 칸 ---------- */
function setSaveSetting(id, props) {
    const el = document.getElementById(id);
    if (el) Object.assign(el, props);
}

// PC 폴더 자동 저장(프로젝트 폴더 연결) 상태 { kind: 'on' | 'failed' | 'locked' | 'off', name }. 머리줄과 같다(state.js folderConnectionState).
// 옛 state.js면 이어 둔 손잡이만 본다
function projectFolderState() {
    if (typeof folderConnectionState === 'function') return folderConnectionState();
    const project = typeof projectFolderHandle !== 'undefined' ? projectFolderHandle : null;
    return project ? { kind: 'on', name: project.name } : { kind: 'off', name: '' };
}

// 상태마다 보일 글, 연결 단추 글, 끊을 연결이 있는지. 멈춤은 머리줄의 '(눌러서 다시 연결)', 실패는 머리줄의 'PC 폴더 저장 실패'와 같다
const PROJECT_FOLDER_VIEW = {
    on: { text: name => `연결됨: ${name}`, connect: '다른 폴더로 바꾸기', linked: true },
    failed: { text: name => `저장 실패: ${name}`, connect: '다른 폴더로 바꾸기', linked: true },
    locked: { text: name => `멈춤: ${name}(다시 연결 필요)`, connect: '다시 연결', linked: true },
    off: { text: () => '연결 안 됨', connect: '폴더 연결', linked: false }
};

// 지금 상태로 칸을 채운다(설정을 열 때, 고르거나 되돌리거나 프로젝트 폴더를 잇고 끊은 뒤). 아직 저장소에서 꺼내지 않았으면 꺼낸 뒤 다시 채운다
function renderSaveLocationSettings() {
    const supported = saveFolderSupported();
    const name = supported ? saveFolderName() : '';
    setSaveSetting('settings-save-folder-name', { textContent: name || SAVE_FOLDER_DEFAULT_LABEL, title: name || SAVE_FOLDER_DEFAULT_LABEL });
    setSaveSetting('settings-save-folder-pick', { disabled: !supported });
    setSaveSetting('settings-save-folder-reset', { disabled: !supported || !name });
    const note = document.getElementById('settings-save-folder-note');
    if (note) {
        note.textContent = supported ? '' : SAVE_FOLDER_UNSUPPORTED;
        note.classList.toggle('hidden', supported);
    }
    const project = projectFolderState();
    const view = PROJECT_FOLDER_VIEW[project.kind] || PROJECT_FOLDER_VIEW.off;
    const projectState = supported ? view.text(project.name) : '이 브라우저는 폴더 연결을 지원하지 않습니다';
    setSaveSetting('settings-project-folder-state', { textContent: projectState, title: projectState });
    setSaveSetting('settings-project-folder-connect', { textContent: view.connect, disabled: !supported });
    setSaveSetting('settings-project-folder-disconnect', { disabled: !view.linked });
    if (supported && !saveFolderRestored) {
        restoreSaveFolder().then(() => {
            if (saveFolderRestored) renderSaveLocationSettings();
        });
    }
}

// 프로젝트 폴더 단추: 머리줄과 같은 연결·끊기(state.js)를 그대로 부르고 칸을 다시 그린다.
// 멈춘 연결이면 새 폴더를 고르지 않고 머리줄·띠의 '다시 연결'처럼 잇는다(폴더가 바뀌었거나 더 새것이면 그 까닭으로 묻는다)
async function connectProjectFolderFromSettings() {
    try {
        if (projectFolderState().kind === 'locked' && typeof reconnectLockedFolder === 'function') await reconnectLockedFolder();
        else await window.connectProjectFolder?.();
    } finally {
        renderSaveLocationSettings();
    }
}

async function disconnectProjectFolderFromSettings() {
    try {
        await window.disconnectProjectFolder?.();
    } finally {
        renderSaveLocationSettings();
    }
}
