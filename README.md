# Infographic API

基于 Hono 和 @antv/infographic 的服务端信息图渲染 API。

## 功能

- 接收信息图语法并渲染为图片
- 支持 PNG 和 SVG 输出格式
- 可配置图片尺寸和 DPI

## 安装

```bash
pnpm install
```

## 开发

```bash
pnpm run dev
```

## 构建

```bash
pnpm run build
```

## 启动

```bash
pnpm start
```

## API 端点

### POST /render

将信息图语法渲染为图片。

#### 请求参数

```json
{
  "syntax": "infographic list-row-simple-horizontal-arrow\ndata\n  title Product Development\n  lists\n    - label Step 1\n    - label Step 2",
  "width": 800,
  "height": 600,
  "format": "png",
  "dpr": 2
}
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| syntax | string | 是 | - | 信息图语法 |
| width | number | 否 | 800 | 图片宽度 |
| height | number | 否 | 600 | 图片高度 |
| format | string | 否 | "png" | 输出格式: "png" 或 "svg" |
| dpr | number | 否 | 2 | 设备像素比 (仅 PNG) |

#### 响应

- **SVG 格式**: 返回 `image/svg+xml` 类型的 SVG 字符串
- **PNG 格式**: 返回 `image/png` 类型的 PNG 图片

#### 示例

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "syntax": "infographic list-row-simple-horizontal-arrow\ndata\n  title Product Development Process\n  lists\n    - label Research\n      desc Market analysis\n    - label Design\n      desc Wireframes",
    "width": 800,
    "height": 600,
    "format": "png"
  }' \
  --output output.png
```

### GET /health

健康检查端点。

```bash
curl http://localhost:3000/health
```

响应:
```json
{ "status": "ok" }
```

## 信息图语法

参考 [@antv/infographic 文档](https://infographic.antv.vision/learn/infographic-syntax) 了解完整的信息图语法。

基本结构:

```
infographic <template-name>
data
  title <title>
  desc <description>
  lists
    - label <label>
      desc <description>
      value <number>
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| PORT | 服务器端口 | 3000 |

## 技术栈

- [Hono](https://hono.dev/) - 轻量级 Web 框架
- [@antv/infographic](https://github.com/antvis/infographic) - 信息图渲染引擎
- [@resvg/resvg-js](https://github.com/yisibl/resvg-js) - SVG 转 PNG 渲染器
