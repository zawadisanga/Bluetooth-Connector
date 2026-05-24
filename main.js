// main.js - Bluetooth Connector Desktop App
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, getIconName()),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false,
        backgroundColor: '#667eea',
        title: 'Bluetooth Connector'
    });

    // Load your web app (Heroku or local)
    mainWindow.loadURL('https://bluetooth.zass.website');

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Open external links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Create menu
    const menuTemplate = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Create Room',
                    click: () => {
                        mainWindow.webContents.send('menu-action', 'create-room');
                    },
                    accelerator: 'CmdOrCtrl+N'
                },
                {
                    label: 'Join Room',
                    click: () => {
                        mainWindow.webContents.send('menu-action', 'join-room');
                    },
                    accelerator: 'CmdOrCtrl+J'
                },
                { type: 'separator' },
                {
                    label: 'Exit',
                    click: () => { app.quit(); },
                    accelerator: 'CmdOrCtrl+Q'
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => { mainWindow.reload(); } },
                { label: 'Toggle Full Screen', accelerator: 'F11', click: () => { mainWindow.setFullScreen(!mainWindow.isFullScreen()); } },
                { type: 'separator' },
                { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => { mainWindow.webContents.zoomFactor += 0.1; } },
                { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => { mainWindow.webContents.zoomFactor -= 0.1; } },
                { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => { mainWindow.webContents.zoomFactor = 1.0; } },
                { type: 'separator' },
                { label: 'Developer Tools', accelerator: 'F12', click: () => { mainWindow.webContents.openDevTools(); } }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About Bluetooth Connector',
                            message: 'Bluetooth Connector Desktop App',
                            detail: 'Version 1.0.0\n\nConnect multiple devices, listen together globally!\n\nCreated by Zawadi Sanga',
                            buttons: ['OK']
                        });
                    }
                },
                { type: 'separator' },
                {
                    label: 'Website',
                    click: () => { shell.openExternal('https://bluetooth.zass.website'); }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', () => { mainWindow = null; });
}

function getIconName() {
    switch (process.platform) {
        case 'win32': return 'icon.ico';
        case 'darwin': return 'icon.icns';
        default: return 'icon.png';
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}
