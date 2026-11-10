# ai-phone web 控制台

用 TypeScript + React + antd 编写的 ai-phone 管理前端。浏览器无法直连 ai-phone 的
Unix 控制套接字,所以本目录包含两部分:

- **桥接服务** (`server/`):Node Express 服务,直连 `~/.ai-phone/control.sock`,
  把 daemon 的 NDJSON 协议转成 HTTP API + SSE 事件流。仅监听 `127.0.0.1`。
- **前端** (`src/`):仪表盘、拨打电话(电话代理 / 中继)、中继控制台(listen/say/hangup)、
  通话记录与转写。

## 前提

- Node.js ≥ 18
- ai-phone 已完成 setup,守护进程正在运行(`ai-phone run`)

## 开发

```bash
cd web
npm install
npm run dev
```

开发模式同时启动 Vite(5173 端口)和桥接服务(8787 端口),打开 http://localhost:5173 。

没有真实 daemon 时,可以用假 daemon 开发界面:

```bash
npm run dev                          # 终端 1
npx tsx scripts/fake-daemon.ts       # 终端 2(模拟 ~/.ai-phone/control.sock)
```

注意假 daemon 会占用真实的控制套接字路径;先停掉真实 daemon 再用它。

## 生产

```bash
npm run build      # 类型检查 + 打包前端到 dist/
npm start          # 单进程:桥接服务 + 静态托管 dist/,http://127.0.0.1:8787
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 桥接与 daemon 存活状态 |
| GET | `/api/status` | 线路注册状态、活动通话(一次性) |
| GET | `/api/events` | SSE:定时 `status` 快照 + 实时 `call_event` |
| POST | `/api/call` | 拨号:`{to, line?, prompt?, relay?, timeout_sec?}` |
| POST | `/api/say` | 中继模式说话:`{text, call_id?}` |
| POST | `/api/listen` | 中继模式听一轮:`{timeout_sec?, call_id?}` |
| POST | `/api/hangup` | 挂断:`{call_id?, say?}` |
| GET | `/api/history` | 本控制台发起的通话列表 |
| GET | `/api/history/:id` | 单次通话详情(含转写) |

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 桥接服务端口 |
| `AI_PHONE_HOME` | `~/.ai-phone` | 与 ai-phone 本体一致的 home 目录 |
| `STATUS_POLL_MS` | `2000` | SSE 状态快照间隔 |

## 安全

桥接服务只监听回环地址,可以驱动真实电话呼出。请勿暴露到局域网。
