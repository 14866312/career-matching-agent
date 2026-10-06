# 项目长期记忆 — career-matching-agent

## 本机环境（Windows）

- **PATH 上的 `python` 是 3.13，但本项目要求 3.12**。`install.ps1` 会断言并中断。
  本机 3.12 解释器在：`C:\Users\lzz\AppData\Roaming\uv\python\cpython-3.12.14-windows-x86_64-none\python.exe`。
  需重建 venv 时用它：`<该解释器> -m venv .venv`，之后 `./install.ps1`、`./start.ps1` 正常。
- `.venv/Scripts/python.exe` 是后端一切命令的解释器（Windows 是 `Scripts/`）。
- 可选依赖 `requirements.samples.txt`（reportlab 等）**仅**用于重建虚构 PDF 样例；
  不装则 `tests/test_samples.py` 会有 1 项失败，其余全绿。用户明确表示不要装。
- `.vscode/` 已在 `.gitignore`，本地已配好 F5 启动与常用任务。

## 前端主题架构（2026-10-06 建立）

- 设计原貌是**纯灰阶深色**主题。**任何新增颜色请保持灰阶（R=G=B）**，
  这样 `scripts/make_light_theme.py` 的亮度反演才继续无损。
- 亮色 / 护眼主题 = `theme-light.css`（**生成物，勿手改**）+ `theme-light-patch.css`（手工修正）。
  两者都在 `styles.css` 末尾导入，全部作用域在 `[data-theme="light"]` 下。
- **改了任何深色 CSS 后必须重跑** `scripts/make_light_theme.py`，否则亮色主题会漏掉新规则。
- 判断「该写进 patch 还是让它自动反演」：凡是**反演后语义变错**的（遮罩要保持深色、
  阴影不能变成白光、toast 要保持深色）写 patch；纯颜色值交给生成器。
- 主题状态：`lib/theme.ts`，键 `career-appearance`，默认 `light`，
  写入 `<html data-theme>`；`index.html` 有首屏内联脚本防闪烁。

## 验证约定

- 无 Playwright 时用 Edge headless + CDP 截图：`tmp/shot.mjs`（tmp/ 已 gitignore）。
- 固定定位元素（弹窗）的裁切判断必须用 `viewport` 模式截图；
  `full` 模式对 fixed 背景会产生假接缝。
