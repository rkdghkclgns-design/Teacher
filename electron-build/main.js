const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        title: '디벨로켓 교안 도우미',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // file:// 에서 CDN 로드 허용
            webSecurity: false,
        },
    });

    // asar 내부의 index.html을 직접 로드
    const htmlPath = path.join(__dirname, 'app', 'index.html');
    console.log('Loading:', htmlPath);
    mainWindow.loadFile(htmlPath);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
