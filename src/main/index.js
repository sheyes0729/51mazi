import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import Store from 'electron-store'

// 创建 store 实例
const store = new Store({
  // 可以设置加密
  // encryptionKey: 'your-encryption-key',

  // 设置默认值
  defaults: {
    config: {
      theme: 'light',
      booksDir: ''
      // 其他默认配置...
    }
  }
})

ipcMain.handle('store:get', async (_, key) => {
  return store.get(key)
})

ipcMain.handle('store:set', async (_, key, value) => {
  store.set(key, value)
  return true
})

ipcMain.handle('store:delete', async (_, key) => {
  store.delete(key)
  return true
})

// 维护已打开书籍编辑窗口的映射
const bookEditorWindows = new Map()

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: '51码字',
    width: 1000,
    height: 800,
    minWidth: 1000,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// 选择书籍目录
ipcMain.handle('select-books-dir', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  return result
})

// 创建书籍
ipcMain.handle('create-book', async (event, bookInfo) => {
  // 1. 处理文件夹名合法性
  const safeName = bookInfo.name.replace(/[\\/:*?"<>|]/g, '_')
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, safeName)
  if (!fs.existsSync(bookPath)) {
    fs.mkdirSync(bookPath)
  }
  // 2. 写入 mazi.json
  const meta = {
    ...bookInfo,
    createdAt: new Date().toLocaleString(),
    updatedAt: new Date().toLocaleString()
  }
  fs.writeFileSync(join(bookPath, 'mazi.json'), JSON.stringify(meta, null, 2), 'utf-8')

  // 3. 创建正文和笔记文件夹
  const textPath = join(bookPath, '正文')
  fs.mkdirSync(textPath, { recursive: true })
  const notesPath = join(bookPath, '笔记')
  fs.mkdirSync(notesPath, { recursive: true })

  // 4. 默认创建一个正文卷
  const volumePath = join(textPath, '正文')
  fs.mkdirSync(volumePath, { recursive: true })

  // 5. 在默认卷中创建第1章文件
  const chapterPath = join(volumePath, '第1章.txt')
  fs.writeFileSync(chapterPath, '')

  // 6. 在笔记文件夹中创建大纲、设定、人物三个默认笔记本文件夹
  fs.mkdirSync(join(notesPath, '大纲'), { recursive: true })
  fs.mkdirSync(join(notesPath, '设定'), { recursive: true })
  fs.mkdirSync(join(notesPath, '人物'), { recursive: true })

  return true
})

// 读取书籍目录
ipcMain.handle('read-books-dir', async () => {
  const books = []
  const booksDir = store.get('booksDir')
  if (!fs.existsSync(booksDir)) return books
  const files = fs.readdirSync(booksDir, { withFileTypes: true })
  for (const file of files) {
    if (file.isDirectory()) {
      const metaPath = join(booksDir, file.name, 'mazi.json')
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          // 只返回必要的字段，确保name是文件夹名称而不是路径
          books.push({
            id: meta.id,
            name: file.name, // 使用文件夹名称作为书名
            type: meta.type,
            typeName: meta.typeName,
            targetCount: meta.targetCount,
            intro: meta.intro,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt
          })
        } catch (e) {
          // ignore parse error
          console.error('read-books-dir', e)
        }
      }
    }
  }
  return books
})

// 删除书籍
ipcMain.handle('delete-book', async (event, { name }) => {
  try {
    const booksDir = store.get('booksDir')
    if (!booksDir) {
      return false
    }

    const bookPath = join(booksDir, name)

    if (!fs.existsSync(bookPath)) {
      return false
    }

    // 删除整个书籍文件夹
    fs.rmSync(bookPath, { recursive: true, force: true })
    return true
  } catch (error) {
    console.error('删除书籍失败:', error)
    return false
  }
})

// 编辑书籍
ipcMain.handle('edit-book', async (event, bookInfo) => {
  try {
    const booksDir = store.get('booksDir')

    // 如果传入了原始名称，使用原始名称定位文件夹
    const originalName = bookInfo.originalName || bookInfo.name
    const bookPath = join(booksDir, originalName)

    if (!fs.existsSync(bookPath)) {
      return { success: false, message: '书籍不存在' }
    }

    const metaPath = join(bookPath, 'mazi.json')

    // 读取现有元数据
    const existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))

    // 如果书名发生变化，需要重命名文件夹
    if (bookInfo.name !== originalName) {
      const newBookPath = join(booksDir, bookInfo.name)

      // 检查新名称是否已存在
      if (fs.existsSync(newBookPath)) {
        return { success: false, message: '已存在同名书籍' }
      }

      // 重命名文件夹
      fs.renameSync(bookPath, newBookPath)

      // 更新元数据路径
      const newMetaPath = join(newBookPath, 'mazi.json')

      // 合并新旧数据，保留原有数据
      const mergedMeta = { ...existingMeta, ...bookInfo }
      fs.writeFileSync(newMetaPath, JSON.stringify(mergedMeta, null, 2), 'utf-8')
    } else {
      // 书名未变化，直接更新元数据
      const mergedMeta = { ...existingMeta, ...bookInfo }
      fs.writeFileSync(metaPath, JSON.stringify(mergedMeta, null, 2), 'utf-8')
    }

    return { success: true }
  } catch (error) {
    console.error('编辑书籍失败:', error)
    return { success: false, message: error.message }
  }
})

// 打开书籍编辑窗口
ipcMain.handle('open-book-editor-window', async (event, { id, name }) => {
  if (bookEditorWindows.has(id)) {
    // 已有窗口，聚焦
    const win = bookEditorWindows.get(id)
    if (win && !win.isDestroyed()) {
      win.focus()
      return true
    }
  }
  // 新建窗口
  const editorWindow = new BrowserWindow({
    title: `${name} - 51码字`,
    width: 1000,
    height: 800,
    minWidth: 1000,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      additionalArguments: [`bookId=${id}`, `bookName=${encodeURIComponent(name)}`]
    }
  })
  bookEditorWindows.set(id, editorWindow)
  editorWindow.on('ready-to-show', () => {
    editorWindow.show()
  })
  editorWindow.on('closed', () => {
    bookEditorWindows.delete(id)
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    // 直接跳转到编辑页
    editorWindow.loadURL(
      `${process.env['ELECTRON_RENDERER_URL']}#/editor?name=${encodeURIComponent(name)}`
    )
  } else {
    editorWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: `/editor?name=${encodeURIComponent(name)}`
    })
  }
  return true
})

// 创建卷
ipcMain.handle('create-volume', async (event, bookName) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const volumePath = join(bookPath, '正文')
  if (!fs.existsSync(volumePath)) {
    fs.mkdirSync(volumePath, { recursive: true })
  }
  let volumeName = '新加卷'
  let index = 1
  while (fs.existsSync(join(volumePath, volumeName))) {
    volumeName = `新加卷${index}`
    index++
  }
  fs.mkdirSync(join(volumePath, volumeName))
  return { success: true }
})

// 创建章节
ipcMain.handle('create-chapter', async (event, { bookName, volumeId }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const volumePath = join(bookPath, '正文', volumeId)
  if (!fs.existsSync(volumePath)) {
    fs.mkdirSync(volumePath, { recursive: true })
  }

  // 获取当前卷下的所有章节文件
  const files = fs.readdirSync(volumePath, { withFileTypes: true })
  const chapters = files.filter((file) => file.isFile() && file.name.endsWith('.txt'))

  // 智能计算新的章节序号
  let nextChapterNumber = 1

  if (chapters.length > 0) {
    // 从现有章节名中提取最大编号（只支持数字格式）
    const chapterNumbers = chapters
      .map((file) => {
        const name = file.name.replace('.txt', '')

        // 只支持数字格式：第1章、第1集等
        let match = name.match(/^第(\d+)(.+)$/)
        if (match) {
          return parseInt(match[1])
        }

        return 0
      })
      .filter((num) => num > 0)

    if (chapterNumbers.length > 0) {
      nextChapterNumber = Math.max(...chapterNumbers) + 1
    } else {
      // 如果没有标准格式的章节名，使用文件数量+1
      nextChapterNumber = chapters.length + 1
    }
  }

  // 获取章节设置
  const chapterSettings = store.get(`chapterSettings:${bookName}`) || {
    suffixType: '章'
  }

  // 根据设置生成章节名称
  const chapterName = generateChapterName(nextChapterNumber, chapterSettings)
  const filePath = join(volumePath, `${chapterName}.txt`)

  fs.writeFileSync(filePath, '')

  // 强制同步文件系统，确保文件立即可见（Windows兼容）
  try {
    const fd = fs.openSync(filePath, 'r')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
  } catch (error) {
    // 如果同步失败，记录错误但不影响主流程
    console.warn('文件同步失败:', error.message)
  }

  return { success: true, chapterName, filePath }
})

// 加载章节数据
ipcMain.handle('load-chapters', async (event, bookName) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const volumePath = join(bookPath, '正文')

  if (!fs.existsSync(volumePath)) {
    return []
  }

  const volumes = fs.readdirSync(volumePath, { withFileTypes: true })

  const chapters = []
  for (const volume of volumes) {
    if (volume.isDirectory()) {
      const volumeName = volume.name
      const currentVolumePath = join(bookPath, '正文', volumeName)

      const files = fs.readdirSync(currentVolumePath, { withFileTypes: true })

      const volumeChapters = []
      for (const file of files) {
        if (file.isFile() && file.name.endsWith('.txt')) {
          volumeChapters.push({
            id: file.name,
            name: file.name.replace('.txt', ''),
            type: 'chapter',
            path: join(bookPath, '正文', volumeName, file.name)
          })
        }
      }

      // 按照章节编号排序
      volumeChapters.sort((a, b) => {
        // 只支持数字格式：第1章、第1集等
        const aMatch = a.name.match(/^第(\d+)(.+)$/)
        const bMatch = b.name.match(/^第(\d+)(.+)$/)

        if (aMatch && bMatch) {
          // 如果都是标准章节格式，按编号排序
          const aNum = parseInt(aMatch[1])
          const bNum = parseInt(bMatch[1])
          return aNum - bNum
        } else if (aMatch) {
          // 如果a是标准格式，b不是，a排在前面
          return -1
        } else if (bMatch) {
          // 如果b是标准格式，a不是，b排在前面
          return 1
        } else {
          // 都不是标准格式，按名称排序
          return a.name.localeCompare(b.name)
        }
      })

      chapters.push({
        id: volumeName,
        name: volumeName,
        type: 'volume',
        path: join(bookPath, '正文', volumeName),
        children: volumeChapters
      })
    }
  }

  return chapters
})

// 重新格式化章节编号
ipcMain.handle('reformat-chapter-numbers', async (event, { bookName, volumeName, settings }) => {
  try {
    const booksDir = store.get('booksDir')
    const bookPath = join(booksDir, bookName)
    const volumePath = join(bookPath, '正文', volumeName)

    if (!fs.existsSync(volumePath)) {
      return { success: false, message: '卷目录不存在' }
    }

    // 获取当前卷下的所有章节文件
    const files = fs.readdirSync(volumePath, { withFileTypes: true })
    const chapters = files.filter((file) => file.isFile() && file.name.endsWith('.txt'))

    if (chapters.length === 0) {
      return { success: false, message: '没有找到章节文件' }
    }

    // 检查章节编号连续性
    const chapterInfos = chapters.map((file) => ({
      oldName: file.name.replace('.txt', ''),
      oldPath: join(volumePath, file.name),
      file: file
    }))

    const numberingCheck = checkChapterNumbering(
      chapterInfos.map((info) => ({ name: info.oldName }))
    )

    if (numberingCheck.isSequential) {
      return { success: true, message: '章节编号已经连续，无需重新格式化' }
    }

    // 按章节编号排序
    chapterInfos.sort((a, b) => {
      const aMatch = a.oldName.match(/^第(\d+)(.+)$/)
      const bMatch = b.oldName.match(/^第(\d+)(.+)$/)

      if (aMatch && bMatch) {
        const aNum = parseInt(aMatch[1])
        const bNum = parseInt(bMatch[1])
        return aNum - bNum
      }
      return a.oldName.localeCompare(b.oldName)
    })

    // 重新格式化章节编号，保留主题名
    let totalRenamed = 0
    for (let i = 0; i < chapterInfos.length; i++) {
      const info = chapterInfos[i]
      const newNumber = i + 1

      // 提取原有的主题名/描述内容
      const oldNameMatch = info.oldName.match(/^第(\d+)(.+?)(.*)$/)
      let themeName = ''

      if (oldNameMatch) {
        // 保留原有的主题名（第3个捕获组）
        themeName = (oldNameMatch[3] || '').trim()
        if (
          themeName &&
          !themeName.startsWith('章') &&
          !themeName.startsWith('集') &&
          !themeName.startsWith('回')
        ) {
          themeName = ' ' + themeName // 添加空格分隔
        }
      }

      // 生成新的章节名前缀
      const newPrefix = generateChapterName(newNumber, settings)

      // 组合新的章节名：前缀 + 主题名
      const newName = newPrefix + themeName

      if (newName !== info.oldName) {
        const newPath = join(volumePath, `${newName}.txt`)

        try {
          fs.renameSync(info.oldPath, newPath)
          totalRenamed++
        } catch (error) {
          return { success: false, message: `重命名失败: ${error.message}` }
        }
      }
    }

    return {
      success: true,
      message: `成功重新格式化 ${totalRenamed} 个章节`,
      totalRenamed
    }
  } catch (error) {
    return { success: false, message: `操作失败: ${error.message}` }
  }
})

// 编辑节点
ipcMain.handle('edit-node', async (event, { bookName, type, volume, chapter, newName }) => {
  try {
    const booksDir = store.get('booksDir')
    if (type === 'volume') {
      // 卷重命名
      const volumePath = join(booksDir, bookName, '正文', volume)
      const newVolumePath = join(booksDir, bookName, '正文', newName)
      if (fs.existsSync(newVolumePath)) {
        return { success: false, message: '新卷名已存在' }
      }
      fs.renameSync(volumePath, newVolumePath)
      return { success: true }
    } else if (type === 'chapter') {
      // 章节重命名
      const chapterPath = join(booksDir, bookName, '正文', volume, `${chapter}.txt`)
      const newChapterPath = join(booksDir, bookName, '正文', volume, `${newName}.txt`)
      if (fs.existsSync(newChapterPath)) {
        return { success: false, message: '新章节名已存在' }
      }
      fs.renameSync(chapterPath, newChapterPath)
      return { success: true }
    }
    return { success: false, message: '类型错误' }
  } catch (error) {
    console.error('编辑节点失败:', error)
    return { success: false, message: error.message }
  }
})

// 删除节点
ipcMain.handle('delete-node', async (event, { bookName, type, volume, chapter }) => {
  const booksDir = store.get('booksDir')
  if (type === 'volume') {
    const volumePath = join(booksDir, bookName, '正文', volume)
    // 删除整个卷文件夹
    if (!fs.existsSync(volumePath)) return { success: false, message: '卷不存在' }
    fs.rmSync(volumePath, { recursive: true, force: true })
    return { success: true }
  } else if (type === 'chapter') {
    const chapterPath = join(booksDir, bookName, '正文', volume, `${chapter}.txt`)
    if (!fs.existsSync(chapterPath)) return { success: false, message: '章节不存在' }
    fs.rmSync(chapterPath)
    return { success: true }
  }
  return { success: false, message: '类型错误' }
})

ipcMain.handle('get-sort-order', (event, bookName) => {
  return store.get(`sortOrder:${bookName}`) || 'asc'
})

// 获取章节设置
ipcMain.handle('get-chapter-settings', (event, bookName) => {
  const settings = store.get(`chapterSettings:${bookName}`) || {
    suffixType: '章'
  }

  return {
    suffixType: settings.suffixType
  }
})

// 更新章节格式
ipcMain.handle('update-chapter-format', async (event, { bookName, settings }) => {
  try {
    const booksDir = store.get('booksDir')
    const bookPath = join(booksDir, bookName)
    const volumePath = join(bookPath, '正文')

    if (!fs.existsSync(volumePath)) {
      return { success: false, message: '正文目录不存在' }
    }

    // 保存设置
    store.set(`chapterSettings:${bookName}`, settings)

    // 获取所有卷和章节
    const volumes = fs.readdirSync(volumePath, { withFileTypes: true })
    let totalRenamed = 0

    for (const volume of volumes) {
      if (volume.isDirectory()) {
        const volumeName = volume.name
        const currentVolumePath = join(bookPath, '正文', volumeName)
        const files = fs.readdirSync(currentVolumePath, { withFileTypes: true })

        for (const file of files) {
          if (file.isFile() && file.name.endsWith('.txt')) {
            const oldName = file.name.replace('.txt', '')

            // 检查是否是标准章节格式（只支持数字格式）
            let match = oldName.match(/^第(\d+)(.+?)(.*)$/)
            let chapterNumber, oldType, description

            if (match) {
              // 数字格式：第1章、第2章等
              chapterNumber = parseInt(match[1])
              oldType = match[2] // 原来的类型（如"章"）
              description = match[3] // 保留后面的描述内容
            }

            // 如果找到了匹配的格式，则进行重命名
            if (chapterNumber && oldType && description !== undefined) {
              // 生成新的前缀（编号+类型），保留描述
              const newPrefix = generateChapterName(chapterNumber, settings)
              const newName = newPrefix + description

              if (newName !== oldName) {
                const oldPath = join(currentVolumePath, file.name)
                const newPath = join(currentVolumePath, `${newName}.txt`)

                // 重命名文件
                fs.renameSync(oldPath, newPath)
                totalRenamed++
              }
            }
          }
        }
      }
    }

    return {
      success: true,
      message: `成功重命名 ${totalRenamed} 个章节文件`,
      totalRenamed
    }
  } catch (error) {
    const errorMessage = error.message || '未知错误'
    return { success: false, message: errorMessage }
  }
})

// 生成章节名称前缀的辅助函数
function generateChapterName(number, settings) {
  const suffix = settings.suffixType || settings.suffix || '章'
  return `第${number}${suffix}`
}

// 检查章节编号是否连续
function checkChapterNumbering(chapters) {
  if (!chapters || chapters.length === 0) {
    return { isSequential: true, missingNumbers: [], maxNumber: 0, totalChapters: 0 }
  }

  const chapterNumbers = chapters
    .map((chapter) => {
      const name = chapter.name
      // 只支持数字格式：第1章、第1集等
      let match = name.match(/^第(\d+)(.+)$/)
      if (match) {
        return parseInt(match[1])
      }
      return 0
    })
    .filter((num) => num > 0)
    .sort((a, b) => a - b)

  if (chapterNumbers.length === 0) {
    return { isSequential: true, missingNumbers: [], maxNumber: 0, totalChapters: chapters.length }
  }

  const maxNumber = Math.max(...chapterNumbers)
  const totalChapters = chapters.length
  const missingNumbers = []

  // 检查缺失的编号
  for (let i = 1; i <= maxNumber; i++) {
    if (!chapterNumbers.includes(i)) {
      missingNumbers.push(i)
    }
  }

  const isSequential = missingNumbers.length === 0 && maxNumber === totalChapters

  return {
    isSequential,
    missingNumbers,
    maxNumber,
    totalChapters,
    chapterNumbers
  }
}

ipcMain.handle('set-sort-order', (event, { bookName, order }) => {
  store.set(`sortOrder:${bookName}`, order)
  return true
})

// 加载笔记数据
ipcMain.handle('load-notes', async (event, bookName) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const notesPath = join(bookPath, '笔记')
  if (!fs.existsSync(notesPath)) {
    return []
  }
  // 递归读取笔记目录
  function readNotesDir(dir, isRoot = false) {
    const items = fs.readdirSync(dir, { withFileTypes: true })
    return items
      .filter((item) => {
        if (isRoot) return item.isDirectory() // 根层只返回文件夹（笔记本）
        if (item.isDirectory()) return true
        // 只返回 .txt 文件作为笔记
        return item.isFile() && item.name.endsWith('.txt')
      })
      .map((item) => {
        if (item.isDirectory()) {
          return {
            id: item.name,
            name: item.name,
            type: 'folder',
            path: join(dir, item.name), // 唯一
            children: readNotesDir(join(dir, item.name))
          }
        } else {
          return {
            id: item.name,
            name: item.name.replace(/\.txt$/, ''),
            type: 'note',
            path: join(dir, item.name) // 唯一
          }
        }
      })
  }
  return readNotesDir(notesPath, true)
})

// 创建笔记本
ipcMain.handle('create-notebook', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const notesPath = join(booksDir, bookName, '笔记')
  let baseName = '新建笔记本'
  let notebookName = baseName
  let index = 1
  while (fs.existsSync(join(notesPath, notebookName))) {
    notebookName = `${baseName}${index}`
    index++
  }
  fs.mkdirSync(join(notesPath, notebookName))
  return { success: true, notebookName }
})

// 删除笔记本
ipcMain.handle('delete-notebook', async (event, { bookName, notebookName }) => {
  const booksDir = store.get('booksDir')
  const notebookPath = join(booksDir, bookName, '笔记', notebookName)
  if (!fs.existsSync(notebookPath)) {
    return { success: false, message: '笔记本不存在' }
  }
  fs.rmSync(notebookPath, { recursive: true, force: true })
  return { success: true }
})

// 重命名笔记本
ipcMain.handle('rename-notebook', async (event, { bookName, oldName, newName }) => {
  const booksDir = store.get('booksDir')
  const notesPath = join(booksDir, bookName, '笔记')
  const oldPath = join(notesPath, oldName)
  const newPath = join(notesPath, newName)
  if (!fs.existsSync(oldPath)) {
    return { success: false, message: '原笔记本不存在' }
  }
  if (fs.existsSync(newPath)) {
    return { success: false, message: '新笔记本名已存在' }
  }
  fs.renameSync(oldPath, newPath)
  return { success: true }
})

// 创建笔记
ipcMain.handle('create-note', async (event, { bookName, notebookName, noteName }) => {
  const booksDir = store.get('booksDir')
  const notebookPath = join(booksDir, bookName, '笔记', notebookName)
  if (!fs.existsSync(notebookPath)) {
    return { success: false, message: '笔记本不存在' }
  }
  let baseName = noteName || '新建笔记'
  let fileName = `${baseName}.txt`
  let index = 1
  while (fs.existsSync(join(notebookPath, fileName))) {
    fileName = `${baseName}${index}.txt`
    index++
  }
  fs.writeFileSync(join(notebookPath, fileName), '')
  return { success: true }
})

// 删除笔记
ipcMain.handle('delete-note', async (event, { bookName, notebookName, noteName }) => {
  const booksDir = store.get('booksDir')
  const notePath = join(booksDir, bookName, '笔记', notebookName, `${noteName}.txt`)
  if (!fs.existsSync(notePath)) {
    return { success: false, message: '笔记不存在' }
  }
  fs.rmSync(notePath)
  return { success: true }
})

// 重命名笔记
ipcMain.handle('rename-note', async (event, { bookName, notebookName, oldName, newName }) => {
  const booksDir = store.get('booksDir')
  const notebookPath = join(booksDir, bookName, '笔记', notebookName)
  const oldPath = join(notebookPath, `${oldName}.txt`)
  const newPath = join(notebookPath, `${newName}.txt`)
  if (!fs.existsSync(oldPath)) {
    return { success: false, message: '原笔记不存在' }
  }
  if (fs.existsSync(newPath)) {
    return { success: false, message: '新笔记名已存在' }
  }
  fs.renameSync(oldPath, newPath)
  return { success: true }
})

// 读取笔记内容
ipcMain.handle('read-note', async (event, { bookName, notebookName, noteName }) => {
  const booksDir = store.get('booksDir')
  const notePath = join(booksDir, bookName, '笔记', notebookName, `${noteName}.txt`)
  if (!fs.existsSync(notePath)) {
    return { success: false, message: '笔记不存在' }
  }
  const content = fs.readFileSync(notePath, 'utf-8')
  return { success: true, content }
})

// 保存笔记内容并支持重命名
ipcMain.handle(
  'edit-note',
  async (event, { bookName, notebookName, noteName, newName, content }) => {
    const booksDir = store.get('booksDir')
    const notebookPath = join(booksDir, bookName, '笔记', notebookName)
    const oldPath = join(notebookPath, `${noteName}.txt`)
    const newPath = join(notebookPath, `${newName || noteName}.txt`)
    if (!fs.existsSync(oldPath)) {
      return { success: false, message: '笔记不存在' }
    }
    // 1. 先写内容到原文件
    fs.writeFileSync(oldPath, content, 'utf-8')
    // 2. 判断是否需要重命名
    if (newName && newName !== noteName) {
      if (fs.existsSync(newPath)) {
        return { success: false, message: '笔记名已存在', name: noteName }
      }
      fs.renameSync(oldPath, newPath)
      return { success: true, name: newName }
    }
    return { success: true, name: noteName }
  }
)

// 读取章节内容
ipcMain.handle('read-chapter', async (event, { bookName, volumeName, chapterName }) => {
  const booksDir = store.get('booksDir')
  const chapterPath = join(booksDir, bookName, '正文', volumeName, `${chapterName}.txt`)
  if (!fs.existsSync(chapterPath)) {
    return { success: false, message: '章节不存在' }
  }
  const content = fs.readFileSync(chapterPath, 'utf-8')
  // 章节标题可单独存储或直接用文件名
  return { success: true, content }
})

// 计算章节字数
function countChapterWords(content) {
  return content.length
}

// 计算书籍总字数
async function calculateBookWordCount(bookName) {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const volumePath = join(bookPath, '正文')
  let totalWords = 0

  if (!fs.existsSync(volumePath)) return totalWords

  const volumes = fs.readdirSync(volumePath, { withFileTypes: true })
  for (const volume of volumes) {
    if (volume.isDirectory()) {
      const volumeName = volume.name
      const volumePath = join(bookPath, '正文', volumeName)
      const files = fs.readdirSync(volumePath, { withFileTypes: true })
      for (const file of files) {
        if (file.isFile() && file.name.endsWith('.txt')) {
          const content = fs.readFileSync(join(volumePath, file.name), 'utf-8')
          totalWords += countChapterWords(content)
        }
      }
    }
  }
  return totalWords
}

// 更新书籍元数据
async function updateBookMetadata(bookName) {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const metaPath = join(bookPath, 'mazi.json')

  if (!fs.existsSync(metaPath)) return false

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    const totalWords = await calculateBookWordCount(bookName)

    meta.totalWords = totalWords
    meta.updatedAt = new Date().toLocaleString()

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error('更新书籍元数据失败:', error)
    return false
  }
}

// 统计文件路径
const STATS_FILE = 'word_stats.json'

// 获取统计文件路径
function getStatsFilePath() {
  const booksDir = store.get('booksDir')
  return join(booksDir, STATS_FILE)
}

// 读取统计数据
function readStats() {
  const statsPath = getStatsFilePath()
  if (!fs.existsSync(statsPath)) {
    return { dailyStats: {}, chapterStats: {}, bookDailyStats: {} }
  }
  try {
    return JSON.parse(fs.readFileSync(statsPath, 'utf-8'))
  } catch (error) {
    console.error('读取统计文件失败:', error)
    return { dailyStats: {}, chapterStats: {}, bookDailyStats: {} }
  }
}

// 保存统计数据
function saveStats(stats) {
  const statsPath = getStatsFilePath()
  try {
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error('保存统计文件失败:', error)
    return false
  }
}

// 更新章节字数统计
function updateChapterStats(bookName, volumeName, chapterName, oldContent, newContent) {
  const stats = readStats()
  const today = new Date().toISOString().split('T')[0]
  const chapterKey = `${bookName}/${volumeName}/${chapterName}`

  const oldLength = oldContent ? oldContent.length : 0
  const newLength = newContent ? newContent.length : 0
  const wordChange = newLength - oldLength

  // 章节上次统计信息
  const prev = stats.chapterStats[chapterKey]
  const lastUpdate = prev ? prev.lastUpdate : today

  // 1. 先把旧字数从旧日期扣除
  if (prev && stats.dailyStats[lastUpdate]) {
    stats.dailyStats[lastUpdate] -= prev.totalWords
    if (stats.dailyStats[lastUpdate] < 0) stats.dailyStats[lastUpdate] = 0
  }

  // 2. 再把新字数加到今天
  if (!stats.dailyStats[today]) stats.dailyStats[today] = 0
  stats.dailyStats[today] += newLength

  // 3. 更新章节统计
  stats.chapterStats[chapterKey] = {
    totalWords: newLength,
    lastUpdate: today,
    wordChange: wordChange, // 记录本次字数变化
    lastContentLength: oldLength // 记录上次内容长度
  }

  // 4. 更新书籍每日净增字数统计
  if (!stats.bookDailyStats) stats.bookDailyStats = {}
  if (!stats.bookDailyStats[bookName]) stats.bookDailyStats[bookName] = {}
  if (!stats.bookDailyStats[bookName][today]) {
    stats.bookDailyStats[bookName][today] = {
      netWords: 0,
      addWords: 0,
      deleteWords: 0,
      totalWords: 0
    }
  }

  // 计算净增字数
  if (wordChange > 0) {
    stats.bookDailyStats[bookName][today].addWords += wordChange
  } else if (wordChange < 0) {
    stats.bookDailyStats[bookName][today].deleteWords += Math.abs(wordChange)
  }

  stats.bookDailyStats[bookName][today].netWords =
    stats.bookDailyStats[bookName][today].addWords -
    stats.bookDailyStats[bookName][today].deleteWords

  stats.bookDailyStats[bookName][today].totalWords = newLength

  saveStats(stats)
}

// 修改保存章节内容的处理函数
ipcMain.handle(
  'save-chapter',
  async (event, { bookName, volumeName, chapterName, newName, content }) => {
    const booksDir = store.get('booksDir')
    const volumePath = join(booksDir, bookName, '正文', volumeName)
    const oldPath = join(volumePath, `${chapterName}.txt`)
    const newPath = join(volumePath, `${newName || chapterName}.txt`)

    if (!fs.existsSync(oldPath)) {
      return { success: false, message: '章节不存在' }
    }

    // 读取旧内容用于统计
    const oldContent = fs.readFileSync(oldPath, 'utf-8')

    // 1. 先写内容到原文件
    fs.writeFileSync(oldPath, content, 'utf-8')

    // 2. 判断是否需要重命名
    if (newName && newName !== chapterName) {
      if (fs.existsSync(newPath)) {
        return { success: false, message: '章节名已存在', name: chapterName }
      }
      fs.renameSync(oldPath, newPath)
    }

    // 3. 更新统计
    updateChapterStats(bookName, volumeName, chapterName, oldContent, content)

    // 4. 更新书籍元数据
    await updateBookMetadata(bookName)

    return { success: true, name: newName || chapterName }
  }
)

// 修改获取每日码字数统计的处理函数
ipcMain.handle('get-daily-word-count', async () => {
  try {
    const stats = readStats()
    return { success: true, data: stats.dailyStats }
  } catch (error) {
    console.error('获取每日码字统计失败:', error)
    return { success: false, message: '获取统计失败' }
  }
})

// 新增：获取书籍每日净增字数统计
ipcMain.handle('get-book-daily-stats', async (event, bookName) => {
  try {
    const stats = readStats()
    if (!stats.bookDailyStats || !stats.bookDailyStats[bookName]) {
      return { success: true, data: {} }
    }
    return { success: true, data: stats.bookDailyStats[bookName] }
  } catch (error) {
    console.error('获取书籍每日统计失败:', error)
    return { success: false, message: '获取统计失败' }
  }
})

// 新增：获取所有书籍的每日净增字数统计
ipcMain.handle('get-all-books-daily-stats', async () => {
  try {
    const stats = readStats()
    if (!stats.bookDailyStats) {
      return { success: true, data: {} }
    }
    return { success: true, data: stats.bookDailyStats }
  } catch (error) {
    console.error('获取所有书籍每日统计失败:', error)
    return { success: false, message: '获取统计失败' }
  }
})

// 添加获取章节统计的处理函数
ipcMain.handle('get-chapter-stats', async (event, { bookName, volumeName, chapterName }) => {
  try {
    const stats = readStats()
    const chapterKey = `${bookName}/${volumeName}/${chapterName}`
    return { success: true, data: stats.chapterStats[chapterKey] || null }
  } catch (error) {
    console.error('获取章节统计失败:', error)
    return { success: false, message: '获取统计失败' }
  }
})

// 时间线数据读写
ipcMain.handle('read-timeline', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const timelinePath = join(bookPath, 'timelines.json')
  if (!fs.existsSync(timelinePath)) return []
  try {
    return JSON.parse(fs.readFileSync(timelinePath, 'utf-8'))
  } catch {
    return []
  }
})

// 保存时间线数据
ipcMain.handle('write-timeline', async (event, { bookName, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const timelinePath = join(bookPath, 'timelines.json')

  try {
    // 确保目录存在
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }

    fs.writeFileSync(timelinePath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存时间线失败:', error)
    return { success: false, message: error.message }
  }
})

// 人物谱数据读写
ipcMain.handle('read-characters', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const charactersPath = join(bookPath, 'characters.json')
  if (!fs.existsSync(charactersPath)) return []
  try {
    return JSON.parse(fs.readFileSync(charactersPath, 'utf-8'))
  } catch {
    return []
  }
})

// 保存人物谱数据
ipcMain.handle('write-characters', async (event, { bookName, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const charactersPath = join(bookPath, 'characters.json')

  try {
    // 确保目录存在
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }

    fs.writeFileSync(charactersPath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存人物谱失败:', error)
    return { success: false, message: error.message }
  }
})

// 词条字典数据读写
ipcMain.handle('read-dictionary', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const dictionaryPath = join(bookPath, 'dictionary.json')
  if (!fs.existsSync(dictionaryPath)) return []
  try {
    return JSON.parse(fs.readFileSync(dictionaryPath, 'utf-8'))
  } catch {
    return []
  }
})

// 保存词条字典数据
ipcMain.handle('write-dictionary', async (event, { bookName, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const dictionaryPath = join(bookPath, 'dictionary.json')

  try {
    // 确保目录存在
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }

    fs.writeFileSync(dictionaryPath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存词条字典失败:', error)
    return { success: false, message: error.message }
  }
})

// 事序图数据读写
ipcMain.handle('read-sequence-charts', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const filePath = join(bookPath, 'sequence-charts.json')
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return []
  }
})

ipcMain.handle('write-sequence-charts', async (event, { bookName, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const filePath = join(bookPath, 'sequence-charts.json')

  try {
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存事序图失败:', error)
    return { success: false, message: error.message }
  }
})

// 读取地图列表
ipcMain.handle('read-maps', async (event, bookName) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('未设置书籍目录')
    }
    const bookPath = join(booksDir, bookName)
    const mapsDir = join(bookPath, 'maps')
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true })
      return []
    }
    const files = fs.readdirSync(mapsDir)
    const maps = files
      .filter((file) => file.endsWith('.png'))
      .map((file) => {
        const name = file.split('.').slice(0, -1).join('.')
        const filePath = join(mapsDir, file)
        let thumbnail = ''
        try {
          const data = fs.readFileSync(filePath)
          thumbnail = `data:image/png;base64,${data.toString('base64')}`
        } catch {
          thumbnail = ''
        }
        return {
          id: name,
          name: name,
          thumbnail
        }
      })
    return maps
  } catch (error) {
    console.error('读取地图列表失败:', error)
    throw error
  }
})

// 新增：读取地图图片为base64
ipcMain.handle('read-map-image', async (event, { bookName, mapName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('未设置书籍目录')
    }
    const filePath = join(booksDir, bookName, 'maps', `${mapName}.png`)
    if (!fs.existsSync(filePath)) return ''
    const data = fs.readFileSync(filePath)
    return `data:image/png;base64,${data.toString('base64')}`
  } catch {
    return ''
  }
})

// 创建地图（有同名校验）
ipcMain.handle('create-map', async (event, { bookName, mapName, imageData }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('未设置书籍目录')
    }
    const bookPath = join(booksDir, bookName)
    const mapsDir = join(bookPath, 'maps')
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true })
    }
    // 校验同名文件
    const filePath = join(mapsDir, `${mapName}.png`)
    if (fs.existsSync(filePath)) {
      throw new Error('已存在同名地图文件')
    }
    // 保存图片
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(filePath, buffer)
    return {
      success: true,
      path: filePath
    }
  } catch (error) {
    console.error('创建地图失败:', error)
    throw error
  }
})

// 更新地图（无同名校验）
ipcMain.handle('update-map', async (event, { bookName, mapName, imageData }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('未设置书籍目录')
    }
    const bookPath = join(booksDir, bookName)
    const mapsDir = join(bookPath, 'maps')
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true })
    }
    const filePath = join(mapsDir, `${mapName}.png`)
    // 保存图片（覆盖）
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(filePath, buffer)
    return {
      success: true,
      path: filePath
    }
  } catch (error) {
    console.error('更新地图失败:', error)
    throw error
  }
})

// 删除地图
ipcMain.handle('delete-map', async (event, { bookName, mapName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('未设置书籍目录')
    }
    const filePath = join(booksDir, bookName, 'maps', `${mapName}.png`)
    if (!fs.existsSync(filePath)) {
      throw new Error('地图不存在')
    }
    fs.unlinkSync(filePath)
    return { success: true }
  } catch (error) {
    console.error('删除地图失败:', error)
    throw error
  }
})

// --------- 关系图相关 ---------

// 读取关系图列表
ipcMain.handle('read-relationships', async (event, bookName) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('未设置书籍目录')
    }
    const bookPath = join(booksDir, bookName)
    const relationshipsDir = join(bookPath, 'relationships')
    if (!fs.existsSync(relationshipsDir)) {
      fs.mkdirSync(relationshipsDir, { recursive: true })
      return []
    }
    const files = fs.readdirSync(relationshipsDir)
    const relationships = files
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const name = file.replace('.json', '')
        const jsonPath = join(relationshipsDir, `${name}.json`)
        const pngPath = join(relationshipsDir, `${name}.png`)

        let relationshipData = {}
        let thumbnail = ''

        try {
          // 读取JSON数据
          relationshipData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
        } catch (error) {
          console.error(`读取关系图数据失败: ${name}`, error)
          relationshipData = {
            id: name,
            name: name,
            description: '',
            nodes: [],
            lines: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }

        // 检查PNG缩略图是否存在
        if (fs.existsSync(pngPath)) {
          thumbnail = `${name}.png`
        }

        return {
          id: relationshipData.id || name,
          name: relationshipData.name || name,
          description: relationshipData.description || '',
          thumbnail: thumbnail,
          nodes: relationshipData.nodes || [],
          lines: relationshipData.lines || [],
          createdAt: relationshipData.createdAt || new Date().toISOString(),
          updatedAt: relationshipData.updatedAt || new Date().toISOString()
        }
      })
    return relationships
  } catch (error) {
    console.error('读取关系图列表失败:', error)
    throw error
  }
})

// 读取关系图数据
ipcMain.handle('read-relationship-data', async (event, { bookName, relationshipName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('未设置书籍目录')
    }
    const bookPath = join(booksDir, bookName)
    const relationshipsDir = join(bookPath, 'relationships')
    const jsonPath = join(relationshipsDir, `${relationshipName}.json`)

    if (!fs.existsSync(jsonPath)) {
      return null
    }

    const relationshipData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    return relationshipData
  } catch (error) {
    console.error('读取关系图数据失败:', error)
    throw error
  }
})

// 创建关系图
ipcMain.handle(
  'create-relationship',
  async (event, { bookName, relationshipName, relationshipData }) => {
    try {
      const booksDir = await store.get('booksDir')
      if (!booksDir) {
        throw new Error('未设置书籍目录')
      }
      const bookPath = join(booksDir, bookName)
      const relationshipsDir = join(bookPath, 'relationships')

      if (!fs.existsSync(relationshipsDir)) {
        fs.mkdirSync(relationshipsDir, { recursive: true })
      }

      // 检查同名文件
      const jsonPath = join(relationshipsDir, `${relationshipName}.json`)

      if (fs.existsSync(jsonPath)) {
        throw new Error('已存在同名关系图')
      }

      // 只保存JSON数据，不创建PNG文件
      fs.writeFileSync(jsonPath, JSON.stringify(relationshipData, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      console.error('创建关系图失败:', error)
      throw error
    }
  }
)

// 保存关系图数据
ipcMain.handle(
  'save-relationship-data',
  async (event, { bookName, relationshipName, relationshipData }) => {
    try {
      const booksDir = await store.get('booksDir')
      if (!booksDir) {
        throw new Error('未设置书籍目录')
      }
      const bookPath = join(booksDir, bookName)
      const relationshipsDir = join(bookPath, 'relationships')

      if (!fs.existsSync(relationshipsDir)) {
        fs.mkdirSync(relationshipsDir, { recursive: true })
      }

      const jsonPath = join(relationshipsDir, `${relationshipName}.json`)

      // 保存JSON数据
      fs.writeFileSync(jsonPath, JSON.stringify(relationshipData, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      console.error('保存关系图数据失败:', error)
      throw error
    }
  }
)

// 更新关系图缩略图
ipcMain.handle(
  'update-relationship-thumbnail',
  async (event, { bookName, relationshipName, thumbnailData }) => {
    try {
      const booksDir = await store.get('booksDir')
      if (!booksDir) {
        throw new Error('未设置书籍目录')
      }
      const bookPath = join(booksDir, bookName)
      const relationshipsDir = join(bookPath, 'relationships')
      const pngPath = join(relationshipsDir, `${relationshipName}.png`)

      if (!fs.existsSync(relationshipsDir)) {
        fs.mkdirSync(relationshipsDir, { recursive: true })
      }

      // 保存PNG缩略图
      if (thumbnailData) {
        const base64Data = thumbnailData.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64Data, 'base64')
        fs.writeFileSync(pngPath, buffer)
      }

      return { success: true }
    } catch (error) {
      console.error('更新关系图缩略图失败:', error)
      throw error
    }
  }
)

// 删除关系图
ipcMain.handle('delete-relationship', async (event, { bookName, relationshipName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('未设置书籍目录')
    }
    const bookPath = join(booksDir, bookName)
    const relationshipsDir = join(bookPath, 'relationships')
    const jsonPath = join(relationshipsDir, `${relationshipName}.json`)
    const pngPath = join(relationshipsDir, `${relationshipName}.png`)

    // 删除JSON文件
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath)
    }

    // 删除PNG文件
    if (fs.existsSync(pngPath)) {
      fs.unlinkSync(pngPath)
    }

    return { success: true }
  } catch (error) {
    console.error('删除关系图失败:', error)
    throw error
  }
})

// 读取关系图图片
ipcMain.handle('read-relationship-image', async (event, { bookName, imageName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('未设置书籍目录')
    }
    const bookPath = join(booksDir, bookName)
    const relationshipsDir = join(bookPath, 'relationships')
    const imagePath = join(relationshipsDir, imageName)

    if (!fs.existsSync(imagePath)) {
      throw new Error('图片文件不存在')
    }

    const data = fs.readFileSync(imagePath)
    return `data:image/png;base64,${data.toString('base64')}`
  } catch (error) {
    console.error('读取关系图图片失败:', error)
    throw error
  }
})
