# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

大学生职业规划智能体：本地运行的演示应用（Windows / PowerShell）。FastAPI 后端 + React/Vite 前端，同一端口提供服务。主流程：岗位与路径浏览 → 手动录入或简历导入 → 确定性匹配与推荐 → AI 职业建议 → TXT 导出。操作指南见 `docs/项目使用全过程.md`。

## 常用命令

需要 Python 3.12、Node.js 22.12.0 或更高版本。Windows 下用 `npm.cmd`，Python 用 `.venv/Scripts/python.exe`。

```powershell
./install.ps1                     # 建 .venv、pip install -r requirements.txt、npm ci + 前端构建
./start.ps1                       # 启动 http://127.0.0.1:8000（-Port 8001 换端口），服务 frontend/dist
npm.cmd --prefix frontend run dev # 前端开发服务器 :5173，/api 代理到 :8000

.venv/Scripts/python.exe -m pytest tests -q                                  # 后端全部测试
.venv/Scripts/python.exe -m pytest tests/test_matching.py -q -k <关键字>     # 单个测试
npm.cmd --prefix frontend test                                               # vitest（frontend/src/__tests__）
npm.cmd --prefix frontend test -- src/__tests__/workflow.test.ts            # 单个前端测试文件
npm.cmd --prefix frontend run build                                          # tsc --noEmit + vite build（即类型检查）

.venv/Scripts/python.exe scripts/build_data.py   # 从赛题 XLS 重建 backend/data/career-data.json

# 浏览器 E2E：先起测试专用服务器（:8011，模型 JSON 为替身），再在另一终端运行
.venv/Scripts/python.exe tests/e2e_server.py
npm.cmd --prefix tests/browser test              # run.cjs；test:ui 跑 ui_regressions.cjs，test:a11y 跑 a11y.cjs（axe）；默认用本机 Edge，PW_CHANNEL=chromium 可切换，E2E_URL 改地址

.venv/Scripts/python.exe scripts/smoke_live.py   # 生产服务启动后真实调用已配置的模型供应商
.venv/Scripts/python.exe -m ruff check backend scripts tests  # Python 静态检查
npm.cmd --prefix frontend run lint                         # TypeScript/React 静态检查
```

修改前端后必须重新 run build 并重启服务，start.ps1 不会重复安装或构建。Ruff 和 ESLint 只做检查，不自动改写文件。

CI（`.github/workflows/ci.yml`）依次跑 ruff、pytest、前端 lint / test / build 与浏览器 E2E，提交前本地按同样顺序自检。

## 代码风格与提交

- Python：4 空格、`snake_case`，Ruff 目标 py312、行宽 100（E501 已忽略，只启用 E4/E7/E9/F）。前端：TypeScript strict，单引号加分号，组件 `PascalCase`，函数变量 `camelCase`；后端测试 `test_*.py`，前端测试 `*.test.ts`。
- 提交信息用 Conventional Commits，如 `fix(frontend): ...`、`docs(acceptance): ...`；PR 需写明用户可见变化、领域/隐私影响、验证命令，UI 改动附截图。

## 架构

后端 `backend/app/`：
- `main.py`：全部 `/api/*` 路由；中间件统一限制 POST 体积（简历 5MB+余量，其他 1MB）、注入 `X-Request-ID`、`Cache-Control: no-store`；所有错误都返回 `{error: {code, message, retryable, request_id}}` 结构。存在 `frontend/dist` 时挂载为静态站点。
- `matching.py`：核心业务，纯确定性计算，大模型不参与评分。基础分 / 增强分（matching-2.2：资料已提及且 level>0 即计满足，精确贡献为 1，不按熟练度折算）、资料已提及 / 资料未提及划分、岗位要求等级记录（了解/熟悉/熟练 → 1/2/3，缺省 2，仅展示）、关联技能上限 0.25、推荐（最多 5 个，排序同分按岗位 ID）、城市与薪资筛选（月薪/日薪不换算）。`ALGORITHM_VERSION` 等版本号参与结果指纹，前端据此判断报告是否过期；改变评分口径时要同步升级版本号与测试。README「给开发者 → 完整评分规则」是规则的权威描述；「匹配度是怎么算的」是给普通读者的通俗版，改口径时两处都要同步。
- `llm.py`：兼容 Chat Completions / OpenAI Responses 的模型调用（`call_json` 是唯一出口），每次上游调用有 45 秒预算及符合条件时的一次重试，含 pydantic 输出校验、简历证据窗口校验与提示注入过滤。`POST /api/llm/config` 只修改进程内 `os.environ`，不写回 `.env`。
- `resume.py`：PDF/DOCX/TXT 文本提取与大小、字符数限制（无 OCR，不静默截断）。
- `data.py`：读取生成数据 `backend/data/career-data.json`。该文件由 `scripts/build_data.py` 从只读的 `competition/岗位样例数据.xls` 生成，不要手改；`docs/职业数据审核.md` 也由脚本同步生成。数据口径与证据规则见 `docs/数据字典.md`。

前端 `frontend/src/`：`lib/useCareerSession.ts` 协调资料、会话姓名、revision、本机草稿、目标岗位、路径选择与 workflow；`App.tsx` 负责页面组合、Toast 和弹窗开关。四个标签页在 `components/`（Jobs / Profile / Matches / Paths），常驻渲染，网络副作用由页面是否激活控制。可单测的纯逻辑放在 `lib/`（`workflow.ts` 推导流程步骤状态，`stale.ts` 判断报告是否过期，`localDraft.ts` 本地草稿，`resumeImport.ts`、`filters.ts`、`onboarding.ts`），测试在 `__tests__/`。API 类型在 `types.ts`，请求封装在 `api.ts`。

测试：`tests/e2e_server.py` 只把 `llm.call_json` 替换为确定性假数据，匹配、校验、文件解析和报告组装都是真实代码。mock 结果不能当作真实 AI 调用的验收证据。

## 领域约束

- 先读 `CONTEXT.md`（术语表）和 `docs/adr/`。命名、测试名、issue 标题要使用其中的术语，例如「基础匹配分」不能称为 AI 评分，「资料未提及」不等于「不具备」。
- ADR 0002：资料（简历或手动）提及的技能直接参与匹配，不需要逐项或整份确认，也不要求证据；`confirmed` 字段只为兼容旧草稿。「简历摘录」只用于核对，不是提交门槛。
- ADR 0001：简历姓名只在当前会话展示，不持久化，不进入后续模型请求、匹配评分或 TXT 报告。与 ADR 冲突的改动要先向用户说明。
- 学生资料不在服务器落盘，也不记录简历正文日志。
- 修改模型调用先读 `docs/AI接口契约.md`；核对当前交付状态先读 `docs/acceptance/项目稳定性验收.md`，真实供应商证据见 `docs/acceptance/真实模型验收.md`。

## 工作约定

- 开始工作前先读 `docs/工作日志.md`（当前状态、用户的长期决定、GitHub 流程和待办）；完成重要工作后在其「日志」一节最上方追加一条，并更新「当前状态」。
- Issue 与 spec 使用本地 Markdown：`本地资料/scratch/<feature-slug>/spec.md` 和 `issues/NN-<slug>.md`。文件顶部写 `Status:` 行，使用 needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix 五种标签，讨论记录追加在 `## Comments` 下（见 `docs/agents/`）。
- `competition/` 是只读的原始赛题材料；`samples/` 全部为虚构数据；`.env` 含密钥，不要读取或回显其中的值。
