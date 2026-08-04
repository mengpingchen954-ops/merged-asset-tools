# 素材工具台

包含序列帧转换、图片压缩、Cocos 单文件 HTML 5MB 压缩和素材矢量分离工具。所有素材均在浏览器本地处理。

一个完全在浏览器本地运行的素材处理工具集合，包含：

- 序列帧动画：处理 GIF、MP4 和 PNG 序列并导出 Cocos 资源。
- 图片自动压缩：批量压缩 PNG、JPG 和 WebP 图片。
- Cocos HTML 压缩：拖入包含 `window.__zip` 的单文件 HTML，导出 5MB HTML 和三种方向提交包。
- 素材矢量分离器：从图片中分离素材并导出 SVG 或 PNG。

## 在线使用

仓库启用 GitHub Pages 后，打开 Pages 提供的网址即可使用，无需下载安装包。图片和素材默认只在浏览器本地处理，不会上传到服务器。

## 本地预览

需要 Node.js 18 或更高版本：

```powershell
node server.mjs
```

然后打开 `http://127.0.0.1:4176/`。

