<script setup>
import { FullScreen, Minus, Close } from '@element-plus/icons-vue'

function operationWindow(action) {
  window.electron?.operationWindow(action)
}
</script>

<template>
  <div class="home-header">
    <div class="logo-container">
      <img src="/src/assets/images/logo.jpeg" alt="logo" class="logo-icon" />
    </div>
    <div class="header-icons">
      <el-icon class="icon-minus" size="20" @click="operationWindow('minus')">
        <Minus />
      </el-icon>
      <el-icon class="icon-fullscreen" size="20" @click="operationWindow('fullscreen')">
        <FullScreen />
      </el-icon>
      <el-icon class="icon-close" size="20" @click="operationWindow('close')">
        <Close />
      </el-icon>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.home-header {
  height: 36px;
  border-bottom: 1px solid var(--border-color);
  app-region: drag;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}

.header-icons {
  display: flex;
  align-items: center;
  gap: 12px;

  .el-icon {
    cursor: pointer;
    app-region: no-drag;
    color: white;
    border-radius: 50%;
    padding: 4px;
  }

  .icon-minus {
    background-color: orange;
  }

  .icon-fullscreen {
    background-color: #4caf50;
  }

  .icon-close {
    background-color: #ff5500;
  }
}

.logo-container {
  height: calc(100% - 8px);
  app-region: no-drag;
  user-select: none;

  .logo-icon {
    height: 100%;
    object-fit: cover;
  }
}
</style>
