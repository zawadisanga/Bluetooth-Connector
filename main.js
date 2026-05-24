// main.js - Bluetooth Connector Desktop App
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) {
    app.quit();
}

let mainWindow = null;

function createWindow() {
    // Create the browser window
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
        titleBarStyle: 'default',
        show: false,
        backgroundColor: '#667eea'
    });

    // Load the web app
    mainWindow.loadURL('https://bluetooth.zass.website');

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Handle external links (open in default browser)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Create custom menu
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
                    click: () => {
                        app.quit();
                    },
                    accelerator: 'CmdOrCtrl+Q'
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Reload',
                    click: () => {
                        mainWindow.reload();
                    },
                    accelerator: 'CmdOrCtrl+R'
                },
                {
                    label: 'Toggle Full Screen',
                    click: () => {
                        mainWindow.setFullScreen(!mainWindow.isFullScreen());
                    },
                    accelerator: 'F11'
                },
                { type: 'separator' },
                {
                    label: 'Zoom In',
                    click: () => {
                        mainWindow.webContents.zoomFactor += 0.1;
                    },
                    accelerator: 'CmdOrCtrl+Plus'
                },
                {
                    label: 'Zoom Out',
                    click: () => {
                        mainWindow.webContents.zoomFactor -= 0.1;
                    },
                    accelerator: 'CmdOrCtrl+-'
                },
                {
                    label: 'Reset Zoom',
                    click: () => {
                        mainWindow.webContents.zoomFactor = 1.0;
                    },
                    accelerator: 'CmdOrCtrl+0'
                },
                { type: 'separator' },
                {
                    label: 'Developer Tools',
                    click: () => {
                        mainWindow.webContents.openDevTools();
                    },
                    accelerator: 'F12'
                }
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
                    click: () => {
                        shell.openExternal('https://bluetooth.zass.website');
                    }
                },
                {
                    label: 'Report Issue',
                    click: () => {
                        shell.openExternal('https://github.com/yourusername/bluetooth-connector/issues');
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    // Handle window close
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Get icon name based on platform
function getIconName() {
    switch (process.platform) {
        case 'win32':
            return 'icon.ico';
        case 'darwin':
            return 'icon.icns';
        default:
            return 'icon.png';
    }
}

// App event handlers
app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// Handle second instance
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
