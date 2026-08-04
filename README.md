# 素材工具台

包含 Cocos 单文件 HTML 5MB 压缩、序列帧转换和素材矢量分离工具。所有素材均在浏览器本地处理。

一个完全在浏览器本地运行的素材处理工具集合，包含：

- Cocos HTML 压缩：拖入包含 `window.__zip` 或 `window.__adapter_zip__` 的单文件 HTML，使用本地 WebP 与 MP3 WASM 压缩并导出 5MB HTML 和三种方向提交包。
- 序列帧动画：处理 GIF、MP4 和 PNG 序列，支持拖入单个 PNG 序列文件夹，以 256、128、64 色或原像素无损档位导出原尺寸压缩序列 ZIP 和 Cocos 资源。
- 素材矢量分离器：从图片中分离素材并导出 SVG 或 PNG。

## 在线使用

仓库启用 GitHub Pages 后，打开 Pages 提供的网址即可使用，无需下载安装包。图片和素材默认只在浏览器本地处理，不会上传到服务器。

## 本地预览

需要 Node.js 18 或更高版本：

```powershell
node server.mjs
```

然后打开 `http://127.0.0.1:4176/`。

