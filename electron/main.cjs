const { app, BrowserWindow, dialog, net } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 650,
    title: 'KAIJAGE POS',
    icon: path.join(__dirname, '../assets/generated/icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.loadFile(path.join(__dirname, '../dist/app/index.html'))
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.on('closed', () => { mainWindow = undefined })
}

app.whenReady().then(() => {
  createWindow()
  if (app.isPackaged && process.platform !== 'linux') {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('error', error => console.warn('Update check failed:', error.message))
    autoUpdater.on('update-downloaded', async info => {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'KAIJAGE POS update ready',
        message: `Version ${info.version} is ready to install.`,
        detail: 'The update will be applied when you restart the app.',
        buttons: ['Restart and update', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      if (result.response === 0) autoUpdater.quitAndInstall()
    })

    const checkForUpdates = () => {
      if (net.isOnline()) autoUpdater.checkForUpdates().catch(error => console.warn('Update check failed:', error.message))
    }
    setTimeout(checkForUpdates, 8000)
    setInterval(checkForUpdates, 6 * 60 * 60 * 1000)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
