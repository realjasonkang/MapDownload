# MapDownload 项目规范文档

## 项目概述

MapDownload 是一个基于 Electron + Vue 3 的桌面应用程序，用于下载多种在线地图服务的瓦片数据，支持行政区划裁切、多格式导出等功能。

## 技术栈

### 核心框架
- **Electron**: v16.0.1 - 桌面应用框架
- **Vue**: v3.2.22 - 前端框架
- **Vue Router**: v4.0.12 - 路由管理
- **Vite**: v2.6.14 - 构建工具

### UI 组件库
- **Naive UI**: v2.28.0 - Vue 3 UI 组件库
- **@vicons/ionicons5**: v0.12.0 - 图标库

### 地图相关
- **Maptalks**: v1.0.0-rc.33 - 地图渲染引擎
- **@turf/***: v6.5.0 - 地理空间分析库（boolean-contains, boolean-crosses, boolean-disjoint, helpers, intersect）

### 工具库
- **Sharp**: v0.29.3 - 图像处理
- **Superagent**: v6.1.0 - HTTP 请求
- **fs-extra**: v10.0.0 - 文件系统扩展
- **Marked**: v4.0.8 - Markdown 解析

### 开发工具
- **ESLint**: v8.3.0 - 代码检查
- **eslint-plugin-vue**: v8.1.1 - Vue 代码检查
- **Sass**: v1.45.0 - CSS 预处理器

## 项目结构

```
MapDownload/
├── packages/                    # Monorepo 结构
│   ├── main/                   # Electron 主进程
│   │   ├── src/
│   │   │   ├── index.js        # 主进程入口
│   │   │   ├── ipcMain.js      # IPC 通信处理
│   │   │   └── ipHandle.js     # IP 处理逻辑
│   │   └── vite.config.js      # 主进程构建配置
│   ├── preload/                # Electron Preload 脚本
│   │   ├── src/
│   │   │   └── index.js        # Preload 入口
│   │   └── vite.config.js      # Preload 构建配置
│   └── renderer/               # 渲染进程（Vue 前端）
│       ├── src/
│       │   ├── components/     # Vue 组件
│       │   ├── utils/          # 工具函数
│       │   │   ├── TileLayerCollection/  # 瓦片图层集合
│       │   │   │   ├── tilelayers/       # 各地图服务实现
│       │   │   │   ├── TileLayerCollection.js
│       │   │   │   ├── param.js
│       │   │   │   └── utils.js
│       │   │   ├── download.js           # 下载逻辑
│       │   │   ├── fileSave.js           # 文件保存
│       │   │   ├── baseMap.js            # 地图基础操作
│       │   │   └── ...
│       │   ├── cesium-helper/  # Cesium 百度地图支持
│       │   ├── geojson/        # 行政区划数据
│       │   ├── style/          # 样式文件
│       │   ├── App.vue         # 根组件
│       │   ├── router.js       # 路由配置
│       │   └── index.js        # 渲染进程入口
│       └── vite.config.js      # 渲染进程构建配置
├── scripts/                    # 构建脚本
│   ├── build.js                # 构建脚本
│   ├── watch.js                # 开发监听
│   └── update-electron-vendors.js
├── tests/                      # 测试文件
│   └── app.spec.js
├── buildResources/             # 构建资源
├── .electron-builder.config.js # Electron Builder 配置
├── .eslintrc.json              # ESLint 配置
├── .editorconfig               # 编辑器配置
└── package.json                # 项目配置
```

## 代码规范

### 编码风格

#### 基本规则
- **缩进**: 2 空格
- **引号**: 单引号
- **分号**: 必须使用分号
- **编码**: UTF-8
- **换行符**: LF (Unix 风格)
- **尾随空格**: 自动删除（Markdown 文件除外）
- **文件末尾**: 插入空行

#### ESLint 规则
```json
{
  "semi": ["error", "always"],
  "comma-dangle": ["warn", "always-multiline"],
  "quotes": ["warn", "single"]
}
```

### 命名约定

#### 文件命名
- **Vue 组件**: PascalCase (如 `LayerControl.vue`, `AreaChoose.vue`)
- **JavaScript 模块**: camelCase (如 `download.js`, `fileSave.js`)
- **工具类**: PascalCase (如 `ClipImage.js`)
- **配置文件**: kebab-case 或 camelCase

#### 变量命名
- **变量/函数**: camelCase (如 `downloadPath`, `apiDownload`)
- **常量**: UPPER_SNAKE_CASE 或 PascalCase (如 `CLIPIMAGE`)
- **类/构造函数**: PascalCase (如 `ClipImage`)
- **私有变量**: 下划线前缀 (如 `_downloadImage`)

#### Vue 组件
- 组件名使用 PascalCase
- 使用 `defineComponent` 定义组件
- 组件 `name` 属性必须设置

### Electron IPC 通信规范

#### 主进程处理
```javascript
ipcMain.handle('channel-name', async (event, data) => {
  try {
    // 处理逻辑
    return { success: true, data: result };
  } catch (error) {
    console.error('Error:', error);
    return { success: false, error: error.message };
  }
});
```

#### 渲染进程调用
```javascript
window.electron.ipcRenderer.send('channel-name', data);
window.electron.ipcRenderer.on('channel-name-reply', (event, result) => {
  // 处理响应
});
```

## 架构模式

### Monorepo 结构
项目采用 Monorepo 结构，将 Electron 的三个主要部分分离：
- **main**: 主进程逻辑，负责窗口管理、IPC 通信、文件操作
- **preload**: 预加载脚本，暴露安全的 API 给渲染进程
- **renderer**: 渲染进程，Vue 3 应用

### 模块化设计

#### 瓦片图层系统
```
TileLayerCollection/
├── TileLayerCollection.js      # 图层集合管理
├── BaseTileLayer.js            # 基类
├── AmapTileLayer.js            # 高德地图
├── BaiduTileLayer.js           # 百度地图
├── TencentTileLayer.js         # 腾讯地图
├── OsmTileLayer.js             # OpenStreetMap
├── TdtTileLayer.js             # 天地图
├── GoogleTileLayer.js          # Google 地图
├── MapboxTileLayer.js          # Mapbox
├── CartoDbTileLayer.js         # CartoDB
└── GeoqTileLayer.js            # GeoQ
```

#### 下载流程
1. 用户选择下载范围（矩形或行政区划）
2. 计算所需瓦片列表
3. 判断瓦片与下载范围的关系（完全包含、完全在外、部分相交）
4. 部分相交时进行裁切
5. 保存瓦片到本地

### 状态管理
使用模块化的状态管理，不使用 Vuex/Pinia：
- `progress.js`: 下载进度状态
- `baseMap.js`: 地图状态
- `mapKey.js`: 地图密钥管理

## 开发流程

### 环境要求
- Node.js >= v16.13
- npm >= v8.1

### 常用命令

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run dev
# 或
npm run watch

# 代码检查
npm run lint

# 构建 Web
npm run build

# 构建应用
npm run compile

# 运行测试
npm run test
```

### 构建配置

#### Vite 配置
- **渲染进程**: 使用 Vue 插件，目标 Chrome 96
- **主进程**: 输出 CJS 格式，目标 Node.js
- **Preload**: 输出 CJS 格式

#### Electron Builder 配置
- 输出目录: `dist/`
- 构建资源: `buildResources/`
- NSIS 安装程序: 支持自定义安装目录

## 功能模块

### 支持的地图服务
1. 高德地图
2. 百度地图（含自定义样式）
3. 腾讯地图
4. OpenStreetMap
5. CartoDB
6. ArcGIS 在线地图
7. 天地图
8. Mapbox
9. GeoQ

### 核心功能
- 瓦片下载（支持多地图源）
- 行政区划下载（GeoJSON 边界裁切）
- 卫星影像与标注合并
- 多格式导出（JPEG、PNG、WebP）
- 下载进度显示


## 扩展开发

### 添加新地图源
1. 在 `TileLayerCollection/tilelayers/` 创建新类
2. 继承 `BaseTileLayer`
3. 实现 `getTileUrl` 方法
4. 在 `TileLayerCollection.js` 中注册

### 添加新功能
1. 在 `components/` 创建 Vue 组件
2. 在 `utils/` 实现业务逻辑
3. 更新路由配置（如需要）
4. 添加 IPC 通信（如需要）

## 相关链接

- [Electron 文档](https://www.electronjs.org/docs)
- [Vue 3 文档](https://v3.vuejs.org/)
- [Vite 文档](https://vitejs.dev/)
- [Naive UI 文档](https://www.naiveui.com/)
- [Maptalks 文档](https://maptalks.org/)
- [Turf.js 文档](https://turfjs.org/)
