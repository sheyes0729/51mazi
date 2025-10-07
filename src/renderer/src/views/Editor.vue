<template>
  <div class="editor-container">
    <WindowHeader />
    <div class="editor-body">
      <el-splitter>
        <el-splitter-panel :size="240" :min="200" :max="400">
          <!-- 左侧面板：笔记章节 -->
          <NoteChapter ref="noteChapterRef" :book-name="bookName" />
        </el-splitter-panel>
        <el-splitter-panel>
          <!-- 中间编辑区 -->
          <EditorPanel
            :book-name="bookName"
            @refresh-notes="refreshNotes"
            @refresh-chapters="refreshChapters"
          />
        </el-splitter-panel>
        <el-splitter-panel :size="150" :resizable="false">
          <!-- 右侧工具栏 -->
          <EditorToolbar />
        </el-splitter-panel>
      </el-splitter>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import NoteChapter from '@renderer/components/NoteChapter.vue'
import EditorPanel from '@renderer/components/EditorPanel.vue'
import EditorToolbar from '@renderer/components/EditorToolbar.vue'
import WindowHeader from '@renderer/components/WindowHeader.vue'

const route = useRoute()

// 解析新窗口参数
let bookName = null
if (window.process && window.process.argv) {
  // Electron 传递的 additionalArguments
  for (const arg of window.process.argv) {
    if (arg.startsWith('bookName=')) bookName = decodeURIComponent(arg.replace('bookName=', ''))
  }
}
if (!bookName) {
  // 回退到 hash/query
  bookName = route.query.name
}

const noteChapterRef = ref(null)

function refreshNotes() {
  noteChapterRef.value && noteChapterRef.value.reloadNotes && noteChapterRef.value.reloadNotes()
}

function refreshChapters() {
  noteChapterRef.value &&
    noteChapterRef.value.reloadChapters &&
    noteChapterRef.value.reloadChapters()
}

// function handleSelectFile(file) {
//   // 预留：可做高亮、聚焦等
// }
</script>

<style lang="scss" scoped>
.editor-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-primary);
  position: relative;
  overflow: hidden;
  background-color: #f8f1e3;
  /* 仿旧纸张的米黄色 */
  background-image:
    linear-gradient(90deg, rgba(0, 0, 0, 0.03) 1px, transparent 1px),
    linear-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px);
  /* 添加细微的纸张纹理 */
  background-size: 20px 20px;
  /* 模拟书本页边距 */
  box-shadow:
    inset 0 0 30px rgba(0, 0, 0, 0.05),
    0 0 15px rgba(0, 0, 0, 0.1);
  /* 外阴影增加立体感 */
  border: 1px solid #e0d5c0;
  /* 纸张边框色 */
  min-height: calc(100vh - 80px);
  /* 确保高度 */
  box-sizing: border-box;
}

.editor-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
