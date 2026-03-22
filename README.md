# Infographic API

基于 `Hono + @antv/infographic + Playwright` 的服务端渲染 API。

它接收客户端传入的 infographic 语法（字符串），返回 `PNG` 或 `SVG` 图片。

## Features

- 渲染格式：`png` / `svg`
- 自定义宽高：`width` / `height`
- 自定义清晰度：`dpr`（仅 PNG）
- 可选 Bearer 鉴权：`AUTH_TOKEN`
- 请求日志与渲染耗时：响应头 `X-Render-Time`
- Playwright 页面池复用（性能优化）

## Quick Start

### Install

```bash
pnpm install
```

### Run

```bash
pnpm run dev
# or
pnpm start
```

默认监听：`0.0.0.0:3000`

### Health Check

```bash
curl http://localhost:3000/health
```

## Request Format

接口：`POST /render`

请求头：

- `Content-Type: application/json`
- `Authorization: Bearer <token>`（仅当服务端配置了 `AUTH_TOKEN`）

请求体（JSON）：

```json
{
  "data": "infographic list-row-simple-horizontal-arrow\ndata\n  title Product Roadmap\n  desc 2026 Q1 Plan\n  lists\n    - label Research\n      desc Customer interview\n      value 80\n    - label Build\n      desc Core feature dev\n      value 92",
  "width": 1200,
  "height": 700,
  "format": "png",
  "dpr": 2
}
```

字段说明：

- `data`：`string`，必填，infographic 语法文本
- `width`：`number`，可选，默认 `800`
- `height`：`number`，可选，默认 `600`
- `format`：`"png" | "svg"`，可选，默认 `png`
- `dpr`：`number`，可选，默认 `2`，仅 `png` 生效

返回：

- `format=png`：`Content-Type: image/png`
- `format=svg`：`Content-Type: image/svg+xml`
- 都会返回 `X-Render-Time` 头，表示服务端渲染耗时

错误返回（JSON）：

```json
{
  "error": "Failed to render infographic",
  "message": "具体错误信息"
}
```

## cURL Examples

### Render PNG

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "data": "infographic list-row-simple-horizontal-arrow\ndata\n  title Demo\n  lists\n    - label A\n      value 60",
    "width": 1200,
    "height": 700,
    "format": "png",
    "dpr": 2
  }' \
  --output output.png
```

### Render SVG

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "data": "infographic list-row-simple-horizontal-arrow\ndata\n  title Demo\n  lists\n    - label A\n      value 60",
    "width": 1200,
    "height": 700,
    "format": "svg"
  }' \
  --output output.svg
```

### With Bearer Token

```bash
curl -X POST http://localhost:3000/render \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "data": "infographic list-row-simple-horizontal-arrow\ndata\n  title Secure Demo\n  lists\n    - label A\n      value 60"
  }' \
  --output output.png
```

## Docker

### Run with Docker

```bash
docker run -d \
  --name infographic-api \
  -p 3000:3000 \
  -e AUTH_TOKEN=your-token \
  ghcr.io/krau/infographic-api:latest
```

### Run with Docker Compose

```bash
docker compose up -d
```

## Environment Variables

- `PORT`：默认 `3000`
- `HOST`：默认 `0.0.0.0`
- `AUTH_TOKEN`：设置后启用 Bearer 鉴权
- `PAGE_POOL_SIZE`：Playwright 页面池大小，默认 `2`

## Notes

- 请求体必须是 JSON，且必须包含 `data` 字段。
- `dpr` 只影响 PNG 输出像素密度，不影响 SVG。
- 返回 PNG 实际像素为：`width * dpr` x `height * dpr`。
